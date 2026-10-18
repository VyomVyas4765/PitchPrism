import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { contactHasher, isPlaceholderContact } from '../../crypto.js';
import { HttpError } from '../../errors.js';
import { scoped, submissionScope } from '../../auth/authorization.js';
import { Cohort, Entrepreneur, Submission, Trade } from '../../models.js';
import { recordAudit } from '../../platform/audit.js';
import { PORTFOLIO_DEMO_ORG } from './portfolio.js';
import { CONSENT_NOTICE_VERSION, LANGUAGES } from '../entrepreneur/models.js';
import { PitchDocument } from '../entrepreneur/intake-models.js';
import { piiVault, type Sealed } from '../entrepreneur/pii-vault.js';
import { deleteOriginal, readOriginal, storeOriginal } from '../entrepreneur/storage.js';
import { hasProcessingConsent } from '../entrepreneur/consent.js';
import { grantConsent } from '../entrepreneur/consent.js';
import { assessPdfWithGroq, PdfAssessmentError, type PdfAssessment } from './runner.js';

const id = z.string().regex(/^[a-f\d]{24}$/i);
const field = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}]+$/u);
const detailsSchema = z.object({
  title: field(160), applicantName: field(100), district: field(80),
  trade: field(80), language: z.enum(LANGUAGES),
  cohortId: id.optional(), tradeKey: z.string().regex(/^[a-z0-9_]{2,60}$/).optional(),
  phone: z.string().trim().regex(/^(?:\+?91[- ]?)?[6-9]\d{9}$/).optional(),
}).strict();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 8, parts: 9 } }).single('plan');
const consentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, parts: 3 } }).single('evidence');
const previewUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }).single('plan');
const previewInFlight = new Set<string>();

function audioMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'audio/webm';
  if (bytes.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (bytes.subarray(4, 8).toString() === 'ftyp') return 'audio/mp4';
  if (bytes.subarray(0, 3).toString() === 'ID3') return 'audio/mpeg';
  return null;
}

