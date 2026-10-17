import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionService } from '../src/auth/session.js';
import { configSchema } from '../src/config.js';
import { connectDatabase } from '../src/database.js';
import { ALL_MODELS, AuditLog, Decision, EvalRun, Evaluation, Job, Org, Outcome, PipelineRun, ReviewSample, StageEvent, Submission, User } from '../src/models.js';
import { CentreCase } from '../src/modules/centre/model.js';
import { setTenancyMode } from '../src/platform/tenancy.js';
import type { Band, SubmissionStatus } from '@pitchprism/contracts';

// HQ reports over synthetic records, with the tenancy guard enforcing.
const config = configSchema.parse({ NODE_ENV: 'test', JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-characters',
  PII_ENCRYPTION_KEY: '12'.repeat(32), TENANCY_MODE: 'enforce' });
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let hqAuth: string;
let assessorAuth: string;
let centre: InstanceType<typeof Org>;
let sibling: InstanceType<typeof Org>;
const ids = () => new mongoose.Types.ObjectId();
const bearer = async (user: { _id: unknown }) => `Bearer ${await sessionService(config).create(String(user._id))}`;
async function idea(orgId: mongoose.Types.ObjectId, status: SubmissionStatus, extra: Record<string, unknown> = {}) {
  return Submission.create({ ownerOrgId: orgId, entrepreneurId: ids(), createdByUserId: ids(), status, shares: [], title: `Synthetic ${status}`, ...extra });
}
async function evaluate(submission: InstanceType<typeof Submission>, potential: number, band: Band) {
  return Evaluation.create({ submissionId: submission._id, ownerOrgId: submission.ownerOrgId, rubricKey: 'edp-default', rubricVersion: 1, domains: [], potential, band, completeness: 80 });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase({ ...config, MONGODB_URI: mongo.getUri() });
  await Promise.all([...ALL_MODELS, CentreCase].map(model => (model as typeof User).init()));
}, 120000);
afterAll(async () => { setTenancyMode('warn'); await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([...ALL_MODELS, CentreCase].filter(model => model.modelName !== 'StageEvent').map(model => (model as typeof User).deleteMany({})));
  const hq = await Org.create({ name: 'Synthetic HQ', type: 'hq' });
  [centre, sibling] = await Org.create([{ name: 'Synthetic centre', type: 'centre' }, { name: 'Synthetic sibling', type: 'centre' }]) as [typeof centre, typeof sibling];
  hqAuth = await bearer(await User.create({ displayName: 'Synthetic HQ admin', email: 'hq@pitchprism.test', role: 'hq_admin', orgId: hq._id }));
  assessorAuth = await bearer(await User.create({ displayName: 'Synthetic assessor', email: 'assessor@pitchprism.test', role: 'centre_assessor', orgId: centre._id }));
  app = createApp(config);
});

