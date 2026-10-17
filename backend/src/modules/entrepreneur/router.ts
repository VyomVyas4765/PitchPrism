import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { HttpError } from '../../errors.js';
import { Org, Submission } from '../../models.js';
import { requirePermission, submissionScope } from '../../auth/authorization.js';
import { piiVault, type Sealed } from './pii-vault.js';
import { CONSENT_NOTICE_VERSION, CONSENT_NOTICE_VERSIONS, Consent, Entrepreneur, GENDERS, INDIAN_STATES, LANGUAGES, SHARING_SCOPES, type SharingScope } from './models.js';import { grantConsent, hasProcessingConsent, revokeConsent } from './consent.js';
import { intakeRouter } from './intake-router.js';
import { assistedRouter } from './assisted-router.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
// Printable text only: no control characters reach storage or later model redaction.
const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}]+$/u);
const profileInput = z.object({
  language: z.enum(LANGUAGES).optional(),
  name: text(100).optional(),
  district: text(80).optional(),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/).optional(),
  state: z.enum(INDIAN_STATES).optional(),
  trade: text(80).optional(),
  gender: z.enum(GENDERS).nullable().optional(),
}).strict();
const consentFields = {
  noticeVersion: z.enum(CONSENT_NOTICE_VERSIONS), language: z.enum(LANGUAGES),
  // Self-service consent only; recorded spoken consent belongs to the assisted applicant flow.
  method: z.enum(['app_tap', 'app_voice']),
};
const consentInput = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('processing'), ...consentFields }).strict(),
  z.object({ purpose: z.literal('partner_sharing'), scope: z.enum(SHARING_SCOPES), ...consentFields }).strict(),
]);

type ConsentRecord = { _id: unknown; purpose: string; scope: string; status: string; grantedAt: Date; revokedAt?: Date | null; noticeVersion: string; method: string; language: string };
const consentView = (consent: ConsentRecord) => ({
  id: String(consent._id), purpose: consent.purpose, scope: consent.scope, status: consent.status,
  grantedAt: consent.grantedAt, revokedAt: consent.revokedAt ?? null, noticeVersion: consent.noticeVersion,
  method: consent.method, language: consent.language,
});
async function consentState(entrepreneurId: string) {
  const active = await Consent.find({ entrepreneurId, status: 'active' }).lean();
  const find = (purpose: string, scope: string) => active.find(item => item.purpose === purpose && item.scope === scope);
  const processing = find('processing', 'all');
  return {
    processing: processing ? consentView(processing) : null,
    sharing: Object.fromEntries(SHARING_SCOPES.map(scope => {
      const consent = find('partner_sharing', scope);
      return [scope, consent ? consentView(consent) : null];
    })) as Record<SharingScope, ReturnType<typeof consentView> | null>,
  };
}

