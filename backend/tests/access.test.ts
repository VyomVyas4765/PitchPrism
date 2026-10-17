import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { Invite, Org, Session, User } from '../src/models.js';

// Synthetic accounts only.
const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters' });
const strong = 'Synthetic-passphrase-42';
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let hq: InstanceType<typeof Org>;
let centre: InstanceType<typeof Org>;
let sibling: InstanceType<typeof Org>;
let admin: InstanceType<typeof User>;
let assessor: InstanceType<typeof User>;

const as = async (user: { _id: unknown }) => `Bearer ${await sessionService(config).create(String(user._id))}`;
const tokenOf = (link: string) => link.split('#')[1]!;
function invite(auth: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/invites').set('Authorization', auth).send(body);
}
function accept(link: string, extra: Record<string, unknown> = {}) {
  return request(app).post('/api/v1/auth/invites/accept').send({ token: tokenOf(link), displayName: 'Synthetic Staff', password: strong, ...extra });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  await Promise.all([User.init(), Org.init(), Session.init(), Invite.init()]);
  hq = await Org.create({ name: 'Synthetic HQ', type: 'hq' });
  [centre, sibling] = await Org.create([{ name: 'Synthetic centre', type: 'centre', parentOrgId: hq._id }, { name: 'Synthetic sibling', type: 'centre', parentOrgId: hq._id }]) as [typeof centre, typeof sibling];
  admin = await User.create({ displayName: 'Synthetic HQ admin', email: 'hq@pitchprism.test', role: 'hq_admin', orgId: hq._id });
  assessor = await User.create({ displayName: 'Synthetic assessor', email: 'assessor@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
  app = createApp(config);
});

describe('organisations', () => {
  it('lets HQ create spokes with the right parent and rejects everyone else', async () => {
    const auth = await as(admin);
    const created = await request(app).post('/api/v1/orgs').set('Authorization', auth).send({ name: 'Synthetic Pune centre', type: 'centre', region: 'Maharashtra', languages: ['mr', 'hi'] }).expect(201);
    expect(created.body.parentOrgId).toBe(String(hq._id));
    await request(app).post('/api/v1/orgs').set('Authorization', auth).send({ name: 'Synthetic NGO', type: 'implementation_partner' }).expect(400);
    const ngo = await request(app).post('/api/v1/orgs').set('Authorization', auth).send({ name: 'Synthetic NGO', type: 'implementation_partner', parentOrgId: String(centre._id) }).expect(201);
    expect(ngo.body.parentOrgId).toBe(String(centre._id));
    await request(app).post('/api/v1/orgs').set('Authorization', auth).send({ name: 'Synthetic NGO 2', type: 'implementation_partner', parentOrgId: String(hq._id) }).expect(400);
    await request(app).post('/api/v1/orgs').set('Authorization', auth).send({ name: 'Synthetic lender', type: 'funding_partner' }).expect(400);
    await request(app).post('/api/v1/orgs').set('Authorization', auth).send({ name: 'Synthetic lender', type: 'funding_partner', fundingMode: 'lender' }).expect(201);
    await request(app).post('/api/v1/orgs').set('Authorization', auth).send({ name: 'Second HQ', type: 'hq' }).expect(400);
    await request(app).post('/api/v1/orgs').set('Authorization', await as(assessor)).send({ name: 'Rogue centre', type: 'centre' }).expect(403);
    const own = await request(app).get('/api/v1/orgs').set('Authorization', await as(assessor)).expect(200);
    expect(own.body.orgs.map((org: { name: string }) => org.name)).toEqual(['Synthetic centre']);
    await request(app).patch(`/api/v1/orgs/${hq._id}`).set('Authorization', auth).send({ active: false }).expect(400);
  });

  it('cuts off an organisation\'s users on their next request when HQ deactivates it', async () => {
    const auth = await as(assessor);
    await request(app).get('/api/v1/auth/me').set('Authorization', auth).expect(200);
    await request(app).patch(`/api/v1/orgs/${centre._id}`).set('Authorization', await as(admin)).send({ active: false }).expect(200);
    await request(app).get('/api/v1/auth/me').set('Authorization', auth).expect(403);
  });
});

describe('invitations', () => {
  it('turns a one-time link into an account whose role and organisation come from the invite', async () => {
    const issued = await invite(await as(admin), { email: 'New.Assessor@PitchPrism.test', role: 'centre_assessor', orgId: String(centre._id) }).expect(201);
    expect(issued.body.link).toMatch(/^http:\/\/localhost:3000\/accept-invite#[A-Za-z0-9_-]{43}$/);
    expect(issued.body.invite).toMatchObject({ email: 'new.assessor@pitchprism.test', role: 'centre_assessor', orgName: 'Synthetic centre', status: 'pending' });
    const stored = await Invite.findOne().lean();
    expect(JSON.stringify(stored)).not.toContain(tokenOf(issued.body.link));
    const preview = await request(app).post('/api/v1/auth/invites/preview').send({ token: tokenOf(issued.body.link) }).expect(200);
    expect(preview.body).toMatchObject({ email: 'new.assessor@pitchprism.test', role: 'centre_assessor', orgName: 'Synthetic centre' });
    await accept(issued.body.link, { password: 'short' }).expect(400);
    await accept(issued.body.link, { role: 'hq_admin' }).expect(400);
    await accept(issued.body.link, { orgId: String(hq._id) }).expect(400);
    const accepted = await accept(issued.body.link).expect(201);
    expect(accepted.body.user).toMatchObject({ role: 'centre_assessor', orgId: String(centre._id), email: 'new.assessor@pitchprism.test' });
    expect(accepted.headers['set-cookie']![0]).toContain('HttpOnly');
    await accept(issued.body.link).expect(404);
    await request(app).post('/api/v1/auth/login').send({ email: 'new.assessor@pitchprism.test', password: strong }).expect(200);
    const list = await request(app).get('/api/v1/invites').set('Authorization', await as(admin)).expect(200);
    expect(list.body.invites[0].status).toBe('accepted');
  });

  it('rejects expired, revoked and replaced links, and existing accounts', async () => {
    const auth = await as(admin);
    const first = await invite(auth, { email: 'staff@pitchprism.test', role: 'facilitator', orgId: String(centre._id) }).expect(201);
    const second = await invite(auth, { email: 'staff@pitchprism.test', role: 'facilitator', orgId: String(centre._id) }).expect(201);
    await request(app).post('/api/v1/auth/invites/preview').send({ token: tokenOf(first.body.link) }).expect(404);
    await request(app).post(`/api/v1/invites/${second.body.invite.id}/revoke`).set('Authorization', auth).send({}).expect(200);
    await accept(second.body.link).expect(404);
    const third = await invite(auth, { email: 'staff@pitchprism.test', role: 'facilitator', orgId: String(centre._id) }).expect(201);
    await Invite.updateOne({ _id: third.body.invite.id }, { expiresAt: new Date(Date.now() - 1000) });
    await accept(third.body.link).expect(404);
    await invite(auth, { email: 'assessor@pitchprism.test', role: 'facilitator', orgId: String(centre._id) }).expect(409);
    await request(app).post('/api/v1/auth/invites/preview').send({ token: 'x'.repeat(43) }).expect(404);
    await request(app).post('/api/v1/auth/invites/preview').send({ token: '$ne' }).expect(400);
    expect(await User.countDocuments({ email: 'staff@pitchprism.test' })).toBe(0);
  });

  it('limits each role to its own organisation and the roles the PRD allows', async () => {
    const assessorAuth = await as(assessor);
    await invite(assessorAuth, { email: 'f1@pitchprism.test', role: 'facilitator' }).expect(201);
    await invite(assessorAuth, { email: 'f2@pitchprism.test', role: 'cohort_lead', orgId: String(centre._id) }).expect(201);
    await invite(assessorAuth, { email: 'f3@pitchprism.test', role: 'hq_admin' }).expect(403);
    await invite(assessorAuth, { email: 'f4@pitchprism.test', role: 'facilitator', orgId: String(sibling._id) }).expect(403);
    await invite(assessorAuth, { email: 'f5@pitchprism.test', role: 'sector_partner' }).expect(403);
    const ngo = await Org.create({ name: 'Synthetic NGO', type: 'implementation_partner', parentOrgId: centre._id });
    const ngoLead = await User.create({ displayName: 'Synthetic NGO lead', email: 'ngo@pitchprism.test', role: 'implementation_partner', orgId: ngo._id });
    await invite(await as(ngoLead), { email: 'f6@pitchprism.test', role: 'facilitator' }).expect(201);
    await invite(await as(ngoLead), { email: 'f7@pitchprism.test', role: 'centre_assessor' }).expect(403);
    const sector = await Org.create({ name: 'Synthetic agri', type: 'sector_partner', parentOrgId: hq._id });
    const sectorUser = await User.create({ displayName: 'Synthetic agri reviewer', email: 'agri@pitchprism.test', role: 'sector_partner', orgId: sector._id });
    await invite(await as(sectorUser), { email: 'f8@pitchprism.test', role: 'facilitator' }).expect(403);
    await invite(await as(sectorUser), { email: 'f9@pitchprism.test', role: 'sector_partner' }).expect(201);
    const facilitator = await User.create({ displayName: 'Synthetic facilitator', email: 'fac@pitchprism.test', role: 'facilitator', orgId: centre._id });
    await invite(await as(facilitator), { email: 'f10@pitchprism.test', role: 'facilitator' }).expect(403);
    await request(app).get('/api/v1/invites').set('Authorization', await as(facilitator)).expect(403);
    const entrepreneur = await User.create({ displayName: 'Entrepreneur', role: 'entrepreneur', firebaseUid: 'synthetic-access' });
    await invite(await as(entrepreneur), { email: 'f11@pitchprism.test', role: 'facilitator' }).expect(403);
    await invite(await as(admin), { email: 'f12@pitchprism.test', role: 'entrepreneur', orgId: String(centre._id) }).expect(400);
    // Lists stay inside the actor's organisation.
    const seen = await request(app).get('/api/v1/invites').set('Authorization', assessorAuth).expect(200);
    expect(seen.body.invites.map((item: { email: string }) => item.email).sort()).toEqual(['f1@pitchprism.test', 'f2@pitchprism.test']);
    const options = await request(app).get('/api/v1/access/options').set('Authorization', assessorAuth).expect(200);
    expect(options.body.orgs).toEqual([{ id: String(centre._id), name: 'Synthetic centre', type: 'centre', roles: ['centre_assessor', 'cohort_lead', 'facilitator'] }]);
  });
});

describe('staff accounts', () => {
  it('lets admins disable or re-role users in scope, ending sessions at once, but never themselves', async () => {
    const facilitator = await User.create({ displayName: 'Synthetic facilitator', email: 'fac@pitchprism.test', role: 'facilitator', orgId: centre._id });
    const siblingUser = await User.create({ displayName: 'Synthetic sibling assessor', email: 'sib@pitchprism.test', role: 'centre_assessor', orgId: sibling._id });
    const facilitatorAuth = await as(facilitator);
    const assessorAuth = await as(assessor);
    const users = await request(app).get('/api/v1/users').set('Authorization', assessorAuth).expect(200);
    expect(users.body.users.map((user: { email: string }) => user.email).sort()).toEqual(['assessor@pitchprism.test', 'fac@pitchprism.test']);
    expect(JSON.stringify(users.body)).not.toContain('passwordHash');
    await request(app).patch(`/api/v1/users/${siblingUser._id}`).set('Authorization', assessorAuth).send({ disabled: true }).expect(404);
    await request(app).patch(`/api/v1/users/${assessor._id}`).set('Authorization', assessorAuth).send({ disabled: true }).expect(400);
    await request(app).patch(`/api/v1/users/${facilitator._id}`).set('Authorization', assessorAuth).send({ role: 'hq_admin' }).expect(403);
    await request(app).patch(`/api/v1/users/${facilitator._id}`).set('Authorization', assessorAuth).send({ role: 'cohort_lead' }).expect(200);
    await request(app).patch(`/api/v1/users/${facilitator._id}`).set('Authorization', assessorAuth).send({ disabled: true }).expect(200);
    expect(await Session.countDocuments({ userId: facilitator._id })).toBe(0);
    await request(app).get('/api/v1/auth/me').set('Authorization', facilitatorAuth).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: 'fac@pitchprism.test', password: strong }).expect(401);
    await request(app).patch(`/api/v1/users/${siblingUser._id}`).set('Authorization', await as(admin)).send({ role: 'cohort_lead' }).expect(200);
    await request(app).patch(`/api/v1/users/${siblingUser._id}`).set('Authorization', await as(admin)).send({ role: 'sector_partner' }).expect(403);
  });
});
