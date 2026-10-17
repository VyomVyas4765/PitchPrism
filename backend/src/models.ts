import mongoose, { Schema } from 'mongoose';
import { ORG_TYPES, ROLES } from '@pitchprism/contracts';
const orgSchema = new Schema({
  name: { type: String, required: true }, type: { type: String, enum: ORG_TYPES, required: true },
  active: { type: Boolean, default: true }, fundingMode: { type: String, enum: ['lender', 'csr'] },
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
  status: { type: String, enum: ['DRAFT', 'READY', 'SHORTLISTED', 'NOT_YET', 'MORE_INFO', 'UNASSESSABLE'], default: 'DRAFT' },
  fundingReady: { type: Boolean, default: false },
  applicant: { name: String, phone: String },
  shares: [{ orgId: Schema.Types.ObjectId, partnerType: { type: String, enum: ['sector_partner', 'funding_partner'] }, active: Boolean, contactAccepted: Boolean }],
});
submissionSchema.index({ ownerOrgId: 1 });
submissionSchema.index({ entrepreneurId: 1 });
export const Org = mongoose.model('Org', orgSchema);
export const User = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const Submission = mongoose.model('Submission', submissionSchema);
