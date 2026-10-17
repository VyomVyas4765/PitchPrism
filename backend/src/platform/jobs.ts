import { Types } from 'mongoose';
import type { Stage, StageStatus } from '@pitchprism/contracts';
import { Job, PipelineRun, StageEvent, Submission } from '../models.js';

// MongoDB job queue (D-29). The API enqueues; one worker claims a job with an atomic lease, extends the lease
// while it works, and finishes it as done or failed. A crashed worker's job returns when its lease expires.
// ai/jobqueue.py implements the same protocol for the Python worker; keep the two in step.
// These helpers run outside request scope (worker side) or after the caller has checked access, so their
// tenant queries are marked 'system'.
export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 3;
const SYSTEM = { tenant: 'system' } as const;
export type JobReason = 'new' | 'followup' | 'transcript_edit' | 'rescore' | 'retry';
export interface JobErrorInput { code: string; message: string; stage?: Stage; retryable?: boolean }

/** Exponential backoff for retries: 5 s, 20 s, 80 s … capped at 10 minutes. */
export const backoffMs = (attempts: number) => Math.min(10 * 60_000, 5_000 * 4 ** Math.max(0, attempts - 1));

/**
 * Queue a pipeline run. The idempotency key covers submission, start stage, reason, input version and rubric
 * version, so a double click, a retried request or two reviewers pressing at once yield one unfinished job.
 */
export async function enqueueJob(input: { submissionId: string; ownerOrgId: string; fromStage: Stage; reason: JobReason; inputVersion?: number;
  rubricKey?: string; rubricVersion?: number; requestedByUserId?: string; maxAttempts?: number }) {
  const inputVersion = input.inputVersion ?? 1;
  const idempotencyKey = `${input.submissionId}:${input.fromStage}:${input.reason}:${inputVersion}${input.rubricVersion ? `:r${input.rubricVersion}` : ''}`;
  const now = new Date();
  // Only an unfinished job absorbs a repeat request. Once a job is done, failed or cancelled, a deliberate new
  // request (a reviewer rerunning after a model change) starts a fresh job; the old one keeps its history.
  const stale = await Job.find({ idempotencyKey, status: { $in: ['done', 'failed', 'cancelled'] } }).select('_id').setOptions(SYSTEM).lean();
  for (const old of stale) await Job.updateOne({ _id: old._id }, { $set: { idempotencyKey: `${idempotencyKey}#${old._id}` } }).setOptions(SYSTEM);
  const result = await Job.findOneAndUpdate({ idempotencyKey }, {
    $setOnInsert: { ...input, inputVersion, idempotencyKey, status: 'queued', attempts: 0, maxAttempts: input.maxAttempts ?? MAX_ATTEMPTS, availableAt: now },
  }, { upsert: true, returnDocument: 'after', includeResultMetadata: true, runValidators: true }).setOptions(SYSTEM);
  const created = !result.lastErrorObject?.updatedExisting;
  if (created) await Submission.updateOne({ _id: input.submissionId }, { $set: { status: 'QUEUED' } }).setOptions(SYSTEM);
  return { job: result.value!, created };
}

/** Claim the oldest available job: queued and due, or leased with an expired lease (crashed worker). */
export async function claimJob(workerId: string, leaseMs = LEASE_MS) {
  const now = new Date();
  const job = await Job.findOneAndUpdate({
    $or: [{ status: 'queued', availableAt: { $lte: now } }, { status: 'leased', leaseUntil: { $lt: now } }],
  }, { $set: { status: 'leased', workerId, leaseUntil: new Date(now.getTime() + leaseMs) }, $inc: { attempts: 1 } },
  { sort: { availableAt: 1, createdAt: 1 }, returnDocument: 'after' }).setOptions(SYSTEM).lean();
  if (!job) return null;
  // A job that has used every attempt (its worker kept crashing) fails here instead of looping forever.
  if (job.attempts > job.maxAttempts) {
    await finish(String(job._id), workerId, 'failed', { code: 'attempts_exhausted', message: 'The pipeline stopped responding on every attempt.' });
    return claimJob(workerId, leaseMs);
  }
  await Submission.updateOne({ _id: job.submissionId }, { $set: { status: 'PROCESSING' } }).setOptions(SYSTEM);
  return job;
}