export function entrepreneurRouter(config: Config) {
  const router = Router();
  const vault = piiVault(config.PII_ENCRYPTION_KEY);
  // Per-route guard: a router-level guard would also run for other roles' routes under /api/v1.
  const entrepreneurOnly = requirePermission('submit_own');
  const self = (req: Request) => req.auth!.user.id;

  async function profileView(entrepreneurId: string) {
    const record = await Entrepreneur.findById(entrepreneurId).select('+personal').lean();
    if (record?.personal && !vault) throw new HttpError(503, 'Profile storage is not configured on this server.');
    const personal = record?.personal && vault ? vault.open<{ name?: string; gender?: string | null }>(record.personal as Sealed, entrepreneurId) : {};
    const profile = {
      name: personal.name ?? null, gender: personal.gender ?? null,
      district: record?.district ?? null, pincode: record?.pincode ?? null, state: record?.state ?? null, trade: record?.trade ?? null,
    };
    return {
      id: entrepreneurId, language: record?.language ?? null, profile,
      profileComplete: !!(profile.name && (profile.district || profile.pincode) && profile.trade),
      consents: await consentState(entrepreneurId), noticeVersion: CONSENT_NOTICE_VERSION,
    };
  }

  router.get('/me', entrepreneurOnly, async (req, res) => { res.json(await profileView(self(req))); });

  router.put('/me', entrepreneurOnly, async (req, res) => {
    const input = profileInput.parse(req.body);
    const id = self(req);
    const { language, gender, name, ...coarse } = input;
    const touchesProfile = name !== undefined || gender !== undefined || Object.keys(coarse).length > 0;
    // Language can be chosen before consent (M-01); personal details need processing consent (M-03 → M-04).
    if (touchesProfile && !await hasProcessingConsent(id)) throw new HttpError(403, 'Give consent to process your details before saving your profile.');
    const update: Record<string, unknown> = { ...coarse, ...(language ? { language } : {}) };
    if (name !== undefined || gender !== undefined) {
      if (!vault) throw new HttpError(503, 'Profile storage is not configured on this server.');
      const existing = await Entrepreneur.findById(id).select('+personal').lean();
      const current = existing?.personal ? vault.open<{ name?: string; gender?: string | null }>(existing.personal as Sealed, id) : {};
      update.personal = vault.seal({ ...current, ...(name !== undefined ? { name } : {}), ...(gender !== undefined ? { gender } : {}) }, id);
    }
    await Entrepreneur.updateOne({ _id: id }, { $set: update, $setOnInsert: { userId: id, createdVia: 'self' } }, { upsert: true, runValidators: true });
    res.json(await profileView(id));
  });

  router.post('/consents', entrepreneurOnly, async (req, res) => {
    const input = consentInput.parse(req.body);
    const id = self(req);
    const scope = input.purpose === 'partner_sharing' ? input.scope : 'all';
    if (input.purpose === 'partner_sharing' && !await hasProcessingConsent(id)) {
      throw new HttpError(409, 'Give consent to process your idea before choosing who it can be shared with.');
    }
    const { consent, created } = await grantConsent({
      entrepreneurId: id, purpose: input.purpose, scope, method: input.method,
      language: input.language, noticeVersion: input.noticeVersion, grantedByUserId: id,
    });
    res.status(created ? 201 : 200).json({ consent: consentView(consent), consents: await consentState(id) });
  });

  router.post('/consents/:id/revoke', entrepreneurOnly, async (req, res) => {
    const id = self(req);
    // Scoped by owner: another entrepreneur's consent ID is indistinguishable from a missing one.
    const consent = await revokeConsent(id, objectId.parse(req.params.id), id);
    if (!consent) throw new HttpError(404, 'Consent not found.');
    res.json({ consent: consentView(consent), consents: await consentState(id) });
  });

  // M-12 basis: the caller's own ideas and their current status, via the shared scope.
  router.get('/me/submissions', entrepreneurOnly, async (req, res) => {
    const submissions = await Submission.find(submissionScope(req.auth!)).select('title status').sort({ _id: -1 }).lean();
    res.json({ submissions: submissions.map(item => ({ id: String(item._id), title: item.title, status: item.status })) });
  });

  // M-18: a facilitator sees only submissions they created, with contact details (PRD §4 permission matrix).
  router.get('/assisted/submissions', requirePermission('submit_assisted'), async (req, res) => {
    const submissions = await Submission.find(submissionScope(req.auth!)).select('title status applicant').sort({ _id: -1 }).lean();
    res.json({ submissions: submissions.map(item => ({ id: String(item._id), title: item.title, status: item.status,
      applicant: { name: item.applicant?.name ?? null, phone: item.applicant?.phone ?? null } })) });
  });

  // M-15: which organisations can see each idea now, and why. Partners appear only with an active share.
  router.get('/me/passport', entrepreneurOnly, async (req, res) => {
    const id = self(req);
    const submissions = await Submission.find(submissionScope(req.auth!)).select('title status ownerOrgId sourceOrgId shares').lean();
    const orgIds = new Set<string>();
    for (const item of submissions) {
      orgIds.add(String(item.ownerOrgId));
      if (item.sourceOrgId) orgIds.add(String(item.sourceOrgId));
      for (const share of item.shares ?? []) if (share.active && share.orgId) orgIds.add(String(share.orgId));
    }
    const orgs = new Map((await Org.find({ _id: { $in: [...orgIds] } }).select('name type').lean()).map(org => [String(org._id), org]));
    const org = (orgId: unknown) => { const found = orgs.get(String(orgId)); return found ? { name: found.name, type: found.type } : null; };
    res.json({
      consents: await consentState(id),
      ideas: submissions.map(item => ({
        id: String(item._id), title: item.title, status: item.status,
        visibleTo: [
          { ...org(item.ownerOrgId), reason: 'owning_centre' },
          ...(item.sourceOrgId ? [{ ...org(item.sourceOrgId), reason: 'collected_by' }] : []),
          ...(item.shares ?? []).filter(share => share.active).map(share => ({
            ...org(share.orgId), reason: 'consented_share', shareId: String(share._id), partnerType: share.partnerType,
            contactAccepted: !!share.contactAccepted,
          })),
        ],
      })),
    });
  });

  // Intake and assisted mode live in this module and mount through this router (no extra app.ts edit).
  router.use(intakeRouter(config));
  router.use(assistedRouter(config));
  return router;
}
