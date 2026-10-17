import { createHash, randomBytes } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ROLES, type Role } from '@pitchprism/contracts';
import { requirePermission } from '../../auth/authorization.js';
import { hashPassword } from '../../auth/password.js';
import type { AuthContext, sessionService } from '../../auth/session.js';
import { userContext } from '../../auth/session.js';
import type { Config } from '../../config.js';
import { HttpError } from '../../errors.js';
import { Invitation, Org, User } from '../../models.js';
import { recordAudit } from '../../platform/audit.js';
import { canGrant, objectId } from '../../platform/validation.js';

// W-01 staff administration and one-time invitations (D-27). Every staff role with invite_users manages its
// own organisation; HQ manages any. The raw invitation token exists only in the response that creates it.
const INVITE_HOURS = 72;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const userView = (user: { _id: unknown; displayName: string; email?: string | null; role: string; orgId?: unknown; disabled?: boolean; createdAt?: Date }) => ({
  id: String(user._id), displayName: user.displayName, email: user.email ?? null, role: user.role,
  orgId: user.orgId ? String(user.orgId) : null, disabled: !!user.disabled, createdAt: user.createdAt ?? null,
});
const invitationView = (item: { _id: unknown; email?: string | null; displayName?: string | null; role: string; orgId: unknown; expiresAt: Date; acceptedAt?: Date | null; revokedAt?: Date | null; createdAt?: Date }) => ({
  id: String(item._id), email: item.email ?? null, displayName: item.displayName ?? null, role: item.role, orgId: String(item.orgId),
  expiresAt: item.expiresAt, createdAt: item.createdAt ?? null,
  status: item.revokedAt ? 'revoked' : item.acceptedAt ? 'accepted' : item.expiresAt.getTime() < Date.now() ? 'expired' : 'pending',
});

/** Organisations whose staff the actor may manage: HQ any (optionally filtered), everyone else only their own. */
function manageableOrg(auth: AuthContext, requested?: string) {
  if (auth.user.role === 'hq_admin') return requested;
  if (requested && requested !== auth.user.orgId) throw new HttpError(403, 'You can only manage your own organisation.');
  return auth.user.orgId!;
}

export function staffRouter(config: Config) {
  const router = Router();
  router.use(requirePermission('invite_users'));

  router.get('/staff', async (req, res) => {
    const { orgId } = z.object({ orgId: objectId.optional() }).parse(req.query);
    const scope = manageableOrg(req.auth!, orgId);
    const users = await User.find({ role: { $ne: 'entrepreneur' }, ...(scope ? { orgId: scope } : {}) }).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ users: users.map(userView) });
  });

  router.patch('/staff/:id', async (req, res) => {
    const id = objectId.parse(req.params.id);
    const input = z.object({ role: z.enum(ROLES).optional(), disabled: z.boolean().optional() }).strict().parse(req.body);
    if (id === req.auth!.user.id) throw new HttpError(400, 'You cannot change your own role or access.');
    const target = await User.findById(id).lean();
    if (!target || target.role === 'entrepreneur' || !target.orgId) throw new HttpError(404, 'Staff member not found.');
    const org = await Org.findById(target.orgId).lean();
    if (!org) throw new HttpError(404, 'Staff member not found.');
    manageableOrg(req.auth!, String(org._id));
    if (input.role && !canGrant(req.auth!, input.role, String(org._id), org.type)) throw new HttpError(403, 'That role cannot be given in this organisation.');
    if (target.role === 'hq_admin' && req.auth!.user.role !== 'hq_admin') throw new HttpError(403, 'Only HQ can change HQ accounts.');
    const updated = await User.findByIdAndUpdate(id, { $set: input }, { returnDocument: 'after', runValidators: true }).lean();
    await recordAudit(req.auth, input.role ? 'user.role_change' : 'user.access_change', { type: 'user', id, orgId: String(org._id) },
      { ...(input.role ? { role: input.role } : {}), ...(input.disabled !== undefined ? { disabled: input.disabled } : {}) });
    res.json({ user: userView(updated!) });
  });

  router.get('/invitations', async (req, res) => {
    const { orgId } = z.object({ orgId: objectId.optional() }).parse(req.query);
    const scope = manageableOrg(req.auth!, orgId);
    const items = await Invitation.find(scope ? { orgId: scope } : {}).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ invitations: items.map(invitationView) });
  });

  router.post('/invitations', async (req, res) => {
    const input = z.object({
      orgId: objectId, role: z.enum(ROLES), email: z.email().max(254).optional(), displayName: z.string().trim().min(1).max(120).optional(),
    }).strict().parse(req.body);
    const org = await Org.findById(input.orgId).lean();
    if (!org || !org.active) throw new HttpError(404, 'Organisation not found or inactive.');
    manageableOrg(req.auth!, input.orgId);
    if (!canGrant(req.auth!, input.role as Role, input.orgId, org.type)) throw new HttpError(403, 'That role cannot be given in this organisation.');
    if (input.email && await User.exists({ email: input.email.toLowerCase() })) throw new HttpError(409, 'An account with this email already exists.');
    const token = randomBytes(32).toString('base64url');
    const invitation = await Invitation.create({ ...input, tokenHash: tokenHash(token), invitedByUserId: req.auth!.user.id,
      expiresAt: new Date(Date.now() + INVITE_HOURS * 3600 * 1000) });
    await recordAudit(req.auth, 'user.invite', { type: 'invitation', id: String(invitation._id), orgId: input.orgId }, { role: input.role });
    // The link is shown once; only its hash is stored.
    res.status(201).json({ invitation: invitationView(invitation.toObject()), link: `${config.WEB_ORIGIN}/invite/${token}` });
  });

  router.post('/invitations/:id/revoke', async (req, res) => {
    const id = objectId.parse(req.params.id);
    const invitation = await Invitation.findById(id);
    if (!invitation) throw new HttpError(404, 'Invitation not found.');
    manageableOrg(req.auth!, String(invitation.orgId));
    if (!invitation.acceptedAt && !invitation.revokedAt) { invitation.revokedAt = new Date(); await invitation.save(); }
    await recordAudit(req.auth, 'user.invite_revoke', { type: 'invitation', id, orgId: String(invitation.orgId) });
    res.json({ invitation: invitationView(invitation.toObject()) });
  });
  return router;
}

