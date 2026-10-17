import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { Org, Session, Submission, User } from '../src/models.js';
import { Consent, CONSENT_NOTICE_VERSION, Entrepreneur } from '../src/modules/entrepreneur/models.js';
import { sharingAllowed } from '../src/modules/entrepreneur/index.js';

// Synthetic values only; the key below exists for tests and protects no real data.
const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters', PII_ENCRYPTION_KEY: 'ab'.repeat(32) });
const syntheticName = 'Synthetic Applicant Kumari';
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let centre: InstanceType<typeof Org>;
let sector: InstanceType<typeof Org>;
let funding: InstanceType<typeof Org>;
let applicant: InstanceType<typeof User>;
let other: InstanceType<typeof User>;
let submission: InstanceType<typeof Submission>;

const tokenFor = (user: { _id: unknown }) => sessionService(config).create(String(user._id));
const as = async (user: { _id: unknown }) => `Bearer ${await tokenFor(user)}`;
const consent = (body: Record<string, unknown>) => ({ noticeVersion: CONSENT_NOTICE_VERSION, language: 'mr', method: 'app_tap', ...body });
async function grantProcessing(auth: string) {
  return request(app).post('/api/v1/consents').set('Authorization', auth).send(consent({ purpose: 'processing' })).expect(201);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all([User.init(), Org.init(), Session.init(), Submission.init(), Entrepreneur.init(), Consent.init()]);
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([User, Org, Session, Submission, Entrepreneur, Consent].map(model => (model as typeof User).deleteMany({})));
  [centre, sector, funding] = await Org.create([
    { name: 'Synthetic centre', type: 'centre' }, { name: 'Synthetic agri partner', type: 'sector_partner' },
    { name: 'Synthetic lender', type: 'funding_partner', fundingMode: 'lender' },
  ]) as [typeof centre, typeof sector, typeof funding];
  applicant = await User.create({ displayName: 'Entrepreneur', role: 'entrepreneur', firebaseUid: 'synthetic-uid-1' });
  other = await User.create({ displayName: 'Entrepreneur', role: 'entrepreneur', firebaseUid: 'synthetic-uid-2' });
  submission = await Submission.create({ title: 'Synthetic papad unit', ownerOrgId: centre._id, entrepreneurId: applicant._id,
    createdByUserId: applicant._id, status: 'SHORTLISTED', fundingReady: true,
    shares: [{ orgId: sector._id, partnerType: 'sector_partner', active: true, contactAccepted: false },
      { orgId: funding._id, partnerType: 'funding_partner', active: true, contactAccepted: false }] });
  app = createApp(config);
});

