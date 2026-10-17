import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { HttpError } from '../../errors.js';
import { enqueueJob } from '../../platform/jobs.js';
import { Job, Org, Submission } from '../../models.js';
import { requirePermission } from '../../auth/authorization.js';
import { hasProcessingConsent } from './consent.js';
import { Entrepreneur, LANGUAGES } from './models.js';
import { CHUNK_BYTES, DOCUMENT_KINDS, GUIDED_STEPS, MAX_BYTES, MAX_DOCUMENTS, PITCH_MODES, Pitch, PitchDocument } from './intake-models.js';
import { appendChunk, finalise, readOriginal, storeOriginal } from './storage.js';
import { processPitch, Transcript } from './processing.js';
import { piiVault } from './pii-vault.js';
import type { Config } from '../../config.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const pitchInput = z.object({
  clientDraftId: clientId, mode: z.enum(PITCH_MODES), language: z.enum(LANGUAGES),
  centreId: objectId.optional(), entrepreneurId: objectId.optional(),
}).strict();
const answersInput = z.object({
  // Newlines and tabs are allowed in typed answers; other control characters are not.
  answers: z.array(z.object({ step: z.enum(GUIDED_STEPS), text: z.string().trim().min(1).max(4000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/) }).strict()).max(GUIDED_STEPS.length),
}).strict();
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
    if (pitch.status !== 'DRAFT') throw new HttpError(409, 'This pitch was already submitted.');
    if (input.bytes > MAX_BYTES[input.kind]) throw new HttpError(413, 'This file is too large.');
    if (!MIMES[input.kind].test(input.mime)) throw new HttpError(400, 'This file type is not accepted.');
    if (await PitchDocument.countDocuments({ pitchId: pitch._id }) >= MAX_DOCUMENTS) throw new HttpError(409, 'This pitch already has the maximum number of files.');
    const document = await PitchDocument.create({ pitchId: pitch._id, entrepreneurId: pitch.entrepreneurId, createdByUserId: user.id,
      purpose: 'pitch', kind: input.kind, declaredMime: input.mime.toLowerCase(), clientFileId: input.clientFileId,
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

  // Submitting turns the draft into a Submission owned by a centre. Processing is queued only when the
  // shared worker queue exists; until then the pitch records pipeline: pending_queue (no fake progress).
  router.post('/pitches/:id/submit', canPitch, async (req, res) => {
    const pitch = await ownPitch(req, req.params.id as string);
    if (pitch.status === 'SUBMITTED') { res.json(pitchView(pitch, await PitchDocument.find({ pitchId: pitch._id }))); return; }
    if (!await hasProcessingConsent(pitch.entrepreneurId)) throw new HttpError(403, 'Processing consent is needed before submitting.');
    if (!pitch.centreId) throw new HttpError(409, req.auth!.user.role === 'facilitator'
      ? 'Your organisation is not linked to a centre yet.' : 'Choose the centre you are applying to.');
    if (!await Org.exists({ _id: pitch.centreId, type: 'centre', active: true })) throw new HttpError(409, 'Choose an active centre.');
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
    res.status(201).json(pitchView(updated, await PitchDocument.find({ pitchId: pitch._id })));
    // Reading, transcription and translation run in the background on this host (no hosted service).
    void processPitch(updated._id, vault);
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
    const latest = await Transcript.findOne({ pitchId: pitch._id }).sort({ version: -1 }).lean();
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
    const latest = await Transcript.findOne({ pitchId: pitch._id }).sort({ version: -1 }).lean();
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
      const next = await Transcript.create({ pitchId: pitch._id, submissionId: latest.submissionId, version: latest.version + 1,
        status: latest.status, segments, extracted: latest.extracted, pending: latest.pending, issues: latest.issues, blurBoxes: latest.blurBoxes, editedByUserId: req.auth!.user.id });
      res.json({ version: next.version, segments: next.segments, edited: true });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'The transcript changed since you opened it. Reload and try again.');
      throw error;
    }
  });

  return router;
}
