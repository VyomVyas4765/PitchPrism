import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { ALL_MODELS, AuditLog, Invitation, Org, Programme, Rubric, Session, Submission, User } from '../src/models.js';
import { setTenancyMode, tenancyContext, UnscopedQueryError } from '../src/platform/tenancy.js';
import type { Role } from '@pitchprism/contracts';

// Synthetic records only. Runs with TENANCY_MODE=enforce so any unscoped tenant query in these routes fails.
const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters',
  PII_ENCRYPTION_KEY: 'cd'.repeat(32), TENANCY_MODE: 'enforce' });
const password = 'SyntheticTestPassword!42';
let mongo: MongoMemoryServer;
let hash: string;
let app: ReturnType<typeof createApp>;
let hq: InstanceType<typeof Org>;
let centre: InstanceType<typeof Org>;
let sibling: InstanceType<typeof Org>;
let sector: InstanceType<typeof Org>;
let admin: InstanceType<typeof User>;
let assessor: InstanceType<typeof User>;

const bearer = async (user: { _id: unknown }) => `Bearer ${await sessionService(config).create(String(user._id))}`;
const staff = (role: Role, orgId: mongoose.Types.ObjectId, name: string = role) =>
  User.create({ displayName: `Synthetic ${name}`, email: `${name}@pitchprism.test`, passwordHash: hash, role, orgId });
const domains = (weights: number[]) => weights.map((weight, index) => ({
  key: `domain_${String.fromCharCode(97 + index)}`, label: `Domain ${index}`, weight, lowDescriptor: 'Low', highDescriptor: 'High',
}));
const rubric = (weights = [40, 35, 25]) => ({ rubricKey: 'synthetic', name: 'Synthetic rubric', domains: domains(weights),
  bands: { strong: 75, promising: 55, minCoverage: 60 } });
const tokenOf = (link: string) => link.split('#')[1]!;
const preview = (token: string) => request(app).post('/api/v1/invitations/accept/preview').send({ token });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all(ALL_MODELS.map(model => (model as typeof User).init()));
  hash = await hashPassword(password);
}, 120000);
afterAll(async () => { setTenancyMode('warn'); await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all(ALL_MODELS.filter(model => model.modelName !== 'StageEvent').map(model => (model as typeof User).deleteMany({})));
  [hq, centre, sibling, sector] = await Org.create([
    { name: 'Synthetic HQ', type: 'hq' }, { name: 'Synthetic centre', type: 'centre' },
    { name: 'Synthetic sibling', type: 'centre' }, { name: 'Synthetic sector', type: 'sector_partner' },
  ]) as [typeof hq, typeof centre, typeof sibling, typeof sector];
  admin = await staff('hq_admin', hq._id);
  assessor = await staff('centre_assessor', centre._id);
  app = createApp(config);
});

