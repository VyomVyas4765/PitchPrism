'use client';
import { useEffect, useMemo, useState } from 'react';
import styles from './hq.module.css';
import { label, mutate, useResource } from './use-resource';

type Funnel = { totals: Record<'received' | 'submitted' | 'assessed' | 'decided' | 'shortlisted' | 'shared', number>; conversion: { assessed: number | null; shortlisted: number | null };
  groups: Array<{ id: string | null; name: string; received: number; submitted: number; assessed: number; decided: number; shortlisted: number; shared: number; unassessable: number; failed: number; outcomes: Record<string, number> }> };
type Health = { queue: Record<string, number>; oldestQueuedSeconds: number | null; expiredLeases: number; hostedCostInr: number; timeToCard: { jobs: number; p50Ms: number | null; p95Ms: number | null };
  stages: Array<{ stage: string; runs: number; failed: number; skipped: number; failureRate: number | null; p50Ms: number | null; p95Ms: number | null }>;
  models: Array<{ model: string; calls: number; tokensIn: number; tokensOut: number }>;
  recentFailures: Array<{ jobId: string; centre: string | null; code: string; stage: string | null; message: string; attempts: number; at: string }> };
type QualityRun = { id: string; runAt: string | null; complete: boolean; total: number; assessed: number; missingExtraction: number; failed: number;
  rubricVersion: string | null; promptVersion: string | null; models: string[]; fieldStateAccuracy: number | null; flagRecall: number | null;
  parity: Array<{ group: string; count: number; gap: number; pass: boolean }>; durationMs: { p50: number | null; p95: number | null }; computeSeconds: number | null; hostedCostInr: number };
type Quality = { available: false; message: string } | (QualityRun & { available: true; history: QualityRun[];
  files: { assessed: number; missingExtraction: number; failed: number; bands: Array<{ band: string; count: number }> } });
const ratioText = (value: number | null) => value == null ? '—' : `${Math.round(value * 100)}%`;
type PipelineItem = { id: string; title: string; status: string; centre: string | null; cohort: string | null; tradeKey: string | null; languages: string[]; channel: string | null;
  potential: number | null; completeness: number | null; band: string | null; pathway: string | null; needsAttention: boolean; updatedAt: string | null };
type Fairness = { assessed: number; minGroup: number; note: string; dimensions: Array<{ key: string; gap: number | null; check: boolean;
  groups: Array<{ value: string; n: number; enough: boolean; meanPotential: number | null; strongOrPromising: number | null; shortlisted: number | null }> }> };
type Sampling = { percent: number; decisions: number; agreement: Array<{ centreId: string; centre: string; decisions: number; reviewed: number; agreementRate: number | null }>;
  sample: Array<{ decisionId: string; title: string; centre: string | null; decision: string; pathway: string | null; overridden: boolean; decidedAt: string;
    verdict: { agrees: boolean; suggestedDecision: string | null; note: string | null } | null }> };
type Audit = { nextCursor: string | null; entries: Array<{ id: string; at: string; action: string; outcome: 'allowed' | 'denied'; actor: string; actorRole: string | null;
  actorOrg: string | null; targetType: string; targetOrg: string | null; meta: Record<string, unknown> }> };
type LiveEvent = { id: string; submissionId: string; stage: string; status: string; ms?: number; at: string; summary?: Record<string, unknown> };

const seconds = (ms: number | null) => ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const percent = (value: number | null) => value == null ? '—' : `${value}%`;
const when = (value: string | null) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const bandClass: Record<string, string> = { strong: styles.ok, promising: styles.warn, not_yet: styles.muted, insufficient: styles.bad };
const Status = ({ error, loading }: { error: string; loading: boolean }) =>
  error ? <p className="error" role="alert">{error}</p> : loading ? <p className={styles.status} role="status">Loading…</p> : null;

