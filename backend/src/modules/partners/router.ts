import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requirePermission, submissionScope } from '../../auth/authorization.js';
import { HttpError } from '../../errors.js';
import { Submission } from '../../models.js';

const queryInput = z.object({
  status: z.enum(['DRAFT', 'READY', 'SHORTLISTED']).optional(),
  after: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.string().regex(/^\d{1,2}$/).transform(Number)
    .pipe(z.number().int().min(1).max(50)).default(20),
}).strict();

// Temporary read-view configuration; replace with agreed domain contracts at integration.
const workspaces = {
  implementation_partner: {
    kind: 'implementation', listPath: '/partners/implementation/submissions',
    pending: ['intake', 'first_level_review', 'forward_to_centre'],
  },
  sector_partner: {
    kind: 'sector', listPath: '/partners/sector/opportunities',
    pending: ['contact_request', 'mentoring_notes'],
  },
  funding_partner: {
    kind: 'lender', listPath: '/partners/funding/shortlist', pending: [],
  },
} as const;

const requirePartner: RequestHandler = (req, _res, next) => {
  const user = req.auth?.user;
  if (!user) { next(new HttpError(401, 'Please sign in.')); return; }
  if (!(user.role in workspaces) || !user.orgId || user.orgType !== user.role) {
    next(new HttpError(403, 'Your account cannot access partner workspaces.')); return;
  }
  next();
};

// Guarded, scoped reads only. Session middleware and router mounting belong to Dev 3.
export function partnerRouter() {
  const router = Router();
  router.use(requirePartner);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/workspace', (req, res) => {
    const { user, fundingMode } = req.auth!;
    if (user.role === 'funding_partner' && fundingMode === 'csr') {
      res.json({ kind: 'csr', listPath: null, pending: ['csr_impact_report'] }); return;
    }
    if (user.role === 'funding_partner' && fundingMode !== 'lender') {
      throw new HttpError(403, 'Your funding workspace mode is unavailable.');
    }
    res.json(workspaces[user.role as keyof typeof workspaces]);
  });

  const list: RequestHandler = async (req, res) => {
    const { status, after, limit } = queryInput.parse(req.query);
    // Never allow query status to replace funding's mandatory SHORTLISTED scope.
    const scope = submissionScope(req.auth!);
    const filter = { $and: [scope, ...(status ? [{ status }] : []), ...(after ? [{ _id: { $lt: after } }] : [])] };
    const [rows, total, draft, ready, shortlisted] = await Promise.all([
      Submission.find(filter).setOptions({ tenant: scope }).select({ _id: 1, title: 1, status: 1 })
        .sort({ _id: -1 }).limit(limit + 1).lean(),
      Submission.countDocuments({}).setOptions({ tenant: scope }),
      Submission.countDocuments({ status: 'DRAFT' }).setOptions({ tenant: scope }),
      Submission.countDocuments({ status: 'READY' }).setOptions({ tenant: scope }),
      Submission.countDocuments({ status: 'SHORTLISTED' }).setOptions({ tenant: scope }),
    ]);
    const page = rows.slice(0, limit);
    res.json({
      items: page.map(row => ({ id: String(row._id), title: row.title, status: row.status })),
      nextCursor: rows.length > limit ? String(page.at(-1)!._id) : null,
      summary: { total, draft, ready, shortlisted },
    });
  };
  router.get('/implementation/submissions', requirePermission('review_own_org'), list);
  router.get('/sector/opportunities', requirePermission('view_consented'), list);
  router.get('/funding/shortlist', requirePermission('view_funding'), list);
  return router;
}
