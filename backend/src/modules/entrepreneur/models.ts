import mongoose, { Schema } from 'mongoose';

// Launch languages (PRD §6). Mirrors ai/capabilities.json; move to packages/contracts with Dev 3 (D-03).
export const LANGUAGES = ['hi', 'mr', 'te', 'or', 'bn', 'en'] as const;
export type Language = typeof LANGUAGES[number];
export const GENDERS = ['female', 'male', 'other', 'prefer_not_to_say'] as const;
export const SHARING_SCOPES = ['sector_partner', 'funding_partner'] as const;
export type SharingScope = typeof SHARING_SCOPES[number];
// The consent notice text shown in the app carries this version; records store what was shown.
export const CONSENT_NOTICE_VERSION = 'consent-notice-2026-10-17';
export const CONSENT_NOTICE_VERSIONS = [CONSENT_NOTICE_VERSION] as const;

const sealedSchema = new Schema({ v: Number, iv: String, tag: String, ct: String }, { _id: false });

// PRD §19 `entrepreneurs`. For phone sign-in, _id equals the entrepreneur's User _id, so the shared
// submission scope (`entrepreneurId: user.id`) keeps working. Assisted applicants get their own _id.
const entrepreneurSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
  language: { type: String, enum: LANGUAGES },
  // Sealed {name, gender}; never selected by default and never sent to models or partners.
  personal: { type: sealedSchema, select: false },
  district: { type: String, trim: true },
  pincode: { type: String, trim: true },
  trade: { type: String, trim: true },
  createdVia: { type: String, enum: ['self', 'assisted'], required: true },
  facilitatorId: { type: Schema.Types.ObjectId, ref: 'User' },
  homeOrgId: { type: Schema.Types.ObjectId, ref: 'Org' },
  // Assisted mode: the device's ID for this applicant, so an offline retry does not register them twice.
  clientApplicantId: String,
}, { timestamps: true });
entrepreneurSchema.index({ facilitatorId: 1, clientApplicantId: 1 }, { unique: true, partialFilterExpression: { clientApplicantId: { $type: 'string' } } });

// PRD §19 `consents`: append-only per purpose. Revoking stamps the record; granting again adds a new one.
const consentSchema = new Schema({
  entrepreneurId: { type: Schema.Types.ObjectId, required: true },
  purpose: { type: String, enum: ['processing', 'partner_sharing'], required: true },
  scope: { type: String, enum: ['all', ...SHARING_SCOPES], required: true },
  status: { type: String, enum: ['active', 'revoked'], required: true, default: 'active' },
  method: { type: String, enum: ['app_tap', 'app_voice', 'assisted_recorded'], required: true },
  language: { type: String, enum: LANGUAGES, required: true },
  noticeVersion: { type: String, enum: CONSENT_NOTICE_VERSIONS, required: true },
  grantedAt: { type: Date, required: true },
  grantedByUserId: { type: Schema.Types.ObjectId, required: true },
  revokedAt: Date,
  revokedByUserId: Schema.Types.ObjectId,
  // Assisted mode: the stored recording of the applicant's spoken consent (private document, M-17).
  evidenceDocumentId: Schema.Types.ObjectId,
});
consentSchema.index({ entrepreneurId: 1, purpose: 1, status: 1 });
consentSchema.index({ entrepreneurId: 1, purpose: 1, scope: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });

export const Entrepreneur = mongoose.model('Entrepreneur', entrepreneurSchema);
export const Consent = mongoose.model('Consent', consentSchema);