/** Public: preview and accept an invitation. Mounted before the session middleware and behind the sign-in limiter. */
export function invitationAcceptRouter(sessions: ReturnType<typeof sessionService>, limiter: RequestHandler) {
  const router = Router();
  const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This invitation link is not valid.');
  async function open(raw: string) {
    const invitation = await Invitation.findOne({ tokenHash: tokenHash(token.parse(raw)) });
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, 'This invitation has expired, been used or been withdrawn. Ask for a new one.');
    }
    const org = await Org.findById(invitation.orgId).lean();
    if (!org || !org.active) throw new HttpError(410, 'This invitation is no longer valid.');
    return { invitation, org };
  }
  router.get('/:token', limiter, async (req, res) => {
    const { invitation, org } = await open(String(req.params.token));
    res.json({ organisation: org.name, orgType: org.type, role: invitation.role, email: invitation.email ?? null,
      displayName: invitation.displayName ?? null, expiresAt: invitation.expiresAt });
  });
  router.post('/', limiter, async (req, res) => {
    const input = z.object({
      token: z.string(), displayName: z.string().trim().min(1).max(120), email: z.email().max(254).transform(value => value.toLowerCase()),
      password: z.string().min(12, 'Use at least 12 characters.').max(128), client: z.enum(['web', 'mobile']).default('web'),
    }).strict().parse(req.body);
    const { invitation, org } = await open(input.token);
    if (invitation.email && invitation.email !== input.email) throw new HttpError(400, 'Use the email address this invitation was sent to.');
    // Claim the invitation atomically so two simultaneous accepts cannot both succeed.
    const claimed = await Invitation.findOneAndUpdate({ _id: invitation._id, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { acceptedAt: new Date() } }, { returnDocument: 'after' });
    if (!claimed) throw new HttpError(410, 'This invitation has already been used.');
    let user;
    try {
      user = await User.create({ displayName: input.displayName, email: input.email, passwordHash: await hashPassword(input.password),
        role: invitation.role, orgId: org._id, invitedByUserId: invitation.invitedByUserId });
    } catch (error) {
      await Invitation.updateOne({ _id: invitation._id }, { $unset: { acceptedAt: 1 } });
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
      throw error;
    }
    await Invitation.updateOne({ _id: invitation._id }, { $set: { acceptedUserId: user._id } });
    const { user: actor } = await userContext(String(user._id));
    await recordAudit({ user: actor, sessionId: '' }, 'user.invite_accept', { type: 'user', id: actor.id, orgId: String(org._id) }, { role: actor.role });
    const sessionToken = await sessions.create(actor.id);
    if (input.client === 'web') sessions.setCookie(res, sessionToken);
    res.status(201).json({ user: actor, ...(input.client === 'mobile' ? { accessToken: sessionToken } : {}) });
  });
  return router;
}