async function hasPlayableAudio(bytes: Buffer): Promise<boolean> {
  return new Promise(resolve => {
    // Decode the stream: pipe-only formats such as WAV often omit duration metadata.
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
      '-progress', 'pipe:1', '-i', 'pipe:0', '-map', '0:a:0', '-f', 'null', '-'],
      { stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 4096) child.kill(); });
    child.on('error', () => resolve(false));
    child.on('close', code => {
      if (code !== 0 || output.length > 4096) { resolve(false); return; }
      const values = [...output.matchAll(/^out_time_us=(\d+)$/gm)];
      const seconds = values.length ? Number(values.at(-1)![1]) / 1_000_000 : NaN;
      resolve(Number.isFinite(seconds) && seconds >= 2 && seconds <= 600);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

export function planIntakeRouter(config: Config, assessPdf: (pdf: Buffer, district: string, applicantName: string, documentId: string) => Promise<PdfAssessment> = assessPdfWithGroq) {
  const router = Router();
  const vault = piiVault(config.PII_ENCRYPTION_KEY);
  const hashContact = contactHasher(config.PII_ENCRYPTION_KEY);

  router.post('/evaluate-preview', (req, res, next) => {
    if (config.NODE_ENV === 'production') return next(new HttpError(404, 'Preview evaluation is unavailable.'));
    previewUpload(req, res, error => {
      if (error instanceof multer.MulterError) return next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'The PDF must be 12 MB or smaller.'));
      next(error);
    });
  }, async (req, res) => {
    const actor = req.auth!.user;
    if (!['centre_assessor', 'cohort_lead'].includes(actor.role) || !actor.orgId)
      throw new HttpError(403, 'Only centre staff can preview a pitch plan.');
    const file = req.file;
    if (!file || file.mimetype !== 'application/pdf' || file.buffer.length < 16 || file.buffer.subarray(0, 5).toString() !== '%PDF-')
      throw new HttpError(400, 'Attach a valid two-page PDF pitch plan.');
    let pages: number;
    try { pages = (await PDFDocument.load(file.buffer)).getPageCount(); }
    catch { throw new HttpError(400, 'The PDF cannot be opened. Upload an unencrypted two-page PDF.'); }
    if (pages !== 2) throw new HttpError(400, 'Pitch plans must contain exactly two pages.');
    if (previewInFlight.has(actor.id)) throw new HttpError(429, 'A PDF preview is already running for this account.');
    previewInFlight.add(actor.id);
    try {
      let result: PdfAssessment;
      try { result = await assessPdf(file.buffer, '', '', 'preview'); }
      catch (error) {
        if (error instanceof PdfAssessmentError && error.code === 'unsupported_pdf') {
          const messages = {
            invalid_pdf: 'The uploaded PDF could not be opened as a digital document.',
            page_layout: 'The PDF page size or two-page layout differs from the supported English business idea forms.',
            name_missing: 'The applicant name was not found in the form header, so it cannot be safely redacted.',
            question_mismatch: 'The printed business idea questions do not align with a supported form layout.',
            answer_unreadable: 'One or more answer boxes are blank or have no readable text layer.',
            address_risk: 'An answer may contain an exact address outside the location box; scoring was stopped for privacy.',
            redaction_failed: 'Applicant details could not be fully redacted before scoring.',
          };
          throw new HttpError(422, error.extractionCode ? messages[error.extractionCode] :
            'The PDF layout or answer text could not be safely read. Try one of the supported English digital business idea forms.');
        }
        if (error instanceof PdfAssessmentError && error.code === 'invalid_evidence')
          throw new HttpError(422, 'The PDF was read, but its evidence or redaction did not pass validation. No score was generated.');
        throw new HttpError(503, 'The PDF evaluator is temporarily unavailable. Please retry; no score was saved.');
      }
      await recordAudit(req.auth, 'centre.preview_pdf_evaluation', { type: 'centre_preview', id: randomUUID(), orgId: actor.orgId },
        { pages, bytes: file.buffer.length, status: result.assessment.status });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ input: result.input, assessment: result.assessment, document: { pages, bytes: file.buffer.length }, saved: false });
    } finally { previewInFlight.delete(actor.id); }
  });

  router.post('/plans', (req, res, next) => {
    upload(req, res, error => {
      if (error instanceof multer.MulterError) return next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'The PDF must be 12 MB or smaller.'));
      next(error);
    });
  }, async (req, res) => {
    if (!['centre_assessor', 'cohort_lead'].includes(req.auth!.user.role) || !req.auth!.user.orgId)
      throw new HttpError(403, 'Only centre staff can receive a pitch plan.');
    if (!vault) throw new HttpError(503, 'Private applicant storage is not configured.');
    const details = detailsSchema.parse(req.body);
    const cohort = details.cohortId ? await Cohort.findOne({ _id: details.cohortId, orgId: req.auth!.user.orgId, status: { $ne: 'closed' } }).lean() : null;
    if (details.cohortId && !cohort) throw new HttpError(404, 'Choose an open cohort in your centre.');
    const trade = details.tradeKey ? await Trade.findOne({ key: details.tradeKey, active: true }).lean() : null;
    if (details.tradeKey && !trade) throw new HttpError(400, 'Choose an active trade.');
    const file = req.file;
    if (!file || file.mimetype !== 'application/pdf' || file.buffer.length < 16 || file.buffer.subarray(0, 5).toString() !== '%PDF-')
      throw new HttpError(400, 'Attach a valid two-page PDF pitch plan.');
    let pageCount: number;
    try { pageCount = (await PDFDocument.load(file.buffer)).getPageCount(); }
    catch { throw new HttpError(400, 'The PDF cannot be opened. Upload an unencrypted two-page PDF.'); }
    if (pageCount !== 2) throw new HttpError(400, 'Pitch plans must contain exactly two pages.');

    const actor = req.auth!.user;
    const applicant = new Entrepreneur({ createdVia: 'import', homeOrgId: actor.orgId,
      language: details.language, district: details.district, trade: details.trade,
      ...(details.phone && hashContact && !isPlaceholderContact(details.phone, 'phone')
        ? { contactHashes: [hashContact(details.phone, 'phone')] } : {}) });
    applicant.set('personal', vault.seal({ name: details.applicantName, ...(details.phone ? { phone: details.phone } : {}) }, String(applicant._id)));
    const submission = new Submission({ title: details.title, ownerOrgId: actor.orgId, entrepreneurId: applicant._id,
      createdByUserId: actor.id, languages: [details.language], templateId: 'centre-english-idea',
      ...(cohort ? { cohortId: cohort._id, programmeId: cohort.programmeId } : {}),
      ...(trade ? { tradeKey: trade.key, sector: trade.sector } : {}),
      channel: 'import', status: 'DRAFT' });
    let storedId: mongoose.Types.ObjectId | undefined;
    let documentId: mongoose.Types.ObjectId | undefined;
    try {
      await applicant.save();
      await submission.save();
      storedId = await storeOriginal(`centre-plan-${submission._id}`, file.buffer,
        { submissionId: submission._id, ownerOrgId: actor.orgId, kind: 'pdf' });
      const document = await PitchDocument.create({ submissionId: submission._id, entrepreneurId: applicant._id, createdByUserId: actor.id,
        purpose: 'pitch', kind: 'pdf', declaredMime: 'application/pdf', clientFileId: `centre-${randomUUID()}`,
        bytes: file.buffer.length, receivedBytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'), state: 'complete',
        storageId: storedId, completedAt: new Date() });
      documentId = document._id;
      await recordAudit(req.auth, 'centre.import_plan', { type: 'submission', id: String(submission._id), orgId: actor.orgId },
        { pages: pageCount, bytes: file.buffer.length });
    } catch (error) {
      if (storedId) await deleteOriginal(storedId).catch(() => undefined);
      await Promise.all([Submission.deleteOne({ _id: submission._id }).setOptions({ tenant: { ownerOrgId: actor.orgId } }),
        Entrepreneur.deleteOne({ _id: applicant._id }).setOptions({ tenant: { homeOrgId: actor.orgId } }),
        ...(documentId ? [PitchDocument.deleteOne({ _id: documentId })] : [])]);
      throw error;
    }
    res.status(201).json({ submissionId: String(submission._id), state: 'PENDING_MODEL', document: { pages: pageCount, bytes: file.buffer.length } });
  });

  router.get('/submissions/:id/plan', async (req, res) => {
    const submissionId = id.parse(req.params.id);
    const submission = await Submission.findOne(scoped(submissionScope(req.auth!), { _id: submissionId }))
      .setOptions({ tenant: submissionScope(req.auth!) }).lean();
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const [document, applicant] = await Promise.all([
      PitchDocument.findOne({ submissionId: submission._id, entrepreneurId: submission.entrepreneurId,
        kind: 'pdf', purpose: 'pitch', state: 'complete' }).lean(),
      Entrepreneur.findOne({ _id: submission.entrepreneurId, homeOrgId: submission.ownerOrgId })
        .setOptions({ tenant: { homeOrgId: submission.ownerOrgId } }).select('+personal').lean(),
    ]);
    const personal = applicant?.personal && vault
      ? vault.open<{ name?: string; phone?: string }>(applicant.personal as Sealed, String(applicant._id)) : {};
    res.json({ submissionId, title: submission.title, status: submission.status,
      synthetic: String(submission.ownerOrgId) === PORTFOLIO_DEMO_ORG,
      processingConsent: await hasProcessingConsent(submission.entrepreneurId),
      applicant: { name: personal.name ?? null, phone: personal.phone ?? null },
      details: { district: applicant?.district ?? null, trade: applicant?.trade ?? null,
        language: applicant?.language ?? null, format: document ? 'pdf' : null },
      document: document ? { id: String(document._id), bytes: document.bytes, pages: 2,
        sha256: document.sha256, url: `/api/v1/centre/submissions/${submissionId}/plan/file` } : null });
  });

  router.post('/submissions/:id/processing-consent', (req, res, next) => {
    consentUpload(req, res, error => {
      if (error instanceof multer.MulterError) return next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'Consent recording must be 10 MB or smaller.'));
      next(error);
    });
  }, async (req, res) => {
    if (!['centre_assessor', 'cohort_lead'].includes(req.auth!.user.role))
      throw new HttpError(403, 'Only centre staff can record consent for an imported plan.');
    const submissionId = id.parse(req.params.id);
    const submission = await Submission.findOne(scoped(submissionScope(req.auth!), { _id: submissionId }))
      .setOptions({ tenant: submissionScope(req.auth!) });
    if (!submission) throw new HttpError(404, 'Submission not found.');
    if (submission.channel !== 'import' || submission.templateId !== 'centre-english-idea' || !submission.languages?.includes('en'))
      throw new HttpError(422, 'This consent recording path supports English centre imports only.');
    z.object({ confirmed: z.literal('true'), noticeVersion: z.literal(CONSENT_NOTICE_VERSION) }).strict().parse(req.body);
    if (await hasProcessingConsent(submission.entrepreneurId)) {
      res.json({ processingConsent: true }); return;
    }
    const file = req.file;
    const detectedMime = file && audioMime(file.buffer);
    if (!file || file.buffer.length < 1024 || !detectedMime)
      throw new HttpError(400, 'Attach a supported audio recording of the applicant giving consent.');
    if (!await hasPlayableAudio(file.buffer))
      throw new HttpError(422, 'The consent recording must contain at least two seconds of playable audio.');
    const storedId = await storeOriginal(`centre-consent-${submission._id}`, file.buffer,
      { submissionId: submission._id, ownerOrgId: submission.ownerOrgId, purpose: 'consent_evidence' });
    let evidence: InstanceType<typeof PitchDocument> | undefined;
    try {
      evidence = await PitchDocument.create({ submissionId: submission._id, entrepreneurId: submission.entrepreneurId,
        createdByUserId: req.auth!.user.id, purpose: 'consent_evidence', kind: 'audio', declaredMime: detectedMime,
        clientFileId: `centre-consent-${randomUUID()}`, bytes: file.buffer.length, receivedBytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'), state: 'complete', storageId: storedId,
        completedAt: new Date() });
      const granted = await grantConsent({ entrepreneurId: submission.entrepreneurId, purpose: 'processing', scope: 'all',
        method: 'assisted_recorded', language: 'en', noticeVersion: CONSENT_NOTICE_VERSION,
        grantedByUserId: req.auth!.user.id, evidenceDocumentId: evidence._id });
      if (!granted.created) {
        await PitchDocument.deleteOne({ _id: evidence._id });
        await deleteOriginal(storedId);
        res.json({ processingConsent: true }); return;
      }
      await recordAudit(req.auth, 'centre.record_processing_consent',
        { type: 'submission', id: submissionId, orgId: String(submission.ownerOrgId) },
        { evidenceDocumentId: String(evidence._id), noticeVersion: CONSENT_NOTICE_VERSION });
    } catch (error) {
      if (!await hasProcessingConsent(submission.entrepreneurId)) {
        if (evidence) await PitchDocument.deleteOne({ _id: evidence._id });
        await deleteOriginal(storedId).catch(() => undefined);
      }
      throw error;
    }
    res.status(201).json({ processingConsent: true });
  });

  router.get('/submissions/:id/plan/file', async (req, res) => {
    const submissionId = id.parse(req.params.id);
    const submission = await Submission.findOne(scoped(submissionScope(req.auth!), { _id: submissionId }))
      .setOptions({ tenant: submissionScope(req.auth!) }).select('entrepreneurId').lean();
    if (!submission) throw new HttpError(404, 'Submission not found.');
    const document = await PitchDocument.findOne({ submissionId: submission._id, entrepreneurId: submission.entrepreneurId,
      kind: 'pdf', purpose: 'pitch', state: 'complete' }).select('storageId').lean();
    if (!document?.storageId) throw new HttpError(404, 'Pitch plan not found.');
    const content = await readOriginal(document.storageId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="pitch-plan.pdf"',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    res.send(content);
  });

  return router;
}
