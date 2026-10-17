import { Router, type Request, type RequestHandler } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requirePermission, submissionScope } from '../../auth/authorization.js';
import type { AuthContext } from '../../auth/session.js';
import { HttpError } from '../../errors.js';
import { ReviewSession, Submission } from '../../models.js';
import { recordAudit } from '../../platform/audit.js';
import { enqueueJob } from '../../platform/jobs.js';
import { objectId } from '../../platform/validation.js';
import { storeOriginal } from './storage.js';

// D-33 pitch review: the entrepreneur (or their facilitator) answers the AI's follow-up questions; centre staff read
// the transcript. Answers are private originals; the worker (ai/worker.py) merges them and reviews the pitch again.
const answerInput = z.object({
  answers: z.array(z.object({ qId: z.string().regex(/^f\d{1,3}$/), text: z.string().trim().min(1).max(2000) }).strict()).min(1).max(10),
}).strict();
type Question = { qId: string; field: string; round: number; questionEn: string; reason?: string; status: string; answerText?: string };

async function load(auth: AuthContext, id: string) {
  const submission = await Submission.findOne({ _id: id }).setOptions({ tenant: submissionScope(auth) }).lean();
  if (!submission) throw new HttpError(404, 'Submission not found.');
  const review = await ReviewSession.findOne({}).setOptions({ tenant: { submissionId: submission._id } }).lean();
  return { submission, review };
}

function view(submission: { status: string }, review: { status: string; round: number; questions?: Question[]; inbox?: Array<{ qId: string }> } | null) {
  const received = new Set((review?.inbox ?? []).map(item => item.qId));
  const questions = (review?.questions ?? []) as Question[];
  return {
    status: submission.status, review: review?.status ?? null, round: review?.round ?? 0,
    // Answers already sent are being read; the app shows "reviewing" until new questions or the evaluation arrive.
    reviewing: received.size > 0 || ['QUEUED', 'PROCESSING'].includes(submission.status),
    // Only while the idea waits for input; a question left unanswered in a batch is asked again next round.
    questions: review?.status === 'needs_input' && submission.status === 'NEEDS_INPUT'
      ? questions.filter(question => question.status === 'pending' && !received.has(question.qId)).map(({ qId, field, questionEn }) => ({ qId, field, questionEn }))
      : [],
    answered: questions.filter(question => question.status === 'answered').length + received.size,
  };
}

export function followupRouter(): Router {
  const router = Router();
  const own = requirePermission('submit_own');
  const assisted = requirePermission('submit_assisted');

  const read: RequestHandler = async (req, res) => {
    const { submission, review } = await load(req.auth!, objectId.parse(req.params.id));
    res.json(view(submission, review));
  };
  const answer: RequestHandler = async (req: Request, res) => {
    const auth = req.auth!;
    const id = objectId.parse(req.params.id);
    const { answers } = answerInput.parse(req.body);
    const qIds = answers.map(item => item.qId);
    if (new Set(qIds).size !== qIds.length) throw new HttpError(400, 'Answer each question once.');
    const { submission, review } = await load(auth, id);
    if (submission.status !== 'NEEDS_INPUT' || review?.status !== 'needs_input') throw new HttpError(409, 'This idea is not waiting for answers.');
    const received = new Set((review.inbox ?? []).map(item => item.qId));
    const pending = new Set((review.questions as Question[]).filter(q => q.status === 'pending' && !received.has(q.qId)).map(q => q.qId));
    if (qIds.some(qId => !pending.has(qId))) throw new HttpError(409, 'That question was already answered or was not asked.');
    const version = (submission.inputVersion ?? 1) + 1;
    const entries = [];
    for (const item of answers) {
      const storageId = await storeOriginal(`followup-${id}-${item.qId}-v${version}`, Buffer.from(item.text, 'utf8'),
        { submissionId: submission._id, qId: item.qId, purpose: 'followup_answer', kind: 'text' });
      entries.push({ qId: item.qId, storageId, receivedAt: new Date(), byUserId: new Types.ObjectId(auth.user.id) });
    }
    // Atomic: a second request answering the same question in parallel finds it already in the inbox and is refused.
    const added = await ReviewSession.updateOne({ status: 'needs_input', 'inbox.qId': { $nin: qIds } }, { $push: { inbox: { $each: entries } } })
      .setOptions({ tenant: { submissionId: submission._id } });
    if (added.modifiedCount !== 1) throw new HttpError(409, 'That question was already answered.');
    await Submission.updateOne({ _id: id }, { $set: { 'followUps.$[question].status': 'answered' }, $inc: { inputVersion: 1 } },
      { arrayFilters: [{ 'question.qId': { $in: qIds } }] }).setOptions({ tenant: submissionScope(auth) });
    await enqueueJob({ submissionId: id, ownerOrgId: String(submission.ownerOrgId), fromStage: 'extract', reason: 'followup',
      inputVersion: version, requestedByUserId: auth.user.id });
    await recordAudit(auth, 'submission.followup_answer', { type: 'submission', id, orgId: String(submission.ownerOrgId) }, { answers: answers.length });
    const fresh = await load(auth, id);
    res.status(202).json(view(fresh.submission, fresh.review));
  };
  router.get('/me/submissions/:id/follow-ups', own, read);
  router.post('/me/submissions/:id/follow-ups', own, answer);
  router.get('/assisted/submissions/:id/follow-ups', assisted, read);
  router.post('/assisted/submissions/:id/follow-ups', assisted, answer);

  // Centre staff and HQ: how the pitch was completed (questions, redacted answers, verdict per topic).
  router.get('/submissions/:id/review', requirePermission('review_centre'), async (req, res) => {
    const { review } = await load(req.auth!, objectId.parse(req.params.id));
    if (!review) throw new HttpError(404, 'This idea has not been through the pitch review.');
    const calls = (review.calls ?? []) as Array<{ ms?: number }>;
    res.json({
      status: review.status, round: review.round, businessType: review.businessType ?? null,
      verdicts: review.verdicts ?? {}, declined: review.declined ?? {},
      questions: ((review.questions ?? []) as Question[]).map(({ qId, field, round, questionEn, reason, status, answerText }) =>
        ({ qId, field, round, questionEn, reason: reason ?? null, status, answer: answerText ?? null })),
      waitingAnswers: (review.inbox ?? []).length,
      model: review.model ?? null, promptVersions: review.promptVersions ?? {},
      calls: { count: calls.length, seconds: Math.round(calls.reduce((sum, call) => sum + (call.ms ?? 0), 0) / 100) / 10 },
    });
  });
  return router;
}
