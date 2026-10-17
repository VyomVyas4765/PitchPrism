import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { Types, type PipelineStage } from 'mongoose';
import { z } from 'zod';
import { requirePermission } from '../../auth/authorization.js';
import { HttpError } from '../../errors.js';
import { AuditLog, Cohort, Decision, EvalRun, Job, Org, Outcome, PipelineRun, ReviewSample, Submission, User } from '../../models.js';
import { recordAudit } from '../../platform/audit.js';
import { objectId } from '../../platform/validation.js';
import { CentreCase } from '../centre/model.js';
import { layout } from './idea-map.js';

// HQ reporting (W-03 pipeline, W-05 funnel, W-06 sampling, W-07 fairness, W-08 audit, W-33 model quality,
// A-29 pipeline health). HQ reads across organisations, so tenant queries are explicitly unscoped ({}).
// Reports show titles, statuses and numbers only: never applicant names, contacts or answers.
const ALL = { tenant: {} } as const;
const DAY = 86_400_000;
const since = (days: number) => new Date(Date.now() - days * DAY);
const oid = (value: string) => new Types.ObjectId(value);
const pct = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 10 : null;
const round = (value: number | null | undefined, digits = 1) => value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
function quantile(sorted: number[], q: number) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  return Math.round(sorted[low]! + (sorted[Math.ceil(index)]! - sorted[low]!) * (index - low));
}
async function names(model: typeof Org | typeof Cohort | typeof User, ids: unknown[], field = 'name') {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const rows = unique.length ? await (model as typeof Org).find({ _id: { $in: unique } }).select(field).lean() : [];
  return Object.fromEntries(rows.map(row => [String(row._id), (row as unknown as Record<string, string>)[field]!]));
}

/**
 * The latest assessment per submission. Prefers the shared evaluations collection and falls back to Dev 2's
 * centrecases card, so HQ views fill in whichever the centre pipeline writes.
 */
const latestAssessment: PipelineStage[] = [
  { $lookup: { from: 'evaluations', let: { id: '$_id' }, as: 'evaluation', pipeline: [
    { $match: { $expr: { $eq: ['$submissionId', '$$id'] } } }, { $sort: { createdAt: -1 } }, { $limit: 1 },
    { $project: { potential: 1, completeness: 1, band: 1, pathway: 1, rubricKey: 1, rubricVersion: 1, needsAttention: 1 } }] } },
  { $lookup: { from: 'centrecases', let: { id: '$_id' }, as: 'centreCase', pipeline: [
    { $match: { $expr: { $eq: ['$submissionId', '$$id'] } } }, { $limit: 1 },
    { $project: { potential: '$evaluation.potential', completeness: '$evaluation.completeness', band: '$evaluation.band', pathway: '$evaluation.pathway',
      rubricVersion: '$evaluation.rubricVersion', needsAttention: '$evaluation.needsAttention' } }] } },
  { $addFields: { assessment: { $ifNull: [{ $first: '$evaluation' }, { $first: '$centreCase' }] } } },
  { $project: { evaluation: 0, centreCase: 0 } },
];

const reportPath = () => process.env.EVAL_REPORT_PATH ?? new URL('../../../../datasets/reports/centre-evaluation.json', import.meta.url);
const ratio = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 1 ? value : undefined;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : value == null ? undefined : String(value).slice(0, max);

