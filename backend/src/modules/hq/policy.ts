import type { OrgType, Role, SessionUser } from '@pitchprism/contracts';
import { ROLE_ORG_TYPES } from '../../auth/session.js';

const STAFF_ROLES: readonly Role[] = ['hq_admin', 'centre_assessor', 'cohort_lead', 'facilitator', 'implementation_partner', 'sector_partner', 'funding_partner'];

// PRD §4 "Onboard orgs and users": HQ for every org; centres, implementation partners, sector and
// funding partners for their own org's users only. Facilitators and entrepreneurs invite no one.
export const INVITABLE_ROLES: Record<Role, readonly Role[]> = {
  hq_admin: STAFF_ROLES,
  centre_assessor: ['centre_assessor', 'cohort_lead', 'facilitator'],
  cohort_lead: ['centre_assessor', 'cohort_lead', 'facilitator'],
  implementation_partner: ['implementation_partner', 'facilitator'],
  sector_partner: ['sector_partner'],
  funding_partner: ['funding_partner'],
  facilitator: [],
  entrepreneur: [],
};

/** Whether `actor` may invite or manage a user with `role` in an org of `orgType` with id `orgId`. */
export function canManage(actor: SessionUser, role: Role, org: { id: string; type: OrgType }) {
  if (!INVITABLE_ROLES[actor.role].includes(role)) return false;
  if (!ROLE_ORG_TYPES[role].includes(org.type)) return false;
  return actor.role === 'hq_admin' || org.id === actor.orgId;
}

/** Organisation filter for listing invites and users: everything for HQ, the actor's org otherwise. */
export function orgFilter(actor: SessionUser): Record<string, unknown> {
  return actor.role === 'hq_admin' ? {} : { orgId: actor.orgId };
}

/** Roles valid for one org type that this actor may assign there. */
export function assignableRoles(actor: SessionUser, orgType: OrgType) {
  return INVITABLE_ROLES[actor.role].filter(role => ROLE_ORG_TYPES[role].includes(orgType));
}