describe('invitations (D-27)', () => {
  it('lets HQ invite, shows the link once and turns acceptance into a signed-in account', async () => {
    const created = await request(app).post('/api/v1/team/invitations').set('Authorization', await bearer(admin))
      .send({ orgId: String(centre._id), role: 'cohort_lead', email: 'Lead@PitchPrism.test' }).expect(201);
    const token = tokenOf(created.body.link);
    expect(created.body.link).toMatch(/^http:\/\/localhost:3000\/accept-invite#[A-Za-z0-9_-]{43}$/);
    const stored = await Invitation.findById(created.body.invitation.id).lean();
    expect(stored!.tokenHash).not.toContain(token);
    expect(JSON.stringify(stored)).not.toContain(token);

    const shown = await preview(token).expect(200);
    expect(shown.body).toMatchObject({ organisation: 'Synthetic centre', role: 'cohort_lead', email: 'lead@pitchprism.test' });
    await request(app).post('/api/v1/invitations/accept').send({ token, displayName: 'New lead', email: 'other@pitchprism.test', password }).expect(400);
    const accepted = await request(app).post('/api/v1/invitations/accept')
      .send({ token, displayName: 'New lead', email: 'lead@pitchprism.test', password }).expect(201);
    expect(accepted.body.user).toMatchObject({ role: 'cohort_lead', orgId: String(centre._id) });
    const cookie = accepted.headers['set-cookie']![0]!;
    await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: 'lead@pitchprism.test', password }).expect(200);

    // Single use: a second accept and a second preview both fail.
    await request(app).post('/api/v1/invitations/accept').send({ token, displayName: 'Again', email: 'lead@pitchprism.test', password }).expect(410);
    await preview(token).expect(410);
    const list = await request(app).get('/api/v1/team/invitations').set('Authorization', await bearer(admin)).expect(200);
    expect(list.body.invitations[0].status).toBe('accepted');
    expect(await AuditLog.countDocuments({ action: { $in: ['user.invite', 'user.invite_accept'] } })).toBe(2);
  });

  it('limits staff to their own organisation and to roles that organisation can hold', async () => {
    const auth = await bearer(assessor);
    const invite = (body: object) => request(app).post('/api/v1/team/invitations').set('Authorization', auth).send(body);
    await invite({ orgId: String(centre._id), role: 'facilitator' }).expect(201);
    await invite({ orgId: String(sibling._id), role: 'facilitator' }).expect(403);
    await invite({ orgId: String(centre._id), role: 'hq_admin' }).expect(403);
    await invite({ orgId: String(centre._id), role: 'sector_partner' }).expect(403);
    await invite({ orgId: String(centre._id), role: 'entrepreneur' }).expect(403);
    await invite({ orgId: String(centre._id), role: 'facilitator', extra: true }).expect(400);
    const defaulted = await invite({ role: 'cohort_lead' }).expect(201); // no orgId: the inviter's own organisation
    expect(defaulted.body.invitation.orgId).toBe(String(centre._id));
    const ngo = await Org.create({ name: 'Synthetic NGO', type: 'implementation_partner', parentOrgId: centre._id });
    const ngoLead = await bearer(await staff('implementation_partner', ngo._id));
    await request(app).post('/api/v1/team/invitations').set('Authorization', ngoLead).send({ role: 'facilitator' }).expect(201);
    await request(app).post('/api/v1/team/invitations').set('Authorization', ngoLead).send({ role: 'centre_assessor' }).expect(403);
    const facilitator = await bearer(await staff('facilitator', centre._id, 'field-facilitator'));
    await request(app).post('/api/v1/team/invitations').set('Authorization', facilitator).send({ role: 'facilitator' }).expect(403);
    const partner = await staff('sector_partner', sector._id);
    await request(app).post('/api/v1/team/invitations').set('Authorization', await bearer(partner))
      .send({ orgId: String(sector._id), role: 'sector_partner' }).expect(201);
    const entrepreneur = await User.create({ displayName: 'Synthetic applicant', role: 'entrepreneur', firebaseUid: 'synthetic' });
    await request(app).get('/api/v1/team/invitations').set('Authorization', await bearer(entrepreneur)).expect(403);
    // Staff lists stay inside the caller's organisation.
    await staff('facilitator', sibling._id, 'sibling-facilitator');
    const list = await request(app).get('/api/v1/team/staff').set('Authorization', auth).expect(200);
    expect(new Set(list.body.users.map((user: { orgId: string }) => user.orgId))).toEqual(new Set([String(centre._id)]));
    await request(app).get(`/api/v1/team/staff?orgId=${sibling._id}`).set('Authorization', auth).expect(403);
  });

  it('rejects revoked, expired and malformed invitations', async () => {
    const created = await request(app).post('/api/v1/team/invitations').set('Authorization', await bearer(admin))
      .send({ orgId: String(centre._id), role: 'facilitator' }).expect(201);
    await request(app).post(`/api/v1/team/invitations/${created.body.invitation.id}/revoke`).set('Authorization', await bearer(assessor)).expect(200);
    await preview(tokenOf(created.body.link)).expect(410);
    const second = await request(app).post('/api/v1/team/invitations').set('Authorization', await bearer(admin))
      .send({ orgId: String(centre._id), role: 'facilitator' }).expect(201);
    await Invitation.updateOne({ _id: second.body.invitation.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).post('/api/v1/invitations/accept')
      .send({ token: tokenOf(second.body.link), displayName: 'Late', email: 'late@pitchprism.test', password }).expect(410);
    await preview('not-a-token').expect(400);
    await request(app).post('/api/v1/invitations/accept/preview').send({ token: { $ne: 1 } }).expect(400);
    // Inviting the same address again withdraws the earlier link.
    const auth = await bearer(admin);
    const first = await request(app).post('/api/v1/team/invitations').set('Authorization', auth).send({ orgId: String(centre._id), role: 'facilitator', email: 'twice@pitchprism.test' }).expect(201);
    await request(app).post('/api/v1/team/invitations').set('Authorization', auth).send({ orgId: String(centre._id), role: 'facilitator', email: 'twice@pitchprism.test' }).expect(201);
    await preview(tokenOf(first.body.link)).expect(410);
    // An invitation for a sibling centre cannot be revoked by this centre.
    const foreign = await request(app).post('/api/v1/team/invitations').set('Authorization', await bearer(admin))
      .send({ orgId: String(sibling._id), role: 'facilitator' }).expect(201);
    await request(app).post(`/api/v1/team/invitations/${foreign.body.invitation.id}/revoke`).set('Authorization', await bearer(assessor)).expect(403);
  });
});

