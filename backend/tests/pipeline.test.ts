import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { ALL_MODELS, AuditLog, Consent, Job, Org, PipelineRun, StageEvent, Submission, User } from '../src/models.js';
import { CONSENT_NOTICE_VERSION } from '../src/modules/entrepreneur/models.js';
import { claimJob, completeJob, enqueueJob, failJob, heartbeat, recordStage } from '../src/platform/jobs.js';
import { setTenancyMode } from '../src/platform/tenancy.js';
import type { Role } from '@pitchprism/contracts';

// Queue protocol (D-29) and live events (A-28) on synthetic records, with the tenancy guard enforcing.
const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters',
  PII_ENCRYPTION_KEY: 'ef'.repeat(32), TENANCY_MODE: 'enforce' });
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let centre: InstanceType<typeof Org>;
let sibling: InstanceType<typeof Org>;
let sector: InstanceType<typeof Org>;
let applicant: InstanceType<typeof User>;
let submission: InstanceType<typeof Submission>;
let foreign: InstanceType<typeof Submission>;

const bearer = async (user: { _id: unknown }) => `Bearer ${await sessionService(config).create(String(user._id))}`;
const staff = (role: Role, orgId: mongoose.Types.ObjectId, name: string = role) =>
  User.create({ displayName: `Synthetic ${name}`, email: `${name}@pitchprism.test`, role, orgId });
const consent = (entrepreneurId: mongoose.Types.ObjectId) => Consent.create({ entrepreneurId, purpose: 'processing', scope: 'all', status: 'active', method: 'app_tap',
  language: 'hi', noticeVersion: CONSENT_NOTICE_VERSION, grantedAt: new Date(), grantedByUserId: entrepreneurId });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all(ALL_MODELS.map(model => (model as typeof User).init()));
}, 120000);
afterAll(async () => { setTenancyMode('warn'); await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  // Capped collections cannot be emptied with deleteMany; drop and recreate stageEvents instead.
  await StageEvent.collection.drop().catch(() => undefined);
  await StageEvent.createCollection();
  await Promise.all(ALL_MODELS.filter(model => model.modelName !== 'StageEvent').map(model => (model as typeof User).deleteMany({})));
  [centre, sibling, sector] = await Org.create([{ name: 'Synthetic centre', type: 'centre' }, { name: 'Synthetic sibling', type: 'centre' },
    { name: 'Synthetic sector', type: 'sector_partner' }]) as [typeof centre, typeof sibling, typeof sector];
  applicant = await User.create({ displayName: 'Synthetic applicant', role: 'entrepreneur', firebaseUid: 'synthetic-uid' });
  submission = await Submission.create({ ownerOrgId: centre._id, entrepreneurId: applicant._id, createdByUserId: applicant._id, status: 'DRAFT', shares: [],
    title: 'Synthetic tailoring plan' });
  foreign = await Submission.create({ ownerOrgId: sibling._id, entrepreneurId: new mongoose.Types.ObjectId(), createdByUserId: applicant._id, status: 'DRAFT', shares: [] });
  app = createApp(config);
});

describe('starting processing', () => {
  it('needs consent, is idempotent and records who started it', async () => {
    const auth = await bearer(applicant);
    await request(app).post(`/api/v1/submissions/${submission._id}/process`).set('Authorization', auth).send({}).expect(409);
    expect(await AuditLog.countDocuments({ action: 'pipeline.start', outcome: 'denied' })).toBe(1);
    await consent(applicant._id);
    const first = await request(app).post(`/api/v1/submissions/${submission._id}/process`).set('Authorization', auth).send({}).expect(202);
    expect(first.body.job).toMatchObject({ status: 'queued', fromStage: 'ingest', reason: 'new', attempts: 0 });
    const again = await request(app).post(`/api/v1/submissions/${submission._id}/process`).set('Authorization', auth).send({});
    expect(again.status).toBe(409); // now QUEUED: not resubmittable by the entrepreneur
    expect(await Job.countDocuments()).toBe(1);
    expect((await Submission.findById(submission._id).lean())!.status).toBe('QUEUED');
  });

  it('lets reviewers rescore once per rubric version and denies partners and other centres', async () => {
    await consent(applicant._id);
    const assessor = await bearer(await staff('centre_assessor', centre._id));
    const rescore = () => request(app).post(`/api/v1/submissions/${submission._id}/process`).set('Authorization', assessor).send({ reason: 'rescore' });
    const first = await rescore().expect(202);
    expect(first.body.job.fromStage).toBe('score');
    expect((await rescore().expect(200)).body.created).toBe(false);
    await request(app).post(`/api/v1/submissions/${submission._id}/process`).set('Authorization', await bearer(applicant)).send({ reason: 'rescore' }).expect(403);
    await request(app).post(`/api/v1/submissions/${foreign._id}/process`).set('Authorization', assessor).send({ reason: 'rescore' }).expect(404);
    await request(app).post(`/api/v1/submissions/${submission._id}/process`).set('Authorization', await bearer(await staff('sector_partner', sector._id))).send({}).expect(403);
    await request(app).post(`/api/v1/submissions/${submission._id}/process`).set('Authorization', assessor).send({ fromStage: 'teleport' }).expect(400);
  });
});