describe('HQ reports', () => {
  it('are HQ only', async () => {
    for (const route of ['pipeline', 'funnel', 'pipeline-health', 'fairness', 'sampling', 'audit', 'model-quality']) {
      await request(app).get(`/api/v1/hq/reports/${route}`).set('Authorization', assessorAuth).expect(403);
    }
  });

  it('lists the cross-organisation pipeline with filters, preferring evaluations and falling back to centre cases', async () => {
    const ready = await idea(centre._id, 'READY', { tradeKey: 'tailoring', languages: ['te'] });
    await evaluate(ready, 72, 'promising');
    const fromCentre = await idea(sibling._id, 'READY', { tradeKey: 'dairy' });
    await CentreCase.create({ submissionId: fromCentre._id, ownerOrgId: sibling._id, input: {}, state: 'READY', evaluation: { potential: 81, completeness: 90, band: 'strong', pathway: 'deeper_evaluation' } });
    await idea(centre._id, 'DRAFT');
    const all = await request(app).get('/api/v1/hq/reports/pipeline').set('Authorization', hqAuth).expect(200);
    expect(all.body.total).toBe(3);
    const byId = Object.fromEntries(all.body.items.map((item: { id: string }) => [item.id, item]));
    expect(byId[String(ready._id)]).toMatchObject({ potential: 72, band: 'promising', centre: 'Synthetic centre', languages: ['te'] });
    expect(byId[String(fromCentre._id)]).toMatchObject({ potential: 81, band: 'strong', centre: 'Synthetic sibling' });
    const strong = await request(app).get('/api/v1/hq/reports/pipeline?band=strong').set('Authorization', hqAuth).expect(200);
    expect(strong.body.items.map((item: { id: string }) => item.id)).toEqual([String(fromCentre._id)]);
    const unassessed = await request(app).get('/api/v1/hq/reports/pipeline?band=unassessed').set('Authorization', hqAuth).expect(200);
    expect(unassessed.body.items).toHaveLength(1);
    const page = await request(app).get(`/api/v1/hq/reports/pipeline?orgId=${centre._id}&limit=1`).set('Authorization', hqAuth).expect(200);
    expect(page.body.items).toHaveLength(1);
    const next = await request(app).get(`/api/v1/hq/reports/pipeline?orgId=${centre._id}&limit=1&after=${page.body.nextCursor}`).set('Authorization', hqAuth).expect(200);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    expect(JSON.stringify(all.body)).not.toMatch(/applicant|phone|entrepreneurId/);
    await request(app).get('/api/v1/hq/reports/pipeline?status={"$ne":1}').set('Authorization', hqAuth).expect(400);
  });

  it('builds the funnel by centre with outcomes counted once per idea', async () => {
    const shortlisted = await idea(centre._id, 'SHORTLISTED');
    await idea(centre._id, 'NOT_YET'); await idea(centre._id, 'DRAFT'); await idea(sibling._id, 'READY');
    await Outcome.create([{ submissionId: shortlisted._id, ownerOrgId: centre._id, stage: 'ENROLLED', date: new Date(), recordedByUserId: ids() },
      { submissionId: shortlisted._id, ownerOrgId: centre._id, stage: 'ENROLLED', date: new Date(), recordedByUserId: ids() }]);
    const funnel = await request(app).get('/api/v1/hq/reports/funnel').set('Authorization', hqAuth).expect(200);
    expect(funnel.body.totals).toEqual({ received: 4, submitted: 3, assessed: 3, decided: 2, shortlisted: 1, shared: 0 });
    const own = funnel.body.groups.find((group: { name: string }) => group.name === 'Synthetic centre');
    expect(own).toMatchObject({ received: 3, decided: 2, outcomes: { ENROLLED: 1 } });
    expect(funnel.body.conversion.shortlisted).toBe(50);
  });

  it('reports pipeline health: queue, stage percentiles, failures and zero hosted cost', async () => {
    const submission = await idea(centre._id, 'FAILED');
    const created = new Date(Date.now() - 60_000);
    await Job.create([
      { submissionId: submission._id, ownerOrgId: centre._id, fromStage: 'ingest', reason: 'new', idempotencyKey: 'a', status: 'done', attempts: 1, maxAttempts: 3, availableAt: created, createdAt: created, finishedAt: new Date(created.getTime() + 40_000) },
      { submissionId: submission._id, ownerOrgId: centre._id, fromStage: 'ingest', reason: 'retry', idempotencyKey: 'b', status: 'failed', attempts: 1, maxAttempts: 3, availableAt: created, finishedAt: new Date(),
        error: { code: 'capability_unavailable', message: 'No local OCR', stage: 'read' } },
      { submissionId: submission._id, ownerOrgId: centre._id, fromStage: 'ingest', reason: 'followup', idempotencyKey: 'c', status: 'queued', attempts: 0, maxAttempts: 3, availableAt: created },
    ]);
    const jobId = ids();
    const run = (status: 'done' | 'failed', ms: number, llmCalls: number) =>
      ({ jobId, submissionId: submission._id, ownerOrgId: centre._id, stage: 'read' as const, status, startedAt: new Date(), ms, model: 'synthetic', provider: 'ollama', llmCalls });
    await PipelineRun.create([run('done', 100, 1), run('done', 200, 1), run('done', 300, 1), run('done', 400, 1), run('failed', 5, 0)]);
    const health = await request(app).get('/api/v1/hq/reports/pipeline-health').set('Authorization', hqAuth).expect(200);
    expect(health.body.queue).toMatchObject({ done: 1, failed: 1, queued: 1 });
    expect(health.body.timeToCard).toMatchObject({ jobs: 1, p50Ms: 40_000 });
    expect(health.body.stages[0]).toMatchObject({ stage: 'read', runs: 5, failed: 1, failureRate: 20, p50Ms: 250 });
    expect(health.body.models[0]).toMatchObject({ model: 'ollama · synthetic', calls: 4 });
    expect(health.body.recentFailures[0]).toMatchObject({ code: 'capability_unavailable', stage: 'read', centre: 'Synthetic centre' });
    expect(health.body.hostedCostInr).toBe(0);
  });

  it('flags a fairness gap above 5 points only between groups large enough to compare', async () => {
    for (let index = 0; index < 5; index++) await evaluate(await idea(centre._id, 'READY', { languages: ['hi'], channel: 'app' }), 70, 'promising');
    for (let index = 0; index < 5; index++) await evaluate(await idea(centre._id, 'READY', { languages: ['te'], channel: 'app' }), 60, 'not_yet');
    await evaluate(await idea(centre._id, 'READY', { languages: ['bn'], channel: 'app' }), 10, 'not_yet');
    const fairness = await request(app).get('/api/v1/hq/reports/fairness').set('Authorization', hqAuth).expect(200);
    const language = fairness.body.dimensions.find((item: { key: string }) => item.key === 'language');
    expect(language).toMatchObject({ gap: 10, check: true });
    expect(language.groups.find((group: { value: string }) => group.value === 'bn')).toMatchObject({ n: 1, enough: false });
    expect(fairness.body.dimensions.find((item: { key: string }) => item.key === 'channel')).toMatchObject({ gap: null, check: false });
  });

  it('samples decisions stably, at least one per centre, and records HQ verdicts', async () => {
    const reviewer = ids();
    for (let index = 0; index < 6; index++) {
      const submission = await idea(index < 4 ? centre._id : sibling._id, 'SHORTLISTED');
      await Decision.create({ submissionId: submission._id, ownerOrgId: submission.ownerOrgId, userId: reviewer, decision: 'shortlist' });
    }
    const first = await request(app).get('/api/v1/hq/reports/sampling?percent=1').set('Authorization', hqAuth).expect(200);
    expect(new Set(first.body.sample.map((item: { centre: string }) => item.centre))).toEqual(new Set(['Synthetic centre', 'Synthetic sibling']));
    const again = await request(app).get('/api/v1/hq/reports/sampling?percent=1').set('Authorization', hqAuth).expect(200);
    expect(again.body.sample.map((item: { decisionId: string }) => item.decisionId)).toEqual(first.body.sample.map((item: { decisionId: string }) => item.decisionId));
    const target = first.body.sample[0].decisionId;
    await request(app).put(`/api/v1/hq/reports/sampling/${target}`).set('Authorization', hqAuth).send({ agrees: false }).expect(400);
    await request(app).put(`/api/v1/hq/reports/sampling/${target}`).set('Authorization', hqAuth).send({ agrees: false, suggestedDecision: 'more_info', note: 'Revenue not evidenced' }).expect(200);
    await request(app).put(`/api/v1/hq/reports/sampling/${target}`).set('Authorization', hqAuth).send({ agrees: true }).expect(200);
    expect(await ReviewSample.countDocuments()).toBe(1);
    expect((await ReviewSample.findOne().lean())!.suggestedDecision).toBeUndefined();
    const after = await request(app).get('/api/v1/hq/reports/sampling?percent=1').set('Authorization', hqAuth).expect(200);
    expect(after.body.agreement.find((row: { reviewed: number }) => row.reviewed === 1).agreementRate).toBe(100);
    expect(await AuditLog.countDocuments({ action: 'decision.second_review' })).toBe(2);
  });

  it('pages and filters the audit log without personal data', async () => {
    await AuditLog.create([{ action: 'user.invite', targetType: 'invitation', at: new Date(), targetOrgId: centre._id },
      { action: 'org.create', targetType: 'org', at: new Date() }, { action: 'pipeline.start', targetType: 'submission', at: new Date(), outcome: 'denied', targetOrgId: sibling._id }]);
    const all = await request(app).get('/api/v1/hq/reports/audit?limit=2').set('Authorization', hqAuth).expect(200);
    expect(all.body.entries).toHaveLength(2);
    const rest = await request(app).get(`/api/v1/hq/reports/audit?limit=2&before=${all.body.nextCursor}`).set('Authorization', hqAuth).expect(200);
    expect(rest.body.entries).toHaveLength(1);
    const users = await request(app).get('/api/v1/hq/reports/audit?action=user').set('Authorization', hqAuth).expect(200);
    expect(users.body.entries.map((entry: { action: string }) => entry.action)).toEqual(['user.invite']);
    const denied = await request(app).get(`/api/v1/hq/reports/audit?outcome=denied&orgId=${sibling._id}`).set('Authorization', hqAuth).expect(200);
    expect(denied.body.entries[0]).toMatchObject({ action: 'pipeline.start', targetOrg: 'Synthetic sibling', actor: 'System' });
    await request(app).get('/api/v1/hq/reports/audit?action=.*').set('Authorization', hqAuth).expect(400);
  });

  it('shows the evaluation-harness report when one exists and says so when it does not', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pp-eval-'));
    process.env.EVAL_REPORT_PATH = path.join(directory, 'missing.json');
    expect((await request(app).get('/api/v1/hq/reports/model-quality').set('Authorization', hqAuth).expect(200)).body.available).toBe(false);
    process.env.EVAL_REPORT_PATH = path.join(directory, 'report.json');
    await writeFile(process.env.EVAL_REPORT_PATH, JSON.stringify({ runAt: '2026-10-17T10:00:00Z', total: 55, assessed: 50, missingExtraction: 5, failed: 0, complete: false,
      fieldStateAccuracy: 0.91, flagRecall: 0.8, parity: { tailoring: { count: 3, gap: 4, pass: true } }, files: [{ status: 'assessed', durationMs: 100 }, { status: 'assessed', durationMs: 300 }] }));
    const report = (await request(app).get('/api/v1/hq/reports/model-quality').set('Authorization', hqAuth).expect(200)).body;
    expect(report).toMatchObject({ available: true, assessed: 50, fieldStateAccuracy: 0.91, parity: [{ group: 'tailoring', gap: 4, pass: true }], durationMs: { p50: 200 },
      computeSeconds: 0.4, hostedCostInr: 0, files: { assessed: 2 } });
    // Reading again does not record twice; a new report adds a run and the history keeps both, newest first.
    await request(app).get('/api/v1/hq/reports/model-quality').set('Authorization', hqAuth).expect(200);
    expect(await EvalRun.countDocuments()).toBe(1);
    await writeFile(process.env.EVAL_REPORT_PATH, JSON.stringify({ runAt: '2026-10-18T10:00:00Z', total: 55, assessed: 55, missingExtraction: 0, failed: 0, complete: true,
      fieldStateAccuracy: 0.95, flagRecall: 0.9, parity: {}, files: [] }));
    const next = (await request(app).get('/api/v1/hq/reports/model-quality').set('Authorization', hqAuth).expect(200)).body;
    expect(next.history.map((run: { assessed: number }) => run.assessed)).toEqual([55, 50]);
    expect(next.complete).toBe(true);
    // A malformed report is skipped and the stored history remains.
    await writeFile(process.env.EVAL_REPORT_PATH, '{ not json');
    expect((await request(app).get('/api/v1/hq/reports/model-quality').set('Authorization', hqAuth).expect(200)).body.history).toHaveLength(2);
    delete process.env.EVAL_REPORT_PATH;
    await rm(directory, { recursive: true, force: true });
  });
});
