import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from '@pitchprism/contracts';
import type { Config } from './config.js';
import { errorHandler, HttpError } from './errors.js';
import { Entrepreneur,AuditEvent, Org, Session, Submission, User } from './models.js';
import { piiVault, type Sealed } from './modules/entrepreneur/pii-vault.js';

import { sessionService, userContext, SESSION_COOKIE } from './auth/session.js';
import { firebasePhoneVerifier, type VerifyPhoneToken } from './auth/firebase.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import { requirePermission, scoped, submissionScope } from './auth/authorization.js';
import { centreRouter } from './modules/centre/router.js';
import type { AssessmentResult } from './modules/centre/runner.js';
import type { CentreExtractedInput } from '@pitchprism/contracts';
import { entrepreneurRouter } from './modules/entrepreneur/index.js';
import { partnerRouter } from './modules/partners/router.js';
import { accessRouter, inviteAcceptRouter } from './modules/hq/router.js';
import { hqAdminRouter } from './modules/hq/admin-router.js';

const loginInput = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(128), client: z.enum(['web', 'mobile']).default('web') }).strict();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const dummyHash = hashPassword('unused-random-timing-placeholder');

export function createApp(config: Config, options: { verifyPhoneToken?: VerifyPhoneToken; assessIdea?: (input: CentreExtractedInput) => Promise<AssessmentResult> } = {}) {
  const app = express();
  const sessions = sessionService(config);
  const vault = piiVault(config.PII_ENCRYPTION_KEY);
  const verifyPhoneToken = options.verifyPhoneToken ?? firebasePhoneVerifier(config.FIREBASE_PROJECT_ID);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '128kb' }));
  app.use(cookieParser());
  app.use('/api/v1', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Browser clients use the Next same-origin proxy. Native clients use bearer tokens.
  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    const origin = req.get('origin');
    if ((origin && origin !== config.WEB_ORIGIN) || (req.cookies?.[SESSION_COOKIE] && origin !== config.WEB_ORIGIN && !req.get('authorization'))) {
      next(new HttpError(403, 'Request origin is not allowed.')); return;
    }
    next();
  });
  app.get('/api/v1/health', (_req, res) => { res.json({ status: 'ok', service: 'api' }); });
  // Counts failed attempts only: successful sign-ins must not lock out a team or demo sharing one IP.
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many failed sign-in attempts. Try again in 15 minutes.' } });
  app.post('/api/v1/auth/login', authLimiter, async (req, res) => {
    const input = loginInput.parse(req.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    const valid = await verifyPassword(input.password, user?.passwordHash ?? await dummyHash);
    if (!valid || !user || user.disabled || user.role === 'entrepreneur') throw new HttpError(401, 'Email or password is incorrect.');
    const { user: actor } = await userContext(String(user._id));
    const token = await sessions.create(actor.id);
    if (input.client === 'web') sessions.setCookie(res, token);
    res.json({ user: actor, ...(input.client === 'mobile' ? { accessToken: token } : {}) });
  });
  app.post('/api/v1/auth/otp/verify', authLimiter, async (req, res) => {
    const { idToken } = z.object({ idToken: z.string().min(1).max(10000) }).strict().parse(req.body);
    const identity = await verifyPhoneToken(idToken);
    const user = await User.findOneAndUpdate({ firebaseUid: identity.uid }, {
      $setOnInsert: { displayName: 'Entrepreneur', firebaseUid: identity.uid, role: 'entrepreneur' },
    }, { upsert: true, returnDocument: 'after', runValidators: true });
    const { user: actor } = await userContext(String(user!._id));
    if (actor.role !== 'entrepreneur') throw new HttpError(403, 'This phone identity is not an entrepreneur account.');
    res.json({ user: actor, accessToken: await sessions.create(actor.id) });
  });
  // Invitation preview/acceptance are public (the one-time token is the credential) and rate limited.
  app.use('/api/v1', inviteAcceptRouter(sessions, authLimiter));
  app.use('/api/v1', sessions.middleware);
  app.get('/api/v1/auth/me', (req, res) => { res.json({ user: req.auth!.user }); });
  app.post('/api/v1/auth/logout', async (req, res) => {
    await Session.deleteOne({ _id: req.auth!.sessionId });
    sessions.clearCookie(res);
    res.status(204).end();
  });
  app.get('/api/v1/workspaces/:role', (req, res) => {
    const role = z.enum(ROLES).parse(req.params.role);
    if (req.auth!.user.role !== role) throw new HttpError(403, 'This workspace belongs to a different role.');
    res.json({ role, permissions: ROLE_PERMISSIONS[role], message: `${ROLE_LABELS[role]} workspace is ready. Feature workflows are assigned in docs/duties.` });
  });
  app.use('/api/v1/centre', centreRouter(options.assessIdea));
  app.use('/api/v1/partners', partnerRouter()); // Dev 4 handoff: behind the shared session middleware
  app.get('/api/v1/admin/overview', requirePermission('manage_platform'), async (_req, res) => {
    const [organisations, activeOrganisations, users, activeUsers, submissions, byStatus, byOrganisation] = await Promise.all([
      Org.countDocuments(), Org.countDocuments({ active: true }), User.countDocuments({ role: { $ne: 'entrepreneur' } }),
      User.countDocuments({ role: { $ne: 'entrepreneur' }, disabled: { $ne: true } }), Submission.countDocuments(),
      Submission.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Submission.aggregate<{ name: string; type: string; submissions: number }>([
        { $group: { _id: '$ownerOrgId', submissions: { $sum: 1 } } },
        { $lookup: { from: 'orgs', localField: '_id', foreignField: '_id', as: 'org' } },
        { $unwind: '$org' }, { $project: { _id: 0, name: '$org.name', type: '$org.type', submissions: 1 } },
        { $sort: { submissions: -1, name: 1 } }, { $limit: 100 },
      ]),
    ]);
    res.json({
      organisations, activeOrganisations, users, activeUsers, submissions,
      byStatus: byStatus.map(item => ({ status: item._id, count: item.count })),
      byOrganisation: byOrganisation.map(item => ({ name: item.name, type: item.type, submissions: item.submissions })),
    });
  });
  app.get('/api/v1/orgs/:id/workspace', async (req, res) => {
    const id = objectId.parse(req.params.id);
    const user = req.auth!.user;
    if (user.role !== 'hq_admin' && user.orgId !== id) throw new HttpError(403, 'This organisation is outside your access.');
    const org = await Org.findById(id).select('name type').lean();
    if (!org) throw new HttpError(404, 'Organisation not found.');
    res.json({ id: String(org._id), name: org.name, type: org.type });
  });
  app.get('/api/v1/submissions/:id', async (req, res) => {
    const id = objectId.parse(req.params.id);
    const submission = await Submission.findOne(scoped(submissionScope(req.auth!), { _id: id })).lean();
    if (!submission) throw new HttpError(404, 'Submission not found.');
    await AuditEvent.create({ actorUserId: req.auth!.user.id, action: 'view', resourceType: 'Submission', resourceId: String(submission._id) });
    const user = req.auth!.user;
    const partner = user.role === 'sector_partner' || user.role === 'funding_partner';
    const contactAccepted = submission.shares?.some(share => String(share.orgId) === user.orgId && share.active && share.partnerType === user.role && share.contactAccepted);
    // Explicit projection: never send internal IDs/share lists or unapproved personal fields to partners.
    // Contact details come from the applicant's sealed profile; the deprecated plaintext copy (D-30) is a fallback.
    let applicant: { name: string | null; phone: string | null } | undefined;
    if (!partner || contactAccepted) {
      const person = vault ? await Entrepreneur.findById(submission.entrepreneurId).select('+personal').lean() : null;
      const sealed = person?.personal ? vault!.open<{ name?: string; phone?: string }>(person.personal as Sealed, String(person._id)) : null;
      const name = sealed?.name ?? submission.applicant?.name ?? null;
      const phone = sealed?.phone ?? submission.applicant?.phone ?? null;
      if (name || phone) applicant = { name, phone };
    }
    res.json({ id: String(submission._id), title: submission.title ?? '', status: submission.status, ...(applicant ? { applicant } : {}) });
  });
  app.use('/api/v1', entrepreneurRouter(config));
  app.use('/api/v1', accessRouter(config));
  app.use('/api/v1', hqAdminRouter());
  app.use((_req, res) => { res.status(404).json({ error: 'Endpoint not found.' }); });
  app.use(errorHandler);
  return app;
}
