import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { Org, Session, Submission, User } from '../src/models.js';
import { CentreCase } from '../src/modules/centre/model.js';

const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'synthetic-centre-test-secret-with-forty-characters' });
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
  await Promise.all([User.init(), Org.init(), Session.init(), Submission.init(), CentreCase.init()]);
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Org.deleteMany({}), Session.deleteMany({}), Submission.deleteMany({}), CentreCase.deleteMany({})]);
  [centre, sibling] = await Org.create([{ name: 'Synthetic centre', type: 'centre' }, { name: 'Synthetic sibling', type: 'centre' }]) as [typeof centre, typeof sibling];
  assessor = await User.create({ displayName: 'Synthetic assessor', role: 'centre_assessor', orgId: centre._id });
  outsider = await User.create({ displayName: 'Synthetic outsider', role: 'centre_assessor', orgId: sibling._id });
  const partnerOrg = await Org.create({ name: 'Synthetic partner', type: 'sector_partner' });
  partner = await User.create({ displayName: 'Synthetic partner', role: 'sector_partner', orgId: partnerOrg._id });
  const applicant = await User.create({ displayName: 'Synthetic applicant', role: 'entrepreneur', email: 'centre-test-applicant@pitchprism.test' });
  submission = await Submission.create({ title: 'Synthetic tailoring', ownerOrgId: centre._id, entrepreneurId: applicant._id,
    createdByUserId: applicant._id, status: 'DRAFT' });
  app = createApp(config, { assessIdea: async () => scored });
});

describe('centre assessment workflow', () => {
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
