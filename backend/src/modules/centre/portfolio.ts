import { Router } from 'express';
import { z } from 'zod';
import { buildPortfolio, PORTFOLIO_DOMAIN_KEYS, type PortfolioDomain, type PortfolioIdea } from '@pitchprism/contracts';
export { buildPortfolio, quantile } from '@pitchprism/contracts';
import { Cohort, Entrepreneur, Submission, Trade } from '../../models.js';
import { scoped, submissionScope } from '../../auth/authorization.js';
import { HttpError } from '../../errors.js';
import type { AuthContext } from '../../auth/session.js';
import { CentreCase } from './model.js';

// Reserved isolated workspace created only by the explicit development seed.
export const PORTFOLIO_DEMO_ORG = '7de000000000000000000001';
export const DOMAIN_KEYS = PORTFOLIO_DOMAIN_KEYS;
const querySchema = z.object({
  q: z.string().trim().max(120).optional(), cohortId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  tradeKey: z.string().max(80).optional(), language: z.string().max(12).optional(),
  state: z.enum(['READY', 'NEEDS_ATTENTION', 'PENDING_MODEL', 'UNASSESSABLE']).optional(),
  rubricVersion: z.string().min(1).max(100).optional(),
  sort: z.enum(['updated', 'potential', 'completeness']).default('updated'),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type PortfolioQuery = z.infer<typeof querySchema>;
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const label = (value: string) => value.replaceAll('_', ' ');
export async function portfolioRows(auth: AuthContext): Promise<PortfolioIdea[]> {
  if (!['centre_assessor', 'cohort_lead'].includes(auth.user.role) || !auth.user.orgId) throw new HttpError(403, 'Open a centre staff workspace to compare ideas.');
  const tenant = submissionScope(auth);
  const submissions = await Submission.find({}).setOptions({ tenant }).select('title status ownerOrgId entrepreneurId cohortId tradeKey location languages channel updatedAt').sort({ updatedAt: -1 }).limit(5001).lean();
  if (submissions.length > 5000) throw new HttpError(422, 'This centre exceeds the comparison limit of 5,000 ideas. Narrow this portfolio in a future reporting release.');
  const [cases, cohorts, trades, applicants] = await Promise.all([
    CentreCase.find({ ownerOrgId: auth.user.orgId, submissionId: { $in: submissions.map(row => row._id) } }).lean(),
    Cohort.find({ orgId: auth.user.orgId }).select('name').lean(), Trade.find({}).select('key label').lean(),
    Entrepreneur.find({ _id: { $in: submissions.map(row => row.entrepreneurId) } }).setOptions({ tenant: { homeOrgId: auth.user.orgId } }).select('district trade language').lean(),
  ]);
  const caseMap = new Map(cases.map(row => [String(row.submissionId), row])), cohortMap = new Map(cohorts.map(row => [String(row._id), row.name])),
    tradeMap = new Map(trades.map(row => [row.key, row.label])), applicantMap = new Map(applicants.map(row => [String(row._id), row]));
  return submissions.map(submission => {
    const item = caseMap.get(String(submission._id)), ev = item?.evaluation, applicant = applicantMap.get(String(submission.entrepreneurId));
    const potential = numeric(ev?.potential), coverage = numeric(ev?.coverage);
    const rubricVersion = typeof ev?.rubricVersion === 'string' ? ev.rubricVersion : null;
    const domains: PortfolioDomain[] = Array.isArray(ev?.domains) ? ev.domains.map((d: { key: string; score: unknown; confidence?: string }) => ({ key: d.key, score: numeric(d.score), confidence: d.confidence ?? 'none' })) : [];
    return { submissionId: String(submission._id), title: submission.title || 'Untitled idea', entrepreneurRef: `Applicant ${String(submission.entrepreneurId).slice(-6).toUpperCase()}`,
      cohortId: submission.cohortId ? String(submission.cohortId) : null, cohortName: cohortMap.get(String(submission.cohortId)) ?? 'Unassigned',
      tradeKey: submission.tradeKey ?? null, tradeLabel: tradeMap.get(submission.tradeKey ?? '') ?? applicant?.trade ?? label(submission.tradeKey ?? 'Unclassified'),
      district: submission.location?.district ?? applicant?.district ?? 'Not recorded', language: submission.languages?.[0] ?? applicant?.language ?? 'und', format: submission.channel === 'import' ? 'PDF' : submission.channel ?? 'app',
      state: item?.state ?? 'PENDING_MODEL', status: submission.status, updatedAt: (item?.updatedAt ?? submission.updatedAt ?? new Date(0)).toISOString(), reviewAvailable: !!item,
      rubricVersion, potential, completeness: numeric(ev?.completeness ?? item?.quality?.completeness), coverage, band: ev?.band ?? null, pathway: ev?.pathway ?? null, domains,
      flagCount: Array.isArray(ev?.flags ?? item?.quality?.flags) ? (ev?.flags ?? item?.quality?.flags).length : 0,
      rankEligible: potential !== null && coverage !== null && coverage >= 60 && !!rubricVersion && !['Insufficient information', 'Unassessable', 'Pending'].includes(ev?.band) && item?.state !== 'PENDING_MODEL' && item?.state !== 'UNASSESSABLE',
      tradeRank: null, cohortRank: null };
  });
}
export function portfolioRouter() {
  const router = Router();
  router.get('/portfolio', async (req, res) => {
    const query = querySchema.parse(req.query);
    const all = await portfolioRows(req.auth!);
    const result = buildPortfolio(all, query, req.auth!.user.orgId === PORTFOLIO_DEMO_ORG);
    if (query.rubricVersion && !result.versions.includes(query.rubricVersion)) throw new HttpError(400, 'Choose a rubric version present in this centre.');
    res.json(result);
  });
  router.get('/intake-options', async (req, res) => {
    if (!['centre_assessor', 'cohort_lead'].includes(req.auth!.user.role)) throw new HttpError(403, 'Centre staff only.');
    const [cohorts, trades] = await Promise.all([Cohort.find({ orgId: req.auth!.user.orgId, status: { $ne: 'closed' } }).select('name programmeId').lean(), Trade.find({ active: true }).select('key label').sort({ label: 1 }).lean()]);
    res.json({ cohorts: cohorts.map(row => ({ id: String(row._id), label: row.name })), trades: trades.map(row => ({ key: row.key, label: row.label })) });
  });
  return router;
}
