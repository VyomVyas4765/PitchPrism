import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { ALL_MODELS, AuditLog, Job, Org, ReviewSession, Submission, User } from '../src/models.js';

// D-33 follow-up answers on synthetic records, with the tenancy guard enforcing.
const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters', PII_ENCRYPTION_KEY: '34'.repeat(32) });
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let centre: InstanceType<typeof Org>;
let applicant: InstanceType<typeof User>;
let submission: InstanceType<typeof Submission>;
const bearer = async (user: { _id: unknown }) => `Bearer ${await sessionService(config).create(String(user._id))}`;
const questions = [
  { qId: 'f1', field: 'customers' as const, round: 1, questionEn: 'Who will buy from you?', reason: 'The pitch does not say.', status: 'pending' as const },
  { qId: 'f2', field: 'location' as const, round: 1, questionEn: 'Where will you run the business?', reason: 'The pitch does not say.', status: 'pending' as const },
];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all(ALL_MODELS.map(model => (model as typeof User).init()));
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all(ALL_MODELS.filter(model => model.modelName !== 'StageEvent').map(model => (model as typeof User).deleteMany({})));
  centre = await Org.create({ name: 'Synthetic centre', type: 'centre' });
  applicant = await User.create({ displayName: 'Synthetic applicant', role: 'entrepreneur', firebaseUid: 'synthetic-uid' });
  submission = await Submission.create({ ownerOrgId: centre._id, entrepreneurId: applicant._id, createdByUserId: applicant._id, status: 'NEEDS_INPUT',
    inputVersion: 1, shares: [], title: 'Synthetic tailoring pitch', followUps: questions.map(({ qId, field, questionEn, status }) => ({ qId, field, questionEn, status })) });
  await ReviewSession.create({ submissionId: submission._id, ownerOrgId: centre._id, status: 'needs_input', round: 1, questions, inbox: [],
    verdicts: { offering: { verdict: 'sufficient', reason: '' } }, declined: {}, calls: [{ step: 'extract:offer', ms: 900, ok: true, round: 1 }] });
  app = createApp(config);
});

const url = (id = submission._id) => `/api/v1/me/submissions/${id}/follow-ups`;

