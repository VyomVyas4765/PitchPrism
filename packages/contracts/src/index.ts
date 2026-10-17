export type { SessionUser, Role, OrgType } from './generated.js';
export type { CentreExtractedInput } from './centre-generated.js';
export { ROLES, ORG_TYPES } from './roles.js';
// Domain contracts (D-03): generated from schemas/domain/*.json by `pnpm contracts:generate`.
export type * from './domain.generated.js';
export { COLLECTIONS, domainSchema, type EntityName } from './schemas.generated.js';

import type { Role } from './generated.js';
export const ROLE_LABELS: Record<Role, string> = {
  entrepreneur: 'Entrepreneur', facilitator: 'Field facilitator',
  centre_assessor: 'Centre assessor', cohort_lead: 'Cohort lead', hq_admin: 'HQ admin',
  implementation_partner: 'Implementation partner', sector_partner: 'Sector partner', funding_partner: 'Funding partner',
};
// Coarse workspace keys (first milestone) plus the PRD section 4 permission matrix. Keys gate actions only;
// which records a role may touch is decided by the server-side scope functions, never by the key alone.
export type Permission =
  | 'submit_own' | 'submit_assisted' | 'review_centre' | 'manage_cohorts' | 'manage_platform' | 'review_own_org' | 'view_consented' | 'view_funding'
  | 'manage_orgs' // create and edit organisations (HQ)
  | 'invite_users' // invite and manage staff: HQ for any organisation, others for their own organisation only
  | 'configure_rubrics' // programmes and versioned rubrics (HQ)
  | 'manage_trades' // trade list, synonyms and OSM tags (HQ)
  | 'manage_routing' // partner routing rules (HQ)
  | 'view_all_analytics' // cross-organisation pipeline, funnel, fairness and model quality (HQ)
  | 'view_audit_log'; // append-only audit trail (HQ)
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  entrepreneur: ['submit_own'], facilitator: ['submit_assisted'],
  centre_assessor: ['review_centre', 'manage_cohorts', 'invite_users'], cohort_lead: ['review_centre', 'manage_cohorts', 'invite_users'],
  hq_admin: ['manage_platform', 'review_centre', 'manage_cohorts', 'manage_orgs', 'invite_users', 'configure_rubrics', 'manage_trades',
    'manage_routing', 'view_all_analytics', 'view_audit_log'],
  implementation_partner: ['review_own_org', 'invite_users'], sector_partner: ['view_consented', 'invite_users'],
  funding_partner: ['view_funding', 'invite_users'],
};
/** Organisation types each role may belong to (also enforced at sign-in). */
export const ROLE_ORG_TYPES: Record<Role, readonly OrgTypeName[]> = {
  entrepreneur: [], facilitator: ['centre', 'implementation_partner'],
  centre_assessor: ['centre'], cohort_lead: ['centre'], hq_admin: ['hq'],
  implementation_partner: ['implementation_partner'], sector_partner: ['sector_partner'], funding_partner: ['funding_partner'],
};
type OrgTypeName = import('./generated.js').OrgType;
export interface AuthResponse { user: import('./generated.js').SessionUser; accessToken?: string }
export interface Workspace { role: Role; permissions: readonly Permission[]; message: string }
