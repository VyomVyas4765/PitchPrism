/** Explicit, idempotent synthetic portfolio. Never seed real-workspace assessments or real consent.
 * Run: pnpm --filter @pitchprism/backend exec tsx src/modules/centre/seed-demo.ts --local
 */
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readConfig } from '../../config.js';
import { connectDatabase } from '../../database.js';
import { hashPassword } from '../../auth/password.js';
import { Cohort, Entrepreneur, Org, Programme, Submission, Trade, User } from '../../models.js';
import { piiVault } from '../entrepreneur/pii-vault.js';
import { PitchDocument } from '../entrepreneur/intake-models.js';
import { deleteOriginal, storeOriginal } from '../entrepreneur/storage.js';
import { CentreCase } from './model.js';
import { DOMAIN_KEYS, PORTFOLIO_DEMO_ORG } from './portfolio.js';

const config = readConfig();
if (config.NODE_ENV === 'production') throw new Error('Synthetic demo loading is forbidden in production.');
if (!process.argv.includes('--local')) throw new Error('Pass --local to load the isolated demo into explicit local development MongoDB.');
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD with at least 12 characters in ignored root .env.');
const vault = piiVault(config.PII_ENCRYPTION_KEY);
if (!vault) throw new Error('Set PII_ENCRYPTION_KEY before loading the synthetic demo.');
const oid = (n: number) => new mongoose.Types.ObjectId(`7de${n.toString(16).padStart(21, '0')}`);
const centreId = new mongoose.Types.ObjectId(PORTFOLIO_DEMO_ORG), userId = oid(2), programmeId = oid(3);
const weights = [10, 15, 15, 15, 10, 10, 15, 10];
const businesses = [
  { key: 'tailoring', label: 'Tailoring', sector: 'Textiles', titles: ['School uniform studio', 'Alterations at home', 'Custom festive clothing', 'Workwear stitching unit', 'Repair and reuse studio', 'Made-to-order boutique'],
    offering: 'Uniform stitching and clothing alterations', buyers: 'Parents of school children and local working families', materials: 'Cotton fabric, thread, buttons and sewing equipment', supplier: 'A district fabric wholesaler', competition: 'Two neighbourhood tailoring shops serve similar customers', price: 'Rs 450 per uniform set', monthly: '80 sets at Rs 450 gives Rs 36000 monthly sales', training: 'Completed a tailoring course and stitched ten trial orders' },
  { key: 'food_services', label: 'Food services', sector: 'Food', titles: ['Office lunch subscriptions', 'Millet snack kitchen', 'Breakfast delivery', 'Village catering service', 'Home bakery orders', 'Weekend meal service'],
    offering: 'Freshly cooked meal subscriptions with scheduled delivery', buyers: 'Office workers and students who need affordable meals', materials: 'Grains, vegetables, packaging and kitchen equipment', supplier: 'A produce seller and grain wholesaler in the district', competition: 'Three local lunch services offer fixed menus', price: 'Rs 80 per meal', monthly: '25 meals a day for 24 days at Rs 80 gives Rs 48000 sales', training: 'Completed food hygiene training and delivered a paid meal trial' },
  { key: 'repair_services', label: 'Repair services', sector: 'Services', titles: ['Mobile repair counter', 'Appliance repair visits', 'Bicycle maintenance hub', 'Solar equipment repairs', 'Farm tool servicing', 'Device care workshop'],
    offering: 'Repairs and preventive maintenance with transparent quotations', buyers: 'Local households and small businesses using everyday equipment', materials: 'Replacement components, repair tools and safety equipment', supplier: 'A district spare-parts distributor', competition: 'Two existing repair counters serve this market', price: 'Rs 250 average labour charge per job', monthly: '100 jobs at Rs 250 gives Rs 25000 labour revenue before costs', training: 'Completed practical repair training and performed supervised repairs' },
];
const questions = [
  ['offering', 'What products/services will you provide?'], ['customers', 'Customer segment'],
  ['market_research', 'Have you done any market research?'], ['raw_materials', 'What raw materials will you need?'],
  ['suppliers', 'Who will supply these raw materials?'], ['funding', 'Which are the avenues for raising funds?'],
  ['competition', 'Is there any competition for your business?'], ['unit_price', 'What is the price per unit?'],
  ['monthly_revenue', 'How much money do you expect to earn every month?'], ['location', 'Where will you start your business?'],
  ['experience', 'Do you have an existing business?'],
];
const evidenceFields = [['offering', 'customers'], ['customers'], ['market_research'], ['raw_materials', 'suppliers', 'funding'], ['competition'], ['offering', 'competition'], ['unit_price', 'monthly_revenue', 'funding'], ['experience']];
async function original(title: string, applicant: string, answers: Record<string, string>) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sources: Record<string, { page: number; bbox: number[] }> = {};
  for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
    const page = pdf.addPage([595, 842]);
    page.drawText('Business Idea', { x: 45, y: 800, size: 20, font });
    page.drawText('SYNTHETIC DEMO - illustrative assessment, not an actual applicant', { x: 45, y: 779, size: 8, font, color: rgb(.4, .45, .35) });
    page.drawText(`Name ${applicant}`, { x: 45, y: 748, size: 10, font });
    page.drawText(title, { x: 45, y: 727, size: 11, font });
    const rows = questions.slice(pageIndex ? 6 : 0, pageIndex ? 11 : 6);
    rows.forEach(([field, question], index) => {
      const top = 147 + index * 80;
      page.drawText(question!, { x: 45, y: 842 - top - 10, maxWidth: 250, size: 9, font, lineHeight: 12 });
      page.drawText(answers[field!] || '', { x: 312, y: 842 - top - 10, maxWidth: 229, size: 9, font, lineHeight: 12 });
      sources[field!] = { page: pageIndex + 1, bbox: [312, top, 545, top + 66] };
    });
  }
  return { bytes: Buffer.from(await pdf.save()), sources };
}
await connectDatabase({ ...config, MONGODB_URI: 'mongodb://127.0.0.1:27017/pitchprism', MONGODB_DNS_SERVERS: '' });
try {
  const existing = await Org.findById(centreId);
  if (existing && existing.name !== 'Synthetic evaluator demo') throw new Error('Reserved demo workspace ID is already in use.');
  await Org.updateOne({ _id: centreId }, { $setOnInsert: { name: 'Synthetic evaluator demo', type: 'centre', active: true } }, { upsert: true, runValidators: true });
  const email = 'evaluator.demo@pitchprism.test';
  const staff = await User.findOne({ email });
  if (staff && String(staff.orgId) !== String(centreId)) throw new Error('The demo email belongs to another organisation.');
  await User.updateOne({ email }, { $setOnInsert: { _id: userId, displayName: 'Demo evaluator', email, role: 'centre_assessor', orgId: centreId, passwordHash: await hashPassword(password) } }, { upsert: true, runValidators: true });
  const actor = await User.findOne({ email });
  await Programme.updateOne({ _id: programmeId }, { $setOnInsert: { orgId: centreId, name: 'Synthetic entrepreneurship programme', status: 'active' } }, { upsert: true, runValidators: true });
  for (let c = 0; c < 2; c++) await Cohort.updateOne({ _id: oid(10 + c) }, { $setOnInsert: { orgId: centreId, programmeId, name: c ? 'October intake' : 'September intake', status: 'open' } }, { upsert: true, runValidators: true });
  for (const trade of businesses) await Trade.updateOne({ key: trade.key }, { $setOnInsert: { key: trade.key, label: trade.label, sector: trade.sector, active: true } }, { upsert: true, runValidators: true });
  let created = 0;
  for (let t = 0; t < businesses.length; t++) for (let j = 0; j < 6; j++) {
    const trade = businesses[t]!, n = t * 6 + j, submissionId = oid(100 + n), applicantId = oid(200 + n);
    if (await Submission.exists({ _id: submissionId })) {
      const old = await CentreCase.findOne({ submissionId, ownerOrgId: centreId }).lean();
      if (!process.argv.includes('--refresh-fixtures') || old?.decision || old?.evaluation?.promptVersion !== 'fixture-no-inference') continue;
      // An explicit refresh replaces only untouched, illustrative fixtures in the reserved demo centre.
      const documents = await PitchDocument.find({ submissionId, entrepreneurId: applicantId });
      for (const document of documents) if (document.storageId) await deleteOriginal(document.storageId);
      await PitchDocument.deleteMany({ submissionId, entrepreneurId: applicantId });
      await CentreCase.deleteOne({ _id: old._id });
      await Submission.deleteOne({ _id: submissionId, ownerOrgId: centreId });
      await Entrepreneur.deleteOne({ _id: applicantId, homeOrgId: centreId });
    }
    const title = trade.titles[j]!, applicantName = `Synthetic Nila ${n + 1}`;
    const answers: Record<string, string> = { offering: trade.offering, customers: trade.buyers,
      market_research: j % 3 ? 'I expect demand but have not interviewed potential buyers yet' : 'Interviewed 20 potential buyers; 12 requested a paid trial',
      raw_materials: trade.materials, suppliers: trade.supplier, funding: 'Rs 80000 setup: Rs 30000 savings and Rs 50000 proposed loan',
      competition: trade.competition, unit_price: trade.price, monthly_revenue: trade.monthly, location: 'Pune, Maharashtra',
      experience: j % 4 ? 'No' : `Yes, ${trade.training}` };
    if (j === 5) for (const key of ['market_research', 'monthly_revenue', 'raw_materials', 'suppliers', 'funding']) answers[key] = '';
    const document = await original(title, applicantName, answers);
    const fields: Record<string, { state: string; evidence: string[] }> = {};
    const segments = questions.flatMap(([field], i) => {
      if (field === 'experience' && answers[field] === 'No') return [];
      if (!answers[field!]) { fields[field!] = { state: 'missing', evidence: [] }; return []; }
      const segId = `s_${String(i + 1).padStart(4, '0')}`;
      fields[field!] = { state: 'answered', evidence: [segId] };
      return [{ segId, textEn: field === 'location' ? 'Applicant provided a planned business location; exact address withheld.' : answers[field!]!, lang: 'en', source: { type: 'pdf', documentId: String(oid(300 + n)), ...document.sources[field!] } }];
    });
    const scores = DOMAIN_KEYS.map((key, d) => {
      const evidence = evidenceFields[d]!.flatMap(field => fields[field]?.evidence ?? []).slice(0, 3);
      const levels = [[4, 5, 4, 4, 4, 4, 4, 4], [3, 3, 3, 3, 2, 3, 3, 3], [2, 2, 2, 3, 2, 2, 2, 2], [4, 3, 4, 3, 3, 3, 3, 3], [5, 4, 4, 5, 4, 4, 4, 5], [4, 4, 4, 4, 3, 4, 4, 3]];
      const score = evidence.length ? levels[j]![d]! : null;
      return { key, score, weight: weights[d], evidence, runs: score === null ? [] : [score, score], confidence: score === null ? 'none' : j === 3 ? 'low' : 'medium',
        reason: score === null ? 'Not assessed: no cited evidence.' : 'Illustrative demo judgement for the cited synthetic claim. Not a model-generated or calibrated result.' };
    });
    const coverage = scores.reduce((sum, d, i) => sum + (d.score === null ? 0 : weights[i]!), 0);
    const potential = Math.round(scores.reduce((sum, d, i) => sum + (d.score ?? 0) * weights[i]!, 0) * 100 / (5 * coverage));
    const completeness = j === 5 ? 60 : 100;
    const band = potential >= 70 ? 'Strong' : potential >= 50 ? 'Promising' : 'Not yet';
    const pathway = j === 5 ? 'Request information' : band === 'Strong' ? 'Deeper evaluation' : 'Mentoring';
    await Entrepreneur.create({ _id: applicantId, homeOrgId: centreId, createdVia: 'import', district: 'Pune', trade: trade.label, language: 'en', personal: vault.seal({ name: applicantName }, String(applicantId)) });
    await Submission.create({ _id: submissionId, title, summaryEn: `Synthetic demo: ${trade.offering}. ${trade.buyers}.`, ownerOrgId: centreId, entrepreneurId: applicantId,
      createdByUserId: actor!._id, programmeId, cohortId: oid(10 + j % 2), tradeKey: trade.key, sector: trade.sector, languages: ['en'], channel: 'import', templateId: 'synthetic-portfolio-v1', status: 'READY', shares: [] });
    const storageId = await storeOriginal(`synthetic-portfolio-${submissionId}`, document.bytes, { submissionId, ownerOrgId: centreId, kind: 'pdf', synthetic: true });
    await PitchDocument.create({ _id: oid(300 + n), submissionId, entrepreneurId: applicantId, createdByUserId: actor!._id, purpose: 'pitch', kind: 'pdf', declaredMime: 'application/pdf', clientFileId: `synthetic-portfolio-${n}`, bytes: document.bytes.length,
      receivedBytes: document.bytes.length, sha256: createHash('sha256').update(document.bytes).digest('hex'), state: 'complete', storageId, completedAt: new Date() });
    const flags = j === 5 ? [{ key: 'missing', field: 'market_research', evidence: [] }] : [];
    await CentreCase.create({ submissionId, ownerOrgId: centreId, state: j === 3 ? 'NEEDS_ATTENTION' : 'READY', input: { template: 'edp-idea-brief', context: { businessType: trade.label, plannedBusinessLocation: { district: 'Pune', state: 'Maharashtra', source: 'pdf', evidence: fields.location?.evidence } }, fields, segments },
      evaluation: { rubricVersion: 'edp-draft-v1', promptVersion: 'fixture-no-inference', domains: scores, potential, completeness, coverage, band, pathway, flags, needsAttention: j === 3 }, quality: { completeness, flags },
      planDraft: { sections: [{ heading: 'Synthetic business overview', textEn: `${trade.offering}. ${trade.buyers}.`, evidence: fields.offering?.evidence }] },
      followUps: [{ field: 'market_research', questionEn: 'What paid customer trials or market checks can support these claims?', reason: 'Validate stated demand' }] });
    created++;
  }
  console.log(`Synthetic evaluator workspace ready: ${created} new illustrative cases, 18 total fixture slots. Sign in as evaluator.demo@pitchprism.test using SEED_PASSWORD from ignored .env. Existing decisions are preserved. No real applicant consent was created.`);
} finally { await mongoose.disconnect(); }
