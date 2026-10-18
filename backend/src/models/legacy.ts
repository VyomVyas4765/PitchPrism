// Legacy HQ/centre models restored from the pre-contract models.ts (commit 3cd2840) because
// modules/hq and modules/centre still import them. Port these to packages/contracts, then delete this file.
import mongoose, { Schema } from 'mongoose';

const auditEventSchema = new Schema({
  actorUserId: Schema.Types.ObjectId, action: { type: String, required: true },
  resourceType: { type: String, required: true }, resourceId: String, metadata: Schema.Types.Mixed,
}, { timestamps: true });
const evaluationRunSchema = new Schema({
  promptVersion: String, rubricVersionId: Schema.Types.ObjectId, models: [String],
  metrics: Schema.Types.Mixed, perFile: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now },
});
const clusterPointSchema = new Schema({
  submissionId: { type: Schema.Types.ObjectId, required: true, unique: true },
  x: { type: Number, required: true }, y: { type: Number, required: true },
  cluster: { type: String, required: true }, method: { type: String, required: true }, generatedAt: { type: Date, default: Date.now },
});

export const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);
export const EvaluationRun = mongoose.model('EvaluationRun', evaluationRunSchema);
export const ClusterPoint = mongoose.model('ClusterPoint', clusterPointSchema);