/** Record the harness report as an EvalRun if it is new. Unreadable or malformed reports are skipped, never stored in part. */
export async function recordEvalReport() {
  let raw: string;
  try { raw = await readFile(reportPath(), 'utf8'); } catch { return null; }
  const reportSha256 = createHash('sha256').update(raw).digest('hex');
  if (await EvalRun.exists({ reportSha256 })) return null;
  let report: Record<string, any>;
  try { report = JSON.parse(raw); } catch { return null; }
  if (!report || typeof report !== 'object') return null;
  const files: Array<Record<string, any>> = Array.isArray(report.files) ? report.files : [];
  const durations = files.map(file => file.durationMs).filter((value): value is number => Number.isInteger(value) && value >= 0).sort((a, b) => a - b);
  const runAt = new Date(report.runAt);
  const run = {
    reportSha256, runAt: Number.isNaN(runAt.getTime()) ? new Date() : runAt, manifestVersion: text(report.manifestVersion, 40),
    rubricVersion: text(report.rubricVersion, 40), promptVersion: text(report.promptVersion, 40),
    models: Array.isArray(report.models) ? report.models.filter((model: unknown) => typeof model === 'string').map((model: string) => model.slice(0, 120)) : [],
    total: Number(report.total) || files.length, assessed: Number(report.assessed) || 0, missingExtraction: Number(report.missingExtraction) || 0,
    failed: Number(report.failed) || 0, complete: !!report.complete,
    fieldStateAccuracy: ratio(report.fieldStateAccuracy), canonicalValueAccuracy: ratio(report.canonicalValueAccuracy), flagRecall: ratio(report.flagRecall),
    ...(durations.length ? { durationP50Ms: quantile(durations, 0.5)!, durationP95Ms: quantile(durations, 0.95)!, computeSeconds: durations.reduce((sum, value) => sum + value, 0) / 1000 } : {}),
    parity: Object.entries(report.parity ?? {}).map(([group, value]) => ({ group: group.slice(0, 80), count: Number((value as any)?.count) || 0,
      gap: Math.abs(Number((value as any)?.gap) || 0), pass: !!(value as any)?.pass })),
    perFile: files.slice(0, 500).map(file => ({ id: String(file.id).slice(0, 80), status: ['assessed', 'missing_extraction', 'failed'].includes(file.status) ? file.status : 'failed',
      ...(typeof file.band === 'string' ? { band: file.band.slice(0, 40) } : {}), ...(typeof file.potential === 'number' ? { potential: file.potential } : {}),
      ...(Number.isInteger(file.durationMs) && file.durationMs >= 0 ? { durationMs: file.durationMs } : {}),
      ...(Array.isArray(file.fieldChecks) ? { fieldChecks: file.fieldChecks.length, fieldChecksCorrect: file.fieldChecks.filter((check: { correct?: boolean }) => check?.correct).length } : {}) })),
  };
  try {
    return await EvalRun.create(Object.fromEntries(Object.entries(run).filter(([, value]) => value !== undefined)));
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return null; // recorded by a concurrent request
    console.warn('model-quality: report not recorded', error instanceof Error ? error.name : 'UnknownError');
    return null;
  }
}

