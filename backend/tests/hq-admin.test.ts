import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { AuditEvent, Cohort, Job, Org, Programme, Rubric, Session, Submission, User } from '../src/models.js';

const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'hq-admin-test-secret-with-more-than-thirty-two-characters' });
const password = 'SyntheticHQPassword!42';
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let hq: InstanceType<typeof User>;
let centre: InstanceType<typeof Org>;
let submission: InstanceType<typeof Submission>;
let hqCookie: string;
let centreCookie: string;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all([User.init(), Org.init(), Session.init(), Submission.init(), Programme.init(), Rubric.init(), Cohort.init(), Job.init(), AuditEvent.init()]);
  app = createApp(config);
}, 120000);
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Org.deleteMany({}), Session.deleteMany({}), Submission.deleteMany({}), Programme.deleteMany({}), Rubric.deleteMany({}), Cohort.deleteMany({}), Job.deleteMany({}), AuditEvent.deleteMany({})]);
  const orgs = await Org.create([{ name: 'HQ', type: 'hq' }, { name: 'Centre', type: 'centre' }]);
  const hqOrg = orgs[0]!;
  const centreOrg = orgs[1]!;
  centre = centreOrg;
  const hash = await hashPassword(password);
  hq = await User.create({ displayName: 'HQ admin', email: 'hq-admin@test.local', role: 'hq_admin', orgId: hqOrg._id, passwordHash: hash });
  const assessor = await User.create({ displayName: 'Centre assessor', email: 'centre@test.local', role: 'centre_assessor', orgId: centreOrg._id, passwordHash: hash });
  const applicant = await User.create({ displayName: 'Applicant', role: 'entrepreneur', firebaseUid: `uid-${Date.now()}` });
  submission = await Submission.create({ title: 'Tailoring idea', ownerOrgId: centreOrg._id, entrepreneurId: applicant._id, createdByUserId: assessor._id, status: 'READY', score: 60, language: 'en', inputFormat: 'text', trade: 'tailoring', district: 'Pune' });
  const login = async (email: string) => {
    const response = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return response.headers['set-cookie']![0]!;
  };
  hqCookie = await login(hq.email!);
  centreCookie = await login(assessor.email!);
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe('HQ administration routes', () => {
  it('allows HQ configuration, pipeline, fairness, clusters and audit access', async () => {
    await request(app).get('/api/v1/hq/programmes').set('Cookie', hqCookie).expect(200);
    await request(app).post('/api/v1/hq/programmes').set('Cookie', hqCookie).set('Origin', config.WEB_ORIGIN).send({ name: 'Demo programme', definition: { domains: [] } }).expect(201);
    await request(app).get('/api/v1/hq/pipeline?trade=tailoring').set('Cookie', hqCookie).expect(200);
    await request(app).get('/api/v1/hq/fairness').set('Cookie', hqCookie).expect(200);
    await request(app).get('/api/v1/hq/clusters').set('Cookie', hqCookie).expect(200);
    const audit = await request(app).get('/api/v1/hq/audit').set('Cookie', hqCookie).expect(200);
    expect(audit.body.events.length).toBeGreaterThan(0);
  });
  it('denies centre users from HQ-only pipeline operations', async () => {
    await request(app).get('/api/v1/hq/pipeline').set('Cookie', centreCookie).expect(403);
    await request(app).post('/api/v1/hq/review-samples').set('Cookie', centreCookie).set('Origin', config.WEB_ORIGIN).send({ limit: 1 }).expect(403);
    await request(app).post('/api/v1/hq/submissions/' + submission.id + '/route').set('Cookie', centreCookie).set('Origin', config.WEB_ORIGIN).send({}).expect(403);
  });
  it('creates a durable processing job when a job is explicitly queued', async () => {
    const job = await Job.create({ type: 'submission.process', payload: { submissionId: submission.id } });
    expect(job.state).toBe('queued');
    await request(app).post('/api/v1/hq/jobs/claim').set('Cookie', hqCookie).set('Origin', config.WEB_ORIGIN).send({ workerId: 'test-worker' }).expect(200);
    expect((await Job.findById(job._id))?.state).toBe('leased');
  });
});
