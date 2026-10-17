import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import type { CentreExtractedInput } from '@pitchprism/contracts';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { Consent, Entrepreneur, Org, Session, Submission, User } from '../src/models.js';
import { CentreCase } from '../src/modules/centre/model.js';
import { PitchDocument } from '../src/modules/entrepreneur/intake-models.js';
import { PdfAssessmentError } from '../src/modules/centre/runner.js';

const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'synthetic-centre-test-secret-with-forty-characters', PII_ENCRYPTION_KEY: 'a'.repeat(64) });
const input = { template: 'edp-idea-brief', context: { businessType: 'tailoring', plannedBusinessLocation: { district: 'Pune', state: 'Maharashtra', source: 'confirmed_by_user', evidence: ['s_1'] } },
  segments: [{ segId: 's_1', textEn: 'Synthetic tailoring service', lang: 'en', source: { type: 'pdf', documentId: 'synthetic', page: 1 } }],
  fields: { offering: { state: 'answered', evidence: ['s_1'] } } };
const scored = { status: 'assessed' as const, evaluation: { rubricVersion: 'edp-draft-v1', potential: 40, completeness: 15, coverage: 10,
  band: 'Insufficient information', pathway: 'Request information', needsAttention: false,
  domains: [{ key: 'clarity', score: 2, evidence: ['s_1'], reason: 'Cited synthetic evidence' }] } };

let mongo: MongoMemoryServer;
let centre: InstanceType<typeof Org>;
let sibling: InstanceType<typeof Org>;
let assessor: InstanceType<typeof User>;
let outsider: InstanceType<typeof User>;
let partner: InstanceType<typeof User>;
let submission: InstanceType<typeof Submission>;
let app: ReturnType<typeof createApp>;
const token = async (user: InstanceType<typeof User>) => `Bearer ${await sessionService(config).create(String(user._id))}`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all([User.init(), Org.init(), Session.init(), Submission.init(), CentreCase.init(), Entrepreneur.init(), Consent.init(), PitchDocument.init()]);
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Org.deleteMany({}), Session.deleteMany({}), Submission.deleteMany({}), CentreCase.deleteMany({}), Entrepreneur.deleteMany({}), Consent.deleteMany({}), PitchDocument.deleteMany({})]);
  [centre, sibling] = await Org.create([{ name: 'Synthetic centre', type: 'centre' }, { name: 'Synthetic sibling', type: 'centre' }]) as [typeof centre, typeof sibling];
  assessor = await User.create({ displayName: 'Synthetic assessor', role: 'centre_assessor', orgId: centre._id });
  outsider = await User.create({ displayName: 'Synthetic outsider', role: 'centre_assessor', orgId: sibling._id });
  const partnerOrg = await Org.create({ name: 'Synthetic partner', type: 'sector_partner' });
  partner = await User.create({ displayName: 'Synthetic partner', role: 'sector_partner', orgId: partnerOrg._id });
  const applicant = await User.create({ displayName: 'Synthetic applicant', role: 'entrepreneur', firebaseUid: 'centre-test-applicant' });
  submission = await Submission.create({ title: 'Synthetic tailoring', ownerOrgId: centre._id, entrepreneurId: applicant._id,
    createdByUserId: applicant._id, status: 'DRAFT' });
  await Consent.create({ entrepreneurId: applicant._id, purpose: 'processing', scope: 'all', status: 'active',
    method: 'app_tap', language: 'en', noticeVersion: 'consent-notice-2026-10-17', grantedAt: new Date(), grantedByUserId: applicant._id });
  app = createApp(config, { assessIdea: async () => scored });
});

