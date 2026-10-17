import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { Org, Session, Submission, User } from '../src/models.js';
import { Consent, CONSENT_NOTICE_VERSION, Entrepreneur } from '../src/modules/entrepreneur/models.js';
import { DocumentChunk, Pitch, PitchDocument } from '../src/modules/entrepreneur/intake-models.js';
import { readOriginal } from '../src/modules/entrepreneur/storage.js';
import { setIngestRunner, Transcript, type IngestJob } from '../src/modules/entrepreneur/processing.js';

// Synthetic values only.
const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters', PII_ENCRYPTION_KEY: 'cd'.repeat(32) });
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let centre: InstanceType<typeof Org>;
let sibling: InstanceType<typeof Org>;
let partnerOrg: InstanceType<typeof Org>;
let applicant: InstanceType<typeof User>;
let other: InstanceType<typeof User>;
let facilitator: InstanceType<typeof User>;

const as = async (user: { _id: unknown }) => `Bearer ${await sessionService(config).create(String(user._id))}`;
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const audio = (size: number) => Buffer.from(Array.from({ length: size }, (_, index) => index % 251));
async function consent(auth: string) {
  await request(app).post('/api/v1/consents').set('Authorization', auth)
    .send({ purpose: 'processing', noticeVersion: CONSENT_NOTICE_VERSION, language: 'mr', method: 'app_tap' }).expect(201);
}
async function upload(auth: string, documentId: string, data: Buffer, chunk = 1024 * 1024) {
  let last;
  for (let offset = 0; offset < data.length; offset += chunk) {
    last = await request(app).put(`/api/v1/documents/${documentId}/content`).set('Authorization', auth)
      .set('Content-Type', 'application/octet-stream').set('Upload-Offset', String(offset)).send(data.subarray(offset, offset + chunk));
  }
  return last!;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all([User, Org, Session, Submission, Entrepreneur, Consent, Pitch, PitchDocument, DocumentChunk].map(model => (model as typeof User).init()));
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await Promise.all([User, Org, Session, Submission, Entrepreneur, Consent, Pitch, PitchDocument, DocumentChunk, Transcript].map(model => (model as typeof User).init()));
  [centre, sibling, partnerOrg] = await Org.create([
    { name: 'Synthetic Nashik centre', type: 'centre' }, { name: 'Synthetic sibling centre', type: 'centre' },
    { name: 'Synthetic NGO', type: 'implementation_partner' },
  ]) as [typeof centre, typeof sibling, typeof partnerOrg];
  applicant = await User.create({ displayName: 'Entrepreneur', role: 'entrepreneur', email: 'synthetic-intake-1@pitchprism.test' });
  other = await User.create({ displayName: 'Entrepreneur', role: 'entrepreneur', email: 'synthetic-intake-2@pitchprism.test' });
  facilitator = await User.create({ displayName: 'Synthetic facilitator', email: 'fac@pitchprism.test', role: 'facilitator', orgId: centre._id });
  app = createApp(config);
});

