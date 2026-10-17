import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { HttpError } from '../../errors.js';
import { requirePermission } from '../../auth/authorization.js';
import { grantConsent } from './consent.js';
import { MAX_BYTES, PitchDocument } from './intake-models.js';
import { CONSENT_NOTICE_VERSIONS, Consent, Entrepreneur, GENDERS, LANGUAGES, SHARING_SCOPES } from './models.js';
import { piiVault, type Sealed } from './pii-vault.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}]+$/u);
const applicantInput = z.object({
  clientApplicantId: clientId, language: z.enum(LANGUAGES), name: text(100), trade: text(80),
  district: text(80).optional(), pincode: z.string().trim().regex(/^[1-9]\d{5}$/).optional(), gender: z.enum(GENDERS).nullable().optional(),
}).strict().refine(input => input.district || input.pincode, { message: 'district or pincode' });
const evidenceInput = z.object({
  clientFileId: clientId, bytes: z.number().int().positive().max(MAX_BYTES.audio),
  sha256: z.string().regex(/^[a-f\d]{64}$/), mime: z.string().regex(/^audio\/[a-z0-9.+-]+$/i).max(80),
}).strict();
const consentFields = {
  noticeVersion: z.enum(CONSENT_NOTICE_VERSIONS), language: z.enum(LANGUAGES), evidenceDocumentId: objectId,
  // The facilitator confirms on screen that the applicant agreed (M-17: recording plus checkbox).
  checkboxConfirmed: z.literal(true),
};
const consentInput = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('processing'), ...consentFields }).strict(),
  z.object({ purpose: z.literal('partner_sharing'), scope: z.enum(SHARING_SCOPES), ...consentFields }).strict(),
]);

/** M-17: a facilitator registers applicants on a shared phone and records their spoken consent. */
export function assistedRouter(config: Config) {
  const router = Router();
  const vault = piiVault(config.PII_ENCRYPTION_KEY);
  const facilitatorOnly = requirePermission('submit_assisted');
  // A facilitator reaches only applicants they registered; others are indistinguishable from missing.
  const ownApplicant = async (req: Request) => {
    const applicant = await Entrepreneur.findOne({ _id: objectId.parse(req.params.id), createdVia: 'assisted' }).setOptions({ tenant: { facilitatorId: req.auth!.user.id } }).select('+personal');
    if (!applicant) throw new HttpError(404, 'Applicant not found.');
    return applicant;
  };
  const applicantView = async (applicant: InstanceType<typeof Entrepreneur>) => {
    const personal = applicant.personal && vault ? vault.open<{ name?: string; gender?: string | null }>(applicant.personal as Sealed, String(applicant._id)) : {};
    const consents = await Consent.find({ status: 'active' }).setOptions({ tenant: { entrepreneurId: applicant._id } }).select('purpose scope').lean();
    return {
      id: String(applicant._id), clientApplicantId: applicant.clientApplicantId, language: applicant.language,
      name: personal.name ?? null, district: applicant.district ?? null, pincode: applicant.pincode ?? null, trade: applicant.trade ?? null,
      processingConsent: consents.some(consent => consent.purpose === 'processing'),
      sharing: SHARING_SCOPES.filter(scope => consents.some(consent => consent.purpose === 'partner_sharing' && consent.scope === scope)),
    };
  };

  router.post('/assisted/applicants', facilitatorOnly, async (req, res) => {
    const input = applicantInput.parse(req.body);
    if (!vault) throw new HttpError(503, 'Profile storage is not configured on this server.');
    const user = req.auth!.user;
    const existing = await Entrepreneur.findOne({ clientApplicantId: input.clientApplicantId }).setOptions({ tenant: { facilitatorId: user.id } }).select('+personal');
    if (existing) { res.json(await applicantView(existing)); return; }
    const applicant = new Entrepreneur({ createdVia: 'assisted', facilitatorId: user.id, homeOrgId: user.orgId, clientApplicantId: input.clientApplicantId,
      language: input.language, trade: input.trade, district: input.district, pincode: input.pincode });
    applicant.set('personal', vault.seal({ name: input.name, gender: input.gender ?? null }, String(applicant._id)));
    try {
      await applicant.save();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const raced = await Entrepreneur.findOne({ clientApplicantId: input.clientApplicantId }).setOptions({ tenant: { facilitatorId: user.id } }).select('+personal');
      res.json(await applicantView(raced!)); return;
    }
    res.status(201).json(await applicantView(applicant));
  });

  router.get('/assisted/applicants', facilitatorOnly, async (req, res) => {
    const applicants = await Entrepreneur.find({ createdVia: 'assisted' }).setOptions({ tenant: { facilitatorId: req.auth!.user.id } }).select('+personal').sort({ _id: -1 }).limit(200);
    res.json({ applicants: await Promise.all(applicants.map(applicantView)) });
  });

  // The spoken-consent recording uploads through the same resumable content route as pitch files.
  router.post('/assisted/applicants/:id/evidence', facilitatorOnly, async (req, res) => {
    const input = evidenceInput.parse(req.body);
    const applicant = await ownApplicant(req);
    const user = req.auth!.user;
    const existing = await PitchDocument.findOne({ createdByUserId: user.id, clientFileId: input.clientFileId });
    if (existing) {
      if (String(existing.entrepreneurId) !== String(applicant._id) || existing.purpose !== 'consent_evidence' || existing.sha256 !== input.sha256) {
        throw new HttpError(409, 'This file ID is already used for different content.');
      }
      res.json({ id: String(existing._id), state: existing.state, receivedBytes: existing.receivedBytes, bytes: existing.bytes }); return;
    }
    const document = await PitchDocument.create({ entrepreneurId: applicant._id, createdByUserId: user.id, purpose: 'consent_evidence', kind: 'audio',
      declaredMime: input.mime.toLowerCase(), clientFileId: input.clientFileId, bytes: input.bytes, sha256: input.sha256 });
    res.status(201).json({ id: String(document._id), state: document.state, receivedBytes: 0, bytes: document.bytes });
  });

  router.post('/assisted/applicants/:id/consents', facilitatorOnly, async (req, res) => {
    const input = consentInput.parse(req.body);
    const applicant = await ownApplicant(req);
    const evidence = await PitchDocument.findOne({ _id: input.evidenceDocumentId, entrepreneurId: applicant._id,
      createdByUserId: req.auth!.user.id, purpose: 'consent_evidence', state: 'complete' });
    if (!evidence) throw new HttpError(409, 'Upload the applicant’s spoken consent recording first.');
    if (input.purpose === 'partner_sharing' && !await Consent.exists({ purpose: 'processing', status: 'active' }).setOptions({ tenant: { entrepreneurId: applicant._id } })) {
      throw new HttpError(409, 'Record processing consent before partner sharing.');
    }
    const { created } = await grantConsent({ entrepreneurId: applicant._id, purpose: input.purpose,
      scope: input.purpose === 'partner_sharing' ? input.scope : 'all', method: 'assisted_recorded', language: input.language,
      noticeVersion: input.noticeVersion, grantedByUserId: req.auth!.user.id, evidenceDocumentId: evidence._id });
    res.status(created ? 201 : 200).json(await applicantView(applicant));
  });

  return router;
}
