'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../lib/api';
import styles from './partner-workspace.module.css';

// Provisional read views only; see backend/src/modules/partners/HANDOFF.md.
type Status = 'DRAFT' | 'READY' | 'SHORTLISTED';
type Kind = 'implementation' | 'sector' | 'lender' | 'csr';
type Workspace = { kind: Kind; listPath: string | null; pending: string[] };
type SubmissionRow = { id: string; title: string; status: Status };
type QueuePage = {
  items: SubmissionRow[];
  nextCursor: string | null;
  summary: { total: number; draft: number; ready: number; shortlisted: number };
};
type SubmissionDetail = SubmissionRow & { applicant?: { name?: string; phone?: string } };
const statusLabels: Record<Status, string> = { DRAFT: 'Draft', READY: 'Ready', SHORTLISTED: 'Shortlisted' };
const headings: Record<Kind, string> = {
  implementation: 'Collected submissions', sector: 'Consented opportunities',
  lender: 'Loan-ready shortlist', csr: 'Impact reporting',
};
const descriptions: Record<Kind, string> = {
  implementation: 'Browse ideas collected by your organisation and check their current status.',
  sector: 'Browse ideas shared with your organisation. Contact details appear after the entrepreneur accepts contact.',
  lender: 'Browse shortlisted, funding-ready ideas shared with your organisation. Contact details appear after the entrepreneur accepts contact.',
  csr: 'This workspace is for aggregate impact reports. Individual ideas and personal details are unavailable.',
};
const pendingLabels: Record<string, string> = {
  intake: 'Submission intake', first_level_review: 'First-level review',
  forward_to_centre: 'Forwarding to your linked centre', contact_request: 'Express interest and contact requests',
  mentoring_notes: 'Mentoring notes', csr_impact_report: 'Aggregate impact report',
};

// Integration entry point: render inside the authenticated partner dashboard only.
// This component has no role selector and obtains funding mode from the server.
export function PartnerWorkspace() {
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const resetWorkspace = useCallback(() => { setWorkspace(null); setRevision(value => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setWorkspace(null); setError('');
    void api<Workspace>('/partners/workspace', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setWorkspace(result); })
      .catch(reason => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401) router.replace('/');
        else setError(reason instanceof ApiError && reason.status === 403
          ? 'Your account cannot access this partner workspace.' : 'Could not load your partner workspace. Please try again.');
      });
    return () => controller.abort();
  }, [revision, router]);
  return <section className={styles.workspace} aria-labelledby="partner-workspace-title">
    <div className={styles.heading}>
      <div><span className="eyebrow">Partner workspace</span><h2 id="partner-workspace-title">{workspace ? headings[workspace.kind] : 'Your workspace'}</h2></div>
      <button type="button" className="secondary" onClick={resetWorkspace}>Refresh</button>
    </div>
    {error ? <div role="alert"><p className="error">{error}</p><button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>Try again</button></div>
      : !workspace ? <p role="status">Loading partner workspace…</p> : <>
        <p>{descriptions[workspace.kind]}</p>
        {workspace.listPath && <SubmissionQueue key={`${revision}:${workspace.kind}`} path={workspace.listPath} kind={workspace.kind} onAccessLost={resetWorkspace} />}
        {!!workspace.pending.length && <aside className={styles.pending} aria-labelledby="partner-pending-title">
          <h3 id="partner-pending-title">Coming next</h3>
          <p>These workflows are not available yet.</p>
          <ul>{workspace.pending.map(item => <li key={item}>{pendingLabels[item] ?? item.replaceAll('_', ' ')}</li>)}</ul>
        </aside>}
      </>}
  </section>;
}