/** Extend the lease; false means the job is no longer this worker's (expired and re-claimed, or cancelled). */
export async function heartbeat(jobId: string, workerId: string, leaseMs = LEASE_MS, currentStage?: Stage) {
  const result = await Job.updateOne({ _id: jobId, workerId, status: 'leased' },
    { $set: { leaseUntil: new Date(Date.now() + leaseMs), ...(currentStage ? { currentStage } : {}) } }).setOptions(SYSTEM);
  return result.modifiedCount === 1;
}

async function finish(jobId: string, workerId: string, status: 'done' | 'failed', error?: JobErrorInput) {
  const job = await Job.findOneAndUpdate({ _id: jobId, workerId, status: 'leased' }, {
    $set: { status, finishedAt: new Date(), ...(error ? { error: { code: error.code, message: error.message.slice(0, 600), ...(error.stage ? { stage: error.stage } : {}) } } : {}) },
    $unset: { leaseUntil: 1 },
  }, { returnDocument: 'after' }).setOptions(SYSTEM).lean();
  return job;
}

/** Mark done. The worker sets the submission's final status (READY, NEEDS_INPUT, UNASSESSABLE) itself. */
export async function completeJob(jobId: string, workerId: string) {
  return !!await finish(jobId, workerId, 'done');
}

/**
 * Fail an attempt. Retryable errors (timeouts, a model still loading) go back to the queue with backoff
 * until maxAttempts; others, such as capability_unavailable (D-24) or invalid_input, fail at once and stay visible.
 */
export async function failJob(jobId: string, workerId: string, error: JobErrorInput) {
  const job = await Job.findOne({ _id: jobId, workerId, status: 'leased' }).setOptions(SYSTEM).lean();
  if (!job) return null;
  if (error.retryable && job.attempts < job.maxAttempts) {
    await Job.updateOne({ _id: jobId, workerId, status: 'leased' }, {
      $set: { status: 'queued', availableAt: new Date(Date.now() + backoffMs(job.attempts)), error: { code: error.code, message: error.message.slice(0, 600), ...(error.stage ? { stage: error.stage } : {}) } },
      $unset: { leaseUntil: 1, workerId: 1 },
    }).setOptions(SYSTEM);
    return 'requeued' as const;
  }
  await finish(jobId, workerId, 'failed', error);
  await Submission.updateOne({ _id: job.submissionId }, { $set: { status: 'FAILED' } }).setOptions(SYSTEM);
  return 'failed' as const;
}

/** Cancel a job that has not finished (for example the entrepreneur withdrew consent). */
export async function cancelJob(jobId: string) {
  const result = await Job.updateOne({ _id: jobId, status: { $in: ['queued', 'leased'] } }, { $set: { status: 'cancelled', finishedAt: new Date() }, $unset: { leaseUntil: 1 } }).setOptions(SYSTEM);
  return result.modifiedCount === 1;
}

/**
 * Record one stage transition: an insert-only StageEvent for the live card (SSE) and, when the stage ends,
 * a PipelineRun row with timing and model use for A-29. Summaries hold small non-personal counts only.
 */
export async function recordStage(job: { _id: unknown; submissionId: unknown; ownerOrgId: unknown }, stage: Stage, status: StageStatus,
  details: { ms?: number; summary?: Record<string, unknown>; error?: string; provider?: string; model?: string; tokensIn?: number; tokensOut?: number;
    llmCalls?: number; computeSeconds?: number; startedAt?: Date } = {}) {
  const ids = { jobId: new Types.ObjectId(String(job._id)), submissionId: new Types.ObjectId(String(job.submissionId)), ownerOrgId: new Types.ObjectId(String(job.ownerOrgId)) };
  const at = new Date();
  const event = await StageEvent.create({ ...ids, stage, status, at, ...(details.ms !== undefined ? { ms: details.ms } : {}),
    ...(details.summary ? { summary: details.summary } : {}), ...(details.error ? { error: details.error.slice(0, 600) } : {}) });
  if (status !== 'started') {
    const { summary: _summary, startedAt, ...usage } = details;
    await PipelineRun.create({ ...ids, stage, status, startedAt: startedAt ?? new Date(at.getTime() - (details.ms ?? 0)), endedAt: at, hostedCostInr: 0,
      ...Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined)) });
  }
  return event;
}