describe('entrepreneur access', () => {
  it('serves /me only to signed-in entrepreneurs', async () => {
    await request(app).get('/api/v1/me').expect(401);
    for (const role of ['facilitator', 'centre_assessor'] as const) {
      const staff = await User.create({ displayName: `Synthetic ${role}`, email: `${role}@pitchprism.test`, role, orgId: centre._id });
      await request(app).get('/api/v1/me').set('Authorization', await as(staff)).expect(403);
      await request(app).put('/api/v1/me').set('Authorization', await as(staff)).send({ language: 'hi' }).expect(403);
      await request(app).post('/api/v1/consents').set('Authorization', await as(staff)).send(consent({ purpose: 'processing' })).expect(403);
    }
    const response = await request(app).get('/api/v1/me').set('Authorization', await as(applicant)).expect(200);
    expect(response.body).toMatchObject({ id: String(applicant._id), language: null, profileComplete: false,
      consents: { processing: null, sharing: { sector_partner: null, funding_partner: null } }, noticeVersion: CONSENT_NOTICE_VERSION });
  });
  it('does not mount entrepreneur guards over other roles\' routes', async () => {
    const assessor = await User.create({ displayName: 'Synthetic assessor', email: 'assessor@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', await as(assessor)).expect(200);
  });
  it('rejects expired sessions', async () => {
    const auth = await as(applicant);
    await Session.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    await request(app).get('/api/v1/me').set('Authorization', auth).expect(401);
  });
});

describe('language and profile', () => {
  it('saves the language before consent but rejects unknown languages and client-chosen access fields', async () => {
    const auth = await as(applicant);
    const response = await request(app).put('/api/v1/me').set('Authorization', auth).send({ language: 'or' }).expect(200);
    expect(response.body.language).toBe('or');
    await request(app).put('/api/v1/me').set('Authorization', auth).send({ language: 'fr' }).expect(400);
    for (const field of [{ role: 'hq_admin' }, { orgId: String(centre._id) }, { homeOrgId: String(centre._id) }, { userId: String(other._id) }]) {
      await request(app).put('/api/v1/me').set('Authorization', auth).send({ language: 'hi', ...field }).expect(400);
    }
  });
  it('requires processing consent before storing personal details', async () => {
    const auth = await as(applicant);
    await request(app).put('/api/v1/me').set('Authorization', auth).send({ name: syntheticName }).expect(403);
    await request(app).put('/api/v1/me').set('Authorization', auth).send({ district: 'Nashik' }).expect(403);
    expect(await Entrepreneur.countDocuments()).toBe(0);
  });
  it('seals name and gender at rest and returns them only to their owner', async () => {
    const auth = await as(applicant);
    await grantProcessing(auth);
    const saved = await request(app).put('/api/v1/me').set('Authorization', auth)
      .send({ language: 'mr', name: syntheticName, district: 'Nashik', pincode: '422001', trade: 'Food processing', gender: 'female' }).expect(200);
    expect(saved.body.profile).toEqual({ name: syntheticName, gender: 'female', district: 'Nashik', pincode: '422001', trade: 'Food processing' });
    expect(saved.body.profileComplete).toBe(true);
    const raw = await mongoose.connection.collection('entrepreneurs').findOne({ _id: applicant._id });
    expect(JSON.stringify(raw)).not.toContain(syntheticName);
    expect(JSON.stringify(raw)).not.toContain('female');
    // Partial updates keep the sealed fields; null clears optional gender.
    const cleared = await request(app).put('/api/v1/me').set('Authorization', auth).send({ gender: null }).expect(200);
    expect(cleared.body.profile).toMatchObject({ name: syntheticName, gender: null, trade: 'Food processing' });
    const otherView = await request(app).get('/api/v1/me').set('Authorization', await as(other)).expect(200);
    expect(otherView.body.profile.name).toBeNull();
  });
  it('rejects a sealed record copied onto another entrepreneur', async () => {
    const auth = await as(applicant);
    await grantProcessing(auth);
    await request(app).put('/api/v1/me').set('Authorization', auth).send({ name: syntheticName }).expect(200);
    const sealed = (await Entrepreneur.findById(applicant._id).select('+personal').lean())!.personal;
    await Entrepreneur.create({ _id: other._id, userId: other._id, createdVia: 'self', personal: sealed });
    await request(app).get('/api/v1/me').set('Authorization', await as(other)).expect(503);
  });
  it('validates profile fields', async () => {
    const auth = await as(applicant);
    await grantProcessing(auth);
    for (const body of [{ pincode: '022001' }, { pincode: '42200' }, { name: '' }, { name: 'a\u0000b' }, { gender: 'unknown' }, { trade: 'x'.repeat(81) }]) {
      await request(app).put('/api/v1/me').set('Authorization', auth).send(body).expect(400);
    }
  });
  it('fails closed without an encryption key', async () => {
    const keyless = createApp({ ...config, PII_ENCRYPTION_KEY: '' });
    const auth = await as(applicant);
    await request(keyless).post('/api/v1/consents').set('Authorization', auth).send(consent({ purpose: 'processing' })).expect(201);
    await request(keyless).put('/api/v1/me').set('Authorization', auth).send({ name: syntheticName }).expect(503);
    expect(await Entrepreneur.countDocuments()).toBe(0);
  });
});

describe('consent', () => {
  it('records processing and optional sharing consent separately, idempotently and with the notice shown', async () => {
    const auth = await as(applicant);
    await request(app).post('/api/v1/consents').set('Authorization', auth).send(consent({ purpose: 'partner_sharing', scope: 'sector_partner' })).expect(409);
    const first = await grantProcessing(auth);
    const repeat = await request(app).post('/api/v1/consents').set('Authorization', auth).send(consent({ purpose: 'processing' })).expect(200);
    expect(repeat.body.consent.id).toBe(first.body.consent.id);
    expect(first.body.consent).toMatchObject({ purpose: 'processing', scope: 'all', status: 'active', noticeVersion: CONSENT_NOTICE_VERSION, language: 'mr', method: 'app_tap' });
    expect(first.body.consents.sharing).toEqual({ sector_partner: null, funding_partner: null });
    const shared = await request(app).post('/api/v1/consents').set('Authorization', auth).send(consent({ purpose: 'partner_sharing', scope: 'sector_partner', method: 'app_voice' })).expect(201);
    expect(shared.body.consents.sharing.sector_partner.status).toBe('active');
    expect(shared.body.consents.sharing.funding_partner).toBeNull();
    expect(await sharingAllowed(applicant._id, 'sector_partner')).toBe(true);
    expect(await sharingAllowed(applicant._id, 'funding_partner')).toBe(false);
  });
  it('rejects unknown notices, assisted methods, missing scopes and client-chosen subjects', async () => {
    const auth = await as(applicant);
    for (const body of [consent({ purpose: 'processing', noticeVersion: 'old' }), consent({ purpose: 'processing', method: 'assisted_recorded' }),
      consent({ purpose: 'partner_sharing' }), consent({ purpose: 'processing', scope: 'sector_partner' }),
      consent({ purpose: 'processing', entrepreneurId: String(other._id) }), consent({ purpose: 'processing', status: 'revoked' })]) {
      await request(app).post('/api/v1/consents').set('Authorization', auth).send(body).expect(400);
    }
    expect(await Consent.countDocuments()).toBe(0);
  });
  it('removes a partner\'s access immediately when sharing is revoked, without touching other partners', async () => {
    const auth = await as(applicant);
    await grantProcessing(auth);
    const sharing = await request(app).post('/api/v1/consents').set('Authorization', auth).send(consent({ purpose: 'partner_sharing', scope: 'sector_partner' })).expect(201);
    const partner = await User.create({ displayName: 'Synthetic partner', email: 'sector@pitchprism.test', role: 'sector_partner', orgId: sector._id });
    const lender = await User.create({ displayName: 'Synthetic lender', email: 'lender@pitchprism.test', role: 'funding_partner', orgId: funding._id });
    const partnerAuth = await as(partner);
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', partnerAuth).expect(200);
    // Another entrepreneur cannot revoke it.
    await request(app).post(`/api/v1/consents/${sharing.body.consent.id}/revoke`).set('Authorization', await as(other)).send({}).expect(404);
    const revoked = await request(app).post(`/api/v1/consents/${sharing.body.consent.id}/revoke`).set('Authorization', auth).send({}).expect(200);
    expect(revoked.body.consent.status).toBe('revoked');
    expect(revoked.body.consents.sharing.sector_partner).toBeNull();
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', partnerAuth).expect(404);
    await request(app).get(`/api/v1/submissions/${submission._id}`).set('Authorization', await as(lender)).expect(200);
    // Retrying the revoke is safe and keeps the share closed.
    await request(app).post(`/api/v1/consents/${sharing.body.consent.id}/revoke`).set('Authorization', auth).send({}).expect(200);
    expect(await sharingAllowed(applicant._id, 'sector_partner')).toBe(false);
  });
  it('withdraws all sharing and closes every share when processing consent is revoked; regranting keeps history', async () => {
    const auth = await as(applicant);
    const processing = await grantProcessing(auth);
    await request(app).post('/api/v1/consents').set('Authorization', auth).send(consent({ purpose: 'partner_sharing', scope: 'funding_partner' })).expect(201);
    await request(app).post(`/api/v1/consents/${processing.body.consent.id}/revoke`).set('Authorization', auth).send({}).expect(200);
    const after = await Submission.findById(submission._id).lean();
    expect(after!.shares.every(share => !share.active)).toBe(true);
    expect(await Consent.countDocuments({ status: 'active' })).toBe(0);
    await request(app).put('/api/v1/me').set('Authorization', auth).send({ trade: 'Tailoring' }).expect(403);
    await grantProcessing(auth);
    expect(await Consent.countDocuments({ purpose: 'processing' })).toBe(2);
  });
  it('rejects malformed consent IDs', async () => {
    await request(app).post('/api/v1/consents/not-an-id/revoke').set('Authorization', await as(applicant)).send({}).expect(400);
  });
});

describe('own submission lists', () => {
  it('shows entrepreneurs only their own ideas and facilitators only what they created', async () => {
    const facilitator = await User.create({ displayName: 'Synthetic facilitator', email: 'f1@pitchprism.test', role: 'facilitator', orgId: centre._id });
    const colleague = await User.create({ displayName: 'Synthetic colleague', email: 'f2@pitchprism.test', role: 'facilitator', orgId: centre._id });
    const assisted = await Submission.create({ title: 'Synthetic assisted pitch', ownerOrgId: centre._id, entrepreneurId: other._id,
      createdByUserId: facilitator._id, applicant: { name: 'Synthetic assisted applicant', phone: '+910000000002' } });
    const own = await request(app).get('/api/v1/me/submissions').set('Authorization', await as(applicant)).expect(200);
    expect(own.body.submissions).toEqual([{ id: String(submission._id), title: 'Synthetic papad unit', status: 'SHORTLISTED' }]);
    const theirs = await request(app).get('/api/v1/me/submissions').set('Authorization', await as(other)).expect(200);
    expect(theirs.body.submissions.map((item: { id: string }) => item.id)).toEqual([String(assisted._id)]);
    const listed = await request(app).get('/api/v1/assisted/submissions').set('Authorization', await as(facilitator)).expect(200);
    expect(listed.body.submissions).toEqual([{ id: String(assisted._id), title: 'Synthetic assisted pitch', status: 'DRAFT',
      applicant: { name: 'Synthetic assisted applicant', phone: '+910000000002' } }]);
    const empty = await request(app).get('/api/v1/assisted/submissions').set('Authorization', await as(colleague)).expect(200);
    expect(empty.body.submissions).toEqual([]);
    await request(app).get('/api/v1/assisted/submissions').set('Authorization', await as(applicant)).expect(403);
    await request(app).get('/api/v1/me/submissions').set('Authorization', await as(facilitator)).expect(403);
    const assessor = await User.create({ displayName: 'Synthetic assessor', email: 'a@pitchprism.test', role: 'centre_assessor', orgId: centre._id });
    await request(app).get('/api/v1/assisted/submissions').set('Authorization', await as(assessor)).expect(403);
  });
});

describe('idea passport', () => {
  it('lists who can see each of the entrepreneur\'s own ideas and why', async () => {
    const auth = await as(applicant);
    await Submission.create({ title: 'Another applicant idea', ownerOrgId: centre._id, entrepreneurId: other._id, createdByUserId: other._id });
    const response = await request(app).get('/api/v1/me/passport').set('Authorization', auth).expect(200);
    expect(response.body.ideas).toHaveLength(1);
    const visible = response.body.ideas[0].visibleTo;
    expect(visible).toEqual(expect.arrayContaining([
      { name: 'Synthetic centre', type: 'centre', reason: 'owning_centre' },
      expect.objectContaining({ name: 'Synthetic agri partner', type: 'sector_partner', reason: 'consented_share', partnerType: 'sector_partner', contactAccepted: false }),
    ]));
    await Submission.updateOne({ _id: submission._id }, { $set: { 'shares.$[].active': false } });
    const closed = await request(app).get('/api/v1/me/passport').set('Authorization', auth).expect(200);
    expect(closed.body.ideas[0].visibleTo).toEqual([{ name: 'Synthetic centre', type: 'centre', reason: 'owning_centre' }]);
    await request(app).get('/api/v1/me/passport').set('Authorization', await as(await User.create({ displayName: 'Synthetic facilitator', email: 'f@pitchprism.test', role: 'facilitator', orgId: centre._id }))).expect(403);
  });
});
