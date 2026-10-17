import { Router } from 'express';
import { z } from 'zod';
import type { CentreExtractedInput } from '@pitchprism/contracts';
import { HttpError } from '../../errors.js';
import { requirePermission, submissionScope } from '../../auth/authorization.js';
import { Submission } from '../../models.js';
import { CentreCase } from './model.js';
import { assessLocally, type AssessmentResult } from './runner.js';

const id = z.string().regex(/^[a-f\d]{24}$/i);
const segment = z.object({ segId: z.string().min(1).max(80), textEn: z.string().max(2000), textOriginal: z.string().max(2000).optional(),
  lang: z.string().max(12), confidence: z.number().min(0).max(1).optional(), struck: z.boolean().optional(),
  supersededBy: z.string().max(80).optional(),
  source: z.object({ type: z.enum(['pdf', 'text', 'profile', 'audio']), documentId: z.string().max(80).optional(),
    page: z.number().int().min(1).max(50).optional(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    chunkId: z.string().max(80).optional(), start: z.number().finite().nonnegative().optional(), end: z.number().finite().nonnegative().optional() }).strict(),
}).strict();
const field = z.object({ state: z.enum(['answered', 'missing', 'not_asked', 'irrelevant', 'unreadable']),
  evidence: z.array(z.string().min(1).max(80)).max(8) }).strict();
const inputSchema = z.object({ template: z.literal('edp-idea-brief'),
  context: z.object({ businessType: z.string().max(120).optional(), plannedBusinessLocation: z.object({
    village: z.string().max(120).optional(), district: z.string().min(1).max(120), state: z.string().min(1).max(120),
    pincode: z.string().regex(/^[1-9]\d{5}$/).optional(), source: z.enum(['profile', 'pdf', 'confirmed_by_user']).optional(),
    evidence: z.array(z.string().min(1).max(80)).min(1).max(3).optional(),
  }).strict() }).strict(),
  segments: z.array(segment).min(1).max(128),
  fields: z.record(z.string(), field),
  financials: z.record(z.string(), z.object({ value: z.number().finite().nonnegative(), segId: z.string() }).strict()).optional(),
}).strict();
const decisions = z.object({ decision: z.enum(['shortlist', 'not_yet', 'more_info']),
  reason: z.string().trim().max(1000).optional(), pathwayOverride: z.string().trim().max(100).optional(),
  bandOverride: z.enum(['Strong', 'Promising', 'Not yet', 'Insufficient information']).optional() }).strict();

function stateOf(result: AssessmentResult): string {
  if (result.status === 'pending_model') return 'PENDING_MODEL';
  if (result.evaluation?.band === 'Unassessable') return 'UNASSESSABLE';
  return result.evaluation?.needsAttention ? 'NEEDS_ATTENTION' : 'READY';
}

export function centreRouter(assess: (input: CentreExtractedInput) => Promise<AssessmentResult> = assessLocally) {
  const router = Router();
  router.use(requirePermission('review_centre'));

  router.get('/queue', async (req, res) => {
    const actor = req.auth!.user;
    const match = actor.role === 'hq_admin' ? {} : { ownerOrgId: actor.orgId };
    const cases = await CentreCase.find(match).sort({ updatedAt: -1 }).limit(100).lean();
    const submissions = await Submission.find({ _id: { $in: cases.map(item => item.submissionId) }, ...submissionScope(req.auth!) })
      .select('title status ownerOrgId').lean();
    const byId = new Map(submissions.map(item => [String(item._id), item]));
    res.json({ items: cases.filter(item => byId.has(String(item.submissionId))).map(item => ({
      submissionId: String(item.submissionId), title: byId.get(String(item.submissionId))!.title,
      state: item.state, status: byId.get(String(item.submissionId))!.status,
      potential: item.evaluation?.potential ?? null, completeness: item.evaluation?.completeness ?? item.quality?.completeness ?? null,
      band: item.evaluation?.band ?? null, updatedAt: item.updatedAt,
    })) });
  });

  router.post('/submissions/:id/assessment', async (req, res) => {
    const submissionId = id.parse(req.params.id);
    const submission = await Submission.findOne({ _id: submissionId, ...submissionScope(req.auth!) });
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const input = inputSchema.parse(req.body) as CentreExtractedInput;
    if (input.segments.some(segment => [segment.textEn, segment.textOriginal ?? ''].some(text =>
      /\b[^\s@]+@[^\s@]+\.[^\s@]+\b|(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)/.test(text))))
      throw new HttpError(422, 'Extracted text must be redacted before assessment.');
    // Rubric settings come from the server until Dev 3 mounts published rubric versions.
    let result: AssessmentResult;
    try { result = await assess(input); }
    catch { throw new HttpError(422, 'The local assessment could not validate or score this evidence.'); }
    const state = stateOf(result);
    const previous = await CentreCase.findOne({ submissionId });
    if (previous?.decision) throw new HttpError(409, 'A decided submission requires a versioned rescore.');
    const update = { $set: {
      ownerOrgId: submission.ownerOrgId, input, evaluation: result.evaluation ?? null,
      quality: result.quality ?? null, financialChecks: result.financialChecks ?? result.evaluation?.financialChecks ?? [],
      followUps: result.followUps ?? result.evaluation?.followUps ?? [], planDraft: result.planDraft ?? result.evaluation?.planDraft ?? null,
      state, reason: result.reason ?? null,
    }, ...(previous?.evaluation ? { $push: { evaluationHistory: { evaluation: previous.evaluation, archivedAt: new Date().toISOString() } } } : {}) };
    const record = await CentreCase.findOneAndUpdate({ submissionId }, update, { upsert: true, returnDocument: 'after', runValidators: true });
    if (result.status === 'assessed' && ['DRAFT', 'READY', 'UNASSESSABLE'].includes(submission.status)) {
      submission.status = state === 'UNASSESSABLE' ? 'UNASSESSABLE' : 'READY'; await submission.save();
    }
    res.status(previous ? 200 : 201).json({ submissionId, state: record!.state, evaluation: record!.evaluation,
      quality: record!.quality, financialChecks: record!.financialChecks, followUps: record!.followUps,
      planDraft: record!.planDraft, reason: record!.reason });
  });

  router.get('/submissions/:id/card', async (req, res) => {
    const submissionId = id.parse(req.params.id);
    const submission = await Submission.findOne({ _id: submissionId, ...submissionScope(req.auth!) }).lean();
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const item = await CentreCase.findOne({ submissionId, ownerOrgId: submission.ownerOrgId }).lean();
    if (!item) throw new HttpError(404, 'Assessment has not started.');
    res.json({ submissionId, title: submission.title, status: submission.status, state: item.state,
      input: item.input, evaluation: item.evaluation, quality: item.quality, financialChecks: item.financialChecks,
      followUps: item.followUps, planDraft: item.planDraft,
      reason: item.reason, decision: item.decision ?? null, feedback: item.feedback ?? null,
      previousEvaluations: item.evaluationHistory?.length ?? 0 });
  });

  router.post('/submissions/:id/decision', async (req, res) => {
    const submissionId = id.parse(req.params.id);
    const input = decisions.parse(req.body);
    const submission = await Submission.findOne({ _id: submissionId, ...submissionScope(req.auth!) });
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const item = await CentreCase.findOne({ submissionId, ownerOrgId: submission.ownerOrgId });
    if (!item || !item.evaluation || item.state === 'PENDING_MODEL' || item.state === 'UNASSESSABLE')
      throw new HttpError(409, 'A valid assessment is required before deciding.');
    if (item.decision) throw new HttpError(409, 'This submission has already been decided.');
    const suggestion = item.evaluation.pathway;
    const override = input.pathwayOverride && input.pathwayOverride !== suggestion;
    const bandOverride = input.bandOverride && input.bandOverride !== item.evaluation.band;
    if ((override || bandOverride) && (!input.reason || input.reason.length < 10)) throw new HttpError(400, 'Explain the band or pathway override.');
    if (input.decision === 'shortlist' && ['Not yet', 'Insufficient information'].includes(item.evaluation.band)
        && (!input.reason || input.reason.length < 10)) throw new HttpError(400, 'Explain the shortlist override.');
    item.decision = { ...input, actorId: req.auth!.user.id, at: new Date().toISOString(),
      suggestedPathway: suggestion, suggestedBand: item.evaluation.band };
    await item.save();
    submission.status = input.decision === 'shortlist' ? 'SHORTLISTED' : input.decision === 'not_yet' ? 'NOT_YET' : 'MORE_INFO';
    await submission.save();
    res.json({ decision: item.decision, status: submission.status });
  });

  router.put('/submissions/:id/feedback', async (req, res) => {
    const submissionId = id.parse(req.params.id);
    const { textEn } = z.object({ textEn: z.string().trim().min(10).max(4000) }).strict().parse(req.body);
    const submission = await Submission.findOne({ _id: submissionId, ...submissionScope(req.auth!) }).lean();
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const item = await CentreCase.findOne({ submissionId, ownerOrgId: submission.ownerOrgId });
    if (!item) throw new HttpError(404, 'Assessment has not started.');
    item.feedback = { textEn, status: 'awaiting_translation_and_delivery', editedBy: req.auth!.user.id, editedAt: new Date().toISOString() };
    await item.save();
    res.json({ feedback: item.feedback });
  });

  return router;
}
