import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../auth/authorization.js';
import { HttpError } from '../../errors.js';
import { AuditEvent, Cohort, ClusterPoint, EvaluationRun, Org, Programme, ReviewSample, RoutingRule, Rubric, StageEvent, Submission, Trade } from '../../models.js';
import { sharingAllowed } from '../entrepreneur/index.js';

const id = z.string().regex(/^[a-f\d]{24}$/i);
const text = z.string().trim().min(1).max(160);
const definition = z.record(z.string(), z.unknown());
const versioned = z.object({ name: text, definition }).strict();
const rule = z.object({ partnerOrgId: id, trades: z.array(text).max(100).default([]), sectors: z.array(text).max(100).default([]), districts: z.array(text).max(100).default([]) }).strict();
const cohort = z.object({ name: text, orgId: id.optional(), programmeId: id.optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional() }).strict();
const trade = z.object({ name: text, synonyms: z.array(text).max(50).default([]), osmTags: z.array(text).max(50).default([]) }).strict();
const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
const pipelineQuery = pagination.extend({
  centre: id.optional(), cohort: id.optional(), language: text.optional(), trade: text.optional(), sector: text.optional(),
  district: text.optional(), status: text.optional(), band: text.optional(), pathway: text.optional(),
}).strict();
const activeUpdate = z.object({ active: z.boolean() }).strict();
const evaluation = z.object({ promptVersion: text.optional(), rubricVersionId: id.optional(), models: z.array(text).max(20).default([]), metrics: z.record(z.string(), z.unknown()), perFile: z.record(z.string(), z.unknown()).optional() }).strict();
const classification = z.object({ cohortId: id.nullable().optional(), trade: text.nullable().optional(), sector: text.nullable().optional(), district: text.nullable().optional(), language: text.nullable().optional(), inputFormat: text.nullable().optional(), gender: text.nullable().optional(), band: text.nullable().optional(), pathway: text.nullable().optional(), score: z.number().min(0).max(100).nullable().optional() }).strict();
const override = z.object({ decision: z.string().trim().min(1).max(100), reason: z.string().trim().min(10).max(2000) }).strict();

