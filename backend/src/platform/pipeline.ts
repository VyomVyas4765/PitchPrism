import { Router, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { domainSchema, ROLE_PERMISSIONS, type Stage } from '@pitchprism/contracts';
import { submissionScope } from '../auth/authorization.js';
import type { AuthContext } from '../auth/session.js';
import { HttpError } from '../errors.js';
import { Job, PipelineRun, Programme, Rubric, StageEvent, Submission } from '../models.js';
import { hasProcessingConsent } from '../modules/entrepreneur/consent.js';
import { recordAudit } from './audit.js';
import { cancelJob, enqueueJob } from './jobs.js';
import { asSystem } from './tenancy.js';
import { objectId } from './validation.js';

// Pipeline control and live stage events (D-17, D-29, A-28). Mounted at /api/v1 behind the session middleware.
const STAGES = (domainSchema as { definitions: Record<string, { enum?: string[] }> }).definitions.Stage!.enum! as [Stage, ...Stage[]];
const RESUBMITTABLE = ['DRAFT', 'NEEDS_INPUT', 'MORE_INFO', 'FAILED'];
const HEARTBEAT_MS = 15_000;
const can = (auth: AuthContext, permission: 'review_centre' | 'submit_own' | 'submit_assisted') => ROLE_PERMISSIONS[auth.user.role].includes(permission);

const eventView = (event: { _id: unknown; jobId: unknown; submissionId: unknown; stage: string; status: string; at: Date; ms?: number | null; summary?: unknown; error?: string | null }) => ({
  id: String(event._id), jobId: String(event.jobId), submissionId: String(event.submissionId), stage: event.stage, status: event.status,
  at: event.at, ...(event.ms != null ? { ms: event.ms } : {}), ...(event.summary ? { summary: event.summary } : {}), ...(event.error ? { error: event.error } : {}),
});
const jobView = (job: { _id: unknown; status: string; reason: string; fromStage: string; attempts: number; maxAttempts: number; currentStage?: string | null;
  error?: { code: string; message: string; stage?: string | null } | null; rubricKey?: string | null; rubricVersion?: number | null; createdAt?: Date; finishedAt?: Date | null }) => ({
  id: String(job._id), status: job.status, reason: job.reason, fromStage: job.fromStage, attempts: job.attempts, maxAttempts: job.maxAttempts,
  currentStage: job.currentStage ?? null, error: job.error ? { code: job.error.code, message: job.error.message, stage: job.error.stage ?? null } : null,
  rubric: job.rubricKey ? `${job.rubricKey} v${job.rubricVersion ?? '?'}` : null, createdAt: job.createdAt ?? null, finishedAt: job.finishedAt ?? null,
});

async function visibleSubmission(auth: AuthContext, id: string) {
  const submission = await Submission.findOne({ _id: id }).setOptions({ tenant: submissionScope(auth) }).lean();
  if (!submission) throw new HttpError(404, 'Submission not found.');
  return submission;
}

/** Event filter for the viewer. Partners never see pipeline internals; field roles only their own submissions. */
async function eventScope(auth: AuthContext, submissionId?: string): Promise<Record<string, unknown>> {
  const role = auth.user.role;
  if (role === 'sector_partner' || role === 'funding_partner') throw new HttpError(403, 'Live pipeline events are not available to partners.');
  if (submissionId) { await visibleSubmission(auth, submissionId); return { submissionId: new Types.ObjectId(submissionId) }; }
  if (role === 'hq_admin') return {};
  if (role === 'centre_assessor' || role === 'cohort_lead') return { ownerOrgId: new Types.ObjectId(auth.user.orgId!) };
  throw new HttpError(400, 'Choose a submission to follow.');
}

export function pipelineRouter() {
  const router = Router();

  // Start (or restart) processing. Staff reviewers may rescore or retry; entrepreneurs and facilitators submit.
  router.post('/submissions/:id/process', async (req, res) => {
    const auth = req.auth!;
    const id = objectId.parse(req.params.id);
    const input = z.object({
      reason: z.enum(['new', 'followup', 'transcript_edit', 'rescore', 'retry']).default('new'), fromStage: z.enum(STAGES).optional(),
    }).strict().parse(req.body ?? {});
    const reviewer = can(auth, 'review_centre');
    if (!reviewer && !can(auth, 'submit_own') && !can(auth, 'submit_assisted')) throw new HttpError(403, 'Your role cannot start processing.');
    if (!reviewer && !['new', 'followup'].includes(input.reason)) throw new HttpError(403, 'Only reviewers can rescore or retry.');
    const submission = await visibleSubmission(auth, id);
    if (!reviewer && !RESUBMITTABLE.includes(submission.status)) throw new HttpError(409, 'This idea is already being assessed.');
    // PRD section 21: nothing is processed without the entrepreneur's active processing consent.
    if (!await asSystem(() => hasProcessingConsent(submission.entrepreneurId))) {
      await recordAudit(auth, 'pipeline.start', { type: 'submission', id, orgId: String(submission.ownerOrgId) }, { reason: 'no_consent' }, 'denied');
      throw new HttpError(409, 'The entrepreneur has not given consent to process this idea.');
    }
    // Rescoring re-runs from scoring with the programme's currently published rubric (W-02 versioning).
    const fromStage = input.fromStage ?? (input.reason === 'rescore' ? 'score' : input.reason === 'transcript_edit' ? 'structure' : 'ingest');
    const programme = submission.programmeId ? await Programme.findById(submission.programmeId).select('rubricKey').lean() : null;
    const rubricKey = programme?.rubricKey ?? 'edp-default';
    const rubric = await Rubric.findOne({ rubricKey, status: 'published' }).sort({ version: -1 }).select('version').lean();
    const { job, created } = await enqueueJob({ submissionId: id, ownerOrgId: String(submission.ownerOrgId), fromStage, reason: input.reason,
      inputVersion: submission.inputVersion ?? 1, requestedByUserId: auth.user.id, ...(rubric ? { rubricKey, rubricVersion: rubric.version } : {}) });
    if (created) await recordAudit(auth, 'pipeline.start', { type: 'submission', id, orgId: String(submission.ownerOrgId) }, { reason: input.reason, fromStage });
    res.status(created ? 202 : 200).json({ job: jobView(job), created });
  });

  router.post('/jobs/:id/cancel', async (req, res) => {
    const auth = req.auth!;
    if (!can(auth, 'review_centre')) throw new HttpError(403, 'Your role cannot cancel processing.');
    const job = await Job.findOne({ _id: objectId.parse(req.params.id) }).setOptions({ tenant: auth.user.role === 'hq_admin' ? {} : { ownerOrgId: auth.user.orgId } }).lean();
    if (!job) throw new HttpError(404, 'Job not found.');
    const cancelled = await cancelJob(String(job._id));
    if (cancelled) await recordAudit(auth, 'pipeline.cancel', { type: 'job', id: String(job._id), orgId: String(job.ownerOrgId) });
    res.json({ cancelled });
  });

  // Pipeline history for one idea: recent jobs, the latest job's stages and its timings.
  router.get('/submissions/:id/pipeline', async (req, res) => {
    const auth = req.auth!;
    const id = objectId.parse(req.params.id);
    if (auth.user.role === 'sector_partner' || auth.user.role === 'funding_partner') throw new HttpError(403, 'Pipeline details are not available to partners.');
    await visibleSubmission(auth, id);
    const tenant = { submissionId: new Types.ObjectId(id) };
    const jobs = await Job.find({}).setOptions({ tenant }).sort({ createdAt: -1 }).limit(10).lean();
    const latest = jobs[0];
    const [events, runs] = latest ? await Promise.all([
      StageEvent.find({ jobId: latest._id }).setOptions({ tenant }).lean(),
      PipelineRun.find({ jobId: latest._id }).setOptions({ tenant }).sort({ startedAt: 1 }).select('stage status ms provider model llmCalls tokensIn tokensOut').lean(),
    ]) : [[], []];
    res.json({ jobs: jobs.map(jobView), events: events.map(eventView),
      runs: runs.map(run => ({ stage: run.stage, status: run.status, ms: run.ms ?? null, provider: run.provider ?? null, model: run.model ?? null, llmCalls: run.llmCalls ?? 0 })) });
  });

  // Server-sent events: follow the capped stageEvents collection with a tailable cursor, filtered by scope.
  // Event IDs are StageEvent IDs. On reconnect the browser sends Last-Event-ID; the API replays from one second
  // before it (IDs from two processes are not strictly ordered within a second) and clients dedupe by ID.
  router.get('/events', async (req, res) => {
    const auth = req.auth!;
    const { submissionId, after } = z.object({ submissionId: objectId.optional(), after: objectId.optional() }).parse(req.query);
    const scope = await eventScope(auth, submissionId);
    const lastId = req.get('last-event-id');
    const resume = lastId && /^[a-f\d]{24}$/i.test(lastId) ? lastId : after;
    // no-transform stops compressing proxies (including the Next dev proxy) from buffering the stream.
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    await stream(res, req, scope, resume ? Types.ObjectId.createFromTime(new Types.ObjectId(resume).getTimestamp().getTime() / 1000 - 1) : submissionId ? null : Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000)));
  });
  return router;
}