// ---------------------------------------------------------------- Overview: W-05 funnel, A-29 health, W-33 model quality
export function OverviewPanel() {
  const [groupBy, setGroupBy] = useState<'centre' | 'cohort'>('centre');
  const funnel = useResource<Funnel>(`/hq/reports/funnel?groupBy=${groupBy}`);
  const health = useResource<Health>('/hq/reports/pipeline-health');
  const quality = useResource<Quality>('/hq/reports/model-quality');
  const steps = ['submitted', 'assessed', 'decided', 'shortlisted', 'shared'] as const;
  const top = funnel.data?.totals.submitted || 1;
  return <>
    <section className={styles.section} aria-labelledby="funnel-title">
      <div className={styles.row}><h3 id="funnel-title">Funnel</h3>
        <label className={styles.muted}>by <select value={groupBy} onChange={event => setGroupBy(event.target.value as 'centre' | 'cohort')}><option value="centre">centre</option><option value="cohort">cohort</option></select></label></div>
      <p className={styles.lede}>From an idea arriving to a partner seeing it, over the last year. Outcomes count each idea once per stage.</p>
      <Status error={funnel.error} loading={funnel.loading} />
      {funnel.data && <>
        <dl className={styles.stats}>{steps.map(step => <div key={step}><dt>{label(step)}</dt><dd>{funnel.data!.totals[step]}</dd></div>)}</dl>
        {steps.map(step => <div key={step} className={styles.row} style={{ marginBottom: 6 }}>
          <span className={styles.muted} style={{ width: 90 }}>{label(step)}</span>
          <div className={styles.barTrack} style={{ flex: 1 }}><div className={styles.bar} style={{ width: `${funnel.data!.totals[step] / top * 100}%` }} /></div>
        </div>)}
        {!!funnel.data.groups.length && <div className={styles.tableWrap} style={{ marginTop: 24 }}><table className={styles.table}>
          <thead><tr><th>{groupBy === 'centre' ? 'Centre' : 'Cohort'}</th>{['Received', 'Assessed', 'Decided', 'Shortlisted', 'Shared', 'Unassessable', 'Failed'].map(head => <th key={head} className={styles.num}>{head}</th>)}<th>Outcomes</th></tr></thead>
          <tbody>{funnel.data.groups.map(group => <tr key={group.id ?? 'none'}><td>{group.name}</td>
            {[group.received, group.assessed, group.decided, group.shortlisted, group.shared, group.unassessable, group.failed].map((value, index) => <td key={index} className={styles.num}>{value}</td>)}
            <td className={styles.muted}>{Object.entries(group.outcomes).map(([stage, count]) => `${label(stage.toLowerCase())} ${count}`).join(' · ') || '—'}</td></tr>)}</tbody></table></div>}
      </>}
    </section>

    <section className={styles.section} aria-labelledby="health-title">
      <h3 id="health-title">Pipeline health</h3>
      <p className={styles.lede}>Last 7 days. Every model runs locally, so hosted AI cost stays at zero; time and machine use are the real costs.</p>
      <Status error={health.error} loading={health.loading} />
      {health.data && <>
        <dl className={styles.stats}>
          <div><dt>Queued</dt><dd>{health.data.queue.queued ?? 0}</dd></div><div><dt>Running</dt><dd>{health.data.queue.leased ?? 0}</dd></div>
          <div><dt>Failed</dt><dd className={health.data.queue.failed ? styles.bad : ''}>{health.data.queue.failed ?? 0}</dd></div>
          <div><dt>Time to card p50</dt><dd>{seconds(health.data.timeToCard.p50Ms)}</dd></div><div><dt>Hosted cost</dt><dd>₹{health.data.hostedCostInr}</dd></div>
        </dl>
        {health.data.expiredLeases > 0 && <p className="error" role="alert">{health.data.expiredLeases} job(s) have a worker that stopped responding; they return to the queue automatically.</p>}
        {!health.data.stages.length ? <p className={styles.status}>No stages have run in this period.</p> :
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Stage</th><th className={styles.num}>Runs</th><th className={styles.num}>Failed</th><th className={styles.num}>Skipped</th><th className={styles.num}>p50</th><th className={styles.num}>p95</th></tr></thead>
            <tbody>{health.data.stages.map(stage => <tr key={stage.stage}><td>{stage.stage}</td><td className={styles.num}>{stage.runs}</td>
              <td className={`${styles.num} ${stage.failed ? styles.bad : ''}`}>{stage.failed} <span className={styles.muted}>({percent(stage.failureRate)})</span></td>
              <td className={styles.num}>{stage.skipped}</td><td className={styles.num}>{seconds(stage.p50Ms)}</td><td className={styles.num}>{seconds(stage.p95Ms)}</td></tr>)}</tbody></table></div>}
        {!!health.data.models.length && <p className={styles.muted}>Models: {health.data.models.map(model => `${model.model} — ${model.calls} calls`).join(' · ')}</p>}
        {!!health.data.recentFailures.length && <><h4>Recent failures</h4><ul>{health.data.recentFailures.map(failure =>
          <li key={failure.jobId}><strong>{label(failure.code)}</strong> at {failure.stage ?? 'unknown stage'} · {failure.centre ?? '—'} · {failure.message} <span className={styles.muted}>({when(failure.at)})</span></li>)}</ul></>}
      </>}
      <LiveFeed />
    </section>

    <section className={styles.section} aria-labelledby="quality-title">
      <h3 id="quality-title">Model quality</h3>
      <p className={styles.lede}>Results of the evaluation harness on the organiser dataset (run locally by the centre pipeline owner). Aggregate numbers only.</p>
      <Status error={quality.error} loading={quality.loading} />
      {quality.data && !quality.data.available && <p className={styles.status}>{quality.data.message}</p>}
      {quality.data?.available && <>
        <dl className={styles.stats}>
          <div><dt>Assessed</dt><dd>{quality.data.assessed}/{quality.data.total}</dd></div>
          <div><dt>Field states right</dt><dd>{ratioText(quality.data.fieldStateAccuracy)}</dd></div>
          <div><dt>Flags found</dt><dd>{ratioText(quality.data.flagRecall)}</dd></div>
          <div><dt>Per file p50</dt><dd>{seconds(quality.data.durationMs.p50)}</dd></div>
          <div><dt>Cost</dt><dd>₹{quality.data.hostedCostInr}</dd><span className={styles.muted}>{quality.data.computeSeconds == null ? '' : `${quality.data.computeSeconds.toFixed(1)} s local compute`}</span></div>
        </dl>
        <p className={styles.muted}>Run {when(quality.data.runAt)} · {quality.data.complete ? 'complete' : `${quality.data.missingExtraction} files not extracted yet, ${quality.data.failed} failed`}
          {quality.data.models.length ? ` · ${quality.data.models.join(', ')}` : ''}{quality.data.rubricVersion ? ` · rubric ${quality.data.rubricVersion}` : ''}
          {quality.data.files.bands.length ? ` · bands: ${quality.data.files.bands.map(item => `${item.band} ${item.count}`).join(', ')}` : ''}</p>
        {!!quality.data.parity.length && <p>Language and format parity (same idea within 5 points): {quality.data.parity.map(group =>
          <span key={group.group} className={`${styles.pill} ${group.pass ? styles.ok : styles.bad}`} style={{ marginRight: 6 }}>{group.group} gap {group.gap}</span>)}</p>}
        {quality.data.history.length > 1 && <>
          <h4>History</h4>
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Run</th><th className={styles.num}>Assessed</th><th className={styles.num}>Field states</th><th className={styles.num}>Flags</th><th className={styles.num}>Parity</th><th className={styles.num}>p50</th><th>Versions</th></tr></thead>
            <tbody>{quality.data.history.map(run => <tr key={run.id}>
              <td className={styles.muted}>{when(run.runAt)}</td><td className={styles.num}>{run.assessed}/{run.total}</td>
              <td className={styles.num}>{ratioText(run.fieldStateAccuracy)}</td><td className={styles.num}>{ratioText(run.flagRecall)}</td>
              <td className={styles.num}>{run.parity.length ? `${run.parity.filter(group => group.pass).length}/${run.parity.length}` : '—'}</td>
              <td className={styles.num}>{seconds(run.durationMs.p50)}</td>
              <td className={styles.muted}>{[run.rubricVersion, run.promptVersion].filter(Boolean).join(' · ') || '—'}</td>
            </tr>)}</tbody></table></div>
        </>}
      </>}
    </section>
  </>;
}