describe('queue protocol', () => {
  const enqueue = (reason: 'new' | 'retry' = 'new', maxAttempts = 3) =>
    enqueueJob({ submissionId: String(submission._id), ownerOrgId: String(centre._id), fromStage: 'ingest', reason, maxAttempts });

  it('claims atomically, extends leases and completes', async () => {
    await enqueue();
    const [a, b] = await Promise.all([claimJob('worker-a'), claimJob('worker-b')]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const job = (a ?? b)!;
    expect(job.attempts).toBe(1);
    expect((await Submission.findById(submission._id).lean())!.status).toBe('PROCESSING');
    expect(await heartbeat(String(job._id), job.workerId!, 60_000, 'read')).toBe(true);
    expect(await heartbeat(String(job._id), 'someone-else')).toBe(false);
    expect(await completeJob(String(job._id), job.workerId!)).toBe(true);
    expect(await claimJob('worker-a')).toBeNull();
    expect((await Job.findById(job._id).lean())!).toMatchObject({ status: 'done', currentStage: 'read' });
    // An unfinished job absorbs repeats; a finished one lets a deliberate rerun start a fresh job.
    const rerun = await enqueue();
    expect(rerun.created).toBe(true);
    expect((await enqueue()).created).toBe(false);
    expect(await Job.countDocuments()).toBe(2);
  });

  it('returns a crashed worker’s job after its lease expires and fails it once attempts run out', async () => {
    await enqueue('new', 2);
    const first = (await claimJob('crashed', 1))!;
    await new Promise(resolve => setTimeout(resolve, 10));
    const second = (await claimJob('rescuer', 1))!;
    expect(String(second._id)).toBe(String(first._id));
    expect(second.attempts).toBe(2);
    expect(await heartbeat(String(first._id), 'crashed')).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await claimJob('third', 1)).toBeNull();
    expect((await Job.findById(first._id).lean())!).toMatchObject({ status: 'failed', error: { code: 'attempts_exhausted' } });
  });

  it('retries retryable errors with backoff, fails others visibly, and a retry after failure starts a new job', async () => {
    await enqueue();
    const job = (await claimJob('worker'))!;
    expect(await failJob(String(job._id), 'worker', { code: 'timeout', message: 'Model still loading', stage: 'read', retryable: true })).toBe('requeued');
    const queued = (await Job.findById(job._id).lean())!;
    expect(queued.status).toBe('queued');
    expect(queued.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(await claimJob('worker')).toBeNull(); // not yet due
    await Job.updateOne({ _id: job._id }, { $set: { availableAt: new Date() } });
    const again = (await claimJob('worker'))!;
    expect(await failJob(String(again._id), 'worker', { code: 'capability_unavailable', message: 'No local OCR for Odia' })).toBe('failed');
    expect((await Submission.findById(submission._id).lean())!.status).toBe('FAILED');
    const retry = await enqueue('new');
    expect(retry.created).toBe(true);
    expect(String(retry.job._id)).not.toBe(String(job._id));
  });

  it('never changes the status of an idea a reviewer has decided', async () => {
    await Submission.updateOne({ _id: submission._id }, { $set: { status: 'SHORTLISTED' } });
    await enqueue();
    const job = (await claimJob('worker'))!;
    expect(await failJob(String(job._id), 'worker', { code: 'capability_unavailable', message: 'No local model' })).toBe('failed');
    expect((await Submission.findById(submission._id).lean())!.status).toBe('SHORTLISTED');
  });

  it('records stage events and pipeline runs with timing and zero hosted cost', async () => {
    const { job } = await enqueue();
    await recordStage(job, 'read', 'started');
    await recordStage(job, 'read', 'done', { ms: 1200, summary: { segments: 14 }, provider: 'ollama', model: 'synthetic', llmCalls: 1 });
    expect(await StageEvent.countDocuments({ jobId: job._id })).toBe(2);
    expect((await PipelineRun.findOne({ jobId: job._id }).lean())!).toMatchObject({ stage: 'read', status: 'done', ms: 1200, hostedCostInr: 0, llmCalls: 1 });
  });
});

describe('live stage events (SSE)', () => {
  let server: http.Server;
  let base: string;
  beforeEach(async () => {
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  });
  /** Open a stream and collect stage events until `count` arrive or the timeout passes. */
  function collect(path: string, auth: string, count: number, headers: Record<string, string> = {}, onOpen?: () => Promise<unknown>) {
    return new Promise<{ status: number; events: Array<{ id: string; data: Record<string, string> }> }>((resolve, reject) => {
      const events: Array<{ id: string; data: Record<string, string> }> = [];
      const req = http.get(`${base}${path}`, { headers: { Authorization: auth, ...headers } }, res => {
        let buffer = '';
        const done = () => { clearTimeout(timer); req.destroy(); resolve({ status: res.statusCode!, events }); };
        const timer = setTimeout(done, 4000);
        if (res.statusCode !== 200) { res.resume(); done(); return; }
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
            const id = /^id: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (/^event: ready$/m.test(block) && onOpen) void onOpen();
            if (id && data) { events.push({ id, data: JSON.parse(data) }); if (events.length >= count) done(); }
          }
        });
      });
      req.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error); });
    });
  }

  it('replays a submission’s events, streams new ones and resumes after Last-Event-ID', async () => {
    const { job } = await enqueueJob({ submissionId: String(submission._id), ownerOrgId: String(centre._id), fromStage: 'ingest', reason: 'new' });
    await recordStage(job, 'ingest', 'started');
    await recordStage(job, 'ingest', 'done', { ms: 40 });
    const auth = await bearer(applicant);
    const first = await collect(`/api/v1/events?submissionId=${submission._id}`, auth, 3, {}, () => recordStage(job, 'classify', 'started'));
    expect(first.status).toBe(200);
    expect(first.events.map(event => `${event.data.stage}:${event.data.status}`)).toEqual(['ingest:started', 'ingest:done', 'classify:started']);
    expect(first.events[0]!.data).not.toHaveProperty('ownerOrgId');
    await recordStage(job, 'classify', 'done', { ms: 12 });
    // Resume: everything after the last seen ID arrives; anything replayed from the one-second window is deduped by ID.
    const resumed = await collect(`/api/v1/events?submissionId=${submission._id}`, auth, 4, { 'Last-Event-ID': first.events[2]!.id });
    const fresh = resumed.events.filter(event => !first.events.some(seen => seen.id === event.id));
    expect(fresh.map(event => `${event.data.stage}:${event.data.status}`)).toEqual(['classify:done']);
  });

  it('scopes the stream: centre staff see their centre only, partners and other applicants are refused', async () => {
    const own = await enqueueJob({ submissionId: String(submission._id), ownerOrgId: String(centre._id), fromStage: 'ingest', reason: 'new' });
    const other = await enqueueJob({ submissionId: String(foreign._id), ownerOrgId: String(sibling._id), fromStage: 'ingest', reason: 'new' });
    const assessor = await bearer(await staff('centre_assessor', centre._id));
    const live = await collect('/api/v1/events', assessor, 1, {}, async () => {
      await recordStage(other.job, 'ingest', 'started');
      await recordStage(own.job, 'ingest', 'started');
    });
    expect(live.events.map(event => event.data.submissionId)).toEqual([String(submission._id)]);
    expect((await collect('/api/v1/events', await bearer(await staff('sector_partner', sector._id)), 1)).status).toBe(403);
    expect((await collect(`/api/v1/events?submissionId=${foreign._id}`, await bearer(applicant), 1)).status).toBe(404);
    expect((await collect('/api/v1/events', await bearer(applicant), 1)).status).toBe(400);
  });
});
