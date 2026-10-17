import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { ROLE_ORG_TYPES, type OrgType, type Role, type SessionUser } from '@pitchprism/contracts';
import { Org, Session, User } from '../models.js';
import { HttpError } from '../errors.js';
import type { Config } from '../config.js';

export const SESSION_COOKIE = 'pp_session';
export const SESSION_SECONDS = 8 * 60 * 60;
export interface AuthContext { user: SessionUser; sessionId: string; fundingMode?: string }
declare global { namespace Express { interface Request { auth?: AuthContext } } }

// Role-to-organisation rules come from the shared contracts so invitations and sign-in agree.
const roleOrgs = ROLE_ORG_TYPES;
export async function userContext(id: string): Promise<Omit<AuthContext, 'sessionId'>> {
  const user = await User.findById(id).lean();
  if (!user || user.disabled) throw new HttpError(401, 'Please sign in again.');
  const role = user.role as Role;
  const org = user.orgId ? await Org.findById(user.orgId).lean() : null;
  if (role === 'entrepreneur' ? !!user.orgId : !org || !org.active || !roleOrgs[role].includes(org.type as OrgType)) {
    throw new HttpError(403, 'Your account organisation is unavailable or does not match your role.');
  }
  return {
    user: { id: String(user._id), displayName: user.displayName, email: user.email ?? null, role, orgId: org ? String(org._id) : null, orgType: org ? org.type as OrgType : null },
    fundingMode: org?.fundingMode ?? undefined,
  };
}
export function sessionService(config: Config) {
  const key = new TextEncoder().encode(config.JWT_SECRET);
  const cookieOptions = { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
  return {
    async create(userId: string) {
      const sid = randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
      await Session.create({ _id: sid, userId, expiresAt });
      return new SignJWT({ sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
        .setIssuer('pitchprism-api').setAudience('pitchprism').setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(key);
    },
    setCookie(res: Response, token: string) { res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 }); },
    clearCookie(res: Response) { res.clearCookie(SESSION_COOKIE, cookieOptions); },
    middleware: async (req: Request, _res: Response, next: NextFunction) => {
      try {
        const header = req.get('authorization');
        const token = header ? /^Bearer ([^\s]+)$/.exec(header)?.[1] : req.cookies?.[SESSION_COOKIE];
        if (!token) throw new HttpError(401, 'Please sign in to continue.');
        let payload;
        try { ({ payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: 'pitchprism-api', audience: 'pitchprism' })); }
        catch { throw new HttpError(401, 'Your session has expired. Please sign in again.'); }
        if (typeof payload.sid !== 'string' || typeof payload.sub !== 'string' || !/^[a-f\d]{24}$/i.test(payload.sub)) throw new HttpError(401, 'Please sign in again.');
        const session = await Session.findOne({ _id: payload.sid, userId: payload.sub, expiresAt: { $gt: new Date() } }).lean();
        if (!session) throw new HttpError(401, 'Your session has ended. Please sign in again.');
        req.auth = { ...await userContext(payload.sub), sessionId: session._id };
        next();
      } catch (error) { next(error); }
    },
  };
}