/** Live stage events across every centre (SSE). The browser reconnects with Last-Event-ID; IDs dedupe replays. */
function LiveFeed() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [state, setState] = useState<'connecting' | 'live' | 'retrying'>('connecting');
  useEffect(() => {
    const source = new EventSource('/api/v1/events', { withCredentials: true });
    source.addEventListener('ready', () => setState('live'));
    source.addEventListener('stage', message => {
      const event = JSON.parse((message as MessageEvent).data) as LiveEvent;
      setEvents(list => list.some(item => item.id === event.id) ? list : [event, ...list].slice(0, 12));
    });
    source.onerror = () => setState('retrying');
    return () => source.close();
  }, []);
  return <div style={{ marginTop: 24 }}>
    <h4>Live stages <span className={`${styles.pill} ${state === 'live' ? styles.ok : styles.warn}`}>{state}</span></h4>
    {!events.length ? <p className={styles.status}>Waiting for the next stage to run…</p> :
      <ol className={styles.muted} style={{ paddingLeft: 18 }} aria-live="polite">{events.map(event => <li key={event.id}>
        {new Date(event.at).toLocaleTimeString('en-IN')} · idea …{event.submissionId.slice(-6)} · <strong>{event.stage}</strong> {event.status}
        {event.ms != null && ` in ${seconds(event.ms)}`}{event.summary?.replay ? ' · replay' : ''}</li>)}</ol>}
  </div>;
}

