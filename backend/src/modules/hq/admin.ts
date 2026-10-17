import { Router } from 'express';
import { z } from 'zod';
import { domainSchema, ORG_TYPES, ROLE_PERMISSIONS, type CanonicalField, type Permission } from '@pitchprism/contracts';
import type { RequestHandler } from 'express';
import { requirePermission } from '../../auth/authorization.js';
import type { AuthContext } from '../../auth/session.js';
import { HttpError } from '../../errors.js';
import { Cohort, Org, Programme, RoutingRule, Rubric, Trade, User } from '../../models.js';
import { recordAudit } from '../../platform/audit.js';
import { LANGUAGE_CODES, objectId, shortText, textList } from '../../platform/validation.js';

// HQ configuration (W-01 organisations, W-02 programmes and rubrics, W-32 cohorts and trades, W-04 routing).
// Centre staff manage cohorts of their own centre; everything else here is HQ only.
const CANONICAL_FIELDS = (domainSchema as { definitions: Record<string, { enum?: string[] }> }).definitions.CanonicalField!.enum! as [CanonicalField, ...CanonicalField[]];
const languages = z.array(z.enum(LANGUAGE_CODES)).max(6);
const changed = (input: object) => ({ fields: Object.keys(input).sort().join(',') });

function anyPermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) { next(new HttpError(401, 'Please sign in.')); return; }
    if (!permissions.some(permission => ROLE_PERMISSIONS[req.auth!.user.role].includes(permission))) { next(new HttpError(403, 'Your role cannot perform this action.')); return; }
    next();
  };
}
/** HQ sees every organisation's records; centre staff only their own centre's. */
const orgScope = (auth: AuthContext) => auth.user.role === 'hq_admin' ? {} : { orgId: auth.user.orgId };

const orgInput = z.object({
  name: shortText(), type: z.enum(ORG_TYPES), parentOrgId: objectId.optional(), active: z.boolean().optional(),
  fundingMode: z.enum(['lender', 'csr']).optional(), state: shortText(80).optional(), districts: textList(),
  languages: languages.optional(), sectors: textList(), tradeKeys: textList(60, 200),
}).partial({ districts: true, sectors: true, tradeKeys: true }).strict();

const rubricDomain = z.object({
  key: z.string().regex(/^[a-z_]{2,40}$/), label: shortText(80), weight: z.number().min(0).max(100),
  lowDescriptor: shortText(400), highDescriptor: shortText(400), evidenceFields: z.array(z.enum(CANONICAL_FIELDS)).max(20).optional(),
}).strict();
const rubricBody = z.object({
  name: shortText(), domains: z.array(rubricDomain).min(1).max(20),
  completenessWeights: z.partialRecord(z.enum(CANONICAL_FIELDS), z.number().min(0).max(100)).optional(),
  bands: z.object({ strong: z.number().min(0).max(100), promising: z.number().min(0).max(100), minCoverage: z.number().min(0).max(100) }).strict(),
  pathwayRules: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((rubric, ctx) => {
  const total = rubric.domains.reduce((sum, domain) => sum + domain.weight, 0);
  if (Math.abs(total - 100) > 0.001) ctx.addIssue({ code: 'custom', path: ['domains'], message: `Domain weights must add up to 100 (now ${total}).` });
  if (new Set(rubric.domains.map(domain => domain.key)).size !== rubric.domains.length) ctx.addIssue({ code: 'custom', path: ['domains'], message: 'Each domain key must be unique.' });
  if (rubric.bands.promising > rubric.bands.strong) ctx.addIssue({ code: 'custom', path: ['bands'], message: 'The promising threshold cannot be above strong.' });
});
const rubricKey = z.string().regex(/^[a-z0-9_-]{2,60}$/, 'Use lower-case letters, digits, - or _.');

const tradeInput = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,60}$/), label: shortText(120), sector: shortText(80),
  nicCodes: z.array(z.string().regex(/^\d{2,5}$/)).max(20).optional(),
  osmTags: z.array(z.string().regex(/^[a-z_:]+=[A-Za-z0-9_;:-]+$/, 'Use OSM key=value tags.')).max(20).optional(),
  synonyms: z.partialRecord(z.enum(LANGUAGE_CODES), textList(120, 40)).optional(), active: z.boolean().optional(),
}).strict();

const routingInput = z.object({
  name: shortText(), partnerOrgId: objectId, partnerType: z.enum(['sector_partner', 'funding_partner']),
  tradeKeys: textList(60, 200).optional(), sectors: textList().optional(), districts: textList().optional(), active: z.boolean().default(true),
}).strict();

