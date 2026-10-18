import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { CentrePortfolio, PortfolioIdea } from '@pitchprism/contracts';
import { domainSchema } from '@pitchprism/contracts';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { PDFDocument } from 'pdf-lib';
import { createApp } from '../src/app.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { sessionService } from '../src/auth/session.js';
import { Cohort, Org, Programme, Session, Submission, Trade, User } from '../src/models.js';
import { CentreCase } from '../src/modules/centre/model.js';
import { buildPortfolio } from '../src/modules/centre/portfolio.js';

const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'portfolio-synthetic-test-secret-at-least-forty-characters', PII_ENCRYPTION_KEY: 'a'.repeat(64), TENANCY_MODE: 'enforce' });
let mongo: MongoMemoryServer, app: ReturnType<typeof createApp>;
let centre: InstanceType<typeof Org>, sibling: InstanceType<typeof Org>, assessor: InstanceType<typeof User>, outsider: InstanceType<typeof User>, partner: InstanceType<typeof User>;
let cohort: InstanceType<typeof Cohort>, foreignCohort: InstanceType<typeof Cohort>;
const auth = async (user: InstanceType<typeof User>) => `Bearer ${await sessionService(config).create(String(user._id))}`;
const ajv = new Ajv({ strict: false });
const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
addFormats(ajv); ajv.addFormat('objectid', /^[a-f\d]{24}$/i);
const validate = ajv.compile({ ...domainSchema, $ref: '#/definitions/CentrePortfolio' });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Org.deleteMany({}), User.deleteMany({}), Session.deleteMany({}), Submission.deleteMany({}), CentreCase.deleteMany({}), Programme.deleteMany({}), Cohort.deleteMany({}), Trade.deleteMany({})]);
  [centre, sibling] = await Org.create([{ name: 'Synthetic centre', type: 'centre' }, { name: 'Synthetic other centre', type: 'centre' }]) as [typeof centre, typeof sibling];
  assessor = await User.create({ displayName: 'Synthetic assessor', role: 'centre_assessor', orgId: centre._id });
  outsider = await User.create({ displayName: 'Synthetic outsider', role: 'cohort_lead', orgId: sibling._id });
  const org = await Org.create({ name: 'Synthetic sector', type: 'sector_partner' });
  partner = await User.create({ displayName: 'Synthetic partner', role: 'sector_partner', orgId: org._id });
  const programme = await Programme.create({ name: 'Synthetic programme', orgId: centre._id, status: 'active' });
  cohort = await Cohort.create({ name: 'Intake one', programmeId: programme._id, orgId: centre._id, status: 'open' });
  foreignCohort = await Cohort.create({ name: 'Foreign intake', programmeId: programme._id, orgId: sibling._id, status: 'open' });
  await Trade.create({ key: 'tailoring', label: 'Tailoring', sector: 'Textiles', active: true });
  app = createApp(config);
});
async function idea(score: number | null, orgId = centre._id, version = 'v1', coverage = 100) {
  const submission = await Submission.create({ title: `Synthetic idea ${score}`, ownerOrgId: orgId, entrepreneurId: new mongoose.Types.ObjectId(), createdByUserId: assessor._id, cohortId: cohort._id, tradeKey: 'tailoring', languages: ['en'], status: 'READY' });
  if (score !== null) await CentreCase.create({ submissionId: submission._id, ownerOrgId: orgId, state: 'READY', input: { segments: [] }, evaluation: { potential: score, completeness: 80, coverage, rubricVersion: version, band: coverage < 60 ? 'Insufficient information' : 'Strong', pathway: 'Deeper evaluation', domains: [{ key: 'clarity', score: 4, confidence: 'high', evidence: ['s_0001'] }] } });
  return submission;
}
describe('centre portfolio comparisons', () => {
  it('scopes rows and aggregate counts before pagination, exposes no personal data, and denies partner access', async () => {
    await idea(80); await idea(70); await idea(null); await idea(99, sibling._id);
    const response = await request(app).get('/api/v1/centre/portfolio?pageSize=1&sort=potential').set('Authorization', await auth(assessor)).expect(200);
    const body = response.body as CentrePortfolio;
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    expect(body.total).toBe(3); expect(body.ideas).toHaveLength(1); expect(body.summary.assessed).toBe(2);
    expect(body.summary.pending).toBe(1); expect(body.summary.medianPotential).toBe(75); expect(body.points).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/personal|phone|email|passwordHash/);
    await request(app).get('/api/v1/centre/portfolio').expect(401);
    await request(app).get('/api/v1/centre/portfolio').set('Authorization', await auth(partner)).expect(403);
    const other = await request(app).get('/api/v1/centre/portfolio').set('Authorization', await auth(outsider)).expect(200);
    expect(other.body.total).toBe(1);
    await request(app).get('/api/v1/centre/intake-options').set('Authorization', await auth(partner)).expect(403);
    const options = await request(app).get('/api/v1/centre/intake-options').set('Authorization', await auth(assessor)).expect(200);
    expect(options.body.cohorts.map((c: { label: string }) => c.label)).toEqual(['Intake one']);
  });
  it('keeps rubric versions separate and excludes low-coverage results from ranks and distributions', async () => {
    await idea(80); await idea(90, centre._id, 'v2'); await idea(100, centre._id, 'v1', 20);
    const response = await request(app).get('/api/v1/centre/portfolio?rubricVersion=v1').set('Authorization', await auth(assessor)).expect(200);
    expect(response.body.excludedOtherVersions).toBe(1); expect(response.body.total).toBe(2);
    expect(response.body.summary.ranked).toBe(1); expect(response.body.summary.medianPotential).toBe(80);
    expect(response.body.ideas.find((row: PortfolioIdea) => row.potential === 100).tradeRank).toBeNull();
    expect(response.body.distribution.reduce((sum: number, row: { count: number }) => sum + row.count, 0)).toBe(1);
    await request(app).get('/api/v1/centre/portfolio?rubricVersion=absent').set('Authorization', await auth(assessor)).expect(400);
  });
  it('filters table and charts together while rank peers remain the full same-version centre population', async () => {
    await idea(80); await idea(70); await idea(60);
    const result = await request(app).get('/api/v1/centre/portfolio?q=idea%2070').set('Authorization', await auth(assessor)).expect(200);
    expect(result.body.total).toBe(1); expect(result.body.points).toHaveLength(1);
    expect(result.body.ideas[0].tradeRank).toMatchObject({ rank: 2, of: 3, percentile: null, scope: 'Trade across your centre' });
    await request(app).get('/api/v1/centre/portfolio?cohortId=bad').set('Authorization', await auth(assessor)).expect(400);
  });
  it('assigns competition ranks to ties and provides percentiles only with enough peers', async () => {
    for (const score of [80, 80, 70, 60, 50]) await idea(score);
    const result = await request(app).get('/api/v1/centre/portfolio?sort=potential').set('Authorization', await auth(assessor)).expect(200);
    expect(result.body.ideas.map((row: PortfolioIdea) => row.tradeRank?.rank)).toEqual([1, 1, 3, 4, 5]);
    expect(result.body.ideas[2].tradeRank).toMatchObject({ percentile: 50, scope: 'Trade within cohort' });
    expect(result.body.heatmap[0]).toMatchObject({ n: 5, medianPotential: 70 });
  });
  it('freezes the comparison rank when a human decision is recorded', async () => {
    const target = await idea(80); await idea(70);
    await request(app).post(`/api/v1/centre/submissions/${target._id}/decision`).set('Authorization', await auth(assessor))
      .send({ decision: 'shortlist' }).expect(200);
    await idea(90);
    const saved = await CentreCase.findOne({ submissionId: target._id }).lean();
    expect(saved!.decision.comparisonSnapshot).toMatchObject({ rubricVersion: 'v1', tradeRank: { rank: 1, of: 2 } });
    const result = await request(app).get('/api/v1/centre/portfolio').set('Authorization', await auth(assessor)).expect(200);
    expect(result.body.ideas.find((row: PortfolioIdea) => row.submissionId === String(target._id)).tradeRank.rank).toBe(2);
  });
  it('rejects foreign cohorts during import instead of accepting client organisation values', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
    const endpoint = '/api/v1/centre/plans';
    const fields = { title: 'Synthetic plan', applicantName: 'Synthetic applicant', district: 'Pune', trade: 'Tailoring', tradeKey: 'tailoring', language: 'en' };
    await request(app).post(endpoint).set('Authorization', await auth(assessor)).field({ ...fields, cohortId: String(foreignCohort._id) }).attach('plan', bytes, 'plan.pdf').expect(404);
    const imported = await request(app).post(endpoint).set('Authorization', await auth(assessor)).field({ ...fields, cohortId: String(cohort._id) }).attach('plan', bytes, 'plan.pdf').expect(201);
    const stored = await Submission.findById(imported.body.submissionId);
    expect(String(stored!.cohortId)).toBe(String(cohort._id)); expect(stored!.tradeKey).toBe('tailoring');
  });
});
