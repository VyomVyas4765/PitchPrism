import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Job, PipelineRun, StageEvent } from '../src/models.js';
import { cancelJob, claimJob, completeJob, enqueueJob, failJob, renewLease } from '../src/queue/jobs.js';

let mongo: MongoMemoryServer;
const submissionId = new mongoose.Types.ObjectId();
const ownerOrgId = new mongoose.Types.ObjectId();
const request = { submissionId, ownerOrgId, fromStage: 'ingest' as const, reason: 'new' as const };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Job.init(), PipelineRun.init(), StageEvent.init()]);
}, 120000);
beforeEach(async () => {
  await Job.deleteMany({});
  await PipelineRun.deleteMany({});
  // The capped event collection is intentionally append-only; each assertion scopes by job ID.
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

describe('MongoDB job leases', () => {
  it('deduplicates enqueue and allows only one concurrent claim', async () => {
    const [first, retry] = await Promise.all([enqueueJob(request), enqueueJob(request)]);
    expect(String(first?._id)).toBe(String(retry?._id));
    expect(await Job.countDocuments({ submissionId })).toBe(1);
    const now = new Date(Date.now() + 1000);
    const [a, b] = await Promise.all([claimJob('worker-a', now), claimJob('worker-b', now)]);
    const winner = a ?? b;
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(winner?.status).toBe('leased');
    expect(winner?.attempts).toBe(1);
    expect(await completeJob(winner!._id, a ? 'worker-b' : 'worker-a', now)).toBeNull();
    expect(await completeJob(winner!._id, a ? 'worker-a' : 'worker-b', now)).toMatchObject({ status: 'done' });
    expect(await claimJob('worker-c', now)).toBeNull();
    expect(await StageEvent.countDocuments({ jobId: winner!._id })).toBe(2);
    expect(await PipelineRun.findOne({ jobId: winner!._id }).lean()).toMatchObject({ status: 'done', hostedCostInr: 0 });
  });

  it('renews a live lease and rejects stale workers after expiry', async () => {
    const job = await enqueueJob({ ...request, inputVersion: 2 });
    const start = new Date(Date.now() + 1000);
    await claimJob('worker-a', start);
    expect(await renewLease(job!._id, 'worker-b', start)).toBeNull();
    expect(await renewLease(job!._id, 'worker-a', new Date(start.getTime() + 30_000))).not.toBeNull();
    expect(await claimJob('worker-b', new Date(start.getTime() + 61_000))).toBeNull();
    const reclaimed = await claimJob('worker-b', new Date(start.getTime() + 91_000));
    expect(reclaimed?.attempts).toBe(2);
    expect(await completeJob(job!._id, 'worker-a', new Date(start.getTime() + 91_000))).toBeNull();
    expect(await PipelineRun.countDocuments({ jobId: job!._id, status: 'failed' })).toBe(1);
  });

  it('backs off retryable failures and terminates after the attempt limit', async () => {
    const job = await enqueueJob({ ...request, inputVersion: 3 });
    const start = new Date(Date.now() + 1000);
    await claimJob('worker-a', start);
    const retry = await failJob(job!._id, 'worker-a', 'timeout', true, start);
    expect(retry).toMatchObject({ status: 'queued', attempts: 1, error: { code: 'timeout' } });
    expect(await claimJob('worker-b', new Date(start.getTime() + 4_999))).toBeNull();
    await claimJob('worker-b', new Date(start.getTime() + 5_000));
    await failJob(job!._id, 'worker-b', 'timeout', true, new Date(start.getTime() + 5_000));
    await claimJob('worker-c', new Date(start.getTime() + 15_000));
    const terminal = await failJob(job!._id, 'worker-c', 'capability_unavailable', true, new Date(start.getTime() + 15_000));
    expect(terminal).toMatchObject({ status: 'failed', attempts: 3, error: { code: 'capability_unavailable' } });
    expect(await claimJob('worker-d', new Date(start.getTime() + 100_000))).toBeNull();
    expect(await StageEvent.countDocuments({ jobId: job!._id, status: 'failed' })).toBe(3);
    expect(await PipelineRun.countDocuments({ jobId: job!._id, status: 'failed' })).toBe(3);
  });

  it('can cancel a pending job before a worker claims it', async () => {
    const job = await enqueueJob({ ...request, inputVersion: 4 });
    expect((await cancelJob(job!._id))?.status).toBe('cancelled');
    expect(await claimJob('worker-a', new Date(Date.now() + 1000))).toBeNull();
  });

  it('fails an abandoned lease once the attempt limit is reached', async () => {
    const job = await enqueueJob({ ...request, inputVersion: 5 });
    const start = new Date(Date.now() + 1000);
    await claimJob('worker-a', start);
    await claimJob('worker-b', new Date(start.getTime() + 60_001));
    await claimJob('worker-c', new Date(start.getTime() + 120_002));
    expect(await claimJob('worker-d', new Date(start.getTime() + 180_003))).toBeNull();
    expect(await Job.findById(job!._id).lean()).toMatchObject({ status: 'failed', attempts: 3,
      error: { code: 'retry_exhausted' } });
  });
});