// ---------------------------------------------------------------- W-03 cross-organisation pipeline
export function PipelinePanel() {
  const [filters, setFilters] = useState({ orgId: '', band: '', status: '', language: '' });
  const [cursors, setCursors] = useState<string[]>([]);
  const orgs = useResource<{ organisations: Array<{ id: string; name: string; type: string }> }>('/hq/orgs');
  const query = useMemo(() => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    if (cursors.length) params.set('after', cursors.at(-1)!);
    return `/hq/reports/pipeline?${params}`;
  }, [filters, cursors]);
  const pipeline = useResource<{ total: number | null; nextCursor: string | null; items: PipelineItem[] }>(query);
  const set = (key: keyof typeof filters) => (event: React.ChangeEvent<HTMLSelectElement>) => { setCursors([]); setFilters({ ...filters, [key]: event.target.value }); };
  return <section className={styles.section} aria-labelledby="pipeline-title">
    <h3 id="pipeline-title">Every idea, every centre</h3>
    <p className={styles.lede}>The live pipeline across organisations. Titles and scores only; open an idea from its centre to see the evidence.</p>
    <div className={styles.row} style={{ marginBottom: 16 }}>
      <select aria-label="Centre" value={filters.orgId} onChange={set('orgId')}><option value="">All centres</option>
        {orgs.data?.organisations.filter(org => org.type === 'centre').map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select>
      <select aria-label="Band" value={filters.band} onChange={set('band')}><option value="">Any band</option>
        {['strong', 'promising', 'not_yet', 'insufficient', 'unassessed'].map(band => <option key={band} value={band}>{label(band)}</option>)}</select>
      <select aria-label="Status" value={filters.status} onChange={set('status')}><option value="">Any status</option>
        {['DRAFT', 'QUEUED', 'PROCESSING', 'NEEDS_INPUT', 'UNASSESSABLE', 'READY', 'FAILED', 'IN_REVIEW', 'SHORTLISTED', 'NOT_YET', 'MORE_INFO', 'SHARED'].map(status => <option key={status} value={status}>{label(status.toLowerCase())}</option>)}</select>
      <select aria-label="Language" value={filters.language} onChange={set('language')}><option value="">Any language</option>
        {['hi', 'mr', 'te', 'or', 'bn', 'en'].map(code => <option key={code} value={code}>{code}</option>)}</select>
      {pipeline.data?.total != null && <span className={styles.muted}>{pipeline.data.total} ideas</span>}
    </div>
    <Status error={pipeline.error} loading={pipeline.loading} />
    {pipeline.data && (!pipeline.data.items.length ? <p className={styles.status}>No ideas match these filters.</p> : <>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Idea</th><th>Centre · cohort</th><th>Status</th><th className={styles.num}>Potential</th><th className={styles.num}>Complete</th><th>Band</th><th>Pathway</th></tr></thead>
        <tbody>{pipeline.data.items.map(item => <tr key={item.id}>
          <td>{item.title}<br /><span className={styles.muted}>{[item.tradeKey && label(item.tradeKey), item.languages.join(' '), item.channel].filter(Boolean).join(' · ')}</span></td>
          <td>{item.centre ?? '—'}<br /><span className={styles.muted}>{item.cohort ?? 'no cohort'}</span></td>
          <td><span className={styles.pill}>{label(item.status.toLowerCase())}</span>{item.needsAttention && <span className={`${styles.pill} ${styles.bad}`}> check</span>}</td>
          <td className={styles.num}>{item.potential ?? '—'}</td><td className={styles.num}>{item.completeness == null ? '—' : `${item.completeness}%`}</td>
          <td>{item.band ? <span className={`${styles.pill} ${bandClass[item.band] ?? ''}`}>{label(item.band)}</span> : <span className={styles.muted}>unassessed</span>}</td>
          <td className={styles.muted}>{item.pathway ? label(item.pathway) : '—'}</td>
        </tr>)}</tbody></table></div>
      <div className={styles.row} style={{ marginTop: 12 }}>
        <button type="button" className={`secondary ${styles.small}`} disabled={!cursors.length} onClick={() => setCursors(list => list.slice(0, -1))}>← Newer</button>
        <button type="button" className={`secondary ${styles.small}`} disabled={!pipeline.data.nextCursor} onClick={() => setCursors(list => [...list, pipeline.data!.nextCursor!])}>Older →</button>
      </div>
    </>)}
  </section>;
}