describe('staff administration', () => {
  it('disables and re-roles staff within scope, never the caller or an HQ account', async () => {
    const colleague = await staff('facilitator', centre._id, 'colleague');
    const colleagueAuth = await bearer(colleague);
    const auth = await bearer(assessor);
    await request(app).patch(`/api/v1/team/staff/${colleague._id}`).set('Authorization', auth).send({ role: 'cohort_lead' }).expect(200);
    await request(app).patch(`/api/v1/team/staff/${colleague._id}`).set('Authorization', auth).send({ disabled: true }).expect(200);
    await request(app).get('/api/v1/auth/me').set('Authorization', colleagueAuth).expect(401);
    expect(await Session.countDocuments({ userId: colleague._id })).toBe(0);
    await request(app).patch(`/api/v1/team/staff/${assessor._id}`).set('Authorization', auth).send({ disabled: true }).expect(400);
    await request(app).patch(`/api/v1/team/staff/${admin._id}`).set('Authorization', auth).send({ disabled: true }).expect(403);
    const foreign = await staff('facilitator', sibling._id, 'foreign');
    await request(app).patch(`/api/v1/team/staff/${foreign._id}`).set('Authorization', auth).send({ disabled: true }).expect(403);
    await request(app).patch(`/api/v1/team/staff/${colleague._id}`).set('Authorization', auth).send({ role: 'funding_partner' }).expect(403);
    expect(await AuditLog.countDocuments({ action: { $in: ['user.role_change', 'user.access_change'] } })).toBe(2);
  });
});

