import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { Org, Session, StageEvent, Submission, User } from '../src/models.js';

const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'events-test-secret-with-more-than-thirty-two-characters' });
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let centre: InstanceType<typeof Org>;
let assessor: InstanceType<typeof User>;
let sibling: InstanceType<typeof User>;
let submission: InstanceType<typeof Submission>;
let firstEventId: string;
const auth = async (user: InstanceType<typeof User>) => `Bearer ${await sessionService(config).create(String(user._id))}`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all([Org.init(), User.init(), Session.init(), Submission.init(), StageEvent.init()]);
  app = createApp(config);
}, 120000);
beforeEach(async () => {
  await Promise.all([Org.deleteMany({}), User.deleteMany({}), Session.deleteMany({}), Submission.deleteMany({})]);
  const other = await Org.create({ name: 'Other centre', type: 'centre' });
  centre = await Org.create({ name: 'Owning centre', type: 'centre' });
  assessor = await User.create({ displayName: 'Owner', role: 'centre_assessor', orgId: centre._id });
  sibling = await User.create({ displayName: 'Sibling', role: 'centre_assessor', orgId: other._id });
  const applicant = await User.create({ displayName: 'Applicant', role: 'entrepreneur' });
  submission = await Submission.create({ title: 'Synthetic idea', ownerOrgId: centre._id,
    entrepreneurId: applicant._id, createdByUserId: applicant._id });
  const jobId = new mongoose.Types.ObjectId();
  const first = await StageEvent.create({ jobId, submissionId: submission._id, ownerOrgId: centre._id,
    stage: 'ingest', status: 'started', at: new Date() });
  firstEventId = String(first._id);
  await StageEvent.create({ jobId, submissionId: submission._id, ownerOrgId: centre._id,
    stage: 'ingest', status: 'failed', at: new Date(), error: 'Required local processing capability is unavailable.' });
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

describe('stage event replay', () => {
  it('denies sibling centres and rejects cursors from another submission', async () => {
    await request(app).get(`/api/v1/events?submissionId=${submission._id}`).set('Authorization', await auth(sibling)).expect(404);
    await request(app).get(`/api/v1/events?submissionId=${submission._id}`).set('Authorization', await auth(assessor))
      .set('Last-Event-ID', String(new mongoose.Types.ObjectId())).expect(410);
    await request(app).get('/api/v1/events?submissionId=invalid').set('Authorization', await auth(assessor)).expect(400);
  });

  it('replays only events after Last-Event-ID', async () => {
    const token = await auth(assessor);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no port.');
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/events?submissionId=${submission._id}`,
        { headers: { Authorization: token, 'Last-Event-ID': firstEventId }, signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      const chunk = await reader.read();
      const body = new TextDecoder().decode(chunk.value);
      expect(body).toContain('event: stage');
      expect(body).toContain('"status":"failed"');
      expect(body).not.toContain('"status":"started"');
      controller.abort();
    } finally {
      controller.abort();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('closes an open stream when its session is revoked', async () => {
    const token = await auth(assessor);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no port.');
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/events?submissionId=${submission._id}`,
        { headers: { Authorization: token }, signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      await reader.read();
      await Session.deleteMany({ userId: assessor._id });
      const closed = async () => {
        while (true) if ((await reader.read()).done) return true;
      };
      await expect(Promise.race([closed(), new Promise((_, reject) => setTimeout(() => reject(new Error('Stream remained open.')), 5000))]))
        .resolves.toBe(true);
    } finally {
      controller.abort();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 10000);

  it('projects partner events to stage metadata and closes after a share is revoked', async () => {
    const partnerOrg = await Org.create({ name: 'Synthetic sector partner', type: 'sector_partner' });
    const partner = await User.create({ displayName: 'Partner', role: 'sector_partner', orgId: partnerOrg._id });
    await Submission.updateOne({ _id: submission._id }, { $set: { shares: [
      { orgId: partnerOrg._id, partnerType: 'sector_partner', active: true },
    ] } });
    await StageEvent.updateOne({ _id: firstEventId }, { $set: { summary: { privateNote: 'internal' } } });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no port.');
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/events?submissionId=${submission._id}`,
        { headers: { Authorization: await auth(partner) }, signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const body = new TextDecoder().decode((await reader.read()).value);
      expect(body).toContain('event: stage');
      expect(body).not.toContain('privateNote');
      expect(body).not.toContain('error');
      await Submission.updateOne({ _id: submission._id }, { $set: { 'shares.0.active': false } });
      const closed = async () => {
        while (true) if ((await reader.read()).done) return true;
      };
      await expect(Promise.race([closed(), new Promise((_, reject) => setTimeout(() => reject(new Error('Stream remained open.')), 5000))]))
        .resolves.toBe(true);
    } finally {
      controller.abort();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 10000);
});