// ---------------------------------------------------------------- W-07 fairness monitor
export function FairnessPanel() {
  const fairness = useResource<Fairness>('/hq/reports/fairness');
  return <section className={styles.section} aria-labelledby="fairness-title">
    <h3 id="fairness-title">Fairness monitor</h3>
    <p className={styles.lede}>Average potential by language, intake channel and district over six months. Caste and gender are never used. A gap above 5 points between groups large enough to compare is flagged for a closer read.</p>
    <Status error={fairness.error} loading={fairness.loading} />
    {fairness.data && (!fairness.data.assessed ? <p className={styles.status}>No assessed ideas yet.</p> : <>
      <p className={styles.muted}>{fairness.data.assessed} assessed ideas · groups under {fairness.data.minGroup} are shown but not compared. {fairness.data.note}</p>
      {fairness.data.dimensions.map(dimension => <div key={dimension.key} className={styles.section}>
        <h4>{label(dimension.key)} {dimension.gap != null && <span className={`${styles.pill} ${dimension.check ? styles.bad : styles.ok}`}>gap {dimension.gap}</span>}</h4>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Group</th><th className={styles.num}>Ideas</th><th className={styles.num}>Mean potential</th><th className={styles.num}>Strong or promising</th><th className={styles.num}>Shortlisted</th></tr></thead>
          <tbody>{dimension.groups.map(group => <tr key={group.value} className={group.enough ? '' : styles.muted}><td>{group.value}</td><td className={styles.num}>{group.n}</td>
            <td className={styles.num}>{group.meanPotential ?? '—'}</td><td className={styles.num}>{percent(group.strongOrPromising)}</td><td className={styles.num}>{percent(group.shortlisted)}</td></tr>)}</tbody></table></div>
      </div>)}
    </>)}
  </section>;
}