describe('guided prompts and centres', () => {
  it('serves the question-bank prompt cards in six languages to pitching roles only', async () => {
    const response = await request(app).get('/api/v1/pitch-prompts').set('Authorization', await as(applicant)).expect(200);
    expect(response.body.steps.map((step: { key: string }) => step.key)).toEqual(['sell', 'buyers', 'where', 'money', 'skills']);
    expect(Object.keys(response.body.steps[0].prompt).sort()).toEqual(['bn', 'en', 'hi', 'mr', 'or', 'te']);
    expect(response.body.review.hi).toBe('unreviewed');
    const assessor = await User.create({ displayName: 'Synthetic assessor', email: 'a@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
    await request(app).get('/api/v1/pitch-prompts').set('Authorization', await as(assessor)).expect(403);
    const centres = await request(app).get('/api/v1/centres').set('Authorization', await as(applicant)).expect(200);
    expect(centres.body.centres.map((item: { name: string }) => item.name)).toEqual(['Synthetic Nashik centre', 'Synthetic sibling centre']);
  });
});

describe('self-service pitch', () => {
  it('creates one draft per device draft ID and keeps drafts private', async () => {
    const auth = await as(applicant);
    const body = { clientDraftId: 'draft-0001-abc', mode: 'typed', language: 'mr', centreId: String(centre._id) };
    const first = await request(app).post('/api/v1/pitches').set('Authorization', auth).send(body).expect(201);
    const retry = await request(app).post('/api/v1/pitches').set('Authorization', auth).send(body).expect(200);
    expect(retry.body.id).toBe(first.body.id);
    await request(app).post('/api/v1/pitches').set('Authorization', auth).send({ ...body, clientDraftId: 'draft-0002-abc', entrepreneurId: String(other._id) }).expect(400);
    await request(app).post('/api/v1/pitches').set('Authorization', auth).send({ ...body, clientDraftId: 'draft-0003-abc', centreId: String(partnerOrg._id) }).expect(400);
    await request(app).get(`/api/v1/pitches/${first.body.id}`).set('Authorization', await as(other)).expect(404);
    await request(app).get(`/api/v1/pitches/${first.body.id}`).set('Authorization', await as(facilitator)).expect(404);
  });

  it('uploads resumably, refuses wrong offsets, and stores the verified original immutably', async () => {
    const auth = await as(applicant);
    const pitch = await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: 'draft-upload-1', mode: 'guided', language: 'hi' }).expect(201);
    const data = audio(1024 * 1024 + 4096);
    const meta = { clientFileId: 'file-sell-0001', kind: 'audio', bytes: data.length, sha256: sha(data), mime: 'audio/ogg', promptStep: 'sell' };
    const created = await request(app).post(`/api/v1/pitches/${pitch.body.id}/documents`).set('Authorization', auth).send(meta).expect(201);
    const id = created.body.id;
    await request(app).post(`/api/v1/pitches/${pitch.body.id}/documents`).set('Authorization', auth).send(meta).expect(200);
    await request(app).post(`/api/v1/pitches/${pitch.body.id}/documents`).set('Authorization', auth).send({ ...meta, sha256: 'a'.repeat(64) }).expect(409);
    const put = (offset: number, chunk: Buffer, user = auth) => request(app).put(`/api/v1/documents/${id}/content`).set('Authorization', user)
      .set('Content-Type', 'application/octet-stream').set('Upload-Offset', String(offset)).send(chunk);
    const firstChunk = await put(0, data.subarray(0, 1024 * 1024)).expect(200);
    expect(firstChunk.body).toMatchObject({ receivedBytes: 1024 * 1024, state: 'receiving' });
    // The app restarted and resent the first chunk: the server keeps its count and says where to resume.
    const conflict = await put(0, data.subarray(0, 1024 * 1024)).expect(409);
    expect(conflict.body.receivedBytes).toBe(1024 * 1024);
    await put(1024 * 1024, data.subarray(1024 * 1024), await as(other)).expect(404);
    const done = await put(1024 * 1024, data.subarray(1024 * 1024)).expect(200);
    expect(done.body).toMatchObject({ state: 'complete', receivedBytes: data.length });
    const stored = await PitchDocument.findById(id).lean();
    expect((await readOriginal(stored!.storageId!)).equals(data)).toBe(true);
    expect(await DocumentChunk.countDocuments()).toBe(0);
    await put(0, data.subarray(0, 10)).expect(409);
  });

  it('rejects content whose hash does not match, oversized files and wrong types', async () => {
    const auth = await as(applicant);
    const pitch = await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: 'draft-upload-2', mode: 'upload', language: 'en' }).expect(201);
    const data = audio(2048);
    const created = await request(app).post(`/api/v1/pitches/${pitch.body.id}/documents`).set('Authorization', auth)
      .send({ clientFileId: 'file-pdf-00001', kind: 'pdf', bytes: data.length, sha256: sha(Buffer.from('other')), mime: 'application/pdf' }).expect(201);
    const result = await upload(auth, created.body.id, data);
    expect(result.body.state).toBe('rejected');
    await request(app).post(`/api/v1/pitches/${pitch.body.id}/documents`).set('Authorization', auth)
      .send({ clientFileId: 'file-big-00001', kind: 'image', bytes: 50 * 1024 * 1024, sha256: sha(data), mime: 'image/jpeg' }).expect(413);
    await request(app).post(`/api/v1/pitches/${pitch.body.id}/documents`).set('Authorization', auth)
      .send({ clientFileId: 'file-exe-00001', kind: 'pdf', bytes: 100, sha256: sha(data), mime: 'application/x-msdownload' }).expect(400);
  });

  it('submits once, only with consent, a centre and content; the centre then sees it and siblings do not', async () => {
    const auth = await as(applicant);
    const pitch = await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: 'draft-submit-1', mode: 'typed', language: 'mr' }).expect(201);
    const submit = () => request(app).post(`/api/v1/pitches/${pitch.body.id}/submit`).set('Authorization', auth).send({});
    await submit().expect(403);
    await consent(auth);
    await submit().expect(409);
    await Pitch.updateOne({ _id: pitch.body.id }, { centreId: centre._id });
    await submit().expect(409);
    await request(app).put(`/api/v1/pitches/${pitch.body.id}/answers`).set('Authorization', auth)
      .send({ answers: [{ step: 'sell', text: 'पापड आणि लोणचे' }, { step: 'money', text: '₹15,000' }] }).expect(200);
    const submitted = await submit().expect(201);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', pipeline: 'pending_queue' });
    expect(submitted.body.documents).toEqual([expect.objectContaining({ kind: 'text', state: 'complete' })]);
    expect((await submit().expect(200)).body.submissionId).toBe(submitted.body.submissionId);
    expect(await Submission.countDocuments()).toBe(1);
    await request(app).put(`/api/v1/pitches/${pitch.body.id}/answers`).set('Authorization', auth).send({ answers: [] }).expect(409);
    const mine = await request(app).get('/api/v1/me/submissions').set('Authorization', auth).expect(200);
    expect(mine.body.submissions.map((item: { id: string }) => item.id)).toEqual([submitted.body.submissionId]);
    const assessor = await User.create({ displayName: 'Synthetic assessor', email: 'a@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
    const siblingAssessor = await User.create({ displayName: 'Synthetic sibling', email: 's@pitchprism.test', role: 'centre_assessor', orgId: sibling._id });
    await request(app).get(`/api/v1/submissions/${submitted.body.submissionId}`).set('Authorization', await as(assessor)).expect(200);
    await request(app).get(`/api/v1/submissions/${submitted.body.submissionId}`).set('Authorization', await as(siblingAssessor)).expect(404);
  });
});

