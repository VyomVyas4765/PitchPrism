import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express, { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { HttpError } from '../../errors.js';
import { recordAudit } from '../../platform/audit.js';
import { enqueueJob } from '../../platform/jobs.js';
import { Job, Org, ReviewSession, Submission } from '../../models.js';
import { requirePermission, submissionScope } from '../../auth/authorization.js';
import { hasProcessingConsent } from './consent.js';
import { Entrepreneur, LANGUAGES } from './models.js';
import { CHUNK_BYTES, ChatMessage, DOCUMENT_KINDS, GUIDED_STEPS, MAX_BYTES, MAX_DOCUMENTS, PITCH_MODES, Pitch, PitchDocument } from './intake-models.js';
import { appendChunk, finalise, readOriginal, storeOriginal } from './storage.js';
import { processPitch, Transcript } from './processing.js';
import { piiVault, type Sealed } from './pii-vault.js';
import { briefRows, buildBrief, type ReviewForBrief } from './brief.js';
import type { Config } from '../../config.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const pitchInput = z.object({
  clientDraftId: clientId, mode: z.enum(PITCH_MODES), language: z.enum(LANGUAGES),
  centreId: objectId.optional(), entrepreneurId: objectId.optional(),
}).strict();
// Newlines and tabs are allowed in typed answers; other control characters are not.
const typedText = z.string().trim().min(1).max(4000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);
const answersInput = z.object({
  answers: z.array(z.object({ step: z.enum(GUIDED_STEPS), text: typedText }).strict()).max(GUIDED_STEPS.length),
}).strict();
// A chat reply is typed text or one uploaded file (a voice note, a PDF form or a photo), never both.
const chatInput = z.object({ text: typedText.optional(), documentId: z.string().regex(/^[a-f\d]{24}$/i).optional() }).strict()
  .refine(input => !input.text !== !input.documentId, 'Send a message or one file.');
type ReviewQuestion = { qId: string; field: string; round: number; questionEn: string; text?: string; lang?: string; status: string };
const documentInput = z.object({
  clientFileId: clientId, kind: z.enum(DOCUMENT_KINDS), bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f\d]{64}$/), mime: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/i).max(80),
  promptStep: z.enum(GUIDED_STEPS).optional(),
}).strict();
const MIMES: Record<typeof DOCUMENT_KINDS[number], RegExp> = {
  audio: /^audio\//, pdf: /^application\/pdf$/, image: /^image\/(jpeg|png|webp|heic|heif)$/, text: /^text\/plain$/,
};

// Guided prompt cards come from the question bank (single source; non-English text unreviewed, Q-05).
const bankPath = new URL('../../../../data/seed/question-bank.json', import.meta.url);
let promptCache: unknown;
function prompts() {
  promptCache ??= (() => {
    const bank = JSON.parse(readFileSync(bankPath, 'utf8')) as { version: string; review: unknown; guidedSteps: { key: string; maxSeconds: number; prompt: Record<string, string> }[] };
    return { version: bank.version, review: bank.review, steps: bank.guidedSteps.map(({ key, maxSeconds, prompt }) => ({ key, maxSeconds, prompt })) };
  })();
  return promptCache;
}

const pitchView = (pitch: InstanceType<typeof Pitch>, documents: InstanceType<typeof PitchDocument>[] = []) => ({
  id: String(pitch._id), clientDraftId: pitch.clientDraftId, mode: pitch.mode, language: pitch.language, channel: pitch.channel,
  status: pitch.status, centreId: pitch.centreId ? String(pitch.centreId) : null, pipeline: pitch.pipeline,
  submissionId: pitch.submissionId ? String(pitch.submissionId) : null,
  typedAnswers: pitch.typedAnswers.map(answer => ({ step: answer.step, text: answer.text })),
  documents: documents.map(documentView),
});
const documentView = (document: InstanceType<typeof PitchDocument>) => ({
  id: String(document._id), clientFileId: document.clientFileId, kind: document.kind, promptStep: document.promptStep ?? null,
  bytes: document.bytes, receivedBytes: document.receivedBytes, state: document.state,
});

