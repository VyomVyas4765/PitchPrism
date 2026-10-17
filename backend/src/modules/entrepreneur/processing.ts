import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose, { Schema } from 'mongoose';
import { Pitch, PitchDocument } from './intake-models.js';
import { Entrepreneur } from './models.js';
import { readOriginal } from './storage.js';
import type { PiiVault, Sealed } from './pii-vault.js';

// M-08: transcripts are versioned; version 1 is the machine reading and is never changed.
const transcriptSchema = new Schema({
  pitchId: { type: Schema.Types.ObjectId, required: true },
  submissionId: Schema.Types.ObjectId,
  version: { type: Number, required: true },
  status: { type: String, enum: ['extracted', 'pending', 'failed'], required: true },
  segments: { type: [Schema.Types.Mixed], default: [] },
  extracted: Schema.Types.Mixed,     // CentreExtractedInput for Dev 2 when status is extracted
  pending: { type: [Schema.Types.Mixed], default: [] },
  issues: { type: [Schema.Types.Mixed], default: [] },
  // A-10: page regions holding personal details, for blurring page images by role.
  blurBoxes: { type: [Schema.Types.Mixed], default: [] },
  editedByUserId: Schema.Types.ObjectId,
}, { timestamps: true });
transcriptSchema.index({ pitchId: 1, version: -1 }, { unique: true });
export const Transcript = mongoose.model('Transcript', transcriptSchema);

export type IngestJob = { documents: { documentId: string; kind: string; path: string; promptStep?: string }[];
  language: string; typedAnswers?: Record<string, string>; known?: Record<string, string[]>; profile?: Record<string, string> };
export type IngestResult = { status: 'extracted' | 'pending' | 'failed' | 'invalid'; transcript?: unknown[]; extracted?: unknown;
  pending?: unknown[]; issues?: unknown[]; blurBoxes?: unknown[] };
export type IngestRunner = (job: IngestJob) => Promise<IngestResult>;

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pythons = ['ai/.venv/bin/python', 'ai/.venv/Scripts/python.exe'].map(path => join(root, path));

/** Runs the local Python pipeline (`ai.ingest.run`); input and output stay on this host. */
export const runLocalIngest: IngestRunner = job => new Promise((resolve, reject) => {
  const python = process.env.PITCHPRISM_PYTHON || pythons.find(path => existsSync(path)) || (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(python, ['-m', 'ai.ingest.run'], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'], timeout: 30 * 60 * 1000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; if (output.length > 16 * 1024 * 1024) child.kill(); });
  child.on('error', () => reject(new Error('Local ingestion worker could not start.')));
  child.on('close', () => {
    try { resolve(JSON.parse(output) as IngestResult); } catch { reject(new Error('Local ingestion worker returned no result.')); }
  });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(job));
});

let runner: IngestRunner = runLocalIngest;
/** Tests replace the Python worker with a fake. */
export function setIngestRunner(next: IngestRunner) { runner = next; }

/**
 * Integration bridge until the shared D-26 job queue exists: one background run per submitted pitch.
 * Originals are copied to a private temp folder for the worker and removed afterwards. A crash leaves
 * the pitch in `processing`; its owner can retry with POST /pitches/:id/process.
 */
export async function processPitch(pitchId: mongoose.Types.ObjectId, vault: PiiVault | null) {
  const claimed = await Pitch.findOneAndUpdate({ _id: pitchId, status: 'SUBMITTED', pipeline: { $in: ['pending_queue', 'pending_capability', 'failed'] } },
    { $set: { pipeline: 'processing' } }, { returnDocument: 'after' });
  if (!claimed) return;
  const folder = await mkdtemp(join(tmpdir(), 'pitchprism-ingest-'));
  try {
    const documents = await PitchDocument.find({ pitchId, purpose: 'pitch', state: 'complete' });
    const job: IngestJob = { documents: [], language: claimed.language };
    for (const document of documents) {
      if (document.declaredMime === 'application/json') continue;  // typed answers are sent below
      const path = join(folder, `${document._id}.${document.kind === 'pdf' ? 'pdf' : document.kind === 'audio' ? 'm4a' : 'bin'}`);
      await writeFile(path, await readOriginal(document.storageId!));
      job.documents.push({ documentId: String(document._id), kind: document.kind, path, ...(document.promptStep ? { promptStep: document.promptStep } : {}) });
    }
    if (claimed.typedAnswers.length) job.typedAnswers = Object.fromEntries(claimed.typedAnswers.map(answer => [answer.step!, answer.text!]));
    // Known personal values are redacted before any model sees the text (A-10); they never leave this host.
    const person = await Entrepreneur.findById(claimed.entrepreneurId).select('+personal').lean();
    const personal = person?.personal && vault ? vault.open<{ name?: string }>(person.personal as Sealed, String(person._id)) : {};
    if (personal.name) job.known = { name: [personal.name] };
    if (person?.district && person.state) job.profile = { district: person.district, state: person.state, ...(person.pincode ? { pincode: person.pincode } : {}) };
    const result = await runner(job);
    const status = result.status === 'extracted' ? 'extracted' : result.status === 'pending' ? 'pending' : 'failed';
    // A retry after a pending or failed run adds the next version; earlier readings stay for audit.
    const previous = await Transcript.findOne({ pitchId }).sort({ version: -1 }).select('version').lean();
    await Transcript.create({ pitchId, submissionId: claimed.submissionId, version: (previous?.version ?? 0) + 1, status, segments: result.transcript ?? [],
      extracted: result.extracted, pending: result.pending ?? [], issues: result.issues ?? [], blurBoxes: result.blurBoxes ?? [] });
    await Pitch.updateOne({ _id: pitchId }, { $set: { pipeline: status === 'extracted' ? 'transcribed' : status === 'pending' ? 'pending_capability' : 'failed' } });
  } catch {
    await Pitch.updateOne({ _id: pitchId }, { $set: { pipeline: 'failed' } });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
