import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ROLES, type Role, type OrgType } from '@pitchprism/contracts';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { errorHandler } from '../src/errors.js';
import { Org, Session, Submission, User } from '../src/models.js';
import { partnerRouter } from '../src/modules/partners/router.js';

const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'synthetic-partner-test-secret-with-more-than-32-characters' });
const paths = {
  implementation_partner: '/api/v1/partners/implementation/submissions',
  sector_partner: '/api/v1/partners/sector/opportunities',
  funding_partner: '/api/v1/partners/funding/shortlist',
} as const;
const workspacePath = '/api/v1/partners/workspace';
let mongo: MongoMemoryServer;
let app: express.Express;
let users: Record<Role, InstanceType<typeof User>>;
let orgs: Record<Exclude<OrgType, 'hq'> | 'hq', InstanceType<typeof Org>>;

async function token(role: Role) { return sessionService(config).create(String(users[role]._id)); }
async function read(path: string, role: Role) {
  return request(app).get(path).set('Authorization', `Bearer ${await token(role)}`);
}
function submission(overrides: Record<string, unknown> = {}) {
  return Submission.create({
    title: 'Synthetic sewing idea', ownerOrgId: orgs.centre._id,
    sourceOrgId: orgs.implementation_partner._id, entrepreneurId: users.entrepreneur._id,
    createdByUserId: users.facilitator._id, status: 'READY',
    applicant: { name: 'Synthetic applicant', phone: '+910000000000' }, ...overrides,
  });
}
function share(type: 'sector_partner' | 'funding_partner', active = true, contactAccepted = false) {
  return { orgId: orgs[type]._id, partnerType: type, active, contactAccepted };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all([Org.init(), User.init(), Submission.init(), Session.init()]);
  // Integration harness only. Production app.ts stays owned by Dev 3.
  app = express();
  app.use(cookieParser());
  app.use('/api/v1', sessionService(config).middleware);
  app.use('/api/v1/partners', partnerRouter());
  app.use(errorHandler);
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Org.deleteMany({}), User.deleteMany({}), Session.deleteMany({}), Submission.deleteMany({})]);
  orgs = {} as typeof orgs;
  for (const type of ['hq', 'centre', 'implementation_partner', 'sector_partner', 'funding_partner'] as const) {
    orgs[type] = await Org.create({ name: `Synthetic ${type}`, type, ...(type === 'funding_partner' ? { fundingMode: 'lender' } : {}) });
  }
  users = {} as typeof users;
  for (const role of ROLES) {
    const orgType = role === 'hq_admin' ? 'hq' : ['facilitator', 'cohort_lead', 'centre_assessor'].includes(role) ? 'centre' : role;
    users[role] = await User.create({ displayName: `Synthetic ${role}`, role,
      ...(role === 'entrepreneur' ? {} : { orgId: orgs[orgType as OrgType]._id }),
    });
  }
});

describe('partner workspace boundaries', () => {
  it.each([workspacePath, ...Object.values(paths)])('requires a real session for %s', async path => {
    await request(app).get(path).expect(401);
    await request(app).get(path).set('Authorization', 'Bearer invalid').expect(401);
  });
  it.each(ROLES)('restricts every partner subtype endpoint for %s', async role => {
    const bearer = await token(role);
    for (const [ownerRole, path] of Object.entries(paths)) {
      await request(app).get(path).set('Authorization', `Bearer ${bearer}`).expect(role === ownerRole ? 200 : 403);
    }
    const workspace = await request(app).get(workspacePath).set('Authorization', `Bearer ${bearer}`);
    expect(workspace.status).toBe(role in paths ? 200 : 403);
  });
  it('derives capability placeholders and funding mode from the database', async () => {
    expect((await read(workspacePath, 'implementation_partner')).body).toEqual({
      kind: 'implementation', listPath: '/partners/implementation/submissions',
      pending: ['intake', 'first_level_review', 'forward_to_centre'],
    });
    expect((await read(workspacePath, 'sector_partner')).body.pending).toEqual(['contact_request', 'mentoring_notes']);
    const bearer = await token('funding_partner');
    await Org.updateOne({ _id: orgs.funding_partner._id }, { fundingMode: 'csr' });
    const response = await request(app).get(`${workspacePath}?fundingMode=lender`).set('Authorization', `Bearer ${bearer}`).expect(200);
    expect(response.body).toEqual({ kind: 'csr', listPath: null, pending: ['csr_impact_report'] });
    await request(app).get(paths.funding_partner).set('Authorization', `Bearer ${bearer}`).expect(403);
    await Org.updateOne({ _id: orgs.funding_partner._id }, { $unset: { fundingMode: 1 } });
    await request(app).get(workspacePath).set('Authorization', `Bearer ${bearer}`).expect(403);
  });
  it('rereads disabled users, organisation state, membership, role and session revocation', async () => {
    const bearer = await token('implementation_partner');
    const fetchQueue = () => request(app).get(paths.implementation_partner).set('Authorization', `Bearer ${bearer}`);
    await User.updateOne({ _id: users.implementation_partner._id }, { disabled: true });
    await fetchQueue().expect(401);
    await User.updateOne({ _id: users.implementation_partner._id }, { disabled: false });
    await Org.updateOne({ _id: orgs.implementation_partner._id }, { active: false });
    await fetchQueue().expect(403);
    await Org.updateOne({ _id: orgs.implementation_partner._id }, { active: true });
    await User.updateOne({ _id: users.implementation_partner._id }, { role: 'sector_partner' });
    await fetchQueue().expect(403);
    await User.updateOne({ _id: users.implementation_partner._id }, { role: 'implementation_partner' });
    await Session.deleteMany({ userId: users.implementation_partner._id });
    await fetchQueue().expect(401);
  });
});

