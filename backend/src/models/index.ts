import mongoose, { Schema } from 'mongoose';
import type { EntityName } from '@pitchprism/contracts';
import { contractSchema, type ModelSpec } from './schema.js';
import type * as S from './stored.generated.js';

// One model per domain contract (packages/contracts/schemas/domain). Field definitions and types come
// from the contract; only storage concerns (indexes, uniqueness, hidden fields, capping) are declared here.
// Dev 3 owns this file: request a change instead of defining a competing model.
function define<T>(name: EntityName, spec?: ModelSpec) {
  return mongoose.model<T>(name, contractSchema(name, spec) as unknown as Schema<T>);
}

export const Org = define<S.Org>('Org', { indexes: [[{ parentOrgId: 1 }], [{ type: 1, active: 1 }]] });
export const User = define<S.User>('User', {
  overrides: {
    email: { lowercase: true, trim: true, unique: true, sparse: true },
    passwordHash: { select: false },
    firebaseUid: { unique: true, sparse: true },
  },
  indexes: [[{ orgId: 1, role: 1 }]],
});
export const Invitation = define<S.Invitation>('Invitation', {
  overrides: { tokenHash: { unique: true }, email: { lowercase: true, trim: true } },
  indexes: [[{ orgId: 1, createdAt: -1 }]],
});
export const Entrepreneur = define<S.Entrepreneur>('Entrepreneur', { tenant: true,
  overrides: {
    userId: { unique: true, sparse: true },
    personal: { select: false }, // sealed; read only with .select('+personal')
    district: { trim: true }, pincode: { trim: true }, trade: { trim: true },
  },
  indexes: [[{ contactHashes: 1 }], [{ homeOrgId: 1 }],
    [{ facilitatorId: 1, clientApplicantId: 1 }, { unique: true, partialFilterExpression: { clientApplicantId: { $type: 'string' } } }]],
});
export const Consent = define<S.Consent>('Consent', { tenant: true,
  indexes: [
    [{ entrepreneurId: 1, purpose: 1, status: 1 }],
    // At most one active consent per purpose and scope; grantConsent relies on this for idempotency.
    [{ entrepreneurId: 1, purpose: 1, scope: 1 }, { unique: true, partialFilterExpression: { status: 'active' } }],
  ],
});
export const Programme = define<S.Programme>('Programme', { indexes: [[{ orgId: 1, status: 1 }]] });
export const Cohort = define<S.Cohort>('Cohort', { indexes: [[{ programmeId: 1 }], [{ orgId: 1, status: 1 }]] });
export const Trade = define<S.Trade>('Trade', { overrides: { key: { unique: true } } });
export const Rubric = define<S.Rubric>('Rubric', { indexes: [[{ rubricKey: 1, version: 1 }, { unique: true }]] });
export const RoutingRule = define<S.RoutingRule>('RoutingRule', { indexes: [[{ partnerOrgId: 1 }], [{ active: 1 }]] });
export const Submission = define<S.Submission>('Submission', { tenant: true,
  indexes: [
    [{ ownerOrgId: 1, status: 1, createdAt: -1 }], [{ sourceOrgId: 1, status: 1 }], [{ cohortId: 1, tradeKey: 1 }],
    [{ entrepreneurId: 1 }], [{ createdByUserId: 1 }], [{ 'partnerAccess.orgId': 1, 'partnerAccess.partnerType': 1 }],
    [{ 'location.geo': '2dsphere' }],
  ],
});
export const Document = define<S.Document>('Document', { tenant: true, indexes: [[{ submissionId: 1 }], [{ sha256: 1 }]] });
export const Transcript = define<S.Transcript>('Transcript', { tenant: true, indexes: [[{ submissionId: 1, version: -1 }, { unique: true }]] });
export const Evaluation = define<S.Evaluation>('Evaluation', { tenant: true, indexes: [[{ submissionId: 1, createdAt: -1 }], [{ ownerOrgId: 1 }]] });
export const Decision = define<S.Decision>('Decision', { tenant: true, indexes: [[{ submissionId: 1, createdAt: -1 }]] });
export const Share = define<S.Share>('Share', { tenant: true, indexes: [[{ toOrgId: 1, status: 1 }], [{ submissionId: 1 }]] });
export const Outcome = define<S.Outcome>('Outcome', { tenant: true, indexes: [[{ submissionId: 1 }], [{ ownerOrgId: 1, stage: 1 }]] });
export const Job = define<S.Job>('Job', { tenant: true,
  overrides: { idempotencyKey: { unique: true } },
  indexes: [[{ status: 1, availableAt: 1, createdAt: 1 }], [{ submissionId: 1, createdAt: -1 }]],
});
// Capped and insert-only: the API follows it with a tailable cursor for SSE (D-26).
export const StageEvent = define<S.StageEvent>('StageEvent', { tenant: true,
  options: { capped: { size: 64 * 1024 * 1024, max: 250_000 } },
  indexes: [[{ submissionId: 1 }]],
});
export const PipelineRun = define<S.PipelineRun>('PipelineRun', { tenant: true,
  indexes: [[{ jobId: 1 }], [{ submissionId: 1 }], [{ ownerOrgId: 1, startedAt: -1 }]],
});
// W-06: one HQ verdict per sampled decision.
export const ReviewSample = define<S.ReviewSample>('ReviewSample', { tenant: true,
  indexes: [[{ decisionId: 1 }, { unique: true }], [{ ownerOrgId: 1, createdAt: -1 }]],
});
// W-33: one row per evaluation-harness report; reportSha256 makes recording idempotent.
export const EvalRun = define<S.EvalRun>('EvalRun', { overrides: { reportSha256: { unique: true } }, indexes: [[{ runAt: -1 }]] });
export const PasswordReset = define<S.PasswordReset>('PasswordReset', {
  overrides: { tokenHash: { unique: true } }, indexes: [[{ userId: 1, createdAt: -1 }]],
});
// D-33 pitch review: one per submission, written by the worker; the API appends answers to the inbox.
export const ReviewSession = define<S.ReviewSession>('ReviewSession', { tenant: true,
  indexes: [[{ submissionId: 1 }, { unique: true }], [{ ownerOrgId: 1, status: 1 }]],
});
export const AuditLog = define<S.AuditLog>('AuditLog', {
  indexes: [[{ at: -1 }], [{ targetOrgId: 1, at: -1 }], [{ actorUserId: 1, at: -1 }]],
});
export const ImportBatch = define<S.ImportBatch>('ImportBatch', { tenant: true, indexes: [[{ orgId: 1, createdAt: -1 }]] });

// Auth sessions are an internal API concern, not a shared contract.
const sessionSchema = new Schema({
  _id: { type: String, required: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});
export const Session = mongoose.model('Session', sessionSchema);

export const ALL_MODELS = [Org, User, Invitation, Entrepreneur, Consent, Programme, Cohort, Trade, Rubric, RoutingRule,
  Submission, Document, Transcript, Evaluation, Decision, Share, Outcome, Job, StageEvent, PipelineRun, ReviewSample, EvalRun, PasswordReset, ReviewSession, AuditLog, ImportBatch, Session];
export type * as Stored from './stored.generated.js';
