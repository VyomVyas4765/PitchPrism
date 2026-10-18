import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Router, type Request } from 'express';
import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { HttpError } from '../../errors.js';
import { requirePermission, submissionScope } from '../../auth/authorization.js';
import { Job, ReviewSession, Submission } from '../../models.js';
import { CentreCase } from '../centre/model.js';
import { briefRows, type ReviewForBrief } from './brief.js';
import { Entrepreneur, LANGUAGES } from './models.js';
import { Pitch } from './intake-models.js';
import { piiVault, type Sealed } from './pii-vault.js';
import { FUNDING_NOTE, fundingOptions } from './funding.js';

// "My ideas" dashboard (entrepreneur app): every business idea the person pitched, each with its status, the final
// evaluation the evaluator sees, the evaluator's feedback, AI coaching to improve the pitch, the Business Idea Brief in
// their own language (the evaluator's copy stays in English), and funding schemes that fit the idea.

// Translations and coaching are model output: cached per idea, language and content, so the dashboard opens fast and
// the model is asked again only when the content changes (a new evaluation, decision or answers).
const ideaExtraSchema = new Schema({
  pitchId: { type: Schema.Types.ObjectId, required: true }, kind: { type: String, enum: ['localized', 'improve'], required: true },
  language: { type: String, required: true }, hash: { type: String, required: true }, data: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });
ideaExtraSchema.index({ pitchId: 1, kind: 1, language: 1 }, { unique: true });
const IdeaExtra = mongoose.model('IdeaExtra', ideaExtraSchema);

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const localPythons = ['../../../../ai/.venv/bin/python', '../../../../ai/.venv/Scripts/python.exe'].map(path => fileURLToPath(new URL(path, import.meta.url)));

