'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { domainSchema } from '@pitchprism/contracts';
import { api } from '../../lib/api';
import styles from './live-stages.module.css';

type StageEvent = { id: string; jobId: string; stage: string; status: 'started' | 'done' | 'skipped' | 'failed'; ms?: number; summary?: Record<string, unknown>; error?: string };
type Job = { id: string; status: string; reason: string; fromStage: string; attempts: number; error: { code: string; message: string; stage: string | null } | null; rubric: string | null };
type Pipeline = { jobs: Job[]; events: StageEvent[] };

const STAGES = (domainSchema as { definitions: Record<string, { enum?: string[] }> }).definitions.Stage!.enum!;
const LABELS: Record<string, string> = { followup: 'follow-ups', normalise: 'normalise', similar: 'similar ideas', local: 'local market', feedback: 'feedback' };
const FINISHED = new Set(['done', 'failed', 'cancelled']);
const summaryText = (summary?: Record<string, unknown>) => summary ? Object.entries(summary).filter(([key]) => key !== 'replay')
  .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} ${Array.isArray(value) ? value.join(', ') : String(value)}`).join(' · ') : '';

/**
 * Live card stages (A-28): the latest job's stages fill in as the worker records them, over SSE. The browser
 * reconnects with Last-Event-ID; events are deduplicated by ID, so a reconnect neither loses nor repeats a stage.
 */
export default function LiveStages({ submissionId, canRescore, onFinished }: { submissionId: string; canRescore: boolean; onFinished?: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<Map<string, StageEvent>>(new Map());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const load = useCallback(async () => {
    const result = await api<Pipeline>(`/submissions/${submissionId}/pipeline`);
    setJob(result.jobs[0] ?? null);
    setEvents(new Map(result.events.map(event => [event.id, event])));
    return result.jobs[0] ?? null;
  }, [submissionId]);

  useEffect(() => {
    let active = true;
    setJob(null); setEvents(new Map()); setError('');
    load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load the pipeline.'); });
    const source = new EventSource(`/api/v1/events?submissionId=${submissionId}`, { withCredentials: true });
    source.addEventListener('ready', () => setLive(true));
    source.addEventListener('stage', message => {
      const event = JSON.parse((message as MessageEvent).data) as StageEvent;
      setEvents(current => current.has(event.id) ? current : new Map(current).set(event.id, event));
      // The job row changes status when the last stage ends; reread it then.
      if (event.status !== 'started' && (event.stage === 'route' || event.status === 'failed')) {
        void load().then(latest => { if (latest && FINISHED.has(latest.status)) finished.current?.(); }).catch(() => undefined);
      }
    });
    source.onerror = () => setLive(false);
    return () => { active = false; source.close(); };
  }, [submissionId, load]);

  async function rescore() {
    setBusy(true); setError('');
    try { await api(`/submissions/${submissionId}/process`, { method: 'POST', body: JSON.stringify({ reason: 'rescore' }) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start a rescore.'); }
    finally { setBusy(false); }
  }

  // Latest state per stage for the current job.
  const byStage = new Map<string, StageEvent>();
  for (const event of [...events.values()].filter(item => item.jobId === job?.id).sort((a, b) => a.id.localeCompare(b.id))) byStage.set(event.stage, event);
  const start = job ? STAGES.indexOf(job.fromStage) : 0;
  const running = job && !FINISHED.has(job.status);

  return <section className={styles.live} aria-label="Pipeline stages">
    <div className={styles.head}>
      <h4>Pipeline {job && <span className={`${styles.status} ${styles[job.status] ?? ''}`}>{job.status === 'leased' ? 'running' : job.status}</span>}</h4>
      <span className={styles.muted}>{live ? 'live' : 'reconnecting…'}{job?.rubric ? ` · rubric ${job.rubric}` : ''}</span>
      {canRescore && <button type="button" className="secondary" disabled={busy || !!running} onClick={() => void rescore()}>{running ? 'Running…' : 'Rescore with the published rubric'}</button>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!job ? <p className={styles.muted}>This idea has not been through the pipeline yet.</p> : <>
      <ol className={styles.strip}>{STAGES.map((stage, index) => {
        const event = byStage.get(stage);
        const state = index < start ? 'before' : event?.status ?? 'waiting';
        return <li key={stage} className={styles[state]} title={[event?.ms != null ? `${event.ms} ms` : '', summaryText(event?.summary)].filter(Boolean).join(' · ')}>
          <span>{LABELS[stage] ?? stage}</span>
          <small>{state === 'before' ? 'not rerun' : state === 'started' ? 'running' : state}</small>
        </li>;
      })}</ol>
      {job.error && <p className="error" role="alert">Stopped at {job.error.stage ?? 'an unknown stage'}: {job.error.message}</p>}
      {[...byStage.values()].some(event => event.summary?.replay) && <p className={styles.muted}>Replay: stage timings from the sample run, not a real assessment.</p>}
    </>}
  </section>;
}