describe('assisted mode', () => {
  const applicantBody = { clientApplicantId: 'applicant-0001', language: 'te', name: 'Synthetic Assisted Applicant', district: 'Ranga Reddy', trade: 'Tailoring' };

  it('registers applicants once per device ID, seals names, and isolates facilitators', async () => {
    const auth = await as(facilitator);
    const first = await request(app).post('/api/v1/assisted/applicants').set('Authorization', auth).send(applicantBody).expect(201);
    const retry = await request(app).post('/api/v1/assisted/applicants').set('Authorization', auth).send(applicantBody).expect(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({ name: 'Synthetic Assisted Applicant', processingConsent: false });
    const raw = await mongoose.connection.collection('entrepreneurs').findOne({ _id: new mongoose.Types.ObjectId(first.body.id as string) });
    expect(JSON.stringify(raw)).not.toContain('Synthetic Assisted Applicant');
    await request(app).post('/api/v1/assisted/applicants').set('Authorization', auth).send({ ...applicantBody, clientApplicantId: 'applicant-0002', district: undefined }).expect(400);
    const colleague = await User.create({ displayName: 'Synthetic colleague', email: 'col@pitchprism.test', role: 'facilitator', orgId: centre._id });
    expect((await request(app).get('/api/v1/assisted/applicants').set('Authorization', await as(colleague)).expect(200)).body.applicants).toEqual([]);
    await request(app).post(`/api/v1/assisted/applicants/${first.body.id}/evidence`).set('Authorization', await as(colleague))
      .send({ clientFileId: 'evidence-0001', bytes: 10, sha256: 'b'.repeat(64), mime: 'audio/ogg' }).expect(404);
    await request(app).post('/api/v1/assisted/applicants').set('Authorization', await as(applicant)).send(applicantBody).expect(403);
  });

  it('needs a complete spoken-consent recording and the checkbox, then submits with facilitator attribution', async () => {
    const auth = await as(facilitator);
    const person = (await request(app).post('/api/v1/assisted/applicants').set('Authorization', auth).send(applicantBody).expect(201)).body;
    const consentBody = (evidenceDocumentId: string) => ({ purpose: 'processing', noticeVersion: CONSENT_NOTICE_VERSION, language: 'te', evidenceDocumentId, checkboxConfirmed: true });
    const recording = audio(4000);
    const evidence = await request(app).post(`/api/v1/assisted/applicants/${person.id}/evidence`).set('Authorization', auth)
      .send({ clientFileId: 'evidence-0001', bytes: recording.length, sha256: sha(recording), mime: 'audio/ogg' }).expect(201);
    await request(app).post(`/api/v1/assisted/applicants/${person.id}/consents`).set('Authorization', auth).send(consentBody(evidence.body.id)).expect(409);
    await upload(auth, evidence.body.id, recording);
    await request(app).post(`/api/v1/assisted/applicants/${person.id}/consents`).set('Authorization', auth)
      .send({ ...consentBody(evidence.body.id), checkboxConfirmed: false }).expect(400);
    const consented = await request(app).post(`/api/v1/assisted/applicants/${person.id}/consents`).set('Authorization', auth).send(consentBody(evidence.body.id)).expect(201);
    expect(consented.body.processingConsent).toBe(true);
    const record = await Consent.findOne({ entrepreneurId: person.id }).lean();
    expect(record).toMatchObject({ method: 'assisted_recorded', grantedByUserId: facilitator._id, evidenceDocumentId: new mongoose.Types.ObjectId(evidence.body.id as string) });

    const pitch = await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: 'assisted-draft-1', mode: 'typed', language: 'te', entrepreneurId: person.id }).expect(201);
    await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: 'assisted-draft-2', mode: 'typed', language: 'te', entrepreneurId: String(applicant._id) }).expect(404);
    await request(app).put(`/api/v1/pitches/${pitch.body.id}/answers`).set('Authorization', auth).send({ answers: [{ step: 'sell', text: 'Tailoring' }] }).expect(200);
    const submitted = await request(app).post(`/api/v1/pitches/${pitch.body.id}/submit`).set('Authorization', auth).send({}).expect(201);
    const submission = await Submission.findById(submitted.body.submissionId).lean();
    expect(submission).toMatchObject({ ownerOrgId: centre._id, sourceOrgId: centre._id, createdByUserId: facilitator._id });
    const listed = await request(app).get('/api/v1/assisted/submissions').set('Authorization', auth).expect(200);
    expect(listed.body.submissions.map((item: { id: string }) => item.id)).toEqual([submitted.body.submissionId]);
  });

  it('does not let a partner-org facilitator submit without a linked centre', async () => {
    const partnerFacilitator = await User.create({ displayName: 'Synthetic NGO facilitator', email: 'ngo@pitchprism.test', role: 'facilitator', orgId: partnerOrg._id });
    const auth = await as(partnerFacilitator);
    const person = (await request(app).post('/api/v1/assisted/applicants').set('Authorization', auth).send(applicantBody).expect(201)).body;
    await Consent.create({ entrepreneurId: person.id, purpose: 'processing', scope: 'all', method: 'assisted_recorded', language: 'te',
      noticeVersion: CONSENT_NOTICE_VERSION, grantedAt: new Date(), grantedByUserId: partnerFacilitator._id });
    const pitch = await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: 'ngo-draft-0001', mode: 'typed', language: 'te', entrepreneurId: person.id }).expect(201);
    await request(app).put(`/api/v1/pitches/${pitch.body.id}/answers`).set('Authorization', auth).send({ answers: [{ step: 'sell', text: 'Tailoring' }] }).expect(200);
    const refused = await request(app).post(`/api/v1/pitches/${pitch.body.id}/submit`).set('Authorization', auth).send({}).expect(409);
    expect(refused.body.error).toContain('not linked to a centre');
    expect(await Submission.countDocuments()).toBe(0);
  });
});

