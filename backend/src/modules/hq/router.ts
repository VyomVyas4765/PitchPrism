import { createHash, randomBytes } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ORG_TYPES, ROLES, type OrgType, type Role } from '@pitchprism/contracts';
import type { Config } from '../../config.js';
import { HttpError } from '../../errors.js';
import { Invite, Org, Session, User } from '../../models.js';
import { requirePermission } from '../../auth/authorization.js';
import { hashPassword } from '../../auth/password.js';
import { ROLE_ORG_TYPES, userContext, type sessionService } from '../../auth/session.js';
import { assignableRoles, canManage, orgFilter } from './policy.js';

const INVITE_HOURS = 72;
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const name = z.string().trim().min(2).max(120).regex(/^[^\p{Cc}]+$/u);
const languages = z.array(z.enum(['hi', 'mr', 'te', 'or', 'bn', 'en'])).max(6);
const email = z.email().max(254).transform(value => value.toLowerCase());
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
// Long passphrases are allowed; 12 characters is the floor (PRD §21: strong staff passwords).
const password = z.string().min(12).max(128);
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

const orgInput = z.object({
  name, type: z.enum(ORG_TYPES).exclude(['hq']), parentOrgId: objectId.optional(),
  region: z.string().trim().min(1).max(80).optional(), languages: languages.optional(),
  fundingMode: z.enum(['lender', 'csr']).optional(),
}).strict();
const orgUpdate = z.object({ name: name.optional(), active: z.boolean().optional(), region: z.string().trim().min(1).max(80).optional(), languages: languages.optional() }).strict();
const inviteInput = z.object({ email, role: z.enum(ROLES).exclude(['entrepreneur']), orgId: objectId.optional() }).strict();
const userUpdate = z.object({ role: z.enum(ROLES).exclude(['entrepreneur']).optional(), disabled: z.boolean().optional() }).strict()
  .refine(input => input.role !== undefined || input.disabled !== undefined);
const acceptInput = z.object({ token, displayName: name, password, client: z.enum(['web', 'mobile']).default('web') }).strict();

type InviteDoc = { _id: unknown; email: string; role: string; orgId: unknown; expiresAt: Date; acceptedAt?: Date | null; revokedAt?: Date | null; createdAt?: Date };
const inviteStatus = (invite: InviteDoc) => invite.acceptedAt ? 'accepted' : invite.revokedAt ? 'revoked' : invite.expiresAt <= new Date() ? 'expired' : 'pending';
const inviteView = (invite: InviteDoc, orgName?: string) => ({
  id: String(invite._id), email: invite.email, role: invite.role, orgId: String(invite.orgId), orgName: orgName ?? null,
  expiresAt: invite.expiresAt, createdAt: invite.createdAt ?? null, status: inviteStatus(invite),
});

