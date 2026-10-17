import { Router } from 'express';
import { z } from 'zod';
import { scoped, submissionScope } from '../auth/authorization.js';
import { userContext } from '../auth/session.js';
import { HttpError } from '../errors.js';
import { Session, StageEvent, Submission } from '../models.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const query = z.object({ submissionId: objectId }).strict();

/** Read-only, replayable stage stream. Only the worker inserts events. */
export function eventsRouter() {
  const router = Router();
  router.get('/events', async (req, res) => {
    const { submissionId } = query.parse(req.query);
    const visible = async () => {
      if (!await Session.exists({ _id: req.auth!.sessionId, expiresAt: { $gt: new Date() } })) return null;
      const actor = await userContext(req.auth!.user.id);
      const submission = await Submission.findOne(scoped(submissionScope({ ...actor, sessionId: req.auth!.sessionId }), { _id: submissionId }))
        .select('_id ownerOrgId').lean();
      return submission ? { submission, role: actor.user.role } : null;
    };
    const initial = await visible();
    if (!initial) throw new HttpError(404, 'Submission not found.');
    const ownerOrgId = initial.submission.ownerOrgId;
    const suppliedCursor = req.get('Last-Event-ID');
    let cursor = suppliedCursor ? objectId.parse(suppliedCursor) : null;
    if (cursor && !await StageEvent.exists({ _id: cursor, submissionId, ownerOrgId })) {
      throw new HttpError(410, 'The event cursor is no longer available. Reconnect without it.');
    }

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive',
      'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let closed = false;
    let polling = false;
    const waitForDrain = () => new Promise<void>(resolve => {
      const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
      res.once('drain', done);
      res.once('close', done);
    });
    const poll = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        // Recheck every poll so a role change or revoked share closes an existing stream promptly.
        const access = await visible();
        if (!access) { res.end(); return; }
        if (cursor && !await StageEvent.exists({ _id: cursor, submissionId, ownerOrgId })) {
          res.end(); // The capped collection has evicted the cursor; reconnect receives 410.
          return;
        }
        const events = await StageEvent.find({ submissionId, ownerOrgId,
          ...(cursor ? { _id: { $gt: cursor } } : {}) }).sort({ _id: 1 }).limit(100).lean();
        for (const event of events) {
          if (closed) return;
          const partner = ['implementation_partner', 'sector_partner', 'funding_partner'].includes(access.role);
          const payload = { id: String(event._id), stage: event.stage, status: event.status, at: event.at,
            ...(event.ms !== undefined ? { ms: event.ms } : {}),
            ...(!partner && event.summary ? { summary: event.summary } : {}),
            ...(!partner && event.error ? { error: event.error } : {}) };
          const writable = res.write(`id: ${String(event._id)}\nevent: stage\ndata: ${JSON.stringify(payload)}\n\n`);
          cursor = String(event._id);
          if (!writable) await waitForDrain();
        }
        if (!events.length && !closed && !res.write(': keepalive\n\n')) await waitForDrain();
      } catch {
        if (!closed) res.end();
      } finally { polling = false; }
    };
    const timer = setInterval(() => { void poll(); }, 1500);
    res.on('close', () => { closed = true; clearInterval(timer); });
    await poll();
  });
  return router;
}
