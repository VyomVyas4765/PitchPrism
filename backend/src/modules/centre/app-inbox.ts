import { Router } from 'express';
import type { Config } from '../../config.js';
import { HttpError } from '../../errors.js';
import { submissionScope } from '../../auth/authorization.js';
import { Job, Submission } from '../../models.js';
import { recordAudit } from '../../platform/audit.js';
import { applicantContact, applicantForCentre, applicantProfile } from '../entrepreneur/applicant.js';
import { Pitch } from '../entrepreneur/intake-models.js';
import { piiVault } from '../entrepreneur/pii-vault.js';
import { CentreCase } from './model.js';

// Live inbox (evaluator dashboard "Live from app"): only the plans entrepreneurs sent with the app's "Send to
// evaluator" button, newest first, each with its evaluation progress, the applicant's details and the Business
// Idea Brief they sent. Chats still in progress and demo/batch records are not listed here.
export function appInboxRouter(config?: Config) {
  const router = Router();
  const vault = config?.PII_ENCRYPTION_KEY ? piiVault(config.PII_ENCRYPTION_KEY) : null;

  router.get('/app-submissions', async (req, res) => {
    const auth = req.auth!;
    if (!['centre_assessor', 'cohort_lead', 'hq_admin'].includes(auth.user.role)) throw new HttpError(403, 'Centre staff only.');
    const tenant = submissionScope(auth);
    // A plan counts as sent once its evaluator job exists (the button queues a job from the quality stage).
    const jobs = await Job.find({ fromStage: 'quality', reason: 'new' }).setOptions({ tenant: 'system' })
      .select('submissionId status currentStage createdAt finishedAt error').sort({ createdAt: -1 }).limit(500).lean();
    const latest = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) if (!latest.has(String(job.submissionId))) latest.set(String(job.submissionId), job);
    const submissions = await Submission.find({ _id: { $in: [...latest.keys()] } }).setOptions({ tenant })
      .select('title status ownerOrgId entrepreneurId updatedAt').lean();
    const ids = submissions.map(item => item._id);
    const [cases, pitches] = await Promise.all([
      CentreCase.find({ submissionId: { $in: ids } }).select('submissionId state evaluation.potential evaluation.band evaluation.pathway decision.decision decision.at interview').lean(),
      Pitch.find({ submissionId: { $in: ids }, mode: 'chat' }).select('submissionId language submittedAt').lean(),
    ]);
    const caseById = new Map(cases.map(item => [String(item.submissionId), item]));
    const pitchById = new Map(pitches.map(item => [String(item.submissionId), item]));
    const items = await Promise.all(submissions.map(async submission => {
      const id = String(submission._id);
      const job = latest.get(id)!, item = caseById.get(id), pitch = pitchById.get(id);
      const applicant = await applicantForCentre(submission.entrepreneurId, submission.ownerOrgId);
      const contact = applicantContact(applicant, vault);
      const evaluation = item?.evaluation as { potential?: number; band?: string; pathway?: string } | undefined;
      return {
        submissionId: id, title: submission.title, status: submission.status, language: pitch?.language ?? null,
        sentAt: job.createdAt ?? null, evaluatedAt: job.finishedAt ?? null,
        evaluation: { job: job.status, stage: job.currentStage ?? null, failed: job.status === 'failed' ? job.error?.message ?? 'Evaluation failed.' : null,
          state: item?.state ?? null, potential: evaluation?.potential ?? null, band: evaluation?.band ?? null, pathway: evaluation?.pathway ?? null },
        reviewAvailable: !!item?.evaluation,
        decision: (item?.decision as { decision?: string; at?: string } | undefined)?.decision
          ? { decision: (item!.decision as { decision: string }).decision, at: (item!.decision as { at?: string }).at ?? null } : null,
        interview: (item as { interview?: unknown } | undefined)?.interview ?? null,
        applicant: { name: contact.name, phone: contact.phone, ...applicantProfile(applicant, vault) },
        brief: pitch ? { url: `/api/v1/submissions/${id}/brief` } : null,
      };
    }));
    items.sort((a, b) => new Date(b.sentAt ?? 0).getTime() - new Date(a.sentAt ?? 0).getTime());
    await recordAudit(auth, 'centre.app_inbox_view', { type: 'centre', ...(auth.user.orgId ? { id: String(auth.user.orgId), orgId: String(auth.user.orgId) } : {}) }, { count: items.length });
    res.json({ items });
  });
  return router;
}
