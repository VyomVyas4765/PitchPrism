import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { SignJWT } from 'jose';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { Entrepreneur, Org, Session, Submission, User } from '../src/models.js';
import { piiVault } from '../src/modules/entrepreneur/pii-vault.js';
import { ROLES, type Role, type OrgType } from '@pitchprism/contracts';

const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters',
  PII_ENCRYPTION_KEY: 'ab'.repeat(32) });
const vault = piiVault(config.PII_ENCRYPTION_KEY)!;
const password = 'SyntheticTestPassword!42';
let mongo: MongoMemoryServer;
let hash: string;
let centre: InstanceType<typeof Org>;
let sibling: InstanceType<typeof Org>;
let sector: InstanceType<typeof Org>;
let funding: InstanceType<typeof Org>;
let applicant: InstanceType<typeof User>;
let applicantProfile: InstanceType<typeof Entrepreneur>;
let assessor: InstanceType<typeof User>;
let submission: InstanceType<typeof Submission>;
let app: ReturnType<typeof createApp>;

async function tokenFor(user: { _id: unknown }) { return sessionService(config).create(String(user._id)); }
async function staff(role: Role, orgId: mongoose.Types.ObjectId = centre._id) {
  return User.create({ displayName: `Synthetic ${role}`, email: `${role}@pitchprism.test`, passwordHash: hash, role, orgId });
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all([User.init(), Org.init(), Session.init(), Submission.init(), Entrepreneur.init()]);
  hash = await hashPassword(password);
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Org.deleteMany({}), Session.deleteMany({}), Submission.deleteMany({}), Entrepreneur.deleteMany({})]);
  [centre, sibling, sector, funding] = await Org.create([
    { name: 'Synthetic centre', type: 'centre' }, { name: 'Synthetic sibling', type: 'centre' },
    { name: 'Synthetic sector', type: 'sector_partner' }, { name: 'Synthetic lender', type: 'funding_partner', fundingMode: 'lender' },
  ]) as [typeof centre, typeof sibling, typeof sector, typeof funding];
  applicant = await User.create({ displayName: 'Synthetic applicant', role: 'entrepreneur', email: 'synthetic-uid@pitchprism.test' });
  assessor = await staff('centre_assessor');
  applicantProfile = await Entrepreneur.create({ _id: applicant._id, userId: applicant._id, homeOrgId: centre._id, createdVia: 'self',
    personal: vault.seal({ name: 'Synthetic applicant', phone: '+910000000000' }, String(applicant._id)) });
  submission = await Submission.create({ title: 'Synthetic tailoring plan', ownerOrgId: centre._id, entrepreneurId: applicantProfile._id,
    createdByUserId: applicant._id, channel: 'app', status: 'SHORTLISTED', fundingReady: true,
    shares: [{ orgId: sector._id, partnerType: 'sector_partner', active: true, contactAccepted: false },
      { orgId: funding._id, partnerType: 'funding_partner', active: true, contactAccepted: false }],
  });
  app = createApp(config);
});