async function stream(res: Response, req: { on(event: 'close', listener: () => void): unknown }, scope: Record<string, unknown>, from: Types.ObjectId | null) {
  let closed = false;
  let cursor: { close(): Promise<void> } | null = null;
  const sent = new Set<string>();
  let since = from;
  const write = (chunk: string) => { if (!closed) res.write(chunk); };
  const ping = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS);
  req.on('close', () => { closed = true; clearInterval(ping); void cursor?.close().catch(() => undefined); });
  write('retry: 3000\n\n');
  write(`event: ready\ndata: {}\n\n`);
  while (!closed) {
    // A tailable cursor ends when the collection is empty or the cursor is invalidated; reopen after a pause.
    const filter = { ...scope, ...(since ? { _id: { $gte: since } } : {}) };
    const tail = StageEvent.collection.find(filter, { tailable: true, awaitData: true, maxAwaitTimeMS: 1000 });
    cursor = tail;
    try {
      for await (const doc of tail) {
        if (closed) break;
        const id = String(doc._id);
        if (sent.has(id)) continue;
        sent.add(id);
        if (sent.size > 5000) sent.delete(sent.values().next().value!);
        write(`id: ${id}\nevent: stage\ndata: ${JSON.stringify(eventView(doc as never))}\n\n`);
        since = Types.ObjectId.createFromTime(doc._id.getTimestamp().getTime() / 1000 - 1);
      }
    } catch (error) {
      if (!closed) console.warn('events: tail interrupted', error instanceof Error ? error.name : 'UnknownError');
    }
    await tail.close().catch(() => undefined);
    if (!closed) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  clearInterval(ping);
  res.end();
}
