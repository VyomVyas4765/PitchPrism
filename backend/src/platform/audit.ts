import type { AuthContext } from '../auth/session.js';
import { AuditLog } from '../models.js';

// Append-only audit trail (W-08, PRD section 21: kept at least 12 months). Records who did what to which
// record; never request bodies, personal data or free text from users.
export interface AuditTarget { type: string; id?: string; orgId?: string | null }

export async function recordAudit(auth: AuthContext | undefined, action: `${string}.${string}`, target: AuditTarget,
  meta: Record<string, string | number | boolean> = {}, outcome: 'allowed' | 'denied' = 'allowed') {
  try {
    await AuditLog.create({
      action, outcome, at: new Date(), targetType: target.type, ...(target.id ? { targetId: target.id } : {}),
      ...(target.orgId ? { targetOrgId: target.orgId } : {}),
      ...(auth ? { actorUserId: auth.user.id, actorRole: auth.user.role, ...(auth.user.orgId ? { orgId: auth.user.orgId } : {}) } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    });
  } catch (error) {
    // An audit write failure must be visible to operators but must not leak details to the caller.
    console.error('audit: failed to record', action, error instanceof Error ? error.name : 'UnknownError');
  }
}
