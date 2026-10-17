// Barrel kept for existing imports. Models live in ./models/index.ts and are built from the shared contracts.
export * from './models/index.js';
import mongoose, { Schema } from 'mongoose';
import { ORG_TYPES, ROLES } from '@pitchprism/contracts';
const orgSchema = new Schema({
  name: { type: String, required: true }, type: { type: String, enum: ORG_TYPES, required: true },
  active: { type: Boolean, default: true }, fundingMode: { type: String, enum: ['lender', 'csr'] },
  // Hub-and-spoke (PRD §5): centres and partners report to HQ; implementation partners to a centre.
  parentOrgId: { type: Schema.Types.ObjectId, ref: 'Org' }, region: String, languages: [String],
  createdByUserId: Schema.Types.ObjectId,
}, { timestamps: true });
const userSchema = new Schema({
  displayName: { type: String, required: true }, email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  passwordHash: { type: String, select: false },
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
