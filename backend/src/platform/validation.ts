import { z } from 'zod';
import type { Role } from '@pitchprism/contracts';
import { ROLE_ORG_TYPES } from '@pitchprism/contracts';
import type { AuthContext } from '../auth/session.js';

// Shared request-validation pieces for platform and role routers.
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Use a valid ID');
export const shortText = (max = 160) => z.string().trim().min(1).max(max);
export const textList = (max = 80, items = 60) => z.array(z.string().trim().min(1).max(max)).max(items);
export const LANGUAGE_CODES = ['hi', 'mr', 'te', 'or', 'bn', 'en'] as const;
export const page = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  after: objectId.optional(),
});

/** Whether `actor` may grant `role` in an organisation of `orgType` with id `orgId` (PRD section 4, D-27). */
export function canGrant(actor: AuthContext, role: Role, orgId: string, orgType: string): boolean {
  if (role === 'entrepreneur') return false; // entrepreneurs only ever sign in with a verified phone
  if (!ROLE_ORG_TYPES[role].includes(orgType as never)) return false;
  if (actor.user.role === 'hq_admin') return true;
  return role !== 'hq_admin' && actor.user.orgId === orgId;
}
