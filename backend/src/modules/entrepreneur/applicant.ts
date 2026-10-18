import type { Types } from 'mongoose';
import { Entrepreneur } from '../../models.js';
import { Pitch } from './intake-models.js';
import type { PiiVault, Sealed } from './pii-vault.js';

type Id = Types.ObjectId | string;

/**
 * The applicant record a centre may read for one of its own submissions: an applicant registered to that centre
 * (centre import or assisted), or a self-registered entrepreneur who submitted a pitch (chat or other) to it. Callers
 * must already have checked that the submission is in the staff member's scope. Returns null for anyone else.
 */
export async function applicantForCentre(entrepreneurId: Id, ownerOrgId: Id) {
  const id = String(entrepreneurId);
  const applied = await Pitch.exists({ entrepreneurId: id, centreId: ownerOrgId, status: 'SUBMITTED' });
  return applied
    ? Entrepreneur.findOne({ _id: id }).setOptions({ tenant: { _id: id } }).select('+personal +onboarding').lean()
    : Entrepreneur.findOne({ _id: id, homeOrgId: ownerOrgId }).setOptions({ tenant: { homeOrgId: ownerOrgId } }).select('+personal +onboarding').lean();
}

/** Name and phone from the sealed records: imports keep the phone with the name; app onboarding keeps the mobile. */
export function applicantContact(applicant: { _id: unknown; personal?: unknown; onboarding?: unknown } | null, vault: PiiVault | null) {
  if (!applicant || !vault) return { name: null, phone: null };
  const id = String(applicant._id);
  const personal = applicant.personal ? vault.open<{ name?: string; phone?: string }>(applicant.personal as Sealed, id) : {};
  const onboarding = applicant.onboarding ? vault.open<{ mobile?: string }>(applicant.onboarding as Sealed, id) : {};
  return { name: personal.name ?? null, phone: personal.phone ?? onboarding.mobile ?? null };
}
