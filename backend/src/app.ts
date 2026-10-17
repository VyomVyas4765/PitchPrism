import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from '@pitchprism/contracts';
import type { Config } from './config.js';
import { errorHandler, HttpError } from './errors.js';
import { Org, Session, Submission, User } from './models.js';
import { sessionService, userContext, SESSION_COOKIE } from './auth/session.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import { requirePermission, submissionScope } from './auth/authorization.js';
import { centreRouter } from './modules/centre/router.js';
import type { AssessmentResult } from './modules/centre/runner.js';
import type { CentreExtractedInput } from '@pitchprism/contracts';
import { entrepreneurRouter } from './modules/entrepreneur/index.js';
import { accessRouter, inviteAcceptRouter } from './modules/hq/router.js';

const loginInput = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(128), client: z.enum(['web', 'mobile']).default('web') }).strict();
const registerInput = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(12).max(128), client: z.enum(['web', 'mobile']).default('mobile') }).strict();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const dummyHash = hashPassword('unused-random-timing-placeholder');

export function createApp(config: Config, options: { assessIdea?: (input: CentreExtractedInput) => Promise<AssessmentResult> } = {}) {
  const app = express();
  const sessions = sessionService(config);
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
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });
  app.post('/api/v1/auth/login', authLimiter, async (req, res) => {
    const input = loginInput.parse(req.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    const valid = await verifyPassword(input.password, user?.passwordHash ?? await dummyHash);
    if (!valid || !user || user.disabled) throw new HttpError(401, 'Email or password is incorrect.');
    const { user: actor } = await userContext(String(user._id));
    const token = await sessions.create(actor.id);
    if (input.client === 'web') sessions.setCookie(res, token);
    res.json({ user: actor, ...(input.client === 'mobile' ? { accessToken: token } : {}) });
  });
  // D-27: email is the only sign-in method. Entrepreneurs register themselves and are always entrepreneurs;
  // staff join by invitation. The role is never taken from the request.
  app.post('/api/v1/auth/register', authLimiter, async (req, res) => {
    const input = registerInput.parse(req.body);
    if (await User.exists({ email: input.email })) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    let user;
    try {
      user = await User.create({ displayName: 'Entrepreneur', email: input.email, role: 'entrepreneur', passwordHash: await hashPassword(input.password) });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
      throw error;
    }
    const { user: actor } = await userContext(String(user._id));
    const token = await sessions.create(actor.id);
    if (input.client === 'web') sessions.setCookie(res, token);
    res.status(201).json({ user: actor, ...(input.client === 'mobile' ? { accessToken: token } : {}) });
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
  app.get('/api/v1/admin/overview', requirePermission('manage_platform'), async (_req, res) => {
    res.json({ organisations: await Org.countDocuments(), users: await User.countDocuments() });
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
    const submission = await Submission.findOne({ ...submissionScope(req.auth!), _id: id }).lean();
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const user = req.auth!.user;
    const partner = user.role === 'sector_partner' || user.role === 'funding_partner';
    const contactAccepted = submission.shares?.some(share => String(share.orgId) === user.orgId && share.active && share.partnerType === user.role && share.contactAccepted);
    // Explicit projection: never send internal IDs/shares or unapproved personal fields to partners.
    res.json({ id: String(submission._id), title: submission.title, status: submission.status,
      ...(!partner || contactAccepted ? { applicant: submission.applicant } : {}) });
  });
  app.use('/api/v1', entrepreneurRouter(config));
  app.use('/api/v1', accessRouter(config));
  app.use((_req, res) => { res.status(404).json({ error: 'Endpoint not found.' }); });
  app.use(errorHandler);
  return app;
}