function SubmissionQueue({ path, kind, onAccessLost }: { path: string; kind: Kind; onAccessLost: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | ''>('');
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<QueuePage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<(string | null)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Replace pages so a later read never retains previously consented rows/details.
    setLoading(true); setError(''); setPage(null); setSelectedId(null);
    const query = new URLSearchParams({ limit: '20' });
    if (status) query.set('status', status);
    if (cursor) query.set('after', cursor);
    void api<QueuePage>(`${path}?${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPage(result); })
      .catch(reason => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
          setPage(null); setSelectedId(null);
          if (reason.status === 401) router.replace('/'); else onAccessLost();
        } else setError('Could not load your submissions. Please try again.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, status, cursor, revision, router, onAccessLost]);
  return <>
    {page && <dl className={styles.totals} aria-label="Totals for all ideas currently accessible to your organisation">
      <div><dt>Total</dt><dd>{page.summary.total}</dd></div>
      <div><dt>Draft</dt><dd>{page.summary.draft}</dd></div>
      <div><dt>Ready</dt><dd>{page.summary.ready}</dd></div>
      <div><dt>Shortlisted</dt><dd>{page.summary.shortlisted}</dd></div>
    </dl>}
    {kind !== 'lender' && <><label htmlFor="partner-status">Filter by status</label>
      <select id="partner-status" className={styles.filter} value={status} onChange={event => {
        setPage(null); setSelectedId(null); setCursor(null); setPreviousCursors([]); setStatus(event.target.value as Status | '');
      }}>
        <option value="">All statuses</option>
        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></>}
    {loading && <p role="status">Loading submissions…</p>}
    {error && <div role="alert"><p className="error">{error}</p><button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {page && <>
      <p className={styles.caption}>Totals cover all ideas currently accessible to your organisation, across all statuses.</p>
      {page.items.length ? <div className={styles.tableWrap}><table className={styles.table}>
        <caption className={styles.srOnly}>Accessible submissions, newest first</caption>
        <thead><tr><th scope="col">Idea</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead>
        <tbody>{page.items.map(item => <tr key={item.id}>
          <th scope="row">{item.title}</th><td>{statusLabels[item.status] ?? item.status}</td>
          <td><button type="button" className="secondary" aria-expanded={selectedId === item.id}
            aria-controls={selectedId === item.id ? 'partner-submission-detail' : undefined}
            aria-label={`Open ${item.title}`} onClick={() => setSelectedId(item.id)}>Open</button></td>
        </tr>)}</tbody>
      </table></div> : <p role="status">{status ? 'No submissions match this status.' : 'No submissions are currently available to your organisation.'}</p>}
      <div className={styles.pagination}>
        {!!previousCursors.length && <button type="button" className="secondary" disabled={loading} onClick={() => {
          setPage(null); setSelectedId(null); setCursor(previousCursors.at(-1) ?? null); setPreviousCursors(values => values.slice(0, -1));
        }}>Previous page</button>}
        {page.nextCursor && !error && <button type="button" className="secondary" disabled={loading} onClick={() => {
          setPage(null); setSelectedId(null); setPreviousCursors(values => [...values, cursor]); setCursor(page.nextCursor);
        }}>Next page</button>}
      </div>
    </>}
    {selectedId && <SubmissionDetails key={selectedId} id={selectedId} kind={kind} onClose={() => setSelectedId(null)} onAccessLost={onAccessLost} />}
  </>;
}

function SubmissionDetails({ id, kind, onClose, onAccessLost }: { id: string; kind: Kind; onClose: () => void; onAccessLost: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setError('');
    // Reuse the existing endpoint: it rechecks scope/consent/contact acceptance per read.
    void api<SubmissionDetail>(`/submissions/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDetail(result); })
      .catch(reason => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401) { onAccessLost(); router.replace('/'); }
        else if (reason instanceof ApiError && reason.status === 403) onAccessLost();
        else setError(reason instanceof ApiError && reason.status === 404
          ? 'This submission is no longer available to your organisation.' : 'Could not open this submission. Please try again.');
      });
    return () => controller.abort();
  }, [id, revision, router, onAccessLost]);
  return <section id="partner-submission-detail" className={styles.detail} aria-labelledby="partner-detail-title">
    <div className={styles.heading}><h3 id="partner-detail-title">Submission details</h3><button type="button" className="secondary" onClick={onClose}>Close</button></div>
    {error ? <div role="alert"><p className="error">{error}</p><button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>Try again</button></div>
      : !detail ? <p role="status">Opening submission…</p> : <>
        <h4>{detail.title}</h4><dl><dt>Status</dt><dd>{statusLabels[detail.status] ?? detail.status}</dd>
          {detail.applicant ? <><dt>Applicant</dt><dd>{detail.applicant.name || 'Not recorded'}</dd><dt>Phone</dt><dd>{detail.applicant.phone || 'Not recorded'}</dd></>
            : kind === 'implementation' ? <><dt>Applicant</dt><dd>Not recorded</dd></> : <><dt>Contact details</dt><dd>Available after the entrepreneur accepts contact.</dd></>}
        </dl>
      </>}
  </section>;
}
