import type { Types } from 'mongoose';
import { Job, PipelineRun, StageEvent } from '../models.js';
import type { Job as StoredJob } from '../models/stored.generated.js';

type Id = string | Types.ObjectId;
type Stage = StoredJob['fromStage'];
type Reason = StoredJob['reason'];
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;
const safeFailures = {
  capability_unavailable: 'Required local processing capability is unavailable.',
  invalid_input: 'The submitted input could not be processed.',
  timeout: 'Processing timed out.',
  worker_stopped: 'Processing stopped before completion.',
} as const;
export type FailureCode = keyof typeof safeFailures;

export interface EnqueueInput {
  submissionId: Id;
  ownerOrgId: Id;
  fromStage: Stage;
  reason: Reason;
  requestedByUserId?: Id;
  inputVersion?: number;
  rubricKey?: string;
  rubricVersion?: number;
}

async function appendStageEvent(event: Parameters<typeof StageEvent.create>[0]) {
  await StageEvent.init(); // Create the capped collection before the first worker event.
  return StageEvent.create(event);
}

async function finishRun(jobId: Id, status: 'done' | 'failed', now: Date, error?: string) {
  const run = await PipelineRun.findOne({ jobId, status: 'started' }).sort({ startedAt: -1 }).lean();
  if (!run) return;
  await PipelineRun.findOneAndUpdate({ _id: run._id, status: 'started' }, { $set: {
    status, endedAt: now, ms: Math.max(0, now.getTime() - new Date(run.startedAt).getTime()),
    ...(error ? { error } : {}),
  } });
}

/** A retry of the same input and stage returns the existing durable job. */
export async function enqueueJob(input: EnqueueInput) {
  await Job.init(); // The idempotency index must exist before concurrent producers enqueue.
  const inputVersion = input.inputVersion ?? 1;
  const idempotencyKey = [String(input.submissionId), inputVersion, input.fromStage, input.reason,
    input.rubricKey ?? '', input.rubricVersion ?? ''].join(':');
  const filter = { idempotencyKey };
  const document = { ...input, inputVersion, idempotencyKey, status: 'queued' as const,
    attempts: 0, maxAttempts: MAX_ATTEMPTS, availableAt: new Date() };
  try {
    return await Job.findOneAndUpdate(filter, { $setOnInsert: document },
      { upsert: true, returnDocument: 'after', runValidators: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    return Job.findOne(filter);
  }
}

async function finishExhausted(now: Date) {
  const job = await Job.findOneAndUpdate({
    status: { $in: ['queued', 'leased'] },
    $or: [{ status: 'queued', availableAt: { $lte: now } }, { status: 'leased', leaseUntil: { $lte: now } }],
    $expr: { $gte: ['$attempts', '$maxAttempts'] },
  }, { $set: { status: 'failed', finishedAt: now,
    error: { code: 'retry_exhausted', message: 'Processing retries were exhausted.' } },
    $unset: { workerId: '', leaseUntil: '' } }, { sort: { createdAt: 1 }, returnDocument: 'after' }).lean();
  if (job) {
    await finishRun(job._id, 'failed', now, 'Processing retries were exhausted.');
    await appendStageEvent({ jobId: job._id, submissionId: job.submissionId, ownerOrgId: job.ownerOrgId,
      stage: job.currentStage ?? job.fromStage, status: 'failed', at: now, error: 'Processing retries were exhausted.' });
  }
}

/** Atomic claim, including an expired lease; attempts are bounded by maxAttempts. */
export async function claimJob(workerId: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(workerId)) throw new Error('Invalid worker ID.');
  await Job.init();
  await finishExhausted(now);
  const job = await Job.findOneAndUpdate({
    $or: [{ status: 'queued', availableAt: { $lte: now } }, { status: 'leased', leaseUntil: { $lte: now } }],
    $expr: { $lt: ['$attempts', '$maxAttempts'] },
  }, { $set: { status: 'leased', workerId, leaseUntil: new Date(now.getTime() + LEASE_MS) },
    $inc: { attempts: 1 } }, { sort: { createdAt: 1 }, returnDocument: 'after' });
  if (job) {
    await PipelineRun.init();
    await finishRun(job._id, 'failed', now, 'The previous worker lease expired.');
    await PipelineRun.create({ jobId: job._id, submissionId: job.submissionId, ownerOrgId: job.ownerOrgId,
      stage: job.currentStage ?? job.fromStage, status: 'started', startedAt: now, hostedCostInr: 0 });
    await appendStageEvent({ jobId: job._id, submissionId: job.submissionId, ownerOrgId: job.ownerOrgId,
      stage: job.currentStage ?? job.fromStage, status: 'started', at: now });
  }
  return job;
}

export function renewLease(jobId: Id, workerId: string, now = new Date()) {
  return Job.findOneAndUpdate({ _id: jobId, status: 'leased', workerId, leaseUntil: { $gt: now } },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } }, { returnDocument: 'after' });
}

export async function completeJob(jobId: Id, workerId: string, now = new Date()) {
  const job = await Job.findOneAndUpdate({ _id: jobId, status: 'leased', workerId, leaseUntil: { $gt: now } },
    { $set: { status: 'done', finishedAt: now }, $unset: { workerId: '', leaseUntil: '', error: '' } },
    { returnDocument: 'after' });
  if (job) {
    await finishRun(job._id, 'done', now);
    await appendStageEvent({ jobId: job._id, submissionId: job.submissionId, ownerOrgId: job.ownerOrgId,
      stage: job.currentStage ?? job.fromStage, status: 'done', at: now });
  }
  return job;
}

export async function failJob(jobId: Id, workerId: string, code: FailureCode, retryable: boolean, now = new Date()) {
  const current = await Job.findOne({ _id: jobId, status: 'leased', workerId, leaseUntil: { $gt: now } }).lean();
  if (!current) return null;
  const retry = retryable && current.attempts < current.maxAttempts;
  const delay = Math.min(300_000, 5_000 * 2 ** Math.max(0, current.attempts - 1));
  const job = await Job.findOneAndUpdate({ _id: jobId, status: 'leased', workerId, attempts: current.attempts,
    leaseUntil: { $gt: now } }, { $set: retry
      ? { status: 'queued', availableAt: new Date(now.getTime() + delay), error: { code, message: safeFailures[code] } }
      : { status: 'failed', finishedAt: now, error: { code, message: safeFailures[code] } },
    $unset: { workerId: '', leaseUntil: '' } }, { returnDocument: 'after' });
  if (job) {
    await finishRun(job._id, 'failed', now, safeFailures[code]);
    await appendStageEvent({ jobId: job._id, submissionId: job.submissionId, ownerOrgId: job.ownerOrgId,
      stage: job.currentStage ?? job.fromStage, status: 'failed', at: now, error: safeFailures[code] });
  }
  return job;
}

export function cancelJob(jobId: Id) {
  return Job.findOneAndUpdate({ _id: jobId, status: { $in: ['queued', 'leased'] } },
    { $set: { status: 'cancelled', finishedAt: new Date() }, $unset: { workerId: '', leaseUntil: '' } },
    { returnDocument: 'after' });
}
