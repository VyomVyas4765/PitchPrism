import mongoose, { Schema } from 'mongoose';
import { LANGUAGES } from './models.js';

export const PITCH_MODES = ['guided', 'free_talk', 'typed', 'upload'] as const;
export const DOCUMENT_KINDS = ['audio', 'pdf', 'image', 'text'] as const;
export const GUIDED_STEPS = ['sell', 'buyers', 'where', 'money', 'skills'] as const;
// Byte ceilings per kind; Opus at ~16 kbps keeps a 10-minute pitch near 1.2 MB.
export const MAX_BYTES = { audio: 20 * 1024 * 1024, pdf: 25 * 1024 * 1024, image: 10 * 1024 * 1024, text: 256 * 1024 } as const;
export const CHUNK_BYTES = 1024 * 1024;
export const MAX_DOCUMENTS = 20;

// A pitch is the entrepreneur's (or facilitator's) draft before it becomes a shared Submission.
// clientDraftId comes from the device, so an offline retry after a crash finds the same draft (M-11).
const pitchSchema = new Schema({
  entrepreneurId: { type: Schema.Types.ObjectId, required: true, index: true },
  createdByUserId: { type: Schema.Types.ObjectId, required: true },
  channel: { type: String, enum: ['app_self', 'app_assisted'], required: true },
  mode: { type: String, enum: PITCH_MODES, required: true },
  language: { type: String, enum: LANGUAGES, required: true },
  clientDraftId: { type: String, required: true },
  centreId: Schema.Types.ObjectId,
  sourceOrgId: Schema.Types.ObjectId,
  typedAnswers: [{ _id: false, step: { type: String, enum: GUIDED_STEPS }, text: String }],
  status: { type: String, enum: ['DRAFT', 'SUBMITTED'], default: 'DRAFT', required: true },
  submissionId: Schema.Types.ObjectId,
  // States are explicit: no state claims processing happened unless a transcript exists (D-24).
  pipeline: { type: String, enum: ['not_requested', 'pending_queue', 'processing', 'transcribed', 'pending_capability', 'failed'], default: 'not_requested' },
  submittedAt: Date,
}, { timestamps: true });
pitchSchema.index({ createdByUserId: 1, clientDraftId: 1 }, { unique: true });

// PRD §19 `documents`: originals are immutable once complete; sha256 is checked on the server.
const documentSchema = new Schema({
  pitchId: Schema.Types.ObjectId,
  // Centre imports link the original directly to the scoped submission.
  submissionId: Schema.Types.ObjectId,
  entrepreneurId: { type: Schema.Types.ObjectId, required: true },
  createdByUserId: { type: Schema.Types.ObjectId, required: true },
  purpose: { type: String, enum: ['pitch', 'consent_evidence'], required: true },
  kind: { type: String, enum: DOCUMENT_KINDS, required: true },
  declaredMime: { type: String, required: true },
  clientFileId: { type: String, required: true },
  promptStep: { type: String, enum: GUIDED_STEPS },
  bytes: { type: Number, required: true },
  sha256: { type: String, required: true },
  receivedBytes: { type: Number, default: 0 },
  state: { type: String, enum: ['receiving', 'complete', 'rejected'], default: 'receiving' },
  storageId: Schema.Types.ObjectId,
  completedAt: Date,
}, { timestamps: true });
documentSchema.index({ createdByUserId: 1, clientFileId: 1 }, { unique: true });
documentSchema.index({ pitchId: 1 });
documentSchema.index({ submissionId: 1 });

// Staged upload chunks; removed once the original is verified and stored.
const chunkSchema = new Schema({
  documentId: { type: Schema.Types.ObjectId, required: true },
  offset: { type: Number, required: true },
  data: { type: Buffer, required: true },
});
chunkSchema.index({ documentId: 1, offset: 1 }, { unique: true });

export const Pitch = mongoose.model('Pitch', pitchSchema);
export const PitchDocument = mongoose.model('PitchDocument', documentSchema, 'documents');
export const DocumentChunk = mongoose.model('DocumentChunk', chunkSchema);