export function intakeRouter(config: Config) {
  const router = Router();
  const vault = piiVault(config.PII_ENCRYPTION_KEY);
  const canPitch: express.RequestHandler = (req, _res, next) => {
    const role = req.auth?.user.role;
    if (role === 'entrepreneur' || role === 'facilitator') { next(); return; }
    next(new HttpError(403, 'Your role cannot perform this action.'));
  };
  // Entrepreneurs act on their own pitches; facilitators only on pitches they created (M-18).
  const ownPitch = async (req: Request, id: string) => {
    const user = req.auth!.user;
    const pitch = await Pitch.findOne({ _id: objectId.parse(id), ...(user.role === 'entrepreneur' ? { entrepreneurId: user.id } : { createdByUserId: user.id }) });
    if (!pitch) throw new HttpError(404, 'Pitch not found.');
    return pitch;
  };
  const ownDocument = async (req: Request, id: string) => {
    const document = await PitchDocument.findOne({ _id: objectId.parse(id), createdByUserId: req.auth!.user.id });
    if (!document) throw new HttpError(404, 'Document not found.');
    return document;
  };

  router.get('/pitch-prompts', canPitch, (_req, res) => { res.json(prompts()); });

  // Centres an entrepreneur can choose to apply to (Q-08 open: no district mapping is assumed).
  router.get('/centres', requirePermission('submit_own'), async (_req, res) => {
    const centres = await Org.find({ type: 'centre', active: true }).select('name').sort({ name: 1 }).lean();
    res.json({ centres: centres.map(centre => ({ id: String(centre._id), name: centre.name })) });
  });

  router.post('/pitches', canPitch, async (req, res) => {
    const input = pitchInput.parse(req.body);
    const user = req.auth!.user;
    let entrepreneurId: string;
    let centreId: string | undefined;
    let sourceOrgId: string | undefined;
    if (user.role === 'entrepreneur') {
      if (input.entrepreneurId) throw new HttpError(400, 'Check the request fields and try again.');
      entrepreneurId = user.id;
      if (input.centreId && !await Org.exists({ _id: input.centreId, type: 'centre', active: true })) throw new HttpError(400, 'Choose an active centre.');
      centreId = input.centreId;
    } else {
      // Assisted pitch: the applicant must be one this facilitator registered; the centre comes from the session.
      if (!input.entrepreneurId || input.centreId) throw new HttpError(400, 'Check the request fields and try again.');
      if (!await Entrepreneur.exists({ _id: input.entrepreneurId, createdVia: 'assisted' }).setOptions({ tenant: { facilitatorId: user.id } })) throw new HttpError(404, 'Applicant not found.');
      entrepreneurId = input.entrepreneurId;
      sourceOrgId = user.orgId!;
      if (user.orgType === 'centre') centreId = user.orgId!;
    }
    const existing = await Pitch.findOne({ createdByUserId: user.id, clientDraftId: input.clientDraftId });
    if (existing) {
      if (String(existing.entrepreneurId) !== entrepreneurId) throw new HttpError(409, 'This draft ID is already used for another applicant.');
      res.json(pitchView(existing, await PitchDocument.find({ pitchId: existing._id }))); return;
    }
    try {
      const pitch = await Pitch.create({ entrepreneurId, createdByUserId: user.id, channel: user.role === 'entrepreneur' ? 'app_self' : 'app_assisted',
        mode: input.mode, language: input.language, clientDraftId: input.clientDraftId, centreId, sourceOrgId });
      res.status(201).json(pitchView(pitch));
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const pitch = (await Pitch.findOne({ createdByUserId: user.id, clientDraftId: input.clientDraftId }))!;
      res.json(pitchView(pitch, await PitchDocument.find({ pitchId: pitch._id })));
    }
  });

  router.get('/pitches', canPitch, async (req, res) => {
    const user = req.auth!.user;
    const pitches = await Pitch.find(user.role === 'entrepreneur' ? { entrepreneurId: user.id } : { createdByUserId: user.id }).sort({ _id: -1 }).limit(100);
    res.json({ pitches: pitches.map(pitch => pitchView(pitch)) });
  });

  router.get('/pitches/:id', canPitch, async (req, res) => {
    const pitch = await ownPitch(req, req.params.id as string);
    res.json(pitchView(pitch, await PitchDocument.find({ pitchId: pitch._id })));
  });

  router.put('/pitches/:id/answers', canPitch, async (req, res) => {
    const { answers } = answersInput.parse(req.body);
    const pitch = await ownPitch(req, req.params.id as string);
    if (pitch.status !== 'DRAFT') throw new HttpError(409, 'This pitch was already submitted.');
    if (new Set(answers.map(answer => answer.step)).size !== answers.length) throw new HttpError(400, 'Check the request fields and try again.');
    pitch.set('typedAnswers', answers);
    await pitch.save();
    res.json(pitchView(pitch, await PitchDocument.find({ pitchId: pitch._id })));
  });

  router.post('/pitches/:id/documents', canPitch, async (req, res) => {
    const input = documentInput.parse(req.body);
    const pitch = await ownPitch(req, req.params.id as string);
    const user = req.auth!.user;
    const existing = await PitchDocument.findOne({ createdByUserId: user.id, clientFileId: input.clientFileId });
    if (existing) {
      if (String(existing.pitchId) !== String(pitch._id) || existing.sha256 !== input.sha256 || existing.bytes !== input.bytes) throw new HttpError(409, 'This file ID is already used for different content.');
      res.json(documentView(existing)); return;
    }
    // A submitted chat pitch takes voice notes and files as replies to the AI's questions (M-05 chat).
    const reply = pitch.status === 'SUBMITTED' && pitch.mode === 'chat';
    if (pitch.status !== 'DRAFT' && !reply) throw new HttpError(409, 'This pitch was already submitted.');
    if (input.bytes > MAX_BYTES[input.kind]) throw new HttpError(413, 'This file is too large.');
    if (!MIMES[input.kind].test(input.mime)) throw new HttpError(400, 'This file type is not accepted.');
    if (await PitchDocument.countDocuments({ pitchId: pitch._id }) >= MAX_DOCUMENTS) throw new HttpError(409, 'This pitch already has the maximum number of files.');
    const document = await PitchDocument.create({ pitchId: pitch._id, entrepreneurId: pitch.entrepreneurId, createdByUserId: user.id,
      purpose: reply ? 'chat_reply' : 'pitch', kind: input.kind, declaredMime: input.mime.toLowerCase(), clientFileId: input.clientFileId,
      promptStep: input.promptStep, bytes: input.bytes, sha256: input.sha256 });
    res.status(201).json(documentView(document));
  });

  router.get('/documents/:id', canPitch, async (req, res) => { res.json(documentView(await ownDocument(req, req.params.id as string))); });

  // Playback of the person's own original (M-08); the content is private and never cached.
  router.get('/documents/:id/original', canPitch, async (req, res) => {
    const user = req.auth!.user;
    const document = await PitchDocument.findOne({ _id: objectId.parse(req.params.id), state: 'complete',
      ...(user.role === 'entrepreneur' ? { entrepreneurId: user.id } : { createdByUserId: user.id }) });
    if (!document?.storageId) throw new HttpError(404, 'Document not found.');
    res.set('Content-Type', document.declaredMime).set('Content-Disposition', 'inline').send(await readOriginal(document.storageId));
  });

  // Resumable upload: the client sends the next chunk at Upload-Offset; any other offset gets 409 and the server's count.
  router.put('/documents/:id/content', canPitch, express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES + 1024 }), async (req, res) => {
    const document = await ownDocument(req, req.params.id as string);
    const offset = z.coerce.number().int().min(0).parse(req.get('upload-offset'));
    const data = req.body as unknown;
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > CHUNK_BYTES) throw new HttpError(400, 'Send one chunk of up to 1 MiB as application/octet-stream.');
    if (document.state !== 'receiving') { res.status(409).json({ ...documentView(document), error: 'This file is already complete.' }); return; }
    const received = await appendChunk(document._id, offset, data, document.bytes);
    if (received === null) {
      const current = await PitchDocument.findById(document._id);
      res.status(409).json({ ...documentView(current!), error: 'Resume from the server offset.' }); return;
    }
    const result = received === document.bytes ? await finalise(document._id) : await PitchDocument.findById(document._id);
    res.json(documentView(result!));
  });

  // Submitting turns the draft into a centre-owned Submission and idempotently enqueues ingestion.
  // The pitch remains pending until a validated local handler records real processing results.
  router.post('/pitches/:id/submit', canPitch, async (req, res) => {
    const pitch = await ownPitch(req, req.params.id as string);
    if (pitch.status === 'SUBMITTED') {
      if (!await hasProcessingConsent(pitch.entrepreneurId)) throw new HttpError(403, 'Processing consent is needed before submitting.');
      if (!pitch.submissionId || !pitch.centreId) throw new HttpError(409, 'This submission needs queue repair.');
      await enqueueJob({ submissionId: String(pitch.submissionId), ownerOrgId: String(pitch.centreId), requestedByUserId: req.auth!.user.id,
        fromStage: 'ingest', reason: 'new' });
      res.json(pitchView(pitch, await PitchDocument.find({ pitchId: pitch._id })));
      return;
    }
    await checkSubmittable(req, pitch);
    const updated = await submitDraft(pitch);
    res.status(201).json(pitchView(updated, await PitchDocument.find({ pitchId: pitch._id })));
    // Reading, transcription and translation run in the background on this host (no hosted service).
    void processPitch(updated._id, vault);
  });

  async function checkSubmittable(req: Request, pitch: InstanceType<typeof Pitch>) {
    if (!await hasProcessingConsent(pitch.entrepreneurId)) throw new HttpError(403, 'Processing consent is needed before submitting.');
    if (!pitch.centreId) throw new HttpError(409, req.auth!.user.role === 'facilitator'
      ? 'Your organisation is not linked to a centre yet.' : 'Choose the centre you are applying to.');
    if (!await Org.exists({ _id: pitch.centreId, type: 'centre', active: true })) throw new HttpError(409, 'Choose an active centre.');
  }

  /** Turns a checked draft into a centre-owned Submission and enqueues the pipeline. */
  async function submitDraft(pitch: InstanceType<typeof Pitch>) {
    const documents = await PitchDocument.find({ pitchId: pitch._id });
    if (documents.some(document => document.state === 'receiving')) throw new HttpError(409, 'Some files are still uploading.');
    const complete = documents.filter(document => document.state === 'complete');
    if (!complete.length && !pitch.typedAnswers.length) throw new HttpError(409, 'Add at least one answer, recording or file.');
    if (pitch.typedAnswers.length) {
      // Typed answers become an immutable original too, so evidence can cite them like any file.
      const content = Buffer.from(JSON.stringify({ language: pitch.language, answers: pitch.typedAnswers.map(a => ({ step: a.step, text: a.text })) }), 'utf8');
      const storageId = await storeOriginal(`typed-${pitch._id}`, content, { pitchId: pitch._id, kind: 'text' });
      await PitchDocument.updateOne({ createdByUserId: pitch.createdByUserId, clientFileId: `typed-${pitch._id}` }, {
        $setOnInsert: { pitchId: pitch._id, entrepreneurId: pitch.entrepreneurId, createdByUserId: pitch.createdByUserId, purpose: 'pitch',
          kind: 'text', declaredMime: 'application/json', clientFileId: `typed-${pitch._id}`, bytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex'), receivedBytes: content.length, state: 'complete', storageId, completedAt: new Date() },
      }, { upsert: true });
    }
    // centreId is checked above; the contract Submission requires an owner.
    const submission = await Submission.create({ title: 'Pitch in progress', ownerOrgId: pitch.centreId!, sourceOrgId: pitch.sourceOrgId ?? undefined,
      entrepreneurId: pitch.entrepreneurId, createdByUserId: pitch.createdByUserId, status: 'DRAFT' });
    // A concurrent submit loses this status guard and removes its own Submission: one draft, one Submission.
    const updated = await Pitch.findOneAndUpdate({ _id: pitch._id, status: 'DRAFT' },
      { $set: { status: 'SUBMITTED', submissionId: submission._id, pipeline: 'pending_queue', submittedAt: new Date() } }, { returnDocument: 'after' });
    if (!updated) { await Submission.deleteOne({ _id: submission._id }).setOptions({ tenant: { createdByUserId: pitch.createdByUserId } }); throw new HttpError(409, 'This pitch was already submitted.'); }
    // Processing starts at once (consent was checked above); the worker records each stage for the live card.
    await enqueueJob({ submissionId: String(submission._id), ownerOrgId: String(pitch.centreId), fromStage: 'ingest', reason: 'new', requestedByUserId: String(pitch.createdByUserId) });
    return updated;
  }

  // ---- M-05 chat: the AI asks for the idea, the person replies by text, voice note or PDF, and the review (D-33)
  // keeps asking in their language until every field is covered. Assistant turns are the review's questions.
  async function chatView(req: Request, pitch: InstanceType<typeof Pitch>) {
    const replies = await ChatMessage.find({ pitchId: pitch._id }).sort({ round: 1 }).lean();
    const submission = pitch.submissionId
      ? await Submission.findOne({ _id: pitch.submissionId }).setOptions({ tenant: submissionScope(req.auth!) }).lean() : null;
    const review = submission ? await ReviewSession.findOne({}).setOptions({ tenant: { submissionId: submission._id } }).lean() : null;
    const questions = (review?.questions ?? []) as ReviewQuestion[];
    const messages: Record<string, unknown>[] = [];
    for (const reply of replies) {
      messages.push({ role: 'user', round: reply.round, kind: reply.kind, text: reply.text ?? null, at: reply.createdAt });
      for (const question of questions.filter(item => item.round === reply.round + 1)) {
        messages.push({ role: 'assistant', round: question.round, qId: question.qId, field: question.field,
          text: question.text ?? question.questionEn, lang: question.lang ?? 'en' });
      }
    }
    const waiting = (review?.inbox ?? []).length > 0;
    // Once complete, the person sees what the brief will say (the PDF adds their name and mobile from the profile).
    const brief = review?.status === 'complete' ? briefRows(review as unknown as ReviewForBrief) : null;
    const state = !submission ? 'start'
      : submission.status === 'FAILED' ? 'failed'
      : review?.status === 'complete' ? 'complete'
      : submission.status === 'NEEDS_INPUT' && review?.status === 'needs_input' && !waiting ? 'your_turn'
      : 'reading';
    return { pitchId: String(pitch._id), language: pitch.language, centreId: pitch.centreId ? String(pitch.centreId) : null,
      submissionId: submission ? String(submission._id) : null, state, round: review?.round ?? 0, messages, brief };
  }

  const chatPitch = async (req: Request) => {
    const pitch = await ownPitch(req, req.params.id as string);
    if (pitch.mode !== 'chat') throw new HttpError(409, 'This pitch is not a chat.');
    return pitch;
  };

  router.get('/pitches/:id/chat', canPitch, async (req, res) => { res.json(await chatView(req, await chatPitch(req))); });

  router.post('/pitches/:id/chat', canPitch, async (req, res) => {
    const input = chatInput.parse(req.body);
    const pitch = await chatPitch(req);
    const user = req.auth!.user;
    let file: InstanceType<typeof PitchDocument> | null = null;
    if (input.documentId) {
      file = await PitchDocument.findOne({ _id: input.documentId, pitchId: pitch._id, createdByUserId: user.id,
        purpose: pitch.status === 'DRAFT' ? 'pitch' : 'chat_reply' });
      if (!file || file.state !== 'complete') throw new HttpError(409, 'That file has not finished uploading.');
      if (await ChatMessage.exists({ pitchId: pitch._id, documentId: file._id })) throw new HttpError(409, 'That file was already sent.');
    }
    const kind = file?.kind ?? 'text';

    if (pitch.status === 'DRAFT') {
      // The opening reply submits the pitch; the review then asks its first questions.
      await checkSubmittable(req, pitch);
      let storageId = file?.storageId;
      if (input.text) {
        const content = Buffer.from(input.text, 'utf8');
        const clientFileId = `chat-${pitch._id}-r0`;
        if (await PitchDocument.exists({ createdByUserId: pitch.createdByUserId, clientFileId })) throw new HttpError(409, 'This idea was already sent.');
        storageId = await storeOriginal(clientFileId, content, { pitchId: pitch._id, kind: 'text' });
        await PitchDocument.create({ pitchId: pitch._id, entrepreneurId: pitch.entrepreneurId, createdByUserId: pitch.createdByUserId,
          purpose: 'pitch', kind: 'text', declaredMime: 'text/plain', clientFileId, bytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex'), receivedBytes: content.length, state: 'complete', storageId, completedAt: new Date() });
      }
      await ChatMessage.create({ pitchId: pitch._id, round: 0, kind, text: input.text, documentId: file?._id, storageId: storageId ?? undefined });
      const updated = await submitDraft(pitch);
      res.status(201).json(await chatView(req, updated));
      return;
    }

    const submission = await Submission.findOne({ _id: pitch.submissionId }).setOptions({ tenant: submissionScope(req.auth!) });
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const scope = { tenant: { submissionId: submission._id } };
    let review = await ReviewSession.findOne({}).setOptions(scope).lean();
    if (!review || review.status !== 'needs_input') throw new HttpError(409, 'Wait for the next question before replying.');
    if (submission.status === 'FAILED') {
      // The last reply could not be read (for example a voice note in a language without a local model):
      // it is replaced by this one, and the review continues from the same questions.
      await ReviewSession.updateOne({}, { $set: { inbox: [] } }).setOptions(scope);
      await ChatMessage.deleteOne({ pitchId: pitch._id, round: review.round });
      review = { ...review, inbox: [] };
    } else if (submission.status !== 'NEEDS_INPUT') throw new HttpError(409, 'Wait for the next question before replying.');
    const received = new Set((review.inbox ?? []).map(item => item.qId));
    const pending = (review.questions as ReviewQuestion[]).filter(question => question.status === 'pending' && !received.has(question.qId)).map(question => question.qId);
    if (!pending.length) throw new HttpError(409, 'Wait for the next question before replying.');
    const storageId = file?.storageId ?? await storeOriginal(`chat-${pitch._id}-r${review.round}`, Buffer.from(input.text!, 'utf8'),
      { pitchId: pitch._id, submissionId: submission._id, purpose: 'chat_reply', kind: 'text' });
    try {
      await ChatMessage.create({ pitchId: pitch._id, round: review.round, kind, text: input.text, documentId: file?._id, storageId });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'You already replied; the next question is coming.');
      throw error;
    }
    // One reply answers every open question; the worker reads it once (ai/worker.py, chat replies).
    const entries = pending.map(qId => ({ qId, storageId, receivedAt: new Date(), byUserId: new Types.ObjectId(user.id) }));
    const added = await ReviewSession.updateOne({ status: 'needs_input', 'inbox.qId': { $nin: pending } }, { $push: { inbox: { $each: entries } } }).setOptions(scope);
    if (added.modifiedCount !== 1) {
      await ChatMessage.deleteOne({ pitchId: pitch._id, round: review.round });
      throw new HttpError(409, 'You already replied; the next question is coming.');
    }
    const version = (submission.inputVersion ?? 1) + 1;
    await Submission.updateOne({ _id: submission._id }, { $set: { 'followUps.$[question].status': 'answered' }, $inc: { inputVersion: 1 } },
      { arrayFilters: [{ 'question.qId': { $in: pending } }] }).setOptions({ tenant: submissionScope(req.auth!) });
    await enqueueJob({ submissionId: String(submission._id), ownerOrgId: String(submission.ownerOrgId), fromStage: 'extract', reason: 'followup',
      inputVersion: version, requestedByUserId: user.id });
    await recordAudit(req.auth!, 'submission.chat_reply', { type: 'submission', id: String(submission._id), orgId: String(submission.ownerOrgId) }, { kind });
    res.status(202).json(await chatView(req, pitch));
  });

  /** The Business Idea Brief PDF for a completed review: header from the sealed profile, responses from the review. */
  async function brief(submissionId: Types.ObjectId, entrepreneurId: Types.ObjectId) {
    const review = await ReviewSession.findOne({}).setOptions({ tenant: { submissionId } }).lean();
    if (!review || review.status !== 'complete') throw new HttpError(409, 'The brief is ready once every question is answered.');
    const id = String(entrepreneurId);
    const person = await Entrepreneur.findById(id).setOptions({ tenant: { _id: id } }).select('+personal +onboarding').lean();
    if ((person?.personal || person?.onboarding) && !vault) throw new HttpError(503, 'Profile storage is not configured on this server.');
    const personal = person?.personal ? vault!.open<{ name?: string }>(person.personal as Sealed, id) : {};
    const details = person?.onboarding ? vault!.open<{ mobile?: string }>(person.onboarding as Sealed, id) : {};
    const reviewed = review as unknown as ReviewForBrief;
    return buildBrief({ name: personal.name ?? null, mobile: details.mobile ?? null, business: reviewed.businessType ?? null, rows: briefRows(reviewed) });
  }
  const sendPdf = (res: express.Response, pdf: Buffer) => {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="business-idea-brief.pdf"', 'Cache-Control': 'private, no-store' });
    res.send(pdf);
  };

  router.get('/pitches/:id/brief', canPitch, async (req, res) => {
    const pitch = await chatPitch(req);
    if (!pitch.submissionId) throw new HttpError(409, 'The brief is ready once every question is answered.');
    sendPdf(res, (await brief(pitch.submissionId, pitch.entrepreneurId)).pdf);
  });

  // Centre staff (and HQ) read the brief for submissions in their scope; it carries the applicant's name and mobile.
  router.get('/submissions/:id/brief', requirePermission('review_centre'), async (req, res) => {
    const submission = await Submission.findOne({ _id: objectId.parse(req.params.id) }).setOptions({ tenant: submissionScope(req.auth!) }).lean();
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const pitch = await Pitch.findOne({ submissionId: submission._id, mode: 'chat' }).lean();
    if (!pitch) throw new HttpError(404, 'This idea was not completed in the chat.');
    const result = await brief(submission._id, pitch.entrepreneurId);
    await recordAudit(req.auth!, 'submission.brief_view', { type: 'submission', id: String(submission._id), orgId: String(submission.ownerOrgId) }, {});
    sendPdf(res, result.pdf);
  });

  // Try the last step again after a failure (a local model was missing or busy). Nothing is re-sent by the person.
  router.post('/pitches/:id/chat/retry', canPitch, async (req, res) => {
    const pitch = await chatPitch(req);
    const submission = pitch.submissionId ? await Submission.findOne({ _id: pitch.submissionId }).setOptions({ tenant: submissionScope(req.auth!) }) : null;
    if (!submission || submission.status !== 'FAILED') throw new HttpError(409, 'There is nothing to try again.');
    const review = await ReviewSession.findOne({}).setOptions({ tenant: { submissionId: submission._id } }).lean();
    const followup = !!review && (review.inbox ?? []).length > 0;
    await enqueueJob({ submissionId: String(submission._id), ownerOrgId: String(submission.ownerOrgId), fromStage: followup ? 'extract' : 'ingest',
      reason: followup ? 'followup' : 'new', inputVersion: submission.inputVersion ?? 1, requestedByUserId: req.auth!.user.id });
    res.status(202).json(await chatView(req, pitch));
  });

  // Retry after a failure or once a missing local capability has been installed.
  router.post('/pitches/:id/process', canPitch, async (req, res) => {
    const pitch = await ownPitch(req, req.params.id as string);
    if (pitch.status !== 'SUBMITTED') throw new HttpError(409, 'Submit the pitch first.');
    // A run interrupted by a restart stays `processing`; after 30 minutes it may be retried too.
    const stale = pitch.pipeline === 'processing' && (pitch.get('updatedAt') as Date) < new Date(Date.now() - 30 * 60 * 1000);
    if (!['pending_capability', 'failed'].includes(pitch.pipeline) && !stale) throw new HttpError(409, 'This pitch is already processed or processing.');
    await Pitch.updateOne({ _id: pitch._id }, { $set: { pipeline: 'pending_queue' } });
    void processPitch(pitch._id, vault);
    res.status(202).json({ pipeline: 'pending_queue' });
  });

  // M-08: the latest transcript version, in the speaker's own script with English beside it.
  router.get('/pitches/:id/transcript', canPitch, async (req, res) => {
    const pitch = await ownPitch(req, req.params.id as string);
    const latest = await Transcript.findOne({ pitchId: pitch._id }).setOptions({ tenant: { pitchId: pitch._id } }).sort({ version: -1 }).lean();
    if (!latest) { res.json({ pipeline: pitch.pipeline, transcript: null }); return; }
    res.json({ pipeline: pitch.pipeline, transcript: { version: latest.version, status: latest.status, pending: latest.pending,
      segments: latest.segments, edited: latest.version > 1 } });
  });

  // Corrections create a new version; version 1 (the machine reading) stays addressable.
  router.put('/pitches/:id/transcript', canPitch, async (req, res) => {
    const input = z.object({ baseVersion: z.number().int().min(1), edits: z.array(z.object({
      segId: z.string().regex(/^s_\d{4,}$/), text: z.string().trim().min(1).max(4000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/),
    }).strict()).min(1).max(200) }).strict().parse(req.body);
    const pitch = await ownPitch(req, req.params.id as string);
    const latest = await Transcript.findOne({ pitchId: pitch._id }).setOptions({ tenant: { pitchId: pitch._id } }).sort({ version: -1 }).lean();
    if (!latest) throw new HttpError(404, 'No transcript yet.');
    if (latest.version !== input.baseVersion) throw new HttpError(409, 'The transcript changed since you opened it. Reload and try again.');
    const edits = new Map(input.edits.map(edit => [edit.segId, edit.text]));
    const segments = (latest.segments as Record<string, unknown>[]).map(segment => {
      const text = edits.get(segment.segId as string);
      // Edited text needs translating again; the earlier English no longer matches it.
      return text === undefined ? segment : { ...segment, textOriginal: text, textEn: null, edited: true };
    });
    if (input.edits.some(edit => !(latest.segments as Record<string, unknown>[]).some(segment => segment.segId === edit.segId))) {
      throw new HttpError(400, 'Check the request fields and try again.');
    }
    try {
      const next = await Transcript.create({ pitchId: pitch._id, ownerOrgId: pitch.centreId!, submissionId: latest.submissionId, version: latest.version + 1,
        status: latest.status, segments, extracted: latest.extracted, pending: latest.pending, issues: latest.issues, blurBoxes: latest.blurBoxes, editedByUserId: req.auth!.user.id });
      res.json({ version: next.version, segments: next.segments, edited: true });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'The transcript changed since you opened it. Reload and try again.');
      throw error;
    }
  });

  return router;
}