export function hqReportsRouter() {
  const router = Router();
  const analytics = requirePermission('view_all_analytics');

  // ---- W-03 cross-organisation pipeline with filters
  router.get('/pipeline', analytics, async (req, res) => {
    const query = z.object({
      orgId: objectId.optional(), cohortId: objectId.optional(), programmeId: objectId.optional(), status: z.string().regex(/^[A-Z_]{2,20}$/).optional(),
      tradeKey: z.string().regex(/^[a-z0-9_]{2,60}$/).optional(), band: z.enum(['strong', 'promising', 'not_yet', 'insufficient', 'unassessed']).optional(),
      language: z.enum(['hi', 'mr', 'te', 'or', 'bn', 'en']).optional(), channel: z.string().regex(/^[a-z_]{2,20}$/).optional(),
      after: objectId.optional(), limit: z.coerce.number().int().min(1).max(100).default(25),
    }).strict().parse(req.query);
    const match: Record<string, unknown> = {
      ...(query.orgId ? { ownerOrgId: oid(query.orgId) } : {}), ...(query.cohortId ? { cohortId: oid(query.cohortId) } : {}),
      ...(query.programmeId ? { programmeId: oid(query.programmeId) } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.tradeKey ? { tradeKey: query.tradeKey } : {}), ...(query.language ? { languages: query.language } : {}),
      ...(query.channel ? { channel: query.channel } : {}), ...(query.after ? { _id: { $lt: oid(query.after) } } : {}),
    };
    const bandMatch = query.band === 'unassessed' ? { assessment: null } : query.band ? { 'assessment.band': query.band } : null;
    const rows = await Submission.aggregate<Record<string, any>>([
      { $match: match }, { $sort: { _id: -1 } },
      ...(bandMatch ? [] : [{ $limit: query.limit + 1 }]),
      { $project: { title: 1, status: 1, ownerOrgId: 1, cohortId: 1, tradeKey: 1, languages: 1, channel: 1, createdAt: 1, updatedAt: 1 } },
      ...latestAssessment,
      ...(bandMatch ? [{ $match: bandMatch }, { $limit: query.limit + 1 }] : []),
    ]).option(ALL as never);
    const page = rows.slice(0, query.limit);
    const [orgs, cohorts] = await Promise.all([names(Org, page.map(row => row.ownerOrgId)), names(Cohort, page.map(row => row.cohortId))]);
    const total = await Submission.countDocuments(Object.fromEntries(Object.entries(match).filter(([key]) => key !== '_id'))).setOptions(ALL);
    res.json({
      total: query.band ? null : total, nextCursor: rows.length > query.limit ? String(page.at(-1)!._id) : null,
      items: page.map(row => ({
        id: String(row._id), title: row.title ?? 'Untitled idea', status: row.status, centre: orgs[String(row.ownerOrgId)] ?? null,
        cohort: cohorts[String(row.cohortId)] ?? null, tradeKey: row.tradeKey ?? null, languages: row.languages ?? [], channel: row.channel ?? null,
        potential: round(row.assessment?.potential), completeness: round(row.assessment?.completeness), band: row.assessment?.band ?? null,
        pathway: row.assessment?.pathway ?? null, needsAttention: !!row.assessment?.needsAttention, updatedAt: row.updatedAt ?? row.createdAt ?? null,
      })),
    });
  });

  // ---- W-05 funnel by centre or cohort
  router.get('/funnel', analytics, async (req, res) => {
    const { groupBy, days } = z.object({ groupBy: z.enum(['centre', 'cohort']).default('centre'), days: z.coerce.number().int().min(1).max(730).default(365) }).strict().parse(req.query);
    const key = groupBy === 'centre' ? '$ownerOrgId' : '$cohortId';
    const has = (statuses: string[]) => ({ $sum: { $cond: [{ $in: ['$status', statuses] }, 1, 0] } });
    const [groups, outcomes] = await Promise.all([
      Submission.aggregate<Record<string, any>>([
        { $match: { createdAt: { $gte: since(days) } } },
        { $group: { _id: key, received: { $sum: 1 },
          submitted: { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 0, 1] } },
          assessed: has(['READY', 'NEEDS_INPUT', 'UNASSESSABLE', 'IN_REVIEW', 'SHORTLISTED', 'NOT_YET', 'MORE_INFO', 'SHARED']),
          decided: has(['SHORTLISTED', 'NOT_YET', 'MORE_INFO', 'SHARED']), shortlisted: has(['SHORTLISTED', 'SHARED']), shared: has(['SHARED']),
          unassessable: has(['UNASSESSABLE']), failed: has(['FAILED']) } },
      ]).option(ALL as never),
      Outcome.aggregate<{ _id: { group: unknown; stage: string }; count: number }>([
        { $lookup: { from: 'submissions', localField: 'submissionId', foreignField: '_id', as: 'submission', pipeline: [{ $project: { cohortId: 1, createdAt: 1 } }] } },
        { $unwind: '$submission' }, { $match: { 'submission.createdAt': { $gte: since(days) } } },
        { $group: { _id: { group: groupBy === 'centre' ? '$ownerOrgId' : '$submission.cohortId', stage: '$stage', submission: '$submissionId' } } },
        { $group: { _id: { group: '$_id.group', stage: '$_id.stage' }, count: { $sum: 1 } } },
      ]).option(ALL as never),
    ]);
    const label = groupBy === 'centre' ? await names(Org, groups.map(group => group._id)) : await names(Cohort, groups.map(group => group._id));
    const outcomeFor = (group: unknown) => Object.fromEntries(outcomes.filter(row => String(row._id.group) === String(group)).map(row => [row._id.stage, row.count]));
    const rows = groups.map(group => ({ id: group._id ? String(group._id) : null, name: group._id ? label[String(group._id)] ?? 'Unknown' : 'No cohort',
      received: group.received, submitted: group.submitted, assessed: group.assessed, decided: group.decided, shortlisted: group.shortlisted, shared: group.shared,
      unassessable: group.unassessable, failed: group.failed, outcomes: outcomeFor(group._id) })).sort((a, b) => b.received - a.received);
    const sum = (field: 'received' | 'submitted' | 'assessed' | 'decided' | 'shortlisted' | 'shared') => rows.reduce((total, row) => total + row[field], 0);
    const totals = { received: sum('received'), submitted: sum('submitted'), assessed: sum('assessed'), decided: sum('decided'), shortlisted: sum('shortlisted'), shared: sum('shared') };
    res.json({ groupBy, days, totals, conversion: { assessed: pct(totals.assessed, totals.submitted), shortlisted: pct(totals.shortlisted, totals.decided) }, groups: rows });
  });

  // ---- A-29 pipeline health: queue, stage timings, failures and model use
  router.get('/pipeline-health', analytics, async (req, res) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).strict().parse(req.query);
    const from = since(days);
    const [byStatus, oldest, stuck, failures, runs, jobs] = await Promise.all([
      Job.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]).option(ALL as never),
      Job.findOne({ status: 'queued' }).setOptions(ALL).sort({ createdAt: 1 }).select('createdAt').lean(),
      Job.countDocuments({ status: 'leased', leaseUntil: { $lt: new Date() } }).setOptions(ALL),
      Job.find({ status: 'failed', finishedAt: { $gte: from } }).setOptions(ALL).sort({ finishedAt: -1 }).limit(10).select('submissionId ownerOrgId error attempts finishedAt').lean(),
      PipelineRun.find({ startedAt: { $gte: from } }).setOptions(ALL).sort({ startedAt: -1 }).limit(20_000).select('stage status ms model provider llmCalls tokensIn tokensOut hostedCostInr').lean(),
      Job.find({ status: 'done', finishedAt: { $gte: from } }).setOptions(ALL).select('createdAt finishedAt fromStage').limit(5_000).lean(),
    ]);
    const stages = new Map<string, { runs: number; failed: number; skipped: number; ms: number[] }>();
    const models = new Map<string, { calls: number; tokensIn: number; tokensOut: number }>();
    let hostedCostInr = 0;
    for (const run of runs) {
      const stage = stages.get(run.stage) ?? { runs: 0, failed: 0, skipped: 0, ms: [] };
      stage.runs++; if (run.status === 'failed') stage.failed++; if (run.status === 'skipped') stage.skipped++;
      if (run.status === 'done' && typeof run.ms === 'number') stage.ms.push(run.ms);
      stages.set(run.stage, stage);
      if (run.model) {
        const model = models.get(`${run.provider ?? 'local'} · ${run.model}`) ?? { calls: 0, tokensIn: 0, tokensOut: 0 };
        model.calls += run.llmCalls ?? 0; model.tokensIn += run.tokensIn ?? 0; model.tokensOut += run.tokensOut ?? 0;
        models.set(`${run.provider ?? 'local'} · ${run.model}`, model);
      }
      hostedCostInr += run.hostedCostInr ?? 0;
    }
    const cardMs = jobs.filter(job => job.fromStage === 'ingest' && job.createdAt && job.finishedAt).map(job => job.finishedAt!.getTime() - job.createdAt!.getTime()).sort((a, b) => a - b);
    const orgs = await names(Org, failures.map(job => job.ownerOrgId));
    res.json({
      days, queue: Object.fromEntries(byStatus.map(row => [row._id, row.count])), oldestQueuedSeconds: oldest?.createdAt ? Math.round((Date.now() - oldest.createdAt.getTime()) / 1000) : null,
      expiredLeases: stuck, hostedCostInr,
      timeToCard: { jobs: cardMs.length, p50Ms: quantile(cardMs, 0.5), p95Ms: quantile(cardMs, 0.95) },
      stages: [...stages.entries()].map(([stage, value]) => { const sorted = value.ms.sort((a, b) => a - b);
        return { stage, runs: value.runs, failed: value.failed, skipped: value.skipped, failureRate: pct(value.failed, value.runs), p50Ms: quantile(sorted, 0.5), p95Ms: quantile(sorted, 0.95) }; }),
      models: [...models.entries()].map(([model, value]) => ({ model, ...value })),
      recentFailures: failures.map(job => ({ jobId: String(job._id), submissionId: String(job.submissionId), centre: orgs[String(job.ownerOrgId)] ?? null,
        code: job.error?.code ?? 'unknown', stage: job.error?.stage ?? null, message: job.error?.message ?? '', attempts: job.attempts, at: job.finishedAt })),
    });
  });

  // ---- W-07 fairness monitor: score distributions by language, channel and district (never caste or gender)
  router.get('/fairness', analytics, async (req, res) => {
    const { days, minGroup } = z.object({ days: z.coerce.number().int().min(7).max(730).default(180), minGroup: z.coerce.number().int().min(2).max(100).default(5) }).strict().parse(req.query);
    const rows = await Submission.aggregate<{ language: string | null; channel: string | null; district: string | null; potential: number | null; band: string | null; status: string }>([
      { $match: { createdAt: { $gte: since(days) } } },
      { $project: { status: 1, language: { $first: '$languages' }, channel: 1, district: '$location.district' } },
      ...latestAssessment,
      { $match: { 'assessment.potential': { $type: 'number' } } },
      { $project: { _id: 0, status: 1, language: 1, channel: 1, district: 1, potential: '$assessment.potential', band: '$assessment.band' } },
    ]).option(ALL as never);
    const dimension = (key: 'language' | 'channel' | 'district') => {
      const groups = new Map<string, typeof rows>();
      for (const row of rows) { const value = row[key] ?? 'unknown'; groups.set(value, [...(groups.get(value) ?? []), row]); }
      const stats = [...groups.entries()].map(([value, members]) => {
        const mean = members.reduce((sum, row) => sum + (row.potential ?? 0), 0) / members.length;
        return { value, n: members.length, enough: members.length >= minGroup, meanPotential: round(mean),
          strongOrPromising: pct(members.filter(row => row.band === 'strong' || row.band === 'promising').length, members.length),
          shortlisted: pct(members.filter(row => row.status === 'SHORTLISTED' || row.status === 'SHARED').length, members.length) };
      }).sort((a, b) => b.n - a.n);
      const comparable = stats.filter(stat => stat.enough);
      const gap = comparable.length >= 2 ? round(Math.max(...comparable.map(stat => stat.meanPotential!)) - Math.min(...comparable.map(stat => stat.meanPotential!))) : null;
      // PRD parity target: the same idea scores within 5 points across languages and formats.
      return { key, groups: stats, gap, check: gap != null && gap > 5 };
    };
    res.json({ days, minGroup, assessed: rows.length, dimensions: [dimension('language'), dimension('channel'), dimension('district')],
      note: 'Differences in averages can reflect real differences between cohorts. A flagged gap is a prompt to read samples, not proof of bias.' });
  });

  // ---- W-06 second-review sampling: a stable sample of each centre's recent decisions
  router.get('/sampling', analytics, async (req, res) => {
    const { percent, days, orgId } = z.object({ percent: z.coerce.number().int().min(1).max(100).default(10), days: z.coerce.number().int().min(1).max(365).default(30),
      orgId: objectId.optional() }).strict().parse(req.query);
    const decisions = await Decision.find({ createdAt: { $gte: since(days) }, ...(orgId ? { ownerOrgId: orgId } : {}) }).setOptions(ALL)
      .sort({ createdAt: -1 }).limit(5_000).select('submissionId ownerOrgId decision pathway overrideReason createdAt').lean();
    // Stable within a week so HQ's list does not reshuffle on every reload; at least one per centre with decisions.
    const week = Math.floor(Date.now() / (7 * DAY));
    const score = (id: unknown) => parseInt(createHash('sha256').update(`${id}:${week}`).digest('hex').slice(0, 8), 16) % 10_000 / 100;
    const byCentre = new Map<string, typeof decisions>();
    for (const decision of decisions) byCentre.set(String(decision.ownerOrgId), [...(byCentre.get(String(decision.ownerOrgId)) ?? []), decision]);
    const sample = [...byCentre.values()].flatMap(list => {
      const ranked = [...list].sort((a, b) => score(a._id) - score(b._id));
      const picked = ranked.filter(decision => score(decision._id) < percent);
      return picked.length ? picked : ranked.slice(0, 1);
    });
    const [verdicts, submissions, orgs] = await Promise.all([
      ReviewSample.find({ decisionId: { $in: sample.map(decision => decision._id) } }).setOptions(ALL).lean(),
      Submission.find({ _id: { $in: sample.map(decision => decision.submissionId) } }).setOptions(ALL).select('title status').lean(),
      names(Org, [...byCentre.keys()]),
    ]);
    const allVerdicts = await ReviewSample.aggregate<{ _id: unknown; reviewed: number; agreed: number }>([
      { $match: { createdAt: { $gte: since(days) } } }, { $group: { _id: '$ownerOrgId', reviewed: { $sum: 1 }, agreed: { $sum: { $cond: ['$agrees', 1, 0] } } } }]).option(ALL as never);
    const titles = Object.fromEntries(submissions.map(item => [String(item._id), item.title ?? 'Untitled idea']));
    const verdictFor = Object.fromEntries(verdicts.map(item => [String(item.decisionId), item]));
    res.json({ percent, days, decisions: decisions.length,
      agreement: [...byCentre.keys()].map(id => { const row = allVerdicts.find(item => String(item._id) === id);
        return { centreId: id, centre: orgs[id] ?? 'Unknown', decisions: byCentre.get(id)!.length, reviewed: row?.reviewed ?? 0, agreementRate: pct(row?.agreed ?? 0, row?.reviewed ?? 0) }; }),
      sample: sample.map(decision => { const verdict = verdictFor[String(decision._id)];
        return { decisionId: String(decision._id), submissionId: String(decision.submissionId), title: titles[String(decision.submissionId)] ?? 'Untitled idea',
          centre: orgs[String(decision.ownerOrgId)] ?? null, decision: decision.decision, pathway: decision.pathway ?? null, overridden: !!decision.overrideReason,
          decidedAt: decision.createdAt, verdict: verdict ? { agrees: verdict.agrees, suggestedDecision: verdict.suggestedDecision ?? null, note: verdict.note ?? null } : null }; }) });
  });
  router.put('/sampling/:decisionId', analytics, async (req, res) => {
    const decisionId = objectId.parse(req.params.decisionId);
    const input = z.object({ agrees: z.boolean(), suggestedDecision: z.enum(['shortlist', 'not_yet', 'more_info']).optional(), note: z.string().trim().max(400).optional() }).strict().parse(req.body);
    if (!input.agrees && !input.suggestedDecision) throw new HttpError(400, 'Say which decision you would have made.');
    const decision = await Decision.findOne({ _id: decisionId }).setOptions(ALL).lean();
    if (!decision) throw new HttpError(404, 'Decision not found.');
    const verdict = await ReviewSample.findOneAndUpdate({ decisionId }, {
      $set: { agrees: input.agrees, reviewerUserId: req.auth!.user.id, ...(input.note ? { note: input.note } : {}), ...(input.suggestedDecision && !input.agrees ? { suggestedDecision: input.suggestedDecision } : {}) },
      $setOnInsert: { decisionId, submissionId: decision.submissionId, ownerOrgId: decision.ownerOrgId },
      ...(input.agrees ? { $unset: { suggestedDecision: 1 } } : {}),
    }, { upsert: true, returnDocument: 'after', runValidators: true }).setOptions(ALL).lean();
    await recordAudit(req.auth, 'decision.second_review', { type: 'decision', id: decisionId, orgId: String(decision.ownerOrgId) }, { agrees: input.agrees });
    res.json({ verdict: { agrees: verdict!.agrees, suggestedDecision: verdict!.suggestedDecision ?? null, note: verdict!.note ?? null } });
  });

  // ---- W-08 audit log viewer (append-only; read only here)
  router.get('/audit', requirePermission('view_audit_log'), async (req, res) => {
    const query = z.object({ action: z.string().regex(/^[a-z_]+(\.[a-z_]+)?$/).optional(), outcome: z.enum(['allowed', 'denied']).optional(),
      actorUserId: objectId.optional(), orgId: objectId.optional(), before: objectId.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).strict().parse(req.query);
    const filter: Record<string, unknown> = {
      ...(query.action ? { action: query.action.includes('.') ? query.action : { $regex: `^${query.action}\\.` } } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}), ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.orgId ? { $or: [{ orgId: query.orgId }, { targetOrgId: query.orgId }] } : {}), ...(query.before ? { _id: { $lt: oid(query.before) } } : {}),
    };
    const rows = await AuditLog.find(filter).sort({ _id: -1 }).limit(query.limit + 1).lean();
    const page = rows.slice(0, query.limit);
    const [actors, orgs] = await Promise.all([names(User, page.map(row => row.actorUserId), 'displayName'), names(Org, page.flatMap(row => [row.orgId, row.targetOrgId]))]);
    res.json({ nextCursor: rows.length > query.limit ? String(page.at(-1)!._id) : null,
      entries: page.map(row => ({ id: String(row._id), at: row.at, action: row.action, outcome: row.outcome, actor: row.actorUserId ? actors[String(row.actorUserId)] ?? 'Removed user' : 'System',
        actorRole: row.actorRole ?? null, actorOrg: row.orgId ? orgs[String(row.orgId)] ?? null : null, targetType: row.targetType, targetId: row.targetId ?? null,
        targetOrg: row.targetOrgId ? orgs[String(row.targetOrgId)] ?? null : null, meta: row.meta ?? {} })) });
  });

  // ---- W-27 idea map: ideas placed by similarity of their fingerprint (trade, offering, customers), with named
  // clusters and saturation alerts where one district already has several similar ideas.
  router.get('/idea-map', analytics, async (req, res) => {
    const query = z.object({ orgId: objectId.optional(), cohortId: objectId.optional(), saturation: z.coerce.number().int().min(2).max(50).default(3) }).strict().parse(req.query);
    const LIMIT = 3000;
    const submissions = await Submission.find({ ...(query.orgId ? { ownerOrgId: query.orgId } : {}), ...(query.cohortId ? { cohortId: query.cohortId } : {}), status: { $ne: 'DRAFT' } })
      .setOptions(ALL).sort({ _id: -1 }).limit(LIMIT + 1).select('title summaryEn tradeKey sector cohortId ownerOrgId location status').lean();
    const page = submissions.slice(0, LIMIT);
    const cases = await CentreCase.find({ submissionId: { $in: page.map(item => item._id) } }).select('submissionId input').lean();
    const caseFor = new Map(cases.map(item => [String(item.submissionId), item.input as { segments?: Array<{ segId: string; textEn?: string }>;
      fields?: Record<string, { state?: string; evidence?: string[] }>; context?: { businessType?: string; plannedBusinessLocation?: { district?: string } } } | undefined]));
    const evidenceText = (input: ReturnType<typeof caseFor.get>, field: string) => {
      const ids = new Set(input?.fields?.[field]?.state === 'answered' ? input.fields[field]!.evidence ?? [] : []);
      return (input?.segments ?? []).filter(segment => ids.has(segment.segId)).map(segment => segment.textEn ?? '').join(' ');
    };
    const ideas = page.map(item => {
      const input = caseFor.get(String(item._id));
      const district = input?.context?.plannedBusinessLocation?.district ?? (item.location as { district?: string } | undefined)?.district ?? null;
      const text = [item.title, item.summaryEn, item.tradeKey?.replaceAll('_', ' '), item.sector, input?.context?.businessType,
        evidenceText(input, 'offering'), evidenceText(input, 'customers')].filter(Boolean).join(' ');
      return { item, district, text };
    });
    const { points, clusters } = layout(ideas.map(idea => ({ id: String(idea.item._id), text: idea.text })));
    const [orgs, cohorts] = await Promise.all([names(Org, page.map(item => item.ownerOrgId)), names(Cohort, page.map(item => item.cohortId))]);
    const alerts = clusters.flatMap(group => {
      const byDistrict = new Map<string, number>();
      points.forEach((point, i) => { const district = ideas[i]!.district; if (point.cluster === group.id && district) byDistrict.set(district, (byDistrict.get(district) ?? 0) + 1); });
      return [...byDistrict.entries()].filter(([, count]) => count >= query.saturation)
        .map(([district, count]) => ({ cluster: group.id, label: group.label, district, count }));
    }).sort((a, b) => b.count - a.count);
    res.json({ method: 'lexical', note: 'Placed by words the ideas share (trade, offering, customers), not by meaning. Semantic embeddings (A-19) will replace this when available.',
      total: page.length, truncated: submissions.length > LIMIT, clusters, alerts,
      points: points.map((point, i) => { const { item, district } = ideas[i]!;
        return { ...point, title: item.title ?? 'Untitled idea', status: item.status, tradeKey: item.tradeKey ?? null, district,
          centre: orgs[String(item.ownerOrgId)] ?? null, cohort: item.cohortId ? cohorts[String(item.cohortId)] ?? null : null }; }) });
  });

  // ---- W-33 model quality: evaluation-harness runs (ai/eval/harness.py). A new report file is recorded once as an
  // EvalRun (keyed by its SHA-256), so the page shows the latest run and its history even after the file changes.
  router.get('/model-quality', analytics, async (_req, res) => {
    await recordEvalReport();
    const runs = await EvalRun.find().sort({ runAt: -1 }).limit(20).select('-perFile').lean();
    if (!runs.length) { res.json({ available: false, message: 'The evaluation harness has not been run on this machine yet (ai/eval/harness.py).' }); return; }
    const latest = await EvalRun.findById(runs[0]!._id).lean();
    const view = (run: typeof runs[number]) => ({ id: String(run._id), runAt: run.runAt, manifestVersion: run.manifestVersion ?? null, rubricVersion: run.rubricVersion ?? null,
      promptVersion: run.promptVersion ?? null, models: run.models ?? [], complete: run.complete, total: run.total, assessed: run.assessed,
      missingExtraction: run.missingExtraction ?? 0, failed: run.failed ?? 0, fieldStateAccuracy: run.fieldStateAccuracy ?? null,
      canonicalValueAccuracy: run.canonicalValueAccuracy ?? null, flagRecall: run.flagRecall ?? null, parity: run.parity ?? [],
      durationMs: { p50: run.durationP50Ms ?? null, p95: run.durationP95Ms ?? null }, computeSeconds: run.computeSeconds ?? null, hostedCostInr: 0 });
    const files = latest!.perFile ?? [];
    const bands = files.reduce<Record<string, number>>((counts, file) => { if (file.band) counts[file.band] = (counts[file.band] ?? 0) + 1; return counts; }, {});
    res.json({ available: true, ...view(runs[0]!), history: runs.map(view),
      files: { assessed: files.filter(file => file.status === 'assessed').length, missingExtraction: files.filter(file => file.status === 'missing_extraction').length,
        failed: files.filter(file => file.status === 'failed').length, bands: Object.entries(bands).map(([band, count]) => ({ band, count })) } });
  });
  return router;
}
