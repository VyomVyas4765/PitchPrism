'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PortfolioIdea } from '@pitchprism/contracts';
import ComparisonDashboard, { type EvidenceCard } from './ComparisonDashboard';
import type { PreviewResult } from './CentreWorkspace';
import styles from './batch-workspace.module.css';

type Entry = { id: string; file: File; url: string; cohort: string; trade: string; status: 'queued' | 'evaluating' | 'scored' | 'failed'; error?: string; result?: PreviewResult };
const maxFiles = 30, maxBytes = 120 * 1024 * 1024;
export default function BatchWorkspace({ onOpen, onDiscard, enabled }: { onOpen: (entry: { id: string; file: File; url: string; result: PreviewResult }) => void; onDiscard: (url?: string) => void; enabled: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]), [running, setRunning] = useState(false), [message, setMessage] = useState('');
  const [cohort, setCohort] = useState('Uploaded batch'), [trade, setTrade] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), alive = useRef(true), runningRef = useRef(false), pause = useRef(false);
  const latest = useRef<Entry[]>([]), urls = useRef(new Set<string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; pause.current = true; for (const url of urls.current) URL.revokeObjectURL(url); }; }, []);
  function update(fn: (previous: Entry[]) => Entry[]) {
    if (!alive.current) return;
    setEntries(previous => { const next = fn(previous); latest.current = next; return next; });
  }
  function addFiles(files: FileList | File[]) {
    if (!enabled) return;
    const incoming = Array.from(files), current = latest.current, added: Entry[] = [], issues: string[] = [];
    let total = current.reduce((sum, row) => sum + row.file.size, 0);
    for (const file of incoming) {
      if (!/\.pdf$/i.test(file.name) || file.type && file.type !== 'application/pdf') { issues.push(`${file.name}: choose a PDF`); continue; }
      if (file.size > 12 * 1024 * 1024 || file.size < 16) { issues.push(`${file.name}: PDF must be 12 MB or smaller`); continue; }
      if ([...current, ...added].some(row => row.file.name === file.name && row.file.size === file.size && row.file.lastModified === file.lastModified)) { issues.push(`${file.name}: already added`); continue; }
      if (current.length + added.length >= maxFiles || total + file.size > maxBytes) { issues.push('Batch limit: 30 PDFs, 120 MB total.'); break; }
      const url = URL.createObjectURL(file); urls.current.add(url); total += file.size;
      added.push({ id: `batch-${crypto.randomUUID()}`, file, url, cohort: cohort.trim() || 'Uploaded batch', trade: trade.trim(), status: 'queued' });
    }
    update(previous => [...previous, ...added]); setMessage(issues.slice(0, 3).join(' · '));
  }
  async function evaluate() {
    if (runningRef.current || !enabled) return;
    runningRef.current = true; pause.current = false; setRunning(true); setMessage('');
    // Snapshot the queued set. Files added during a run wait for the next Evaluate action.
    const queued = latest.current.filter(row => row.status === 'queued');
    try {
      for (const entry of queued) {
        if (pause.current || !alive.current) break;
        update(previous => previous.map(row => row.id === entry.id ? { ...row, status: 'evaluating', error: undefined } : row));
        try {
          const form = new FormData(); form.set('plan', entry.file);
          const response = await fetch('/api/v1/centre/evaluate-preview', { method: 'POST', credentials: 'same-origin', body: form });
          const result = await response.json() as PreviewResult & { error?: string };
          if (!response.ok) throw new Error(result.error || 'This PDF could not be evaluated.');
          if (!result.input || !result.assessment) throw new Error('The evaluator returned an incomplete result.');
          if (result.assessment.status !== 'assessed' || !result.assessment.evaluation) throw new Error(result.assessment.reason || 'Scoring is unavailable. Retry this PDF when the evaluator is ready.');
          update(previous => previous.map(row => row.id === entry.id ? { ...row, status: 'scored', result } : row));
        } catch (reason) {
          update(previous => previous.map(row => row.id === entry.id ? { ...row, status: 'failed', error: reason instanceof Error ? reason.message : 'Evaluation failed.' } : row));
        }
      }
    } finally {
      runningRef.current = false;
      if (alive.current) { setRunning(false); if (pause.current) setMessage('Paused after the current PDF. Choose Evaluate queued PDFs to continue.'); }
    }
  }
  function remove(entry: Entry) {
    if (runningRef.current) return;
    onDiscard(entry.url);
    URL.revokeObjectURL(entry.url); urls.current.delete(entry.url); update(previous => previous.filter(row => row.id !== entry.id));
  }
  const local = useMemo(() => {
    const cards: Record<string, EvidenceCard> = {};
    const ideas: PortfolioIdea[] = entries.map((entry, i) => {
      const result = entry.result, ev = result?.assessment.evaluation;
      if (result) cards[entry.id] = { input: result.input, evaluation: ev ?? null,
        followUps: result.assessment.followUps ?? (ev as (typeof ev & { followUps?: EvidenceCard['followUps'] }))?.followUps ?? [] };
      return { submissionId: entry.id, title: entry.file.name.replace(/\.pdf$/i, ''), entrepreneurRef: `Uploaded idea ${i + 1}`,
        cohortId: entry.cohort, cohortName: entry.cohort, tradeKey: entry.trade || null, tradeLabel: entry.trade || 'Unclassified', district: 'From original PDF', language: 'en', format: 'PDF',
        state: entry.status === 'failed' || ev?.band === 'Unassessable' ? 'UNASSESSABLE' : ev ? ev.needsAttention ? 'NEEDS_ATTENTION' : 'READY' : 'PENDING_MODEL', status: 'PREVIEW', updatedAt: new Date(entry.file.lastModified || 0).toISOString(),
        reviewAvailable: !!ev, rubricVersion: ev?.rubricVersion ?? null, potential: ev?.potential ?? null, completeness: ev?.completeness ?? null, coverage: ev?.coverage ?? null,
        band: ev?.band ?? null, pathway: ev?.pathway ?? null, domains: ev?.domains.map(domain => ({ key: domain.key, score: domain.score, confidence: domain.confidence })) ?? [], flagCount: ev?.flags?.length ?? 0,
        rankEligible: ev?.potential != null && ev.coverage >= 60 && !['Insufficient information', 'Unassessable'].includes(ev.band), tradeRank: null, cohortRank: null };
    });
    return { ideas, cards };
  }, [entries]);
  const scored = entries.filter(row => row.status === 'scored').length, failed = entries.filter(row => row.status === 'failed').length, queued = entries.filter(row => row.status === 'queued').length;
  return <div className={styles.batch}>
    <section className={styles.intake} aria-label="Batch PDF intake"><div className={styles.title}><div><span>BATCH EVALUATION</span><h3>Bring all the ideas to one desk.</h3><p>Select your PDFs, then start evaluation. Each result joins the comparison below.</p></div><span className={styles.session}>Browser session · unsaved</span></div>
      {!enabled && <p role="status" className={styles.notice}>Batch preview is available in local demo mode. Saved production assessments use the consent-gated intake flow.</p>}
      <div className={styles.settings}><label>Batch / cohort label<input value={cohort} maxLength={80} onChange={event => setCohort(event.target.value)} /></label><label>Trade label (optional)<input value={trade} maxLength={80} placeholder="e.g. Tailoring; leave blank for mixed ideas" onChange={event => setTrade(event.target.value)} /></label></div>
      <div className={`${styles.dropzone} ${dragging ? styles.dragging : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
        <strong>Drop your business idea PDFs here</strong><span>Up to 30 PDFs · 12 MB each · 120 MB total · supported two-page English forms</span><button disabled={!enabled} onClick={() => fileInput.current?.click()}>+ Choose PDFs</button><input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden style={{ display: 'none' }} aria-label="Choose batch PDFs" onChange={event => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} /></div>
      <div className={styles.controls}><div><strong>{entries.length} PDFs</strong><span>{scored} evaluated · {failed} failed · {queued} queued</span></div><div>
        {failed > 0 && <button disabled={running} onClick={() => update(previous => previous.map(row => row.status === 'failed' ? { ...row, status: 'queued', error: undefined } : row))}>Retry failed ({failed})</button>}
        {running ? <button onClick={() => { pause.current = true; setMessage('Finishing the current PDF, then pausing…'); }}>Pause after current PDF</button> : <button className={styles.start} disabled={!enabled || !queued} onClick={() => void evaluate()}>Evaluate queued PDFs ({queued}) →</button>}
        {entries.length > 0 && <button disabled={running} onClick={() => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); update(() => []); onDiscard(); setMessage(''); }}>Clear batch</button>}</div></div>
      <progress aria-label="Batch evaluation progress" max={Math.max(1, entries.length)} value={scored + failed} />
      {message && <p className={styles.notice} role="status">{message}</p>}
      <p className={styles.note}>Originals remain in this browser; only locally redacted answers go to the existing scorer. Reloading clears this batch. Demo fixtures stay separate.</p>
      {!!entries.length && <div className={styles.files}>{entries.map((entry, i) => <div className={styles.file} key={entry.id}><span className={styles.number}>{String(i + 1).padStart(2, '0')}</span><div><strong>{entry.file.name}</strong><small>{(entry.file.size / 1024).toFixed(0)} KB · {entry.cohort}{entry.trade ? ` · ${entry.trade}` : ''}</small>{entry.error && <p role="alert">{entry.error}</p>}</div><span className={`${styles.status} ${styles[entry.status]}`}>{entry.status === 'evaluating' ? 'Evaluating…' : entry.status === 'scored' ? `${entry.result?.assessment.evaluation?.potential ?? '—'}/100 · evaluated` : entry.status}</span>
        {entry.result && <button onClick={() => onOpen({ ...entry, result: entry.result! })}>Open result ↗</button>}
        {entry.status === 'failed' && <button disabled={running} onClick={() => update(previous => previous.map(row => row.id === entry.id ? { ...row, status: 'queued', error: undefined } : row))}>Retry</button>}
        <button disabled={running} onClick={() => remove(entry)} aria-label={`Remove ${entry.file.name}`}>×</button></div>)}</div>}
    </section>
    {!!entries.length && <ComparisonDashboard revision={0} local={local} onOpen={idea => { const entry = entries.find(row => row.id === idea.submissionId); if (entry?.result) onOpen({ ...entry, result: entry.result }); }} />}
  </div>;
}