describe('centre assessment workflow', () => {
  it('previews a two-page PDF for centre staff without saving applicant data or a scored case', async () => {
    const makePdf = async (pages: number) => { const pdf = await PDFDocument.create(); for (let i = 0; i < pages; i++) pdf.addPage(); return Buffer.from(await pdf.save()); };
    let calls = 0;
    app = createApp(config, { assessIdea: async () => scored, assessPdf: async (pdf, district, applicantName, documentId) => {
      calls += 1;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect([district, applicantName, documentId]).toEqual(['', '', 'preview']);
      return { input: input as unknown as CentreExtractedInput, assessment: scored };
    } });
    const pdf = await makePdf(2);
    const endpoint = '/api/v1/centre/evaluate-preview';
    await request(app).post(endpoint).set('Authorization', await token(partner))
      .attach('plan', pdf, { filename: 'idea.pdf', contentType: 'application/pdf' }).expect(403);
    await request(app).post(endpoint).set('Authorization', await token(assessor))
      .attach('plan', await makePdf(1), { filename: 'idea.pdf', contentType: 'application/pdf' }).expect(400);
    const result = await request(app).post(endpoint).set('Authorization', await token(assessor))
      .attach('plan', pdf, { filename: 'idea.pdf', contentType: 'application/pdf' }).expect(200);
    expect(result.body.saved).toBe(false);
    expect(result.body.assessment.evaluation.potential).toBe(40);
    expect(result.body.input.segments[0].segId).toBe('s_1');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(calls).toBe(1);
    expect(await Submission.countDocuments()).toBe(1);
    expect(await Entrepreneur.countDocuments()).toBe(0);
    expect(await PitchDocument.countDocuments()).toBe(0);
    expect(await CentreCase.countDocuments()).toBe(0);
    const productionApp = createApp({ ...config, NODE_ENV: 'production' }, { assessIdea: async () => scored,
      assessPdf: async () => { throw new Error('Production preview must not call a model.'); } });
    await request(productionApp).post(endpoint).set('Authorization', await token(assessor))
      .attach('plan', pdf, { filename: 'idea.pdf', contentType: 'application/pdf' }).expect(404);
  });

  it('reports a safe preview failure category without creating a score', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    app = createApp(config, { assessIdea: async () => scored,
      assessPdf: async () => { throw new PdfAssessmentError('unsupported_pdf', 'question_mismatch'); } });
    const unsupported = await request(app).post('/api/v1/centre/evaluate-preview').set('Authorization', await token(assessor))
      .attach('plan', bytes, { filename: 'idea.pdf', contentType: 'application/pdf' }).expect(422);
    expect(unsupported.body.error).toMatch(/printed business idea questions/i);
    app = createApp(config, { assessIdea: async () => scored,
      assessPdf: async () => { throw new PdfAssessmentError('worker_unavailable'); } });
    const unavailable = await request(app).post('/api/v1/centre/evaluate-preview').set('Authorization', await token(assessor))
      .attach('plan', bytes, { filename: 'idea.pdf', contentType: 'application/pdf' }).expect(503);
    expect(unavailable.body.error).toMatch(/temporarily unavailable/i);
    expect(await CentreCase.countDocuments()).toBe(0);
    expect(await PitchDocument.countDocuments()).toBe(0);
  });

  it('evaluates a private PDF only with active processing consent and the owning centre', async () => {
    let calls = 0;
    app = createApp(config, { assessIdea: async () => scored, assessPdf: async (_pdf, district, applicantName, documentId) => {
      calls += 1;
      expect(district).toBe('Pune');
      expect(applicantName).toBe('Synthetic Applicant');
      expect(documentId).toMatch(/^[a-f\d]{24}$/i);
      return { input: input as unknown as CentreExtractedInput, assessment: { ...scored, metrics: { model: 'openai/gpt-oss-120b', durationMs: 12,
        inputTokens: 20, outputTokens: 10, calls: 2 } } };
    } });
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
    const received = await request(app).post('/api/v1/centre/plans').set('Authorization', await token(assessor))
      .field({ title: 'Synthetic plan', applicantName: 'Synthetic Applicant', district: 'Pune', trade: 'Tailoring', language: 'en' })
      .attach('plan', Buffer.from(await pdf.save()), { filename: 'plan.pdf', contentType: 'application/pdf' }).expect(201);
    const path = `/api/v1/centre/submissions/${received.body.submissionId}`;
    expect((await request(app).get(`${path}/plan`).set('Authorization', await token(assessor)).expect(200)).body.processingConsent).toBe(false);
    await request(app).post(`${path}/evaluate-pdf`).set('Authorization', await token(outsider)).expect(404);
    await request(app).post(`${path}/evaluate-pdf`).set('Authorization', await token(partner)).expect(403);
    await request(app).post(`${path}/evaluate-pdf`).set('Authorization', await token(assessor)).expect(403);
    expect(calls).toBe(0);
    const recording = Buffer.alloc(44 + 48000);
    recording.write('RIFF'); recording.writeUInt32LE(recording.length - 8, 4); recording.write('WAVE', 8);
    recording.write('fmt ', 12); recording.writeUInt32LE(16, 16); recording.writeUInt16LE(1, 20);
    recording.writeUInt16LE(1, 22); recording.writeUInt32LE(8000, 24); recording.writeUInt32LE(16000, 28);
    recording.writeUInt16LE(2, 32); recording.writeUInt16LE(16, 34); recording.write('data', 36);
    recording.writeUInt32LE(48000, 40);
    await request(app).post(`${path}/processing-consent`).set('Authorization', await token(outsider))
      .field({ confirmed: 'true', noticeVersion: 'consent-notice-2026-10-17' })
      .attach('evidence', recording, { filename: 'consent.wav', contentType: 'audio/wav' }).expect(404);
    await request(app).post(`${path}/processing-consent`).set('Authorization', await token(assessor))
      .field({ confirmed: 'false', noticeVersion: 'consent-notice-2026-10-17' })
      .attach('evidence', recording, { filename: 'consent.wav', contentType: 'audio/wav' }).expect(400);
    await request(app).post(`${path}/processing-consent`).set('Authorization', await token(assessor))
      .field({ confirmed: 'true', noticeVersion: 'consent-notice-2026-10-17' })
      .attach('evidence', Buffer.alloc(2048), { filename: 'bad.wav', contentType: 'audio/wav' }).expect(400);
    await request(app).post(`${path}/processing-consent`).set('Authorization', await token(assessor))
      .field({ confirmed: 'true', noticeVersion: 'consent-notice-2026-10-17' })
      .attach('evidence', recording, { filename: 'consent.wav', contentType: 'audio/wav' }).expect(201);
    expect((await request(app).get(`${path}/plan`).set('Authorization', await token(assessor)).expect(200)).body.processingConsent).toBe(true);
    expect(await PitchDocument.countDocuments({ submissionId: received.body.submissionId, purpose: 'consent_evidence' })).toBe(1);
    const evaluated = await request(app).post(`${path}/evaluate-pdf`).set('Authorization', await token(assessor)).expect(201);
    expect(evaluated.body.evaluation.potential).toBe(40);
    expect(evaluated.body.metrics.calls).toBe(2);
    expect(calls).toBe(1);
    await request(app).post(`${path}/evaluate-pdf`).set('Authorization', await token(assessor)).expect(409);
    expect(calls).toBe(1);
    expect((await request(app).get(`${path}/card`).set('Authorization', await token(assessor)).expect(200)).body.input.segments[0].segId).toBe('s_1');
  });

  it('receives only a two-page original and keeps it private to its centre without generating a score', async () => {
    const makePdf = async (pages: number) => { const pdf = await PDFDocument.create(); for (let i = 0; i < pages; i++) pdf.addPage(); return Buffer.from(await pdf.save()); };
    const fields = { title: 'Synthetic bakery plan', applicantName: 'Synthetic Applicant', district: 'Pune', trade: 'Bakery', language: 'en' };
    const onePage = await request(app).post('/api/v1/centre/plans').set('Authorization', await token(assessor))
      .field(fields).attach('plan', await makePdf(1), { filename: 'plan.pdf', contentType: 'application/pdf' }).expect(400);
    expect(onePage.body.error).toMatch(/exactly two pages/i);
    expect(await PitchDocument.countDocuments()).toBe(0);

    const received = await request(app).post('/api/v1/centre/plans').set('Authorization', await token(assessor))
      .field(fields).attach('plan', await makePdf(2), { filename: 'plan.pdf', contentType: 'application/pdf' }).expect(201);
    const id = received.body.submissionId;
    const queue = await request(app).get('/api/v1/centre/queue').set('Authorization', await token(assessor)).expect(200);
    expect(queue.body.items).toContainEqual(expect.objectContaining({ submissionId: id, potential: null, reviewAvailable: false }));
    const detail = await request(app).get(`/api/v1/centre/submissions/${id}/plan`).set('Authorization', await token(assessor)).expect(200);
    expect(detail.body.applicant.name).toBe(fields.applicantName);
    expect(detail.body.document).toEqual(expect.objectContaining({ pages: 2 }));
    const file = await request(app).get(`/api/v1/centre/submissions/${id}/plan/file`).set('Authorization', await token(assessor)).expect(200);
    expect(file.headers['content-type']).toMatch(/application\/pdf/);
    expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');
    await request(app).get(`/api/v1/centre/submissions/${id}/plan`).set('Authorization', await token(outsider)).expect(404);
    await request(app).get(`/api/v1/centre/submissions/${id}/plan/file`).set('Authorization', await token(outsider)).expect(404);
    await request(app).post('/api/v1/centre/plans').set('Authorization', await token(partner))
      .field(fields).attach('plan', await makePdf(2), { filename: 'plan.pdf', contentType: 'application/pdf' }).expect(403);
  });
  it('shows a newly submitted idea as pending until a real assessment exists', async () => {
    const queue = await request(app).get('/api/v1/centre/queue').set('Authorization', await token(assessor)).expect(200);
    expect(queue.body.items).toEqual([expect.objectContaining({ submissionId: String(submission._id),
      state: 'PENDING_MODEL', reviewAvailable: false, potential: null })]);
    expect((await request(app).get('/api/v1/centre/queue').set('Authorization', await token(outsider)).expect(200)).body.items).toEqual([]);
    await request(app).get(`/api/v1/centre/submissions/${submission._id}/card`).set('Authorization', await token(assessor)).expect(404);
  });

  it('does not invoke the extracted-input scorer without processing consent', async () => {
    await Consent.updateMany({ entrepreneurId: submission.entrepreneurId }, { $set: { status: 'revoked', revokedAt: new Date() } });
    await request(app).post(`/api/v1/centre/submissions/${submission._id}/assessment`)
      .set('Authorization', await token(assessor)).send(input).expect(403);
    expect(await CentreCase.countDocuments()).toBe(0);
  });

  it('persists an evidence-linked assessment and scopes the queue/card to its centre', async () => {
    await request(app).post(`/api/v1/centre/submissions/${submission._id}/assessment`).set('Authorization', await token(assessor)).send(input).expect(201);
    const queue = await request(app).get('/api/v1/centre/queue').set('Authorization', await token(assessor)).expect(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0].potential).toBe(40);
    const card = await request(app).get(`/api/v1/centre/submissions/${submission._id}/card`).set('Authorization', await token(assessor)).expect(200);
    expect(card.body.evaluation.domains[0].evidence).toEqual(['s_1']);
    expect(card.body.input.segments[0].source.page).toBe(1);
    expect((await request(app).get('/api/v1/centre/queue').set('Authorization', await token(outsider)).expect(200)).body.items).toEqual([]);
    await request(app).get(`/api/v1/centre/submissions/${submission._id}/card`).set('Authorization', await token(outsider)).expect(404);
    await request(app).get('/api/v1/centre/queue').set('Authorization', await token(partner)).expect(403);
  });

  it('requires a reason to shortlist against an insufficient-information band', async () => {
    await request(app).post(`/api/v1/centre/submissions/${submission._id}/assessment`).set('Authorization', await token(assessor)).send(input).expect(201);
    await request(app).post(`/api/v1/centre/submissions/${submission._id}/decision`).set('Authorization', await token(assessor))
      .send({ decision: 'shortlist' }).expect(400);
    const response = await request(app).post(`/api/v1/centre/submissions/${submission._id}/decision`).set('Authorization', await token(assessor))
      .send({ decision: 'shortlist', reason: 'Human interview confirmed local demand.' }).expect(200);
    expect(response.body.status).toBe('SHORTLISTED');
    await request(app).post(`/api/v1/centre/submissions/${submission._id}/assessment`).set('Authorization', await token(assessor)).send(input).expect(409);
  });

  it('persists the more-information status visible to the applicant API', async () => {
    await request(app).post(`/api/v1/centre/submissions/${submission._id}/assessment`).set('Authorization', await token(assessor)).send(input).expect(201);
    await request(app).post(`/api/v1/centre/submissions/${submission._id}/decision`).set('Authorization', await token(assessor))
      .send({ decision: 'more_info' }).expect(200);
    const applicant = await User.findOne({ role: 'entrepreneur' });
    const response = await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', await token(applicant!)).expect(200);
    expect(response.body.status).toBe('MORE_INFO');
  });

  it('does not expose a pending model result as a valid score or permit a decision', async () => {
    const pendingApp = createApp(config, { assessIdea: async () => ({ status: 'pending_model', reason: 'Local model unavailable.' }) });
    const response = await request(pendingApp).post(`/api/v1/centre/submissions/${submission._id}/assessment`).set('Authorization', await token(assessor)).send(input).expect(201);
    expect(response.body.state).toBe('PENDING_MODEL');
    expect(response.body.evaluation).toBeNull();
    expect((await Submission.findById(submission._id))!.status).toBe('DRAFT');
    await request(pendingApp).post(`/api/v1/centre/submissions/${submission._id}/decision`).set('Authorization', await token(assessor))
      .send({ decision: 'shortlist' }).expect(409);
  });

  it('rejects unredacted extracted text before invoking the model', async () => {
    const unsafe = structuredClone(input);
    unsafe.segments[0]!.textEn = 'Call 9876543210';
    await request(app).post(`/api/v1/centre/submissions/${submission._id}/assessment`).set('Authorization', await token(assessor)).send(unsafe).expect(422);
    expect(await CentreCase.countDocuments()).toBe(0);
  });
  it('archives the previous evaluation before a new undecided run', async () => {
    const url = `/api/v1/centre/submissions/${submission._id}/assessment`;
    await request(app).post(url).set('Authorization', await token(assessor)).send(input).expect(201);
    await request(app).post(url).set('Authorization', await token(assessor)).send(input).expect(200);
    const record = await CentreCase.findOne({ submissionId: submission._id });
    expect(record!.evaluationHistory).toHaveLength(1);
    expect(record!.evaluationHistory[0].evaluation.rubricVersion).toBe('edp-draft-v1');
  });
});
