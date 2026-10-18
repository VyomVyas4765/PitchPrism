'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import styles from './live-inbox.module.css';

// "Live from app": plans entrepreneurs sent with the app's "Send to evaluator" button, read from the database and
// refreshed every few seconds. Each row carries the applicant's details, the evaluator pipeline's progress and the
// Business Idea Brief they sent; "Open idea card" opens the same full review drawer as the portfolio.
export type LiveItem = {
  submissionId: string; title: string; status: string; language: string | null; sentAt: string | null; evaluatedAt: string | null;
  evaluation: { job: string; stage: string | null; failed: string | null; state: string | null; potential: number | null; band: string | null; pathway: string | null };
  reviewAvailable: boolean; brief: { url: string } | null;
  decision: { decision: 'shortlist' | 'not_yet' | 'more_info'; at: string | null } | null;
  interview: { status: 'awaiting_choice' | 'confirmed' | 'other_times_requested'; chosenSlotId: string | null; slots: Array<{ id: string; at: string }> } | null;
  applicant: { name: string | null; phone: string | null; gender: string | null; village: string | null; block: string | null; district: string | null;
    state: string | null; pincode: string | null; education: string | null; workBackground: string | null; creditScore: number | null };
};

const POLL_MS = 8000;
const NEW_MS = 15 * 60 * 1000;
const languages: Record<string, string> = { en: 'English', hi: 'Hindi', mr: 'Marathi', te: 'Telugu', or: 'Odia', bn: 'Bengali' };
const when = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const place = (a: LiveItem['applicant']) => [a.village, a.block, a.district, a.state].filter(Boolean).join(', ') || 'Location not recorded';

function progress(item: LiveItem): { label: string; tone: 'busy' | 'done' | 'failed' } {
  const e = item.evaluation;
  if (item.decision?.decision === 'shortlist') {
    const chosen = item.interview?.slots.find(slot => slot.id === item.interview?.chosenSlotId);
    return { label: chosen ? `Shortlisted · interview ${when(chosen.at)}` : item.interview?.status === 'other_times_requested' ? 'Shortlisted · wants other times' : 'Shortlisted · awaiting slot choice', tone: chosen ? 'done' : 'busy' };
  }
  if (item.decision?.decision === 'not_yet') return { label: 'Not yet · review sent', tone: 'failed' };
  if (item.decision?.decision === 'more_info') return { label: 'More information requested', tone: 'busy' };
  if (e.job === 'failed') return { label: 'Evaluation failed', tone: 'failed' };
  if (e.job === 'queued') return { label: 'Queued for evaluation', tone: 'busy' };
  if (e.job === 'leased') return { label: `Evaluating${e.stage ? ` · ${e.stage}` : ''}`, tone: 'busy' };
  if (e.potential != null) return { label: `${e.potential} / 100 · ${e.band ?? 'Scored'}`, tone: 'done' };
  return { label: e.state ? e.state.replaceAll('_', ' ').toLowerCase() : 'Evaluated', tone: 'done' };
}