describe('authentication', () => {
  it('hashes passwords with unique salts and rejects incorrect passwords', async () => {
    expect(await hashPassword(password)).not.toBe(hash);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword(password, 'malformed')).toBe(false);
  });
  it('allows health checks and rejects missing or tampered sessions', async () => {
    await request(app).get('/api/v1/health').expect(200);
    await request(app).get('/api/v1/auth/me').expect(401);
    await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer tampered').expect(401);
  });
  it('logs staff in with an HttpOnly cookie without exposing the hash or bearer token', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password }).expect(200);
    expect(response.body.user.role).toBe('centre_assessor');
    expect(response.body.accessToken).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    const cookie = response.headers['set-cookie']![0]!;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
    await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
  });
  it('marks production session cookies Secure', async () => {
    const prod = createApp({ ...config, NODE_ENV: 'production', WEB_ORIGIN: 'https://pitchprism.test' });
    const response = await request(prod).post('/api/v1/auth/login').send({ email: assessor.email, password }).expect(200);
    expect(response.headers['set-cookie']![0]!).toContain('Secure');
  });
  it('returns the same rejection for unknown users and wrong passwords', async () => {
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'unknown@pitchprism.test', password }).expect(401);
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password: 'wrong' }).expect(401);
    expect(unknown.body).toEqual(wrong.body);
  });
  it('rejects caller-selected roles, malformed bodies, and operator injection', async () => {
    await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password, role: 'hq_admin' }).expect(400);
    await request(app).post('/api/v1/auth/login').send({ email: { $ne: null }, password }).expect(400);
    await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{').expect(400);
  });
  it('revokes bearer sessions on logout', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password, client: 'mobile' }).expect(200);
    const token = response.body.accessToken;
    expect(response.headers['set-cookie']).toBeUndefined();
    await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).send({}).expect(204);
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });
  it('rejects cross-origin mutations and cookie mutations without an origin', async () => {
    await request(app).post('/api/v1/auth/login').set('Origin', 'https://other.test').send({ email: assessor.email, password }).expect(403);
    const response = await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password });
    const cookie = response.headers['set-cookie']![0]!;
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).send({}).expect(403);
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', config.WEB_ORIGIN).send({}).expect(204);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });
  it('expires sessions even before the Mongo TTL cleanup runs', async () => {
    const token = await tokenFor(assessor);
    await Session.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });
  it('rejects expired JWTs even if their database session is still active', async () => {
    await tokenFor(assessor);
    const session = await Session.findOne();
    const expired = await new SignJWT({ sid: session!._id }).setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(assessor._id)).setIssuer('pitchprism-api').setAudience('pitchprism').setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(new TextEncoder().encode(config.JWT_SECRET));
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
  });
  it('stops disabled users and inactive organisations on the next request', async () => {
    const token = await tokenFor(assessor);
    await User.updateOne({ _id: assessor._id }, { disabled: true });
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    await User.updateOne({ _id: assessor._id }, { disabled: false });
    await Org.updateOne({ _id: centre._id }, { active: false });
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(403);
  });
  it('rate limits repeated login failures', async () => {
    for (let attempt = 0; attempt < 10; attempt++) await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password: 'wrong' }).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password: 'wrong' }).expect(429);
  });
  it('does not count successful sign-ins toward the limit', async () => {
    for (let attempt = 0; attempt < 12; attempt++) await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password }).expect(200);
    for (let attempt = 0; attempt < 10; attempt++) await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password: 'wrong' }).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: assessor.email, password }).expect(429);
  });
  it('fails closed when Firebase is unconfigured', async () => {
    await request(app).post('/api/v1/auth/otp/verify').send({ idToken: 'unverified' }).expect(503);
    expect(await User.countDocuments({ firebaseUid: 'unverified' })).toBe(0);
  });
  it('creates only entrepreneur accounts from a verified phone identity and reuses them', async () => {
    const verifiedApp = createApp(config, { verifyPhoneToken: async () => ({ uid: 'verified-synthetic', phone: '+910000000001' }) });
    const first = await request(verifiedApp).post('/api/v1/auth/otp/verify').send({ idToken: 'verified-by-injected-test-adapter' }).expect(200);
    const second = await request(verifiedApp).post('/api/v1/auth/otp/verify').send({ idToken: 'verified-by-injected-test-adapter' }).expect(200);
    expect(first.body.user.role).toBe('entrepreneur'); expect(first.body.user.orgId).toBeNull();
    expect(first.body.user.id).toBe(second.body.user.id);
    await request(verifiedApp).get('/api/v1/auth/me').set('Authorization', `Bearer ${first.body.accessToken}`).expect(200);
    await request(verifiedApp).post('/api/v1/auth/otp/verify').send({ idToken: 'test', role: 'hq_admin' }).expect(400);
  });
});

