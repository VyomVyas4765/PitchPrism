import mongoose from 'mongoose';
import { Submission } from '../../models.js';
import { Consent, SHARING_SCOPES, type CONSENT_NOTICE_VERSIONS, type Language, type SharingScope } from './models.js';

type Id = string | mongoose.Types.ObjectId;
export interface GrantInput {
  entrepreneurId: Id; purpose: 'processing' | 'partner_sharing'; scope: 'all' | SharingScope;
  method: 'app_tap' | 'app_voice' | 'assisted_recorded'; language: Language; noticeVersion: typeof CONSENT_NOTICE_VERSIONS[number];
  grantedByUserId: Id; evidenceDocumentId?: Id;
}

export async function hasProcessingConsent(entrepreneurId: Id) {
  return !!await Consent.exists({ entrepreneurId, purpose: 'processing', status: 'active' });
}
// Routing (W-13/A-27) and partner shares must call this before creating or sending a share.
export async function sharingAllowed(entrepreneurId: Id, partnerType: SharingScope) {
  const active = await Consent.find({ entrepreneurId, status: 'active', $or: [{ purpose: 'processing' }, { purpose: 'partner_sharing', scope: partnerType }] }).select('purpose').lean();
  return active.some(consent => consent.purpose === 'processing') && active.some(consent => consent.purpose === 'partner_sharing');
}

// Idempotent: an existing active consent for the same purpose and scope is returned unchanged.
export async function grantConsent(input: GrantInput) {
  const key = { entrepreneurId: input.entrepreneurId, purpose: input.purpose, scope: input.scope, status: 'active' as const };
  const existing = await Consent.findOne(key).lean();
  if (existing) return { consent: existing, created: false };
  try {
    const consent = await Consent.create({ ...input, status: 'active' as const, grantedAt: new Date() });
    return { consent: consent.toObject(), created: true };
  } catch (error) {
    // A concurrent grant won the unique active-consent index; return that record.
    if ((error as { code?: number }).code !== 11000) throw error;
    return { consent: (await Consent.findOne(key).lean())!, created: false };
  }
}

// Partner access is removed before the response returns: the shared submission scope only
// admits active shares, so partners lose access on their next request (PRD §19).
export async function deactivateShares(entrepreneurId: Id, scopes: readonly SharingScope[]) {
  if (!scopes.length) return;
  await Submission.updateMany(
    { entrepreneurId, shares: { $elemMatch: { partnerType: { $in: scopes }, active: true } } },
    { $set: { 'shares.$[share].active': false } },
    { arrayFilters: [{ 'share.partnerType': { $in: scopes }, 'share.active': true }] },
  );
}

// Revoking processing withdraws every sharing consent too, since sharing depends on processing.
// Safe to retry: an already-revoked consent re-runs share deactivation and returns its record.
export async function revokeConsent(entrepreneurId: Id, consentId: Id, revokedByUserId: Id) {
  const consent = await Consent.findOne({ _id: consentId, entrepreneurId }).lean();
  if (!consent) return null;
  const filter = consent.purpose === 'processing'
    ? { entrepreneurId, status: 'active' as const }
    : { _id: consent._id, status: 'active' as const };
  await Consent.updateMany(filter, { $set: { status: 'revoked' as const, revokedAt: new Date(), revokedByUserId } });
  await deactivateShares(entrepreneurId, consent.purpose === 'processing' ? SHARING_SCOPES : [consent.scope as SharingScope]);
  return Consent.findById(consent._id).lean();
}
