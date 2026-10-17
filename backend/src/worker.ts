import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { connectDatabase } from './database.js';
import { readConfig } from './config.js';
import { claimJob, failJob } from './queue/jobs.js';

const config = readConfig();
const workerId = `local-${randomUUID()}`;
await connectDatabase(config);
console.log(`MongoDB job worker ${workerId} started.`);

let inFlight: Promise<void> | null = null;
let stopping = false;
async function tick() {
  if (stopping || inFlight) return;
  inFlight = (async () => {
    const job = await claimJob(workerId);
    if (!job) return;
    // Dev 1/2 stage handlers are not integrated yet. Do not claim an assessment succeeded.
    await failJob(job._id, workerId, 'capability_unavailable', false);
  })();
  try { await inFlight; }
  finally { inFlight = null; }
}

const timer = setInterval(() => { void tick().catch(error => console.error('Job tick failed:', error instanceof Error ? error.name : 'UnknownError')); }, 1000);
const stop = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  if (inFlight) await inFlight.catch(() => undefined);
  await mongoose.disconnect();
  process.exit(0);
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