export function hqRouter() {
  const router = Router();

  // ---- Organisations (W-01)
  router.get('/orgs', requirePermission('manage_orgs'), async (_req, res) => {
    const [orgs, counts] = await Promise.all([
      Org.find().sort({ type: 1, name: 1 }).lean(),
      User.aggregate<{ _id: unknown; staff: number }>([{ $match: { role: { $ne: 'entrepreneur' }, disabled: { $ne: true } } }, { $group: { _id: '$orgId', staff: { $sum: 1 } } }]),
    ]);
    const staff = new Map(counts.map(row => [String(row._id), row.staff]));
    res.json({ organisations: orgs.map(org => ({ ...org, id: String(org._id), _id: undefined, staff: staff.get(String(org._id)) ?? 0 })) });
  });
  router.post('/orgs', requirePermission('manage_orgs'), async (req, res) => {
    const input = orgInput.parse(req.body);
    if (input.type === 'hq') throw new HttpError(400, 'There is one HQ organisation; create centres and partners instead.');
    if (input.type === 'funding_partner' && !input.fundingMode) throw new HttpError(400, 'Choose whether the funding partner is a lender or CSR funder.');
    if (input.type !== 'funding_partner' && input.fundingMode) throw new HttpError(400, 'Only funding partners have a funding mode.');
    // Hub and spoke (PRD section 5): implementation partners report to a centre; every other organisation to HQ.
    let parentOrgId = req.auth!.user.orgId!;
    if (input.type === 'implementation_partner') {
      const parent = input.parentOrgId ? await Org.findOne({ _id: input.parentOrgId, active: true }).lean() : null;
      if (!parent || parent.type !== 'centre') throw new HttpError(400, 'Choose the active centre this implementation partner reports to.');
      parentOrgId = String(parent._id);
    } else if (input.parentOrgId) throw new HttpError(400, 'This organisation type reports to HQ.');
    const org = await Org.create({ ...input, parentOrgId });
    await recordAudit(req.auth, 'org.create', { type: 'org', id: String(org._id), orgId: String(org._id) }, { orgType: org.type });
    res.status(201).json({ organisation: { ...org.toObject(), id: String(org._id) } });
  });
  router.patch('/orgs/:id', requirePermission('manage_orgs'), async (req, res) => {
    const id = objectId.parse(req.params.id);
    // Type and parent are fixed at creation: re-parenting would move an organisation's data between hubs.
    const input = orgInput.omit({ type: true, parentOrgId: true }).partial().strict().parse(req.body);
    const org = await Org.findById(id);
    if (!org) throw new HttpError(404, 'Organisation not found.');
    if (org.type === 'hq' && input.active === false) throw new HttpError(400, 'The HQ organisation cannot be deactivated.');
    if (input.fundingMode && org.type !== 'funding_partner') throw new HttpError(400, 'Only funding partners have a funding mode.');
    org.set(input);
    await org.save();
    await recordAudit(req.auth, input.active === false ? 'org.deactivate' : 'org.update', { type: 'org', id, orgId: id }, changed(input));
    res.json({ organisation: { ...org.toObject(), id } });
  });

  // ---- Programmes (W-02)
  router.get('/programmes', anyPermission('configure_rubrics', 'manage_cohorts'), async (req, res) => {
    const programmes = await Programme.find(orgScope(req.auth!)).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ programmes: programmes.map(item => ({ ...item, id: String(item._id) })) });
  });
  const programmeInput = z.object({
    orgId: objectId, name: shortText(), rubricKey: rubricKey.optional(), languages: languages.optional(),
    districts: textList().optional(), status: z.enum(['draft', 'active', 'closed']).default('draft'),
  }).strict();
  router.post('/programmes', requirePermission('configure_rubrics'), async (req, res) => {
    const input = programmeInput.parse(req.body);
    const org = await Org.findById(input.orgId).lean();
    if (!org || org.type !== 'centre' || !org.active) throw new HttpError(400, 'Programmes belong to an active centre.');
    if (input.rubricKey && !await Rubric.exists({ rubricKey: input.rubricKey })) throw new HttpError(400, 'That rubric does not exist.');
    const programme = await Programme.create(input);
    await recordAudit(req.auth, 'programme.create', { type: 'programme', id: String(programme._id), orgId: input.orgId });
    res.status(201).json({ programme: { ...programme.toObject(), id: String(programme._id) } });
  });
  router.patch('/programmes/:id', requirePermission('configure_rubrics'), async (req, res) => {
    const id = objectId.parse(req.params.id);
    const input = programmeInput.omit({ orgId: true }).partial().strict().parse(req.body);
    if (input.rubricKey && !await Rubric.exists({ rubricKey: input.rubricKey })) throw new HttpError(400, 'That rubric does not exist.');
    const programme = await Programme.findByIdAndUpdate(id, { $set: input }, { returnDocument: 'after', runValidators: true }).lean();
    if (!programme) throw new HttpError(404, 'Programme not found.');
    await recordAudit(req.auth, 'programme.update', { type: 'programme', id, orgId: String(programme.orgId) }, changed(input));
    res.json({ programme: { ...programme, id } });
  });

  // ---- Versioned rubrics (W-02). A save never edits a version in place: it creates the next draft version.
  // Publishing archives the previously published version, so a submission keeps the exact version it was scored with.
  router.get('/rubrics', anyPermission('configure_rubrics', 'review_centre'), async (_req, res) => {
    const rubrics = await Rubric.find().sort({ rubricKey: 1, version: -1 }).lean();
    const families = new Map<string, { rubricKey: string; name: string; published: number | null; latest: number; versions: unknown[] }>();
    for (const rubric of rubrics) {
      const family = families.get(rubric.rubricKey) ?? { rubricKey: rubric.rubricKey, name: rubric.name, published: null, latest: rubric.version, versions: [] };
      if (rubric.status === 'published' && family.published === null) family.published = rubric.version;
      family.versions.push({ ...rubric, id: String(rubric._id) });
      families.set(rubric.rubricKey, family);
    }
    res.json({ rubrics: [...families.values()] });
  });
  router.get('/rubrics/:key/:version', anyPermission('configure_rubrics', 'review_centre'), async (req, res) => {
    const rubric = await Rubric.findOne({ rubricKey: rubricKey.parse(req.params.key), version: z.coerce.number().int().min(1).parse(req.params.version) }).lean();
    if (!rubric) throw new HttpError(404, 'Rubric version not found.');
    res.json({ rubric: { ...rubric, id: String(rubric._id) } });
  });
  router.post('/rubrics', requirePermission('configure_rubrics'), async (req, res) => {
    const { rubricKey: key, ...body } = z.object({ rubricKey }).passthrough().parse(req.body);
    const input = rubricBody.parse(body);
    const latest = await Rubric.findOne({ rubricKey: key }).sort({ version: -1 }).select('version').lean();
    const version = (latest?.version ?? 0) + 1;
    try {
      const rubric = await Rubric.create({ ...input, rubricKey: key, version, status: 'draft', createdByUserId: req.auth!.user.id });
      await recordAudit(req.auth, 'rubric.version_create', { type: 'rubric', id: String(rubric._id) }, { rubricKey: key, version });
      res.status(201).json({ rubric: { ...rubric.toObject(), id: String(rubric._id) } });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'Someone saved this rubric at the same time. Reload and try again.');
      throw error;
    }
  });
  router.post('/rubrics/:key/:version/publish', requirePermission('configure_rubrics'), async (req, res) => {
    const key = rubricKey.parse(req.params.key);
    const version = z.coerce.number().int().min(1).parse(req.params.version);
    const rubric = await Rubric.findOne({ rubricKey: key, version });
    if (!rubric) throw new HttpError(404, 'Rubric version not found.');
    if (rubric.status === 'archived') throw new HttpError(400, 'Archived versions cannot be republished; save a new version instead.');
    await Rubric.updateMany({ rubricKey: key, status: 'published', version: { $ne: version } }, { $set: { status: 'archived' } });
    rubric.status = 'published';
    await rubric.save();
    await recordAudit(req.auth, 'rubric.publish', { type: 'rubric', id: String(rubric._id) }, { rubricKey: key, version });
    res.json({ rubric: { ...rubric.toObject(), id: String(rubric._id) } });
  });

  // ---- Cohorts (W-32): centre staff for their centre, HQ for any.
  router.get('/cohorts', anyPermission('manage_cohorts', 'review_centre'), async (req, res) => {
    const { programmeId } = z.object({ programmeId: objectId.optional() }).parse(req.query);
    const cohorts = await Cohort.find({ ...orgScope(req.auth!), ...(programmeId ? { programmeId } : {}) }).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ cohorts: cohorts.map(item => ({ ...item, id: String(item._id) })) });
  });
  const cohortInput = z.object({
    programmeId: objectId, name: shortText(), intakeStart: z.coerce.date().optional(), intakeEnd: z.coerce.date().optional(),
    districts: textList().optional(), status: z.enum(['planned', 'open', 'closed']).default('planned'),
  }).strict();
  const checkDates = (input: { intakeStart?: Date; intakeEnd?: Date }) => {
    if (input.intakeStart && input.intakeEnd && input.intakeEnd < input.intakeStart) throw new HttpError(400, 'The intake must end after it starts.');
  };
  router.post('/cohorts', requirePermission('manage_cohorts'), async (req, res) => {
    const input = cohortInput.parse(req.body);
    checkDates(input);
    const programme = await Programme.findOne({ _id: input.programmeId, ...orgScope(req.auth!) }).lean();
    if (!programme) throw new HttpError(404, 'Programme not found.');
    if (programme.status === 'closed') throw new HttpError(400, 'This programme is closed.');
    const cohort = await Cohort.create({ ...input, orgId: programme.orgId });
    await recordAudit(req.auth, 'cohort.create', { type: 'cohort', id: String(cohort._id), orgId: String(programme.orgId) });
    res.status(201).json({ cohort: { ...cohort.toObject(), id: String(cohort._id) } });
  });
  router.patch('/cohorts/:id', requirePermission('manage_cohorts'), async (req, res) => {
    const id = objectId.parse(req.params.id);
    const input = cohortInput.omit({ programmeId: true }).partial().strict().parse(req.body);
    const cohort = await Cohort.findOne({ _id: id, ...orgScope(req.auth!) });
    if (!cohort) throw new HttpError(404, 'Cohort not found.');
    cohort.set(input);
    checkDates({ intakeStart: cohort.intakeStart ?? undefined, intakeEnd: cohort.intakeEnd ?? undefined });
    await cohort.save();
    await recordAudit(req.auth, 'cohort.update', { type: 'cohort', id, orgId: String(cohort.orgId) }, changed(input));
    res.json({ cohort: { ...cohort.toObject(), id } });
  });

  // ---- Trades (W-32): every staff member reads the list; HQ edits it.
  router.get('/trades', async (req, res) => {
    if (req.auth!.user.role === 'entrepreneur') throw new HttpError(403, 'Your role cannot perform this action.');
    const trades = await Trade.find().sort({ sector: 1, label: 1 }).lean();
    res.json({ trades: trades.map(item => ({ ...item, id: String(item._id) })) });
  });
  router.post('/trades', requirePermission('manage_trades'), async (req, res) => {
    const input = tradeInput.parse(req.body);
    try {
      const trade = await Trade.create(input);
      await recordAudit(req.auth, 'trade.create', { type: 'trade', id: String(trade._id) }, { key: input.key });
      res.status(201).json({ trade: { ...trade.toObject(), id: String(trade._id) } });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new HttpError(409, 'A trade with this key already exists.');
      throw error;
    }
  });
  router.patch('/trades/:id', requirePermission('manage_trades'), async (req, res) => {
    const id = objectId.parse(req.params.id);
    // The key is referenced by submissions and routing rules, so it never changes.
    const input = tradeInput.omit({ key: true }).partial().strict().parse(req.body);
    const trade = await Trade.findByIdAndUpdate(id, { $set: input }, { returnDocument: 'after', runValidators: true }).lean();
    if (!trade) throw new HttpError(404, 'Trade not found.');
    await recordAudit(req.auth, 'trade.update', { type: 'trade', id }, changed(input));
    res.json({ trade: { ...trade, id } });
  });

  // ---- Partner routing rules (W-04). Rules suggest partners; sharing still needs consent and a reviewer's action.
  router.get('/routing-rules', requirePermission('manage_routing'), async (_req, res) => {
    const rules = await RoutingRule.find().sort({ createdAt: -1 }).lean();
    res.json({ rules: rules.map(item => ({ ...item, id: String(item._id) })) });
  });
  const checkPartner = async (orgId: string, partnerType: string) => {
    const org = await Org.findById(orgId).lean();
    if (!org || org.type !== partnerType) throw new HttpError(400, 'Choose an organisation of the matching partner type.');
  };
  router.post('/routing-rules', requirePermission('manage_routing'), async (req, res) => {
    const input = routingInput.parse(req.body);
    await checkPartner(input.partnerOrgId, input.partnerType);
    const rule = await RoutingRule.create({ ...input, createdByUserId: req.auth!.user.id });
    await recordAudit(req.auth, 'routing.create', { type: 'routing_rule', id: String(rule._id), orgId: input.partnerOrgId });
    res.status(201).json({ rule: { ...rule.toObject(), id: String(rule._id) } });
  });
  router.patch('/routing-rules/:id', requirePermission('manage_routing'), async (req, res) => {
    const id = objectId.parse(req.params.id);
    const input = routingInput.partial().strict().parse(req.body);
    const rule = await RoutingRule.findById(id);
    if (!rule) throw new HttpError(404, 'Routing rule not found.');
    rule.set(input);
    await checkPartner(String(rule.partnerOrgId), rule.partnerType);
    await rule.save();
    await recordAudit(req.auth, 'routing.update', { type: 'routing_rule', id, orgId: String(rule.partnerOrgId) }, changed(input));
    res.json({ rule: { ...rule.toObject(), id } });
  });
  router.delete('/routing-rules/:id', requirePermission('manage_routing'), async (req, res) => {
    const id = objectId.parse(req.params.id);
    const rule = await RoutingRule.findByIdAndDelete(id).lean();
    if (!rule) throw new HttpError(404, 'Routing rule not found.');
    await recordAudit(req.auth, 'routing.delete', { type: 'routing_rule', id, orgId: String(rule.partnerOrgId) });
    res.status(204).end();
  });
  return router;
}
