import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { ALL_MODELS, AuditLog, Job, Org, ReviewSession, Submission, User } from '../src/models.js';
import { Consent, CONSENT_NOTICE_VERSION, Entrepreneur } from '../src/modules/entrepreneur/models.js';
import { ChatMessage, DocumentChunk, Pitch, PitchDocument } from '../src/modules/entrepreneur/intake-models.js';
import { briefRows, FORM } from '../src/modules/entrepreneur/brief.js';
import { piiVault } from '../src/modules/entrepreneur/pii-vault.js';
import { PDFDocument } from 'pdf-lib';

// M-05 chat intake on synthetic records: the opening reply submits, replies answer every open question together.
const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters', PII_ENCRYPTION_KEY: 'ef'.repeat(32) });
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let centre: InstanceType<typeof Org>;
let applicant: InstanceType<typeof User>;
let auth: string;
const as = async (user: { _id: unknown }) => `Bearer ${await sessionService(config).create(String(user._id))}`;
const pdf = Buffer.from('%PDF-1.4\n% synthetic chat reply\n%%EOF\n');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await Promise.all([...ALL_MODELS, Entrepreneur, Consent, Pitch, PitchDocument, DocumentChunk, ChatMessage].map(model => (model as typeof User).init()));
  centre = await Org.create({ name: 'Synthetic Nashik centre', type: 'centre' });
  applicant = await User.create({ displayName: 'Entrepreneur', role: 'entrepreneur', email: 'synthetic-chat-1@pitchprism.test' });
  app = createApp(config);
  auth = await as(applicant);
  await request(app).post('/api/v1/consents').set('Authorization', auth)
    .send({ purpose: 'processing', noticeVersion: CONSENT_NOTICE_VERSION, language: 'hi', method: 'app_tap' }).expect(201);
});

async function chatPitch() {
  const created = await request(app).post('/api/v1/pitches').set('Authorization', auth)
    .send({ clientDraftId: 'chat-draft-0001', mode: 'chat', language: 'hi', centreId: String(centre._id) }).expect(201);
  return created.body.id as string;
}

/** What the worker writes after reading the opening reply: two questions, one in Hindi. */
async function reviewAsks(submissionId: string, round = 1) {
  const questions = [
    { qId: 'f1', field: 'customers' as const, round, questionEn: 'Who will buy from you?', text: 'आपसे कौन खरीदेगा?', lang: 'hi' as const, status: 'pending' as const },
    { qId: 'f2', field: 'location' as const, round, questionEn: 'Where will the shop be?', text: 'Where will the shop be?', lang: 'en' as const, status: 'pending' as const },
  ];
  await ReviewSession.create({ submissionId, ownerOrgId: centre._id, status: 'needs_input', round, questions, inbox: [], verdicts: {}, declined: {}, calls: [] });
  await Submission.updateOne({ _id: submissionId }, { $set: { status: 'NEEDS_INPUT' } });
}

