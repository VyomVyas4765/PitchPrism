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

/** Everything the app's application form collected, for the centre's applicant panel (sealed parts opened here). */
export function applicantProfile(applicant: { _id: unknown; personal?: unknown; onboarding?: unknown; district?: string | null;
  state?: string | null; pincode?: string | null } | null, vault: PiiVault | null) {
  const empty = { gender: null, village: null, block: null, district: null, state: null, pincode: null, education: null, workBackground: null, creditScore: null };
  if (!applicant) return empty;
  const id = String(applicant._id);
  const personal = applicant.personal && vault ? vault.open<{ gender?: string | null }>(applicant.personal as Sealed, id) : {};
  const form = applicant.onboarding && vault ? vault.open<{ village?: string; block?: string; education?: string; workBackground?: string;
    creditScore?: number | null }>(applicant.onboarding as Sealed, id) : {};
  return { ...empty, gender: personal.gender ?? null, village: form.village ?? null, block: form.block ?? null, district: applicant.district ?? null,
    state: applicant.state ?? null, pincode: applicant.pincode ?? null, education: form.education ?? null, workBackground: form.workBackground ?? null,
    creditScore: form.creditScore ?? null };
}

/** Name and phone from the sealed records: imports keep the phone with the name; app onboarding keeps the mobile. */
export function applicantContact(applicant: { _id: unknown; personal?: unknown; onboarding?: unknown } | null, vault: PiiVault | null) {
  if (!applicant || !vault) return { name: null, phone: null };
  const id = String(applicant._id);
  const personal = applicant.personal ? vault.open<{ name?: string; phone?: string }>(applicant.personal as Sealed, id) : {};
  const onboarding = applicant.onboarding ? vault.open<{ mobile?: string }>(applicant.onboarding as Sealed, id) : {};
  return { name: personal.name ?? null, phone: personal.phone ?? onboarding.mobile ?? null };
}