describe('HQ configuration', () => {
  it('creates and edits organisations for HQ only, with funding-mode rules', async () => {
    const auth = await bearer(admin);
    await request(app).post('/api/v1/hq/orgs').set('Authorization', await bearer(assessor)).send({ name: 'X', type: 'centre' }).expect(403);
    await request(app).post('/api/v1/hq/orgs').set('Authorization', auth).send({ name: 'Second HQ', type: 'hq' }).expect(400);
    await request(app).post('/api/v1/hq/orgs').set('Authorization', auth).send({ name: 'Lender', type: 'funding_partner' }).expect(400);
    // Hub and spoke: centres report to HQ; implementation partners to an active centre, never to HQ.
    const pune = await request(app).post('/api/v1/hq/orgs').set('Authorization', auth).send({ name: 'Synthetic Pune centre', type: 'centre' }).expect(201);
    expect(pune.body.organisation.parentOrgId).toBe(String(hq._id));
    await request(app).post('/api/v1/hq/orgs').set('Authorization', auth).send({ name: 'Synthetic NGO', type: 'implementation_partner' }).expect(400);
    await request(app).post('/api/v1/hq/orgs').set('Authorization', auth).send({ name: 'Synthetic NGO', type: 'implementation_partner', parentOrgId: String(hq._id) }).expect(400);
    const ngo = await request(app).post('/api/v1/hq/orgs').set('Authorization', auth).send({ name: 'Synthetic NGO', type: 'implementation_partner', parentOrgId: String(centre._id) }).expect(201);
    expect(ngo.body.organisation.parentOrgId).toBe(String(centre._id));
    await request(app).post('/api/v1/hq/orgs').set('Authorization', auth).send({ name: 'Synthetic lab', type: 'sector_partner', parentOrgId: String(centre._id) }).expect(400);
    await request(app).patch(`/api/v1/hq/orgs/${ngo.body.organisation.id}`).set('Authorization', auth).send({ parentOrgId: String(sibling._id) }).expect(400);
    const lender = await request(app).post('/api/v1/hq/orgs').set('Authorization', auth)
      .send({ name: 'Lender', type: 'funding_partner', fundingMode: 'lender', languages: ['hi'] }).expect(201);
    await request(app).patch(`/api/v1/hq/orgs/${lender.body.organisation.id}`).set('Authorization', auth).send({ active: false }).expect(200);
    await request(app).patch(`/api/v1/hq/orgs/${hq._id}`).set('Authorization', auth).send({ active: false }).expect(400);
    const list = await request(app).get('/api/v1/hq/orgs').set('Authorization', auth).expect(200);
    expect(list.body.organisations.find((org: { name: string }) => org.name === 'Synthetic centre').staff).toBe(1);
    // An inactive organisation cannot receive invitations.
    await request(app).post('/api/v1/team/invitations').set('Authorization', auth)
      .send({ orgId: lender.body.organisation.id, role: 'funding_partner' }).expect(404);
  });

  it('versions rubrics: weights must sum to 100, saves add versions and publishing archives the previous one', async () => {
    const auth = await bearer(admin);
    const uneven = await request(app).post('/api/v1/hq/rubrics').set('Authorization', auth).send(rubric([40, 40, 10])).expect(400);
    expect(uneven.body.error).toBe('Domain weights must add up to 100 (now 90).');
    await request(app).post('/api/v1/hq/rubrics').set('Authorization', await bearer(assessor)).send(rubric()).expect(403);
    const first = await request(app).post('/api/v1/hq/rubrics').set('Authorization', auth).send(rubric()).expect(201);
    expect(first.body.rubric).toMatchObject({ version: 1, status: 'draft' });
    await request(app).post('/api/v1/hq/rubrics/synthetic/1/publish').set('Authorization', auth).expect(200);
    const second = await request(app).post('/api/v1/hq/rubrics').set('Authorization', auth).send(rubric([50, 25, 25])).expect(201);
    expect(second.body.rubric.version).toBe(2);
    await request(app).post('/api/v1/hq/rubrics/synthetic/2/publish').set('Authorization', auth).expect(200);
    expect((await Rubric.findOne({ rubricKey: 'synthetic', version: 1 }).lean())!.status).toBe('archived');
    await request(app).post('/api/v1/hq/rubrics/synthetic/1/publish').set('Authorization', auth).expect(400);
    const families = await request(app).get('/api/v1/hq/rubrics').set('Authorization', await bearer(assessor)).expect(200);
    expect(families.body.rubrics[0]).toMatchObject({ rubricKey: 'synthetic', published: 2, latest: 2 });
  });

  it('scopes programmes and cohorts to the caller centre', async () => {
    const auth = await bearer(admin);
    await request(app).post('/api/v1/hq/programmes').set('Authorization', auth).send({ orgId: String(sector._id), name: 'Wrong' }).expect(400);
    const own = await request(app).post('/api/v1/hq/programmes').set('Authorization', auth).send({ orgId: String(centre._id), name: 'EDP 2026', status: 'active' }).expect(201);
    const other = await request(app).post('/api/v1/hq/programmes').set('Authorization', auth).send({ orgId: String(sibling._id), name: 'Sibling EDP' }).expect(201);
    const lead = await bearer(assessor);
    await request(app).post('/api/v1/hq/cohorts').set('Authorization', lead).send({ programmeId: other.body.programme.id, name: 'Not mine' }).expect(404);
    await request(app).post('/api/v1/hq/cohorts').set('Authorization', lead)
      .send({ programmeId: own.body.programme.id, name: 'Bad dates', intakeStart: '2026-11-10', intakeEnd: '2026-11-01' }).expect(400);
    const cohort = await request(app).post('/api/v1/hq/cohorts').set('Authorization', lead)
      .send({ programmeId: own.body.programme.id, name: 'November batch', status: 'open' }).expect(201);
    expect(cohort.body.cohort.orgId).toBe(String(centre._id));
    const programmes = await request(app).get('/api/v1/hq/programmes').set('Authorization', lead).expect(200);
    expect(programmes.body.programmes.map((item: { name: string }) => item.name)).toEqual(['EDP 2026']);
    expect(await Programme.countDocuments()).toBe(2);
  });

  it('manages trades and routing rules with immutable keys and matching partner types', async () => {
    const auth = await bearer(admin);
    const trade = { key: 'tailoring', label: 'Tailoring', sector: 'Apparel', osmTags: ['shop=tailor'], synonyms: { hi: ['सिलाई'] } };
    const created = await request(app).post('/api/v1/hq/trades').set('Authorization', auth).send(trade).expect(201);
    await request(app).post('/api/v1/hq/trades').set('Authorization', auth).send(trade).expect(409);
    await request(app).post('/api/v1/hq/trades').set('Authorization', auth).send({ ...trade, key: 'x2', osmTags: ['not a tag'] }).expect(400);
    await request(app).patch(`/api/v1/hq/trades/${created.body.trade.id}`).set('Authorization', auth).send({ key: 'renamed' }).expect(400);
    await request(app).get('/api/v1/hq/trades').set('Authorization', await bearer(assessor)).expect(200);
    await request(app).post('/api/v1/hq/routing-rules').set('Authorization', auth)
      .send({ name: 'Wrong', partnerOrgId: String(sector._id), partnerType: 'funding_partner' }).expect(400);
    const rule = await request(app).post('/api/v1/hq/routing-rules').set('Authorization', auth)
      .send({ name: 'Apparel to sector', partnerOrgId: String(sector._id), partnerType: 'sector_partner', tradeKeys: ['tailoring'] }).expect(201);
    await request(app).patch(`/api/v1/hq/routing-rules/${rule.body.rule.id}`).set('Authorization', auth).send({ active: false }).expect(200);
    await request(app).delete(`/api/v1/hq/routing-rules/${rule.body.rule.id}`).set('Authorization', auth).expect(204);
    await request(app).get('/api/v1/hq/routing-rules').set('Authorization', await bearer(assessor)).expect(403);
  });
});