/** Authenticated access administration: organisations (HQ), invitations and staff accounts (W-01). */
export function accessRouter(config: Config) {
  const router = Router();
  const manageUsers = requirePermission('manage_org_users');
  const managePlatform = requirePermission('manage_platform');

  async function activeOrg(id: string) {
    const org = await Org.findOne({ _id: id, active: true }).lean();
    if (!org) throw new HttpError(404, 'Organisation not found.');
    return { id: String(org._id), type: org.type as OrgType, name: org.name };
  }
  const orgNames = async (ids: unknown[]) => new Map((await Org.find({ _id: { $in: ids } }).select('name').lean()).map(org => [String(org._id), org.name]));

  // What the admin screen may offer this actor: organisations in scope and the roles per org.
  router.get('/access/options', manageUsers, async (req, res) => {
    const actor = req.auth!.user;
    const orgs = await Org.find({ active: true, ...(actor.role === 'hq_admin' ? {} : { _id: actor.orgId }) }).select('name type').sort({ type: 1, name: 1 }).lean();
    res.json({ orgs: orgs.map(org => ({ id: String(org._id), name: org.name, type: org.type, roles: assignableRoles(actor, org.type as OrgType) }))
      .filter(org => org.roles.length) });
  });

  router.get('/orgs', manageUsers, async (req, res) => {
    const actor = req.auth!.user;
    const orgs = await Org.find(actor.role === 'hq_admin' ? {} : { _id: actor.orgId }).sort({ type: 1, name: 1 }).lean();
    const parents = await orgNames(orgs.map(org => org.parentOrgId).filter(Boolean));
    const counts = new Map((await User.aggregate<{ _id: unknown; users: number }>([
      { $match: { orgId: { $in: orgs.map(org => org._id) }, disabled: { $ne: true } } }, { $group: { _id: '$orgId', users: { $sum: 1 } } },
    ])).map(row => [String(row._id), row.users]));
    res.json({ orgs: orgs.map(org => ({ id: String(org._id), name: org.name, type: org.type, active: org.active,
      parentOrgId: org.parentOrgId ? String(org.parentOrgId) : null, parentName: org.parentOrgId ? parents.get(String(org.parentOrgId)) ?? null : null,
      region: org.region ?? null, languages: org.languages ?? [], fundingMode: org.fundingMode ?? null, users: counts.get(String(org._id)) ?? 0 })) });
  });

  // HQ creates spokes: centres, sector and funding partners report to HQ; implementation partners to a centre.
  router.post('/orgs', managePlatform, async (req, res) => {
    const input = orgInput.parse(req.body);
    const actor = req.auth!.user;
    if ((input.type === 'funding_partner') !== (input.fundingMode !== undefined)) throw new HttpError(400, 'Funding partners need a funding mode (lender or CSR); other types must not have one.');
    let parentOrgId = actor.orgId!;
    if (input.type === 'implementation_partner') {
      if (!input.parentOrgId) throw new HttpError(400, 'Choose the centre this implementation partner reports to.');
      const parent = await activeOrg(input.parentOrgId);
      if (parent.type !== 'centre') throw new HttpError(400, 'An implementation partner must report to a centre.');
      parentOrgId = parent.id;
    } else if (input.parentOrgId) {
      throw new HttpError(400, 'This organisation type reports to HQ.');
    }
    const org = await Org.create({ name: input.name, type: input.type, parentOrgId, region: input.region, languages: input.languages ?? [],
      fundingMode: input.fundingMode, createdByUserId: actor.id });
    res.status(201).json({ id: String(org._id), name: org.name, type: org.type, parentOrgId: String(org.parentOrgId), active: org.active });
  });

  router.patch('/orgs/:id', managePlatform, async (req, res) => {
    const input = orgUpdate.parse(req.body);
    const id = objectId.parse(req.params.id);
    if (input.active === false && id === req.auth!.user.orgId) throw new HttpError(400, 'You cannot deactivate your own organisation.');
    const org = await Org.findOneAndUpdate({ _id: id, type: { $ne: 'hq' } }, { $set: input }, { returnDocument: 'after' }).lean();
    if (!org) throw new HttpError(404, 'Organisation not found.');
    res.json({ id: String(org._id), name: org.name, type: org.type, active: org.active });
  });

  // The token is returned once, inside a link fragment so it never reaches server or proxy logs.
  router.post('/invites', manageUsers, async (req, res) => {
    const input = inviteInput.parse(req.body);
    const actor = req.auth!.user;
    const orgId = input.orgId ?? actor.orgId;
    if (!orgId) throw new HttpError(400, 'Choose an organisation.');
    const org = await activeOrg(orgId);
    if (!canManage(actor, input.role, org)) throw new HttpError(403, 'You cannot invite this role to this organisation.');
    if (await User.exists({ email: input.email })) throw new HttpError(409, 'This email address already has an account.');
    // Inviting the same address again replaces the earlier pending invitation.
    await Invite.updateMany({ email: input.email, acceptedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const secret = randomBytes(32).toString('base64url');
    const invite = await Invite.create({ tokenHash: hashToken(secret), email: input.email, role: input.role, orgId: org.id,
      invitedByUserId: actor.id, expiresAt: new Date(Date.now() + INVITE_HOURS * 3600 * 1000) });
    res.status(201).json({ invite: inviteView(invite.toObject(), org.name), link: `${config.WEB_ORIGIN}/accept-invite#${secret}` });
  });

  router.get('/invites', manageUsers, async (req, res) => {
    const invites = await Invite.find(orgFilter(req.auth!.user)).sort({ createdAt: -1 }).limit(200).lean();
    const names = await orgNames(invites.map(invite => invite.orgId));
    res.json({ invites: invites.map(invite => inviteView(invite, names.get(String(invite.orgId)))) });
  });

  router.post('/invites/:id/revoke', manageUsers, async (req, res) => {
    const actor = req.auth!.user;
    const invite = await Invite.findOne({ _id: objectId.parse(req.params.id), ...orgFilter(actor) });
    const org = invite ? await Org.findById(invite.orgId).lean() : null;
    if (!invite || !org || !canManage(actor, invite.role as Role, { id: String(org._id), type: org.type as OrgType })) throw new HttpError(404, 'Invitation not found.');
    if (!invite.acceptedAt && !invite.revokedAt) { invite.revokedAt = new Date(); await invite.save(); }
    res.json(inviteView(invite.toObject(), org.name));
  });

  router.get('/users', manageUsers, async (req, res) => {
    const users = await User.find({ ...orgFilter(req.auth!.user), role: { $ne: 'entrepreneur' } }).sort({ role: 1, displayName: 1 }).limit(500).lean();
    const names = await orgNames(users.map(user => user.orgId));
    res.json({ users: users.map(user => ({ id: String(user._id), displayName: user.displayName, email: user.email ?? null, role: user.role,
      orgId: user.orgId ? String(user.orgId) : null, orgName: names.get(String(user.orgId)) ?? null, disabled: !!user.disabled })) });
  });

  // Role changes and disabling take effect on the user's next request; disabling also ends their sessions.
  router.patch('/users/:id', manageUsers, async (req, res) => {
    const input = userUpdate.parse(req.body);
    const actor = req.auth!.user;
    const id = objectId.parse(req.params.id);
    if (id === actor.id) throw new HttpError(400, 'Ask another administrator to change your own account.');
    const target = await User.findOne({ _id: id, ...orgFilter(actor), role: { $ne: 'entrepreneur' } });
    const org = target?.orgId ? await Org.findById(target.orgId).lean() : null;
    const scope = org ? { id: String(org._id), type: org.type as OrgType } : null;
    if (!target || !scope || !canManage(actor, target.role as Role, scope)) throw new HttpError(404, 'User not found.');
    if (input.role && !canManage(actor, input.role, scope)) throw new HttpError(403, 'You cannot assign this role in this organisation.');
    if (input.role) target.role = input.role;
    if (input.disabled !== undefined) target.disabled = input.disabled;
    await target.save();
    if (input.disabled) await Session.deleteMany({ userId: target._id });
    res.json({ id: String(target._id), role: target.role, disabled: target.disabled });
  });

  return router;
}

/** Public invitation endpoints, mounted before the session middleware and behind the sign-in rate limit. */
export function inviteAcceptRouter(sessions: ReturnType<typeof sessionService>, limiter: RequestHandler) {
  const router = Router();
  const usable = (tokenValue: string) => ({ tokenHash: hashToken(tokenValue), acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } });
  const invalid = () => new HttpError(404, 'This invitation link is invalid or has expired. Ask your administrator for a new one.');

  router.post('/auth/invites/preview', limiter, async (req, res) => {
    const { token: value } = z.object({ token }).strict().parse(req.body);
    const invite = await Invite.findOne(usable(value)).lean();
    const org = invite ? await Org.findOne({ _id: invite.orgId, active: true }).select('name type').lean() : null;
    if (!invite || !org) throw invalid();
    res.json({ email: invite.email, role: invite.role, orgName: org.name, orgType: org.type, expiresAt: invite.expiresAt });
  });

  router.post('/auth/invites/accept', limiter, async (req, res) => {
    const input = acceptInput.parse(req.body);
    const invite = await Invite.findOne(usable(input.token));
    const org = invite ? await Org.findOne({ _id: invite.orgId, active: true }).lean() : null;
    if (!invite || !org || !ROLE_ORG_TYPES[invite.role as Role].includes(org.type as OrgType)) throw invalid();
    if (await User.exists({ email: invite.email })) throw new HttpError(409, 'This email address already has an account. Sign in instead.');
    const user = await User.create({ displayName: input.displayName, email: invite.email, role: invite.role, orgId: org._id,
      passwordHash: await hashPassword(input.password) });
    // Single use: only the first acceptance marks the invite; a concurrent second one removes its user.
    const claimed = await Invite.findOneAndUpdate({ _id: invite._id, acceptedAt: null, revokedAt: null },
      { $set: { acceptedAt: new Date(), acceptedUserId: user._id } });
    if (!claimed) { await User.deleteOne({ _id: user._id }); throw invalid(); }
    const { user: actor } = await userContext(String(user._id));
    const sessionToken = await sessions.create(actor.id);
    if (input.client === 'web') sessions.setCookie(res, sessionToken);
    res.status(201).json({ user: actor, ...(input.client === 'mobile' ? { accessToken: sessionToken } : {}) });
  });

  return router;
}