describe('follow-up answers', () => {
  it('shows the pending questions only to the applicant', async () => {
    const own = await request(app).get(url()).set('Authorization', await bearer(applicant)).expect(200);
    expect(own.body).toMatchObject({ status: 'NEEDS_INPUT', review: 'needs_input', round: 1, reviewing: false, answered: 0 });
    expect(own.body.questions).toEqual([{ qId: 'f1', field: 'customers', questionEn: 'Who will buy from you?' },
      { qId: 'f2', field: 'location', questionEn: 'Where will you run the business?' }]);
    const other = await User.create({ displayName: 'Other applicant', role: 'entrepreneur', firebaseUid: 'other-uid' });
    await request(app).get(url()).set('Authorization', await bearer(other)).expect(404);
    const assessor = await User.create({ displayName: 'Synthetic assessor', email: 'assessor@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
    await request(app).get(url()).set('Authorization', await bearer(assessor)).expect(403);
  });

  it('stores answers privately, queues the review again and refuses repeats', async () => {
    const auth = await bearer(applicant);
    const sent = await request(app).post(url()).set('Authorization', auth).send({ answers: [{ qId: 'f1', text: 'Women and schools in Sinnar, about 400 families.' }] }).expect(202);
    expect(sent.body).toMatchObject({ reviewing: true, answered: 1 });
    expect(sent.body.questions).toEqual([]); // the review is running again; new questions follow
    const stored = (await Submission.findById(submission._id).lean())!;
    expect(stored).toMatchObject({ status: 'QUEUED', inputVersion: 2 });
    expect(stored.followUps!.map(item => item.status)).toEqual(['answered', 'pending']);
    const job = (await Job.findOne().lean())!;
    expect(job).toMatchObject({ reason: 'followup', fromStage: 'extract', inputVersion: 2, status: 'queued' });
    const review = (await ReviewSession.findOne().lean())!;
    expect(review.inbox!.map(item => item.qId)).toEqual(['f1']);
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: 'originals' });
    const parts: Buffer[] = [];
    for await (const part of bucket.openDownloadStream(review.inbox![0]!.storageId as mongoose.Types.ObjectId)) parts.push(part as Buffer);
    expect(Buffer.concat(parts).toString('utf8')).toBe('Women and schools in Sinnar, about 400 families.');
    expect(await AuditLog.countDocuments({ action: 'submission.followup_answer' })).toBe(1);
    await request(app).post(url()).set('Authorization', auth).send({ answers: [{ qId: 'f2', text: 'Sinnar' }] }).expect(409); // no longer waiting
  });

  it('validates answers and lets only one of two parallel answers to a question through', async () => {
    const auth = await bearer(applicant);
    await request(app).post(url()).set('Authorization', auth).send({ answers: [{ qId: 'f9', text: 'x' }] }).expect(409);
    await request(app).post(url()).set('Authorization', auth).send({ answers: [{ qId: 'f1', text: 'a' }, { qId: 'f1', text: 'b' }] }).expect(400);
    await request(app).post(url()).set('Authorization', auth).send({ answers: [{ qId: 'f1', text: '   ' }] }).expect(400);
    await request(app).post(url()).set('Authorization', auth).send({ answers: [{ qId: 'f1', text: 'x', status: 'answered' }] }).expect(400);
    const [first, second] = await Promise.all([1, 2].map(n =>
      request(app).post(url()).set('Authorization', auth).send({ answers: [{ qId: 'f2', text: `Sinnar town, Nashik district ${n}` }] })));
    expect([first!.status, second!.status].sort()).toEqual([202, 409]);
    expect((await ReviewSession.findOne().lean())!.inbox).toHaveLength(1);
    expect(await Job.countDocuments()).toBe(1);
  });

  it('lets the facilitator who created the idea answer through the assisted route', async () => {
    const facilitator = await User.create({ displayName: 'Synthetic facilitator', email: 'facilitator@pitchprism.test', role: 'facilitator', orgId: centre._id });
    await Submission.updateOne({ _id: submission._id }, { $set: { createdByUserId: facilitator._id } });
    const auth = await bearer(facilitator);
    await request(app).get(`/api/v1/assisted/submissions/${submission._id}/follow-ups`).set('Authorization', auth).expect(200);
    await request(app).post(`/api/v1/assisted/submissions/${submission._id}/follow-ups`).set('Authorization', auth)
      .send({ answers: [{ qId: 'f1', text: 'Women in Sinnar town.' }] }).expect(202);
    await request(app).get(`/api/v1/assisted/submissions/${submission._id}/follow-ups`).set('Authorization', await bearer(applicant)).expect(403);
  });

  it('shows centre staff the review transcript for their centre only', async () => {
    const assessor = await User.create({ displayName: 'Synthetic assessor', email: 'assessor@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
    const transcript = await request(app).get(`/api/v1/submissions/${submission._id}/review`).set('Authorization', await bearer(assessor)).expect(200);
    expect(transcript.body).toMatchObject({ status: 'needs_input', round: 1, calls: { count: 1, seconds: 0.9 } });
    expect(transcript.body.questions[0]).toMatchObject({ qId: 'f1', field: 'customers', status: 'pending', answer: null });
    const sibling = await Org.create({ name: 'Synthetic sibling', type: 'centre' });
    const outsider = await User.create({ displayName: 'Sibling assessor', email: 'sibling@pitchprism.test', role: 'centre_assessor', orgId: sibling._id });
    await request(app).get(`/api/v1/submissions/${submission._id}/review`).set('Authorization', await bearer(outsider)).expect(404);
    await request(app).get(`/api/v1/submissions/${submission._id}/review`).set('Authorization', await bearer(applicant)).expect(403);
  });
});
