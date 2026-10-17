import { randomUUID } from 'node:crypto';
import { connectDatabase } from './database.js';
import { readConfig } from './config.js';
import { Job, StageEvent } from './models.js';

const config = readConfig();
const workerId = `local-${randomUUID()}`;
await connectDatabase(config);
console.log(`MongoDB job worker ${workerId} started.`);

async function tick() {
  const now = new Date();
  const job = await Job.findOneAndUpdate(
    { $or: [{ state: 'queued', availableAt: { $lte: now } }, { state: 'leased', leaseUntil: { $lt: now } }] },
    { $set: { state: 'leased', workerId, leaseUntil: new Date(Date.now() + 60_000) }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  );
  if (!job) return;
  const submissionId = typeof job.payload?.submissionId === 'string' ? job.payload.submissionId : null;
  if (job.type !== 'submission.process' || !submissionId) {
    job.state = 'failed'; job.error = 'Unsupported job payload.'; await job.save(); return;
  }
  await StageEvent.create({ submissionId, stage: 'processing', status: 'failed', detail: { code: 'capability_pending', message: 'No validated local ingestion worker is configured.' } });
  job.state = 'failed'; job.error = 'capability_pending'; job.completedAt = new Date(); await job.save();
}

const timer = setInterval(() => { void tick().catch(error => console.error('Job tick failed:', error)); }, 1000);
const stop = async () => { clearInterval(timer); await (await import('mongoose')).default.disconnect(); process.exit(0); };
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