describe('tenancy guard', () => {
  it('refuses an unscoped in-request query on a tenant collection in enforce mode', async () => {
    setTenancyMode('enforce');
    const run = (fn: () => Promise<unknown>) => new Promise((resolve, reject) => {
      tenancyContext({ method: 'GET', baseUrl: '/api/v1', path: '/test' } as never, {} as never, () => { fn().then(resolve, reject); });
    });
    await expect(run(() => Submission.find({}).lean())).rejects.toBeInstanceOf(UnscopedQueryError);
    await expect(run(() => Submission.find({}).setOptions({ tenant: { ownerOrgId: centre._id } }).lean())).resolves.toEqual([]);
    await expect(run(() => Submission.find({}).setOptions({ tenant: 'system' }).lean())).resolves.toEqual([]);
    // Outside a request (worker, scripts) the guard does not apply.
    await expect(Submission.find({}).lean()).resolves.toEqual([]);
  });
  it('combines the scope with $and so a route filter cannot widen it', async () => {
    const entrepreneurId = new mongoose.Types.ObjectId();
    const own = await Submission.create({ ownerOrgId: centre._id, entrepreneurId, createdByUserId: assessor._id, status: 'DRAFT', shares: [] });
    const foreign = await Submission.create({ ownerOrgId: sibling._id, entrepreneurId, createdByUserId: assessor._id, status: 'DRAFT', shares: [] });
    const found = await Submission.find({ ownerOrgId: sibling._id }).setOptions({ tenant: { ownerOrgId: centre._id } }).lean();
    expect(found).toEqual([]);
    expect(await Submission.countDocuments({ _id: { $in: [own._id, foreign._id] } }).setOptions({ tenant: { ownerOrgId: centre._id } })).toBe(1);
  });
});