describe('chat intake', () => {
  it('submits the pitch with the opening message and shows the questions in the chosen language', async () => {
    const id = await chatPitch();
    const start = await request(app).get(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).expect(200);
    expect(start.body).toMatchObject({ state: 'start', language: 'hi', messages: [] });

    const sent = await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth)
      .send({ text: 'मैं सिनार में सिलाई की दुकान खोलना चाहती हूँ।' }).expect(201);
    expect(sent.body).toMatchObject({ state: 'reading', messages: [{ role: 'user', round: 0, kind: 'text', text: 'मैं सिनार में सिलाई की दुकान खोलना चाहती हूँ।' }] });
    const submission = (await Submission.findById(sent.body.submissionId).lean())!;
    expect(submission).toMatchObject({ status: 'QUEUED', ownerOrgId: centre._id });
    expect(await Job.findOne().lean()).toMatchObject({ reason: 'new', fromStage: 'ingest' });
    const opening = (await PitchDocument.findOne({ pitchId: id }).lean())!;
    expect(opening).toMatchObject({ purpose: 'pitch', kind: 'text', declaredMime: 'text/plain', state: 'complete' });
    await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'again' }).expect(409);

    await reviewAsks(sent.body.submissionId);
    const turn = await request(app).get(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).expect(200);
    expect(turn.body.state).toBe('your_turn');
    expect(turn.body.messages.slice(1)).toEqual([
      { role: 'assistant', round: 1, qId: 'f1', field: 'customers', text: 'आपसे कौन खरीदेगा?', lang: 'hi' },
      { role: 'assistant', round: 1, qId: 'f2', field: 'location', text: 'Where will the shop be?', lang: 'en' },
    ]);
  });

  it('takes one PDF reply for every open question and queues the review once', async () => {
    const id = await chatPitch();
    const sent = await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'Tailoring shop.' }).expect(201);
    await reviewAsks(sent.body.submissionId);
    const document = await request(app).post(`/api/v1/pitches/${id}/documents`).set('Authorization', auth)
      .send({ clientFileId: 'chat-file-0001', kind: 'pdf', bytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), mime: 'application/pdf' }).expect(201);
    await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ documentId: document.body.id }).expect(409); // not uploaded yet
    await request(app).put(`/api/v1/documents/${document.body.id}/content`).set('Authorization', auth)
      .set('Content-Type', 'application/octet-stream').set('Upload-Offset', '0').send(pdf).expect(200);
    expect((await PitchDocument.findById(document.body.id).lean())!.purpose).toBe('chat_reply');

    const reply = await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ documentId: document.body.id }).expect(202);
    expect(reply.body.state).toBe('reading');
    expect(reply.body.messages.at(-1)).toMatchObject({ role: 'user', round: 1, kind: 'pdf', text: null });
    const review = (await ReviewSession.findOne().lean())!;
    expect(review.inbox!.map(item => item.qId)).toEqual(['f1', 'f2']);
    expect(new Set(review.inbox!.map(item => String(item.storageId))).size).toBe(1);
    const job = (await Job.findOne({ reason: 'followup' }).lean())!;
    expect(job).toMatchObject({ fromStage: 'extract', inputVersion: 2 });
    expect(await AuditLog.countDocuments({ action: 'submission.chat_reply' })).toBe(1);
    await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'More detail.' }).expect(409);
  });

  it('replaces a reply that could not be read and can retry the last step', async () => {
    const id = await chatPitch();
    const sent = await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'Tailoring shop.' }).expect(201);
    await reviewAsks(sent.body.submissionId);
    await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'First try.' }).expect(202);
    await Submission.updateOne({ _id: sent.body.submissionId }, { $set: { status: 'FAILED' } });
    expect((await request(app).get(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).expect(200)).body.state).toBe('failed');

    await request(app).post(`/api/v1/pitches/${id}/chat/retry`).set('Authorization', auth).expect(202);
    expect(await Job.countDocuments({ reason: 'followup', status: 'queued' })).toBe(1);
    await Submission.updateOne({ _id: sent.body.submissionId }, { $set: { status: 'FAILED' } });

    await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'Women in Sinnar town, Nashik district.' }).expect(202);
    const messages = await ChatMessage.find({ pitchId: id }).sort({ round: 1 }).lean();
    expect(messages.map(message => message.text)).toEqual(['Tailoring shop.', 'Women in Sinnar town, Nashik district.']);
    expect((await ReviewSession.findOne().lean())!.inbox).toHaveLength(2);
  });

  it('keeps chats private and validates replies', async () => {
    const id = await chatPitch();
    const other = await User.create({ displayName: 'Entrepreneur', role: 'entrepreneur', email: 'synthetic-chat-2@pitchprism.test' });
    await request(app).get(`/api/v1/pitches/${id}/chat`).set('Authorization', await as(other)).expect(404);
    await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', await as(other)).send({ text: 'x' }).expect(404);
    await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({}).expect(400);
    await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'x', documentId: 'a'.repeat(24) }).expect(400);
    const typed = await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: 'typed-draft-0001', mode: 'typed', language: 'hi', centreId: String(centre._id) }).expect(201);
    await request(app).get(`/api/v1/pitches/${typed.body.id}/chat`).set('Authorization', auth).expect(409);
    // Without a centre the opening reply is refused before anything is stored.
    const loose = await request(app).post('/api/v1/pitches').set('Authorization', auth)
      .send({ clientDraftId: 'chat-draft-0002', mode: 'chat', language: 'hi' }).expect(201);
    await request(app).post(`/api/v1/pitches/${loose.body.id}/chat`).set('Authorization', auth).send({ text: 'Tea stall.' }).expect(409);
    expect(await PitchDocument.countDocuments({ pitchId: loose.body.id })).toBe(0);
    expect(await ChatMessage.countDocuments({ pitchId: loose.body.id })).toBe(0);
  });

  it('builds the Business Idea Brief from the completed review for the owner and the owning centre only', async () => {
    const id = await chatPitch();
    const sent = await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'Tailoring shop.' }).expect(201);
    await request(app).get(`/api/v1/pitches/${id}/brief`).set('Authorization', auth).expect(409); // not complete yet
    const segments = [
      { segId: 's1', textEn: 'Village Kothapally, District Ranga Reddy, Telangana.' },
      { segId: 's2', textEn: `${FORM[1]!.topic} — Blouse and kurti stitching, school uniforms.` },
      { segId: 's3', textEn: 'Call me on ⟨PHONE⟩ for bulk orders.' },
    ];
    await ReviewSession.create({ submissionId: sent.body.submissionId, ownerOrgId: centre._id, status: 'complete', round: 3, questions: [], inbox: [],
      verdicts: {}, declined: { market_research: 'The entrepreneur has not decided this yet.' }, calls: [], businessType: 'Tailoring unit', segments,
      fields: { location: { state: 'answered', evidence: ['s1'] }, offering: { state: 'answered', evidence: ['s2', 's3'] }, customers: { state: 'missing', evidence: [] } } });
    const vault = piiVault('ef'.repeat(32))!;
    await Entrepreneur.updateOne({ _id: applicant._id }, { $set: { personal: vault.seal({ name: 'Synthetic Applicant' }, String(applicant._id)),
      onboarding: vault.seal({ mobile: '9000000080' }, String(applicant._id)) } }, { upsert: true });

    const rows = briefRows((await ReviewSession.findOne().lean()) as never);
    expect(rows.map(row => row.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows[0]).toMatchObject({ key: 'location', state: 'answered', response: 'Village Kothapally, District Ranga Reddy, Telangana.' });
    expect(rows[1]!.response).toBe('Blouse and kurti stitching, school uniforms. Call me on ⟨PHONE⟩ for bulk orders.'); // form question stripped
    expect(rows[2]).toMatchObject({ state: 'missing', response: 'Not provided.' });
    expect(rows[3]).toMatchObject({ state: 'declined', response: 'Not decided yet.' });

    const chat = await request(app).get(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).expect(200);
    expect(chat.body).toMatchObject({ state: 'complete' });
    expect(chat.body.brief).toHaveLength(10);
    const own = await request(app).get(`/api/v1/pitches/${id}/brief`).set('Authorization', auth).buffer(true)
      .parse((response, done) => { const parts: Buffer[] = []; response.on('data', (part: Buffer) => parts.push(part)); response.on('end', () => done(null, Buffer.concat(parts))); })
      .expect(200).expect('Content-Type', /application\/pdf/);
    expect((own.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(own.body as Buffer)).getPageCount()).toBeGreaterThanOrEqual(1);

    const assessor = await User.create({ displayName: 'Synthetic assessor', email: 'assessor-chat@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
    await request(app).get(`/api/v1/submissions/${sent.body.submissionId}/brief`).set('Authorization', await as(assessor)).expect(200);
    expect(await AuditLog.countDocuments({ action: 'submission.brief_view' })).toBe(1);
    const sibling = await Org.create({ name: 'Synthetic sibling centre', type: 'centre' });
    const outsider = await User.create({ displayName: 'Sibling assessor', email: 'sibling-chat@pitchprism.test', role: 'centre_assessor', orgId: sibling._id });
    await request(app).get(`/api/v1/submissions/${sent.body.submissionId}/brief`).set('Authorization', await as(outsider)).expect(404);
    await request(app).get(`/api/v1/submissions/${sent.body.submissionId}/brief`).set('Authorization', auth).expect(403);
  });

  it('hands the evaluator the brief with the applicant details when the person sends the finished plan', async () => {
    const id = await chatPitch();
    const sent = await request(app).post(`/api/v1/pitches/${id}/chat`).set('Authorization', auth).send({ text: 'Tailoring shop.' }).expect(201);
    await request(app).post(`/api/v1/pitches/${id}/chat/submit`).set('Authorization', auth).expect(409); // review not complete
    await ReviewSession.create({ submissionId: sent.body.submissionId, ownerOrgId: centre._id, status: 'complete', round: 2, questions: [], inbox: [],
      verdicts: {}, declined: {}, calls: [], businessType: 'Tailoring unit', segments: [{ segId: 's1', textEn: 'Village Kothapally, District Ranga Reddy, Telangana.' }],
      fields: { location: { state: 'answered', evidence: ['s1'] } } });
    await Submission.updateOne({ _id: sent.body.submissionId }, { $set: { status: 'DRAFT' } }); // the worker stops here for chat plans
    const vault = piiVault('ef'.repeat(32))!;
    await Entrepreneur.updateOne({ _id: applicant._id }, { $set: { personal: vault.seal({ name: 'Asha Demo' }, String(applicant._id)),
      onboarding: vault.seal({ mobile: '9000000080' }, String(applicant._id)) } }, { upsert: true });

    await request(app).post(`/api/v1/pitches/${id}/chat/submit`).set('Authorization', auth).expect(202);
    await request(app).post(`/api/v1/pitches/${id}/chat/submit`).set('Authorization', auth).expect(202); // repeating is harmless
    const briefs = await PitchDocument.find({ submissionId: sent.body.submissionId }).lean();
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toMatchObject({ kind: 'pdf', purpose: 'pitch', state: 'complete', declaredMime: 'application/pdf' });
    expect(briefs[0]!.pitchId).toBeUndefined(); // never read back as pitch input
    expect(await Job.countDocuments({ submissionId: sent.body.submissionId, fromStage: 'quality' })).toBe(1);

    // The centre evaluator opens the stored brief from the review desk.
    const assessor = await User.create({ displayName: 'Synthetic assessor', email: 'assessor-send@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
    const file = await request(app).get(`/api/v1/centre/submissions/${sent.body.submissionId}/plan/file`).set('Authorization', await as(assessor)).buffer(true)
      .parse((response, done) => { const parts: Buffer[] = []; response.on('data', (part: Buffer) => parts.push(part)); response.on('end', () => done(null, Buffer.concat(parts))); });
    expect(file.status).toBe(200);
    expect((file.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(file.body as Buffer).digest('hex')).toBe(briefs[0]!.sha256);
    // ...and sees the personal details the chat model never saw, next to the brief.
    const plan = await request(app).get(`/api/v1/centre/submissions/${sent.body.submissionId}/plan`).set('Authorization', await as(assessor)).expect(200);
    expect(plan.body.applicant).toEqual({ name: 'Asha Demo', phone: '9000000080' });
    expect(plan.body.document).toMatchObject({ sha256: briefs[0]!.sha256 });
    const sibling = await Org.create({ name: 'Synthetic other centre', type: 'centre' });
    const outsider = await User.create({ displayName: 'Other assessor', email: 'other-send@pitchprism.test', role: 'centre_assessor', orgId: sibling._id });
    await request(app).get(`/api/v1/centre/submissions/${sent.body.submissionId}/plan`).set('Authorization', await as(outsider)).expect(404);
  });
});