// ---------------------------------------------------------------- W-06 second-review sampling
export function SamplingPanel() {
  const [rate, setRate] = useState(10);
  const sampling = useResource<Sampling>(`/hq/reports/sampling?percent=${rate}`);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function verdict(decisionId: string, body: object) {
    setBusy(decisionId); setError('');
    try { await mutate(`/hq/reports/sampling/${decisionId}`, 'PUT', body); sampling.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the review.'); }
    finally { setBusy(''); }
  }
  return <section className={styles.section} aria-labelledby="sampling-title">
    <div className={styles.row}><h3 id="sampling-title">Second-review sample</h3>
      <label className={styles.muted}>sample <select value={rate} onChange={event => setRate(Number(event.target.value))}>{[5, 10, 20, 50].map(value => <option key={value} value={value}>{value}%</option>)}</select></label></div>
    <p className={styles.lede}>A stable weekly sample of each centre’s decisions from the last 30 days, with at least one per centre. Re-read the idea, then say whether you would have decided the same.</p>
    <Status error={sampling.error} loading={sampling.loading} />
    {error && <p className="error" role="alert">{error}</p>}
    {sampling.data && (!sampling.data.decisions ? <p className={styles.status}>No decisions in the last 30 days.</p> : <>
      <dl className={styles.stats}>{sampling.data.agreement.map(row => <div key={row.centreId}><dt>{row.centre}</dt><dd>{percent(row.agreementRate)}</dd>
        <span className={styles.muted}>{row.reviewed} reviewed of {row.decisions}</span></div>)}</dl>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Idea</th><th>Centre</th><th>Decision</th><th>Your review</th></tr></thead>
        <tbody>{sampling.data.sample.map(item => <tr key={item.decisionId}>
          <td>{item.title}<br /><span className={styles.muted}>{when(item.decidedAt)}</span></td><td>{item.centre ?? '—'}</td>
          <td>{label(item.decision)}{item.pathway && <span className={styles.muted}> · {label(item.pathway)}</span>}{item.overridden && <span className={`${styles.pill} ${styles.warn}`}> override</span>}</td>
          <td>{item.verdict && <p className={item.verdict.agrees ? styles.ok : styles.bad} style={{ margin: '0 0 6px' }}>{item.verdict.agrees ? 'Agreed' : `Would have chosen ${label(item.verdict.suggestedDecision ?? '')}`}</p>}
            <div className={styles.row}>
              <button type="button" className={styles.small} disabled={busy === item.decisionId} onClick={() => verdict(item.decisionId, { agrees: true })}>Agree</button>
              <select aria-label="Would have chosen" className={styles.small} disabled={busy === item.decisionId} value=""
                onChange={event => event.target.value && verdict(item.decisionId, { agrees: false, suggestedDecision: event.target.value })}>
                <option value="">Disagree: would have…</option>{['shortlist', 'not_yet', 'more_info'].filter(option => option !== item.decision).map(option => <option key={option} value={option}>{label(option)}</option>)}
              </select>
            </div></td>
        </tr>)}</tbody></table></div>
    </>)}
  </section>;
}

// ---------------------------------------------------------------- W-08 audit log
export function AuditPanel() {
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const params = new URLSearchParams({ ...(action ? { action } : {}), ...(outcome ? { outcome } : {}), ...(cursors.length ? { before: cursors.at(-1)! } : {}) });
  const audit = useResource<Audit>(`/hq/reports/audit?${params}`);
  return <section className={styles.section} aria-labelledby="audit-title">
    <h3 id="audit-title">Audit log</h3>
    <p className={styles.lede}>Append-only record of who did what: invitations, role changes, configuration, processing and access refusals. It holds no request bodies or personal details.</p>
    <div className={styles.row} style={{ marginBottom: 16 }}>
      <select aria-label="Area" value={action} onChange={event => { setCursors([]); setAction(event.target.value); }}><option value="">All areas</option>
        {['user', 'org', 'programme', 'rubric', 'cohort', 'trade', 'routing', 'pipeline', 'decision', 'consent', 'submission'].map(area => <option key={area} value={area}>{area}</option>)}</select>
      <select aria-label="Outcome" value={outcome} onChange={event => { setCursors([]); setOutcome(event.target.value); }}><option value="">Allowed and denied</option><option value="denied">Denied only</option><option value="allowed">Allowed only</option></select>
    </div>
    <Status error={audit.error} loading={audit.loading} />
    {audit.data && (!audit.data.entries.length ? <p className={styles.status}>Nothing recorded for this filter.</p> : <>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>{audit.data.entries.map(entry => <tr key={entry.id}>
          <td className={styles.muted}>{when(entry.at)}</td>
          <td>{entry.actor}<br /><span className={styles.muted}>{[entry.actorRole && label(entry.actorRole), entry.actorOrg].filter(Boolean).join(' · ')}</span></td>
          <td>{entry.action}{entry.outcome === 'denied' && <span className={`${styles.pill} ${styles.bad}`}> denied</span>}</td>
          <td>{label(entry.targetType)}<br /><span className={styles.muted}>{entry.targetOrg ?? ''}</span></td>
          <td className={styles.muted}>{Object.entries(entry.meta).map(([key, value]) => `${key}: ${String(value)}`).join(' · ') || '—'}</td>
        </tr>)}</tbody></table></div>
      <div className={styles.row} style={{ marginTop: 12 }}>
        <button type="button" className={`secondary ${styles.small}`} disabled={!cursors.length} onClick={() => setCursors(list => list.slice(0, -1))}>← Newer</button>
        <button type="button" className={`secondary ${styles.small}`} disabled={!audit.data.nextCursor} onClick={() => setCursors(list => [...list, audit.data!.nextCursor!])}>Older →</button>
      </div>
    </>)}
  </section>;
}
