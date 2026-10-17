import { readFile } from 'node:fs/promises';
import type { Stage } from '@pitchprism/contracts';
import { readConfig } from './config.js';
import { connectDatabase } from './database.js';
import { Submission } from './models.js';
import { claimJob, completeJob, heartbeat, recordStage } from './platform/jobs.js';

// Development only (D-22): a stand-in consumer that replays the fixture's 17 stage timings for queued jobs, so
// the live card, SSE and pipeline-health views can be built and demonstrated before the Python worker runs the
// real stages. Every event is marked replay: true. Nothing is assessed: a submission ends READY only if it
// already has a stored evaluation (cached demo results), otherwise it returns to DRAFT.
//   pnpm pipeline:replay [--speed 4] [--once]
const config = readConfig();
if (config.NODE_ENV === 'production') throw new Error('The pipeline replay is forbidden in production');
const args = process.argv.slice(2);
const speed = Math.max(0.1, Number(args[args.indexOf('--speed') + 1]) || 4);
const once = args.includes('--once');
const fixtures = JSON.parse(await readFile(new URL('../../packages/contracts/fixtures/synthetic.json', import.meta.url), 'utf8')) as
  { stageEvents: Array<{ stage: Stage; status: 'done' | 'skipped'; ms: number; summary?: Record<string, unknown> }> };
const STAGES = fixtures.stageEvents;
const WORKER = `replay-${process.pid}`;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

await connectDatabase(config);
console.log(`Pipeline replay ready (speed ×${speed}). Waiting for queued jobs; press Ctrl+C to stop.`);
for (;;) {
  const job = await claimJob(WORKER);
  if (!job) { if (once) break; await pause(1000); continue; }
  console.log(`job ${job._id}: replaying from ${job.fromStage}`);
  const start = STAGES.findIndex(item => item.stage === job.fromStage);
  for (const step of STAGES.slice(Math.max(0, start))) {
    if (!await heartbeat(String(job._id), WORKER, 60_000, step.stage)) { console.log('lease lost; stopping this job'); break; }
    await recordStage(job, step.stage, 'started', { summary: { replay: true } });
    await pause(step.ms / speed);
    await recordStage(job, step.stage, step.status, { ms: Math.round(step.ms / speed), summary: { ...step.summary, replay: true }, provider: 'replay' });
  }
  if (await completeJob(String(job._id), WORKER)) {
    const submission = await Submission.findById(job.submissionId).select('latestEvaluationId').setOptions({ tenant: 'system' }).lean();
    await Submission.updateOne({ _id: job.submissionId }, { $set: { status: submission?.latestEvaluationId ? 'READY' : 'DRAFT' } }).setOptions({ tenant: 'system' });
  }
  if (once) break;
}
process.exit(0);