describe('processing and transcript review', () => {
  async function waitFor(auth: string, pitchId: string, wanted: string) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await request(app).get(`/api/v1/pitches/${pitchId}/transcript`).set('Authorization', auth).expect(200);
      if (response.body.pipeline === wanted) return response.body;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`pipeline never reached ${wanted}`);
  }
  async function submittedPitch(auth: string, draft: string) {
    await consent(auth);
    const pitch = await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: draft, mode: 'guided', language: 'hi', centreId: String(centre._id) }).expect(201);
    const recording = audio(3000);
    const doc = await request(app).post(`/api/v1/pitches/${pitch.body.id}/documents`).set('Authorization', auth)
      .send({ clientFileId: `${draft}-file`, kind: 'audio', bytes: recording.length, sha256: sha(recording), mime: 'audio/mp4', promptStep: 'sell' }).expect(201);
    await upload(auth, doc.body.id, recording);
    await request(app).post(`/api/v1/pitches/${pitch.body.id}/submit`).set('Authorization', auth).send({}).expect(201);
    return { pitchId: pitch.body.id as string, documentId: doc.body.id as string, recording };
  }

  it('runs the local pipeline after submit, stores version 1 and keeps it when corrections are saved', async () => {
    const jobs: IngestJob[] = [];
    setIngestRunner(async job => {
      jobs.push(job);
      return { status: 'extracted', transcript: [{ segId: 's_0001', textOriginal: 'मैं पापड़ बेचूँगी', textEn: 'I will sell papad', lang: 'hi',
        source: { type: 'audio', documentId: job.documents[0]!.documentId, start: 0.4, end: 3.1 } }], extracted: { template: 'edp-idea-brief' } };
    });
    const auth = await as(applicant);
    const { pitchId, documentId, recording } = await submittedPitch(auth, 'draft-process-1');
    const body = await waitFor(auth, pitchId, 'transcribed');
    expect(body.transcript).toMatchObject({ version: 1, status: 'extracted', edited: false });
    expect(jobs[0]).toMatchObject({ language: 'hi', documents: [{ documentId, kind: 'audio', promptStep: 'sell' }] });
    const saved = await request(app).put(`/api/v1/pitches/${pitchId}/transcript`).set('Authorization', auth)
      .send({ baseVersion: 1, edits: [{ segId: 's_0001', text: 'मैं पापड़ और अचार बेचूँगी' }] }).expect(200);
    expect(saved.body.segments[0]).toMatchObject({ textOriginal: 'मैं पापड़ और अचार बेचूँगी', textEn: null, edited: true });
    await request(app).put(`/api/v1/pitches/${pitchId}/transcript`).set('Authorization', auth)
      .send({ baseVersion: 1, edits: [{ segId: 's_0001', text: 'stale edit' }] }).expect(409);
    await request(app).put(`/api/v1/pitches/${pitchId}/transcript`).set('Authorization', auth)
      .send({ baseVersion: 2, edits: [{ segId: 's_9999', text: 'unknown segment' }] }).expect(400);
    const original = await Transcript.findOne({ pitchId, version: 1 }).lean();
    expect((original!.segments[0] as { textOriginal: string }).textOriginal).toBe('मैं पापड़ बेचूँगी');
    const played = await request(app).get(`/api/v1/documents/${documentId}/original`).set('Authorization', auth).buffer(true)
      .parse((response, callback) => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => callback(null, Buffer.concat(chunks))); }).expect(200);
    expect(Buffer.compare(played.body as Buffer, recording)).toBe(0);
    await request(app).get(`/api/v1/pitches/${pitchId}/transcript`).set('Authorization', await as(other)).expect(404);
    await request(app).get(`/api/v1/documents/${documentId}/original`).set('Authorization', await as(other)).expect(404);
  });

  it('keeps a missing local capability pending and lets the owner retry', async () => {
    let capable = false;
    setIngestRunner(async () => capable
      ? { status: 'extracted', transcript: [], extracted: {} }
      : { status: 'pending', transcript: [], pending: [{ stage: 'translate', reason: 'No approved local translation model.' }] });
    const auth = await as(applicant);
    const { pitchId } = await submittedPitch(auth, 'draft-process-2');
    const pending = await waitFor(auth, pitchId, 'pending_capability');
    expect(pending.transcript.pending[0].stage).toBe('translate');
    capable = true;
    await request(app).post(`/api/v1/pitches/${pitchId}/process`).set('Authorization', auth).send({}).expect(202);
    await waitFor(auth, pitchId, 'transcribed');
    await request(app).post(`/api/v1/pitches/${pitchId}/process`).set('Authorization', auth).send({}).expect(409);
    expect((await Transcript.find({ pitchId }).sort({ version: 1 }).lean()).map(item => [item.version, item.status])).toEqual([[1, 'pending'], [2, 'extracted']]);
    // A run interrupted by a restart: retry is refused while recent, allowed once stale.
    await Pitch.collection.updateOne({ _id: new mongoose.Types.ObjectId(pitchId) }, { $set: { pipeline: 'processing', updatedAt: new Date() } });
    await request(app).post(`/api/v1/pitches/${pitchId}/process`).set('Authorization', auth).send({}).expect(409);
    await Pitch.collection.updateOne({ _id: new mongoose.Types.ObjectId(pitchId) }, { $set: { updatedAt: new Date(Date.now() - 31 * 60 * 1000) } });
    await request(app).post(`/api/v1/pitches/${pitchId}/process`).set('Authorization', auth).send({}).expect(202);
    await waitFor(auth, pitchId, 'transcribed');
  });
});