describe('implementation partner read queue', () => {
  it('scopes both items and totals by source organisation, independent of owning centre', async () => {
    const otherCentre = await Org.create({ name: 'Synthetic other centre', type: 'centre' });
    const sibling = await Org.create({ name: 'Synthetic other collector', type: 'implementation_partner' });
    const own = await submission({ ownerOrgId: otherCentre._id });
    await submission({ status: 'DRAFT' });
    await submission({ status: 'SHORTLISTED' });
    await submission({ sourceOrgId: sibling._id });
    await submission({ sourceOrgId: undefined });
    const response = await read(`${paths.implementation_partner}?status=READY`, 'implementation_partner');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      items: [{ id: String(own._id), title: own.title, status: 'READY' }], nextCursor: null,
      summary: { total: 3, draft: 1, ready: 1, shortlisted: 1 },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/applicant|phone|shares|ownerOrgId|entrepreneurId|createdByUserId|fundingReady/);
  });
  it('returns a truthful empty state', async () => {
    const response = await read(paths.implementation_partner, 'implementation_partner');
    expect(response.body).toEqual({ items: [], nextCursor: null, summary: { total: 0, draft: 0, ready: 0, shortlisted: 0 } });
  });
  it('paginates in stable ID order with no duplicates and keeps organisation totals unfiltered', async () => {
    const ids = ['100000000000000000000001', '100000000000000000000002', '100000000000000000000003'];
    for (const id of ids) await submission({ _id: id });
    const first = await read(`${paths.implementation_partner}?limit=2`, 'implementation_partner');
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([ids[2], ids[1]]);
    expect(first.body.nextCursor).toBe(ids[1]);
    const second = await read(`${paths.implementation_partner}?limit=2&after=${first.body.nextCursor}`, 'implementation_partner');
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([ids[0]]);
    expect(second.body.nextCursor).toBeNull();
    expect(second.body.summary.total).toBe(3);
  });
});

describe('sector consent and lender readiness', () => {
  it('rereads active shares on every sector list, including after contact acceptance and revocation', async () => {
    const row = await submission({ shares: [share('sector_partner')] });
    await submission({ shares: [share('sector_partner', false)] });
    await submission();
    const bearer = await token('sector_partner');
    const fetchList = () => request(app).get(paths.sector_partner).set('Authorization', `Bearer ${bearer}`);
    const first = await fetchList().expect(200);
    expect(first.body.items).toEqual([{ id: String(row._id), title: row.title, status: 'READY' }]);
    expect(first.body.summary.total).toBe(1);
    await Submission.updateOne({ _id: row._id, 'shares.orgId': orgs.sector_partner._id }, { $set: { 'shares.$.contactAccepted': true } });
    expect((await fetchList()).body.items).toEqual(first.body.items);
    await Submission.updateOne({ _id: row._id, 'shares.orgId': orgs.sector_partner._id }, { $set: { 'shares.$.active': false } });
    const revoked = await fetchList().expect(200);
    expect(revoked.body.items).toEqual([]);
    expect(revoked.body.summary.total).toBe(0);
  });
  it('requires org ID, partner type and active flag on the same share', async () => {
    const other = await Org.create({ name: 'Synthetic other sector', type: 'sector_partner' });
    await submission({ shares: [
      { orgId: orgs.sector_partner._id, partnerType: 'funding_partner', active: true },
      { orgId: other._id, partnerType: 'sector_partner', active: true },
      share('sector_partner', false),
    ] });
    const response = await read(paths.sector_partner, 'sector_partner');
    expect(response.body.items).toEqual([]);
    expect(response.body.summary.total).toBe(0);
  });
  it('requires all lender conditions and prevents status filters from overriding the shortlist boundary', async () => {
    const good = await submission({ status: 'SHORTLISTED', fundingReady: true, shares: [share('funding_partner')] });
    await submission({ status: 'READY', fundingReady: true, shares: [share('funding_partner')] });
    await submission({ status: 'SHORTLISTED', fundingReady: false, shares: [share('funding_partner')] });
    await submission({ status: 'SHORTLISTED', fundingReady: true, shares: [share('funding_partner', false)] });
    await submission({ status: 'SHORTLISTED', fundingReady: true });
    const response = await read(paths.funding_partner, 'funding_partner');
    expect(response.body).toEqual({ items: [{ id: String(good._id), title: good.title, status: 'SHORTLISTED' }],
      nextCursor: null, summary: { total: 1, draft: 0, ready: 0, shortlisted: 1 } });
    const filtered = await read(`${paths.funding_partner}?status=READY`, 'funding_partner');
    expect(filtered.body.items).toEqual([]);
    expect(filtered.body.summary.total).toBe(1);
    await Submission.updateOne({ _id: good._id }, { fundingReady: false });
    expect((await read(paths.funding_partner, 'funding_partner')).body.summary.total).toBe(0);
  });
});

describe('query validation', () => {
  it.each([
    'sourceOrgId=100000000000000000000001', 'ownerOrgId=100000000000000000000001',
    'role=hq_admin', 'consent=true', 'status[$ne]=DRAFT', 'status=READY&status=DRAFT',
    'status=UNKNOWN', 'limit=0', 'limit=51', 'limit=-1', 'limit=1.5', 'limit[]=2',
    'after=invalid', 'after[$ne]=x',
  ])('rejects malformed filters and caller-selected scope: %s', async query => {
    for (const [role, path] of Object.entries(paths)) {
      const response = await read(`${path}?${query}`, role as Role);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Check the request fields and try again.' });
    }
  });
});