/** Runs ai/coach/cli.py with one JSON request (the same local worker pattern as the centre assessment). */
function runCoach<T>(request: Record<string, unknown>): Promise<T> {
  const python = process.env.PITCHPRISM_PYTHON || localPythons.find(path => existsSync(path)) || (process.platform === 'win32' ? 'python' : 'python3');
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'ai.coach.cli'], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'], timeout: 150000 });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 2 * 1024 * 1024) child.kill(); });
    child.on('error', () => reject(new Error('coach worker could not start')));
    child.on('close', code => {
      if (code !== 0) { reject(new Error('coach worker failed')); return; }
      try { resolve(JSON.parse(output) as T); } catch { reject(new Error('coach worker returned invalid output')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
type Evaluation = { potential?: number | null; band?: string; pathway?: string; coverage?: number; completeness?: number; rubricVersion?: string;
  domains?: { key: string; score: number | null; reason: string; confidence?: string }[]; financialChecks?: { field: string; written: string; expected: string }[];
  followUps?: { field: string; questionEn: string }[] };

export function ideasRouter(config: Config) {
  const router = Router();
  const vault = config.PII_ENCRYPTION_KEY ? piiVault(config.PII_ENCRYPTION_KEY) : null;
  const entrepreneurOnly = requirePermission('submit_own');
  const languageQuery = z.object({ lang: z.enum(LANGUAGES).optional() }).strict();

  /** Everything one idea's dashboard shows, in English (translations are layered on separately). */
  async function load(req: Request, pitchId: string) {
    if (!/^[a-f\d]{24}$/i.test(pitchId)) throw new HttpError(404, 'Idea not found.');
    const pitch = await Pitch.findOne({ _id: pitchId, entrepreneurId: req.auth!.user.id }).lean();
    if (!pitch?.submissionId) throw new HttpError(404, 'Idea not found.');
    const submission = await Submission.findOne({ _id: pitch.submissionId }).setOptions({ tenant: submissionScope(req.auth!) }).lean();
    if (!submission) throw new HttpError(404, 'Idea not found.');
    const [review, item, job, person] = await Promise.all([
      ReviewSession.findOne({}).setOptions({ tenant: { submissionId: submission._id } }).lean(),
      CentreCase.findOne({ submissionId: submission._id }).lean(),
      Job.findOne({ submissionId: submission._id, fromStage: 'quality' }).sort({ createdAt: -1 }).setOptions({ tenant: 'system' }).lean(),
      Entrepreneur.findById(req.auth!.user.id).setOptions({ tenant: { _id: req.auth!.user.id } }).select('+personal +onboarding state district').lean(),
    ]);
    const reviewed = review as unknown as (ReviewForBrief & { status?: string }) | null;
    const evaluation = (item?.evaluation ?? null) as Evaluation | null;
    const decision = (item?.decision ?? null) as { decision?: string; applicantMessage?: string; at?: string } | null;
    const feedback = (item?.feedback ?? null) as { textEn?: string; editedAt?: string } | null;
    const interview = (item as { interview?: unknown } | null)?.interview ?? null;
    const sent = !!job;
    const status = submission.status;
    const stage = ['SHORTLISTED'].includes(status) ? 'shortlisted' : status === 'NOT_YET' ? 'not_selected' : status === 'MORE_INFO' ? 'more_info'
      : !sent ? (reviewed?.status === 'complete' ? 'ready_to_send' : 'in_chat')
      : job.status === 'failed' ? 'evaluation_failed' : ['queued', 'leased'].includes(job.status) ? 'evaluating' : 'under_review';
    const input = (item?.input ?? {}) as { financials?: Record<string, { value?: number }>; context?: { plannedBusinessLocation?: { state?: string } } };
    const personal = person?.personal && vault ? vault.open<{ gender?: string | null; name?: string }>(person.personal as Sealed, String(person._id)) : {};
    const form = person?.onboarding && vault ? vault.open<{ mobile?: string }>(person.onboarding as Sealed, String(person._id)) : {};
    const gender = personal.gender ?? null;
    const business = reviewed?.businessType ?? submission.title ?? '';
    const funding = fundingOptions({ loan: input.financials?.loan?.value ?? null, investment: input.financials?.investment?.value ?? null,
      state: input.context?.plannedBusinessLocation?.state ?? person?.state ?? null, gender, business });
    return {
      pitch, submission, reviewed, evaluation,
      view: {
        pitchId: String(pitch._id), submissionId: String(submission._id), title: business || 'My business idea', language: pitch.language,
        // The person's own details for the header of their draft (the same header the evaluator's PDF carries).
        applicant: { name: personal.name ?? null, mobile: form.mobile ?? null },
        status: { code: status, stage, startedAt: pitch.submittedAt ?? null, sentAt: job?.createdAt ?? null, evaluatedAt: job?.status === 'done' ? job.finishedAt ?? null : null,
          decidedAt: decision?.at ?? null },
        // The same final evaluation the evaluator sees, once the evaluator pipeline has run on the sent plan.
        score: sent && evaluation?.potential != null ? { potential: evaluation.potential, band: evaluation.band ?? null, pathway: evaluation.pathway ?? null,
          coverage: evaluation.coverage ?? null, completeness: evaluation.completeness ?? null, rubricVersion: evaluation.rubricVersion ?? null,
          domains: (evaluation.domains ?? []).map(domain => ({ key: domain.key, score: domain.score, reason: domain.reason })),
          checks: (evaluation.financialChecks ?? []).map(check => `${check.field}: written ${check.written}; expected ${check.expected}`) } : null,
        feedback: decision?.decision || feedback?.textEn ? { decision: decision?.decision ?? null, message: decision?.applicantMessage ?? null,
          notes: feedback?.textEn ?? null, decidedAt: decision?.at ?? null, interview } : null,
        brief: reviewed?.status === 'complete' ? briefRows(reviewed) : null,
        funding, fundingNote: FUNDING_NOTE,
      },
    };
  }

  /** The English text that gets translated for the person's language, in a stable order. */
  function translatable(view: Awaited<ReturnType<typeof load>>['view']) {
    const texts: string[] = [];
    for (const row of view.brief ?? []) texts.push(row.question, row.response);
    for (const domain of view.score?.domains ?? []) texts.push(domain.reason);
    texts.push(view.feedback?.message ?? '', view.feedback?.notes ?? '');
    for (const option of view.funding) texts.push(option.summary, option.amount, option.who, option.howToApply, option.why);
    texts.push(view.fundingNote);
    return texts;
  }
  function applyTranslation(view: Awaited<ReturnType<typeof load>>['view'], texts: string[], langs: string[], language: string) {
    let i = 0;
    const next = () => ({ text: texts[i], lang: langs[i++] });
    const brief = (view.brief ?? []).map(row => { const q = next(), r = next(); return { ...row, question: q.text, response: r.text, lang: r.lang }; });
    const reasons = (view.score?.domains ?? []).map(() => next().text);
    const message = next().text, notes = next().text;
    const funding = view.funding.map(option => ({ ...option, summary: next().text, amount: next().text, who: next().text, howToApply: next().text, why: next().text }));
    const fundingNote = next().text;
    const complete = langs.every((code, index) => code === language || !texts[index] || texts[index].length < 12);
    return { language, complete, brief, scoreReasons: reasons, feedbackMessage: message || null, feedbackNotes: notes || null, funding, fundingNote };
  }

  router.get('/me/ideas', entrepreneurOnly, async (req, res) => {
    const pitches = await Pitch.find({ entrepreneurId: req.auth!.user.id, mode: 'chat', submissionId: { $exists: true } }).sort({ _id: -1 }).limit(50).lean();
    const ids = pitches.map(pitch => pitch.submissionId!);
    const [submissions, cases, reviews] = await Promise.all([
      Submission.find({ _id: { $in: ids } }).setOptions({ tenant: submissionScope(req.auth!) }).select('status title').lean(),
      CentreCase.find({ submissionId: { $in: ids } }).select('submissionId evaluation.potential evaluation.band').lean(),
      ReviewSession.find({ submissionId: { $in: ids } }).setOptions({ tenant: 'system' }).select('submissionId businessType status').lean(),
    ]);
    const sub = new Map(submissions.map(item => [String(item._id), item]));
    const cs = new Map(cases.map(item => [String(item.submissionId), item]));
    const rv = new Map(reviews.map(item => [String((item as { submissionId: unknown }).submissionId), item as { businessType?: string }]));
    res.json({ ideas: pitches.flatMap(pitch => {
      const id = String(pitch.submissionId), submission = sub.get(id);
      if (!submission) return [];
      const evaluation = cs.get(id)?.evaluation as { potential?: number; band?: string } | undefined;
      const title = rv.get(id)?.businessType ?? (submission.title !== 'Pitch in progress' ? submission.title : null);
      return [{ pitchId: String(pitch._id), title, status: submission.status, language: pitch.language, startedAt: pitch.submittedAt ?? null,
        potential: evaluation?.potential ?? null, band: evaluation?.band ?? null }];
    }) });
  });

  router.get('/me/ideas/:pitchId', entrepreneurOnly, async (req, res) => {
    const { lang } = languageQuery.parse(req.query);
    const { view } = await load(req, req.params.pitchId as string);
    const language = lang ?? view.language;
    let localized = null;
    if (language !== 'en') {
      const cached = await IdeaExtra.findOne({ pitchId: view.pitchId, kind: 'localized', language }).lean() as { hash: string; data: unknown } | null;
      if (cached && cached.hash === hashOf(translatable(view))) localized = cached.data;
    }
    const improve = await IdeaExtra.findOne({ pitchId: view.pitchId, kind: 'improve', language }).lean() as { hash: string; data: unknown } | null;
    res.json({ ...view, displayLanguage: language, localized, translationNeeded: language !== 'en' && !localized,
      improve: improve && improve.hash === hashOf({ brief: view.brief, score: view.score, language }) ? improve.data : null });
  });

  // Translate the dashboard (draft, score reasons, feedback, funding notes) into the person's language; cached.
  router.post('/me/ideas/:pitchId/localize', entrepreneurOnly, async (req, res) => {
    const { lang } = languageQuery.parse(req.query);
    const { view } = await load(req, req.params.pitchId as string);
    const language = lang ?? view.language;
    if (language === 'en') { res.json({ localized: null }); return; }
    const texts = translatable(view);
    const hash = hashOf(texts);
    const cached = await IdeaExtra.findOne({ pitchId: view.pitchId, kind: 'localized', language }).lean() as { hash: string; data: unknown } | null;
    if (cached?.hash === hash) { res.json({ localized: cached.data }); return; }
    const unique = [...new Set(texts.filter(Boolean))];
    let result: { texts: string[]; langs: string[] };
    try { result = await runCoach({ task: 'translate', language, texts: unique }); }
    catch { throw new HttpError(503, 'Translation is not available right now. Please try again in a minute.'); }
    const byText = new Map(unique.map((text, index) => [text, { text: result.texts[index] ?? text, lang: result.langs[index] ?? 'en' }]));
    const data = applyTranslation(view, texts.map(text => byText.get(text)?.text ?? text), texts.map(text => text ? byText.get(text)?.lang ?? 'en' : language), language);
    await IdeaExtra.updateOne({ pitchId: view.pitchId, kind: 'localized', language }, { $set: { hash, data } }, { upsert: true });
    res.json({ localized: data });
  });

  // AI coaching to improve the pitch, in the person's language; cached until the plan or its evaluation changes.
  router.post('/me/ideas/:pitchId/improve', entrepreneurOnly, async (req, res) => {
    const { lang } = languageQuery.parse(req.query);
    const { refresh } = z.object({ refresh: z.boolean().optional() }).strict().parse(req.body ?? {});
    const { view, evaluation } = await load(req, req.params.pitchId as string);
    if (!view.brief) throw new HttpError(409, 'Finish your plan in the chat first; then the coach can help improve it.');
    const language = lang ?? view.language;
    const hash = hashOf({ brief: view.brief, score: view.score, language });
    const cached = await IdeaExtra.findOne({ pitchId: view.pitchId, kind: 'improve', language }).lean() as { hash: string; data: unknown } | null;
    if (cached?.hash === hash && !refresh) { res.json({ improve: cached.data }); return; }
    let data: unknown;
    try {
      data = await runCoach({ task: 'improve', language, idea: { businessType: view.title, brief: view.brief,
        evaluation: evaluation ? { potential: evaluation.potential ?? null, band: evaluation.band ?? null, pathway: evaluation.pathway ?? null,
          domains: (evaluation.domains ?? []).map(domain => ({ key: domain.key, score: domain.score, reason: domain.reason })),
          financialChecks: evaluation.financialChecks ?? [], followUps: (evaluation.followUps ?? []).map(item => item.questionEn) } : null } });
    } catch { throw new HttpError(503, 'The coach is not available right now. Please try again in a minute.'); }
    const stored = { ...(data as object), generatedAt: new Date().toISOString() };
    await IdeaExtra.updateOne({ pitchId: view.pitchId, kind: 'improve', language }, { $set: { hash, data: stored } }, { upsert: true });
    res.json({ improve: stored });
  });

  return router;
}
