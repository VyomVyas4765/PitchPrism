export type { SessionUser, Role, OrgType } from './generated.js';
export type { CentreExtractedInput } from './centre-generated.js';
export { ROLES, ORG_TYPES } from './roles.js';

import type { Role } from './generated.js';
export const ROLE_LABELS: Record<Role, string> = {
  entrepreneur: 'Entrepreneur', facilitator: 'Field facilitator',
  centre_assessor: 'Centre assessor', cohort_lead: 'Cohort lead', hq_admin: 'HQ admin',
  implementation_partner: 'Implementation partner', sector_partner: 'Sector partner', funding_partner: 'Funding partner',
};
export type Permission = 'submit_own' | 'submit_assisted' | 'review_centre' | 'manage_cohorts' | 'manage_platform' | 'review_own_org' | 'view_consented' | 'view_funding';
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  entrepreneur: ['submit_own'], facilitator: ['submit_assisted'],
  centre_assessor: ['review_centre', 'manage_cohorts'], cohort_lead: ['review_centre', 'manage_cohorts'],
  hq_admin: ['manage_platform', 'review_centre', 'manage_cohorts'],
  implementation_partner: ['review_own_org'], sector_partner: ['view_consented'], funding_partner: ['view_funding'],
};
export interface AuthResponse { user: import('./generated.js').SessionUser; accessToken?: string }
export interface Workspace { role: Role; permissions: readonly Permission[]; message: string }