export default function LiveInbox({ active, onOpen }: { active: boolean; onOpen: (item: Pick<LiveItem, 'submissionId' | 'reviewAvailable'>) => void }) {
  const [items, setItems] = useState<LiveItem[] | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api<{ items: LiveItem[] }>('/centre/app-submissions');
      setItems(result.items); setError(''); setCheckedAt(new Date());
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load plans sent from the app.'); }
  }, []);
  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const list = items ?? [];
  const evaluating = list.filter(item => ['queued', 'leased'].includes(item.evaluation.job)).length;
  const scored = list.filter(item => item.evaluation.potential != null).length;
  const failed = list.filter(item => item.evaluation.job === 'failed').length;

  return <section className={styles.inbox} aria-label="Plans sent from the app">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>LIVE FROM THE APP · REAL SUBMISSIONS</span><h3>Plans sent to the evaluator</h3>
        <p>Each plan arrives when an entrepreneur taps <strong>Send to evaluator</strong> in the app, with their details and the Business Idea Brief they sent.</p></div>
      <div className={styles.refresh}><span className={styles.liveDot} aria-hidden />{checkedAt ? `Updated ${checkedAt.toLocaleTimeString()}` : 'Connecting…'}
        <button onClick={() => void load()}>↻ Refresh</button></div>
    </div>
    <div className={styles.metrics}>
      <div><span>Received</span><strong>{list.length}</strong></div>
      <div><span>Being evaluated</span><strong>{evaluating}</strong></div>
      <div><span>Scored</span><strong>{scored}</strong></div>
      <div><span>Need attention</span><strong>{failed}</strong></div>
    </div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {items === null && !error ? <p className={styles.empty} role="status">Loading plans sent from the app…</p>
      : list.length === 0 ? <div className={styles.empty}><h4>No plans received yet</h4><p>When an entrepreneur finishes the chat in the app and taps Send to evaluator, the plan appears here within a few seconds.</p></div>
      : <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th>Idea</th><th>Entrepreneur</th><th>Location</th><th>Sent</th><th>Evaluation</th><th /></tr></thead>
        <tbody>{list.map(item => {
          const a = item.applicant, p = progress(item), open = expanded === item.submissionId;
          const fresh = item.sentAt && Date.now() - new Date(item.sentAt).getTime() < NEW_MS;
          return <Fragment key={item.submissionId}>
            <tr className={open ? styles.openRow : undefined}>
              <td><button className={styles.ideaLink} onClick={() => onOpen(item)}>{item.title || 'Untitled idea'}</button>
                {fresh && <span className={styles.newBadge}>NEW</span>}<small>{languages[item.language ?? ''] ?? 'Language not recorded'} · ID {item.submissionId.slice(-6).toUpperCase()}</small></td>
              <td><strong>{a.name ?? 'Name not available'}</strong><small>{a.phone ?? 'No phone'}</small></td>
              <td>{place(a)}<small>{a.pincode ?? ''}</small></td>
              <td>{when(item.sentAt)}</td>
              <td><span className={`${styles.pill} ${styles[p.tone]}`}>{p.label}</span>{item.evaluation.pathway && <small>{item.evaluation.pathway}</small>}
                {item.evaluation.failed && <small>{item.evaluation.failed}</small>}</td>
              <td className={styles.actions}>
                <button onClick={() => onOpen(item)}>Open idea card</button>
                {item.brief && <a href={item.brief.url} target="_blank" rel="noopener noreferrer">Brief PDF ↗</a>}
                <button className={styles.ghost} aria-expanded={open} onClick={() => setExpanded(open ? null : item.submissionId)}>{open ? 'Hide details' : 'User details'}</button>
              </td>
            </tr>
            {open && <tr className={styles.detailRow}><td colSpan={6}><dl className={styles.details}>
              <div><dt>Name</dt><dd>{a.name ?? '—'}</dd></div><div><dt>Phone</dt><dd>{a.phone ?? '—'}</dd></div>
              <div><dt>Gender</dt><dd>{a.gender ?? 'Not shared'}</dd></div><div><dt>Village / area</dt><dd>{a.village ?? '—'}</dd></div>
              <div><dt>Block</dt><dd>{a.block ?? '—'}</dd></div><div><dt>District</dt><dd>{a.district ?? '—'}</dd></div>
              <div><dt>State</dt><dd>{a.state ?? '—'}</dd></div><div><dt>Pincode</dt><dd>{a.pincode ?? '—'}</dd></div>
              <div><dt>Education</dt><dd>{a.education ?? '—'}</dd></div><div><dt>Work background</dt><dd>{a.workBackground ?? '—'}</dd></div>
              <div><dt>Credit score</dt><dd>{a.creditScore ?? 'Not shared'}</dd></div><div><dt>Evaluated</dt><dd>{when(item.evaluatedAt)}</dd></div>
            </dl></td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>}
  </section>;
}