describe('authorization', () => {
  it.each(ROLES)('allows %s into only its own role workspace', async role => {
    const orgType = (['entrepreneur', 'facilitator', 'centre_assessor', 'cohort_lead'].includes(role) ? 'centre' : role === 'hq_admin' ? 'hq' : role) as OrgType;
    const org = await Org.create({ name: `Synthetic ${role} org`, type: orgType, fundingMode: role === 'funding_partner' ? 'lender' : undefined });
    const user = role === 'entrepreneur' ? applicant : role === 'centre_assessor' ? assessor : await staff(role, org._id);
    const token = await tokenFor(user);
    await request(app).get(`/api/v1/workspaces/${role}`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get(`/api/v1/workspaces/${role === 'hq_admin' ? 'entrepreneur' : 'hq_admin'}`).set('Authorization', `Bearer ${token}`).expect(403);
  });
  it('blocks sibling-centre access including query-string scope overrides', async () => {
    const token = await tokenFor(assessor);
    await request(app).get(`/api/v1/orgs/${centre._id}/workspace`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get(`/api/v1/orgs/${sibling._id}/workspace`).set('Authorization', `Bearer ${token}`).expect(403);
    await Submission.updateOne({ _id: submission._id }, { ownerOrgId: sibling._id });
    await request(app).get(`/api/v1/submissions/${submission._id}?ownerOrgId=${sibling._id}`).set('Authorization', `Bearer ${token}`).expect(404);
  });
  it('limits admin endpoints to HQ and refreshes role permissions from the database', async () => {
    const token = await tokenFor(assessor);
    await request(app).get('/api/v1/admin/overview').set('Authorization', `Bearer ${token}`).expect(403);
    const hq = await Org.create({ name: 'Synthetic HQ', type: 'hq' });
    await User.updateOne({ _id: assessor._id }, { role: 'hq_admin', orgId: hq._id });
    await request(app).get('/api/v1/admin/overview').set('Authorization', `Bearer ${token}`).expect(200);
    await User.updateOne({ _id: assessor._id }, { role: 'hq_admin', orgId: centre._id });
    await request(app).get('/api/v1/admin/overview').set('Authorization', `Bearer ${token}`).expect(403);
  });
  it('restricts entrepreneurs, facilitators, and implementation partners to their records', async () => {
    const entrepreneurToken = await tokenFor(applicant);
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${entrepreneurToken}`).expect(200);
    const other = await User.create({ displayName: 'Another synthetic applicant', role: 'entrepreneur' });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${await tokenFor(other)}`).expect(404);
    const facilitator = await staff('facilitator');
    const facilitatorToken = await tokenFor(facilitator);
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${facilitatorToken}`).expect(404);
    const implementationOrg = await Org.create({ name: 'Synthetic implementation partner', type: 'implementation_partner' });
    const implementation = await staff('implementation_partner', implementationOrg._id);
    const implementationToken = await tokenFor(implementation);
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${implementationToken}`).expect(404);
    await Submission.updateOne({ _id: submission._id }, { createdByUserId: facilitator._id, sourceOrgId: implementationOrg._id });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${facilitatorToken}`).expect(200);
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${implementationToken}`).expect(200);
  });
  it('hides partner personal data until contact acceptance and removes access after consent revocation', async () => {
    const partner = await staff('sector_partner', sector._id);
    const token = await tokenFor(partner);
    const response = await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body).toEqual({ id: String(submission._id), title: submission.title, status: 'SHORTLISTED' });
    await Submission.updateOne({ _id: submission._id, 'shares.orgId': sector._id }, { $set: { 'shares.$.contactAccepted': true } });
    const accepted = await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(accepted.body.applicant).toEqual({ name: 'Synthetic applicant', phone: '+910000000000' });
    await Submission.updateOne({ _id: submission._id, 'shares.orgId': sector._id }, { $set: { 'shares.$.active': false } });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(404);
  });
  it('requires funding consent, a shortlist, and funding readiness; CSR gets no individual record', async () => {
    const user = await staff('funding_partner', funding._id);
    const token = await tokenFor(user);
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(200);
    await Submission.updateOne({ _id: submission._id }, { status: 'READY' });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(404);
    await Submission.updateOne({ _id: submission._id }, { status: 'SHORTLISTED', fundingReady: false });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(404);
    await Submission.updateOne({ _id: submission._id }, { status: 'SHARED', fundingReady: true });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(200);
    await Submission.updateOne({ _id: submission._id, 'shares.orgId': funding._id }, { $set: { 'shares.$.active': false } });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(404);
    await Org.updateOne({ _id: funding._id }, { fundingMode: 'csr' });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', `Bearer ${token}`).expect(403);
  });
});