function clusterKey(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}
function words(value: string) {
  return new Set(value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(Boolean));
}
function similarity(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter(word => right.has(word)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

export function hqAdminRouter() {
  const router = Router();
  const platform = requirePermission('manage_platform');
  const cohorts = requirePermission('manage_cohorts');
  const list = (model: typeof Programme | typeof Rubric) => async (_req: Request, res: Response) => res.json({ items: await model.find().sort({ name: 1, version: -1 }).limit(500).lean() });
  const createVersion = (model: typeof Programme | typeof Rubric) => async (req: Request, res: Response) => {
    const input = versioned.parse(req.body);
    const previous = await model.findOne({ name: input.name }).sort({ version: -1 }).select('version').lean();
    const item = await model.create({ ...input, version: (previous?.version ?? 0) + 1, createdByUserId: req.auth!.user.id });
    await AuditEvent.create({ actorUserId: req.auth!.user.id, action: 'create', resourceType: model.modelName, resourceId: String(item._id) });
    res.status(201).json(item);
  };
  router.get('/hq/programmes', platform, list(Programme));
  router.post('/hq/programmes', platform, createVersion(Programme));
  router.get('/hq/rubrics', platform, list(Rubric));
  router.post('/hq/rubrics', platform, createVersion(Rubric));
  router.get('/hq/routing-rules', platform, async (_req, res) => res.json({ rules: await RoutingRule.find().sort({ createdAt: -1 }).limit(500).lean() }));
  router.post('/hq/routing-rules', platform, async (req, res) => res.status(201).json(await RoutingRule.create({ ...rule.parse(req.body), createdByUserId: req.auth!.user.id })));
  router.patch('/hq/routing-rules/:id', platform, async (req, res) => {
    const item = await RoutingRule.findByIdAndUpdate(id.parse(req.params.id), activeUpdate.parse(req.body), { returnDocument: 'after' }).lean();
    if (!item) { res.status(404).json({ error: 'Routing rule not found.' }); return; }
    await AuditEvent.create({ actorUserId: req.auth!.user.id, action: 'update', resourceType: 'RoutingRule', resourceId: String(item._id), metadata: activeUpdate.parse(req.body) });
    res.json(item);
  });
  router.get('/hq/cohorts', cohorts, async (req, res) => res.json({ cohorts: await Cohort.find(req.auth!.user.role === 'hq_admin' ? {} : { orgId: req.auth!.user.orgId }).sort({ startsAt: -1 }).lean() }));
  router.post('/hq/cohorts', cohorts, async (req, res) => {
    const input = cohort.parse(req.body);
    const actor = req.auth!.user;
    if (actor.role !== 'hq_admin' && input.orgId && input.orgId !== actor.orgId) throw new HttpError(403, 'This centre is outside your access.');
    const orgId = actor.role === 'hq_admin' ? input.orgId : actor.orgId;
    if (!orgId) throw new HttpError(400, 'Choose a centre.');
    if (!await Org.exists({ _id: orgId, type: 'centre', active: true })) throw new HttpError(400, 'Choose an active centre.');
    const item = await Cohort.create({ ...input, orgId });
    await AuditEvent.create({ actorUserId: actor.id, action: 'create', resourceType: 'Cohort', resourceId: String(item._id) });
    res.status(201).json(item);
  });
  router.patch('/hq/cohorts/:id', cohorts, async (req, res) => {
    const input = cohort.partial().parse(req.body);
    const actor = req.auth!.user;
    if (actor.role !== 'hq_admin' && input.orgId && input.orgId !== actor.orgId) throw new HttpError(403, 'This centre is outside your access.');
    if (input.orgId && !await Org.exists({ _id: input.orgId, type: 'centre', active: true })) throw new HttpError(400, 'Choose an active centre.');
    const filter = actor.role === 'hq_admin' ? { _id: id.parse(req.params.id) } : { _id: id.parse(req.params.id), orgId: actor.orgId };
    const item = await Cohort.findOneAndUpdate(filter, { $set: actor.role === 'hq_admin' ? input : { ...input, orgId: actor.orgId } }, { returnDocument: 'after' }).lean();
    if (!item) { res.status(404).json({ error: 'Cohort not found.' }); return; }
    await AuditEvent.create({ actorUserId: actor.id, action: 'update', resourceType: 'Cohort', resourceId: String(item._id) });
    res.json(item);
  });
  router.get('/hq/trades', cohorts, async (_req, res) => res.json({ trades: await Trade.find({ active: true }).sort({ name: 1 }).lean() }));
  router.post('/hq/trades', cohorts, async (req, res) => res.status(201).json(await Trade.create(trade.parse(req.body))));
  router.patch('/hq/trades/:id', cohorts, async (req, res) => {
    const input = trade.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const item = await Trade.findByIdAndUpdate(id.parse(req.params.id), { $set: input }, { returnDocument: 'after' }).lean();
    if (!item) { res.status(404).json({ error: 'Trade not found.' }); return; }
    res.json(item);
  });
  router.get('/hq/pipeline', platform, async (req, res) => {
    const query = pipelineQuery.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.centre) filter.ownerOrgId = query.centre;
    if (query.cohort) filter.cohortId = query.cohort;
    for (const field of ['language', 'trade', 'sector', 'district', 'status', 'band', 'pathway'] as const) if (query[field]) filter[field] = query[field];
    const [items, total] = await Promise.all([
      Submission.find(filter).select('title status language inputFormat gender district trade sector band pathway score ownerOrgId cohortId createdAt').sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      Submission.countDocuments(filter),
    ]);
    await AuditEvent.create({ actorUserId: req.auth!.user.id, action: 'view', resourceType: 'SubmissionPipeline', metadata: { filter, page: query.page } });
    res.json({ items, page: query.page, limit: query.limit, total });
  });
  router.patch('/hq/submissions/:id/classification', platform, async (req, res) => {
    const input = classification.parse(req.body);
    if (input.cohortId && !await Cohort.exists({ _id: input.cohortId, active: true })) { res.status(400).json({ error: 'Active cohort not found.' }); return; }
    const item = await Submission.findByIdAndUpdate(id.parse(req.params.id), { $set: input }, { returnDocument: 'after' }).lean();
    if (!item) { res.status(404).json({ error: 'Submission not found.' }); return; }
    await AuditEvent.create({ actorUserId: req.auth!.user.id, action: 'classify', resourceType: 'Submission', resourceId: String(item._id), metadata: input });
    res.json(item);
  });
  router.post('/hq/submissions/:id/route', platform, async (req, res) => {
    const submission = await Submission.findById(id.parse(req.params.id));
    if (!submission) { res.status(404).json({ error: 'Submission not found.' }); return; }
    const rules = await RoutingRule.find({ active: true }).lean();
    const matches = rules.filter(item => {
      const fits = (values: string[], actual?: string) => values.length === 0 || (!!actual && values.includes(actual));
      return fits(item.trades, submission.trade ?? undefined) && fits(item.sectors, submission.sector ?? undefined) && fits(item.districts, submission.district ?? undefined);
    });
    const partnerOrgs = await Org.find({ _id: { $in: matches.map(item => item.partnerOrgId) }, type: { $in: ['sector_partner', 'funding_partner'] }, active: true }).select('_id type').lean();
    const allowed = new Map(await Promise.all((['sector_partner', 'funding_partner'] as const).map(async type =>
      [type, await sharingAllowed(submission.entrepreneurId, type)] as const)));
    const consentedOrgs = partnerOrgs.filter(org => allowed.get(org.type as 'sector_partner' | 'funding_partner'));
    if (partnerOrgs.length && !consentedOrgs.length) throw new HttpError(409, 'The applicant has not consented to sharing with these partner types.');
    const partnerIds = consentedOrgs.map(item => item._id);
    submission.shares = consentedOrgs.map(org => ({ orgId: org._id, partnerType: org.type === 'funding_partner' ? 'funding_partner' : 'sector_partner', active: true, contactAccepted: false })) as typeof submission.shares;
    await submission.save();
    await AuditEvent.create({ actorUserId: req.auth!.user.id, action: 'route', resourceType: 'Submission', resourceId: String(submission._id), metadata: { partnerCount: partnerIds.length } });
    res.json({ submissionId: String(submission._id), matchedRules: matches.length, partnerOrgIds: partnerIds.map(String) });
  });
  router.post('/hq/review-samples', platform, async (req, res) => {
    const limit = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) }).parse(req.body ?? {});
    const candidates = await Submission.collection.find({ score: { $exists: true } }, { projection: { _id: 1, score: 1 } }).sort({ _id: 1 }).toArray() as unknown as Array<{ _id: string; score: number }>;
    const selected = candidates.filter(item => parseInt(createHash('sha256').update(String(item._id)).digest('hex').slice(0, 8), 16) % 10 === 0).slice(0, limit.limit);
    const samples = await Promise.all(selected.map(item => ReviewSample.findOneAndUpdate({ submissionId: item._id }, { $setOnInsert: { submissionId: item._id, reason: 'deterministic_quality_sample' } }, { upsert: true, returnDocument: 'after' }).lean()));
    res.status(201).json({ samples });
  });
  router.post('/hq/review-samples/:id/override', platform, async (req, res) => {
    const input = override.parse(req.body);
    const sample = await ReviewSample.findOneAndUpdate({ submissionId: id.parse(req.params.id) }, { $set: { status: 'reviewed', reviewerUserId: req.auth!.user.id, override: { ...input, at: new Date() } } }, { returnDocument: 'after' }).lean();
    if (!sample) { res.status(404).json({ error: 'Review sample not found.' }); return; }
    await AuditEvent.create({ actorUserId: req.auth!.user.id, action: 'score_override', resourceType: 'Submission', resourceId: id.parse(req.params.id), metadata: input });
    res.json(sample);
  });
  router.get('/hq/clusters', platform, async (_req, res) => {
    const submissions = await Submission.collection.find({}, { projection: { _id: 1, title: 1, trade: 1, cohortId: 1 } }).limit(1000).toArray() as unknown as Array<{ _id: string; title: string; trade?: string; cohortId?: string }>;
    const points = submissions.map((item, index) => {
      const digest = createHash('sha256').update(String(item._id)).digest();
      return { item, x: digest.readUInt16BE(0) / 65535, y: digest.readUInt16BE(2) / 65535, words: words(item.title), index };
    });
    const output = await Promise.all(points.map(async point => {
      const nearest = points.filter(other => other.index !== point.index).sort((a, b) => similarity(point.words, b.words) - similarity(point.words, a.words))[0];
      const cluster = nearest && similarity(point.words, nearest.words) >= 0.25 ? clusterKey(nearest.item.title) : clusterKey(point.item.title);
      return ClusterPoint.findOneAndUpdate({ submissionId: point.item._id }, { $set: { x: point.x, y: point.y, cluster, method: 'deterministic-title-similarity' } }, { upsert: true, returnDocument: 'after' }).lean();
    }));
    res.json({ points: output });
  });
  router.get('/hq/fairness', platform, async (_req, res) => {
    const groups = await Submission.aggregate([
      { $match: { score: { $type: 'number' } } },
      { $facet: {
        language: [{ $group: { _id: '$language', count: { $sum: 1 }, average: { $avg: '$score' } } }],
        inputFormat: [{ $group: { _id: '$inputFormat', count: { $sum: 1 }, average: { $avg: '$score' } } }],
        gender: [{ $group: { _id: '$gender', count: { $sum: 1 }, average: { $avg: '$score' } } }],
        district: [{ $group: { _id: '$district', count: { $sum: 1 }, average: { $avg: '$score' } } }],
      } },
    ]);
    res.json({ groups: groups[0] ?? { language: [], inputFormat: [], gender: [], district: [] }, alertThreshold: 5 });
  });
  router.get('/hq/audit', platform, async (_req, res) => res.json({ events: await AuditEvent.find().sort({ createdAt: -1 }).limit(500).lean() }));
  router.get('/hq/evaluations', platform, async (_req, res) => res.json({ runs: await EvaluationRun.find().sort({ createdAt: -1 }).limit(100).lean() }));
  router.post('/hq/evaluations', platform, async (req, res) => res.status(201).json(await EvaluationRun.create(evaluation.parse(req.body))));
  router.get('/hq/stage-events/:submissionId', platform, async (req, res) => res.json({ events: await StageEvent.find({ submissionId: id.parse(req.params.submissionId) }).sort({ at: 1, _id: 1 }).lean() }));
  return router;
}
