import mongoose, { Schema } from 'mongoose';
import { ORG_TYPES, ROLES } from '@pitchprism/contracts';
import { contractSchema } from './models/schema.js';
import type * as Stored from './models/stored.generated.js';
const orgSchema = new Schema({
  name: { type: String, required: true }, type: { type: String, enum: ORG_TYPES, required: true },
  active: { type: Boolean, default: true }, fundingMode: { type: String, enum: ['lender', 'csr'] },
  // Hub-and-spoke (PRD §5): centres and partners report to HQ; implementation partners to a centre.
  parentOrgId: { type: Schema.Types.ObjectId, ref: 'Org' }, region: String, languages: [String],
  createdByUserId: Schema.Types.ObjectId,
}, { timestamps: true });
const userSchema = new Schema({
  displayName: { type: String, required: true }, email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  passwordHash: { type: String, select: false }, firebaseUid: { type: String, unique: true, sparse: true },
  role: { type: String, enum: ROLES, required: true }, orgId: { type: Schema.Types.ObjectId, ref: 'Org' },
  disabled: { type: Boolean, default: false },
}, { timestamps: true });
const sessionSchema = new Schema({
  _id: { type: String, required: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});
// Read-only starter model. Expand through reviewed contracts before adding workflow writes.
const submissionSchema = new Schema({
  title: { type: String, required: true }, ownerOrgId: { type: Schema.Types.ObjectId, required: true },
  sourceOrgId: Schema.Types.ObjectId, entrepreneurId: { type: Schema.Types.ObjectId, required: true },
  createdByUserId: { type: Schema.Types.ObjectId, required: true },
  cohortId: Schema.Types.ObjectId, language: String, inputFormat: String, channel: String, gender: String,
  district: String, trade: String, sector: String, band: String, pathway: String, score: Number,
  status: { type: String, enum: ['DRAFT', 'READY', 'SHORTLISTED', 'NOT_YET', 'MORE_INFO', 'UNASSESSABLE'], default: 'DRAFT' },
  fundingReady: { type: Boolean, default: false },
  applicant: { name: String, phone: String },
  shares: [{ orgId: Schema.Types.ObjectId, partnerType: { type: String, enum: ['sector_partner', 'funding_partner'] }, active: Boolean, contactAccepted: Boolean }],
});
// Staff join only by invitation (W-01). Only the sha256 of the one-time token is stored; the role and
// organisation come from this record, never from the person accepting it.
const inviteSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ROLES, required: true }, orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  invitedByUserId: { type: Schema.Types.ObjectId, required: true },
  expiresAt: { type: Date, required: true }, acceptedAt: Date, revokedAt: Date, acceptedUserId: Schema.Types.ObjectId,
}, { timestamps: true });
inviteSchema.index({ orgId: 1, createdAt: -1 });
inviteSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { acceptedAt: null, revokedAt: null } });
submissionSchema.index({ ownerOrgId: 1 });
submissionSchema.index({ entrepreneurId: 1 });
export const Org = mongoose.model('Org', orgSchema);
export const User = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const Invite = mongoose.model('Invite', inviteSchema);
export const Submission = mongoose.model('Submission', submissionSchema);

