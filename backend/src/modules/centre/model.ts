import mongoose, { Schema } from 'mongoose';

const centreCaseSchema = new Schema({
  submissionId: { type: Schema.Types.ObjectId, ref: 'Submission', required: true, unique: true },
  ownerOrgId: { type: Schema.Types.ObjectId, required: true, index: true },
  input: { type: Schema.Types.Mixed, required: true },
  evaluation: { type: Schema.Types.Mixed },
  evaluationHistory: { type: [Schema.Types.Mixed], default: [] },
  financialChecks: { type: [Schema.Types.Mixed], default: [] },
  quality: { type: Schema.Types.Mixed },
  followUps: { type: [Schema.Types.Mixed], default: [] },
  planDraft: { type: Schema.Types.Mixed },
  state: { type: String, enum: ['PENDING_MODEL', 'READY', 'NEEDS_ATTENTION', 'UNASSESSABLE'], required: true },
  reason: String,
  metrics: { type: Schema.Types.Mixed },
  decision: { type: Schema.Types.Mixed },
  feedback: { type: Schema.Types.Mixed },
}, { timestamps: true, minimize: false });
centreCaseSchema.index({ ownerOrgId: 1, state: 1, updatedAt: -1 });
export const CentreCase = mongoose.model('CentreCase', centreCaseSchema);
