import type { RequestHandler } from 'express';
import { ROLE_PERMISSIONS, type Permission } from '@pitchprism/contracts';
import type { AuthContext } from './session.js';
import { HttpError } from '../errors.js';

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) { next(new HttpError(401, 'Please sign in.')); return; }
    if (!ROLE_PERMISSIONS[req.auth.user.role].includes(permission)) { next(new HttpError(403, 'Your role cannot perform this action.')); return; }
    next();
  };
}
/**
 * Combine a scope with a route's own filter. Always use this instead of spreading ({ ...scope, _id }):
 * a spread lets a route key silently overwrite a scope key with the same name and widen access.
 */
export function scoped(scope: Record<string, unknown>, filter: Record<string, unknown>) {
  return { $and: [scope, filter] };
}
// Every resource query must include this scope; client-supplied org IDs never select access.
// Partner access reads active entries in Submission.shares; an entrepreneur's Entrepreneur _id equals its user ID.
export function submissionScope({ user, fundingMode }: AuthContext): Record<string, unknown> {
  switch (user.role) {
    case 'hq_admin': return {};
    case 'centre_assessor': case 'cohort_lead': return { ownerOrgId: user.orgId };
    case 'entrepreneur': return { entrepreneurId: user.id };
    case 'facilitator': return { createdByUserId: user.id };
    case 'implementation_partner': return { sourceOrgId: user.orgId };
    case 'sector_partner': return { shares: { $elemMatch: { orgId: user.orgId, partnerType: 'sector_partner', active: true } } };
    case 'funding_partner':
      if (fundingMode !== 'lender') throw new HttpError(403, 'This account has access to aggregate impact reports only.');
      return { status: { $in: ['SHORTLISTED', 'SHARED'] }, fundingReady: true, shares: { $elemMatch: { orgId: user.orgId, partnerType: 'funding_partner', active: true } } };
  }
}