const versionedSchema = new Schema({
  name: { type: String, required: true }, version: { type: Number, required: true },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  definition: { type: Schema.Types.Mixed, required: true }, createdByUserId: Schema.Types.ObjectId,
}, { timestamps: true });
versionedSchema.index({ name: 1, version: -1 }, { unique: true });
const routingRuleSchema = new Schema({
  partnerOrgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  trades: [String], sectors: [String], districts: [String], active: { type: Boolean, default: true },
  createdByUserId: Schema.Types.ObjectId,
}, { timestamps: true });
const cohortSchema = new Schema({
  name: { type: String, required: true }, orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  programmeId: Schema.Types.ObjectId, startsAt: Date, endsAt: Date, active: { type: Boolean, default: true },
}, { timestamps: true });
const tradeSchema = new Schema({
  name: { type: String, required: true }, synonyms: [String], osmTags: [String], active: { type: Boolean, default: true },
}, { timestamps: true });
const auditEventSchema = new Schema({
  actorUserId: Schema.Types.ObjectId, action: { type: String, required: true },
  resourceType: { type: String, required: true }, resourceId: String, metadata: Schema.Types.Mixed,
}, { timestamps: true });
const evaluationRunSchema = new Schema({
  promptVersion: String, rubricVersionId: Schema.Types.ObjectId, models: [String],
  metrics: Schema.Types.Mixed, perFile: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now },
});
const stageEventSchema = new Schema({
  submissionId: Schema.Types.ObjectId, stage: { type: String, required: true },
  status: { type: String, enum: ['started', 'completed', 'failed'], required: true },
  durationMs: Number, model: String, tokens: Number, cost: Number, detail: Schema.Types.Mixed,
}, { timestamps: true });
const jobSchema = new Schema({
  type: { type: String, required: true }, payload: { type: Schema.Types.Mixed, required: true },
  state: { type: String, enum: ['queued', 'leased', 'completed', 'failed'], default: 'queued' },
  attempts: { type: Number, default: 0 }, leaseUntil: Date, workerId: String, error: String,
  availableAt: { type: Date, default: Date.now }, completedAt: Date,
}, { timestamps: true });
jobSchema.index({ state: 1, availableAt: 1, leaseUntil: 1 });
const reviewSampleSchema = new Schema({
  submissionId: { type: Schema.Types.ObjectId, required: true, unique: true },
  reason: { type: String, required: true }, sampledAt: { type: Date, default: Date.now },
  reviewerUserId: Schema.Types.ObjectId, override: Schema.Types.Mixed, status: { type: String, enum: ['pending', 'reviewed'], default: 'pending' },
}, { timestamps: true });
const clusterPointSchema = new Schema({
  submissionId: { type: Schema.Types.ObjectId, required: true, unique: true },
  x: { type: Number, required: true }, y: { type: Number, required: true },
  cluster: { type: String, required: true }, method: { type: String, required: true }, generatedAt: { type: Date, default: Date.now },
});
export const Programme = mongoose.model('Programme', versionedSchema);
export const Rubric = mongoose.model('Rubric', versionedSchema);
export const RoutingRule = mongoose.model('RoutingRule', routingRuleSchema);
export const Cohort = mongoose.model('Cohort', cohortSchema);
export const Trade = mongoose.model('Trade', tradeSchema);
export const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);
export const EvaluationRun = mongoose.model('EvaluationRun', evaluationRunSchema);
export const StageEvent = mongoose.model('StageEvent', stageEventSchema);
export const Job = mongoose.model('Job', jobSchema);
export const ReviewSample = mongoose.model('ReviewSample', reviewSampleSchema);
export const ClusterPoint = mongoose.model('ClusterPoint', clusterPointSchema);
// These two collections already use the reviewed domain contracts; the other live models still
// need a coordinated migration from the legacy definitions above to ./models/index.ts.
export const Entrepreneur = mongoose.model<Stored.Entrepreneur>('Entrepreneur', contractSchema('Entrepreneur', {
  overrides: { userId: { unique: true, sparse: true }, personal: { select: false } },
  indexes: [[{ contactHashes: 1 }], [{ homeOrgId: 1 }],
    [{ facilitatorId: 1, clientApplicantId: 1 }, { unique: true, partialFilterExpression: { clientApplicantId: { $type: 'string' } } }]],
}));
export const Consent = mongoose.model<Stored.Consent>('Consent', contractSchema('Consent', {
  indexes: [
    [{ entrepreneurId: 1, purpose: 1, status: 1 }],
    [{ entrepreneurId: 1, purpose: 1, scope: 1 }, { unique: true, partialFilterExpression: { status: 'active' } }],
  ],
}));
