'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import styles from './hq-workspace.module.css';

type Overview = {
  organisations: number;
  activeOrganisations: number;
  users: number;
  activeUsers: number;
  submissions: number;
  byStatus: { status: string; count: number }[];
  byOrganisation: { name: string; type: string; submissions: number }[];
};
type PipelineItem = { _id: string; title: string; status: string; language?: string; inputFormat?: string; trade?: string; district?: string; score?: number };
type FairnessGroup = { _id: string | null; count: number; average: number };

const label = (value: string) => value.replaceAll('_', ' ');

export default function HqWorkspace() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pipeline, setPipeline] = useState<PipelineItem[]>([]);
  const [fairness, setFairness] = useState<Record<string, FairnessGroup[]>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<Overview>('/admin/overview'),
      api<{ items: PipelineItem[] }>('/hq/pipeline?limit=8'),
      api<{ groups: Record<string, FairnessGroup[]> }>('/hq/fairness'),
    ]).then(([summary, pipelineResult, fairnessResult]) => { setOverview(summary); setPipeline(pipelineResult.items); setFairness(fairnessResult.groups); })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load HQ metrics.'));
  }, []);

  if (error) return <section className={styles.panel} id="reports"><p className="error" role="alert">{error}</p></section>;
  if (!overview) return <section className={styles.panel} id="reports"><p role="status">Loading HQ overview…</p></section>;

  const ready = overview.byStatus.find(item => item.status === 'READY')?.count ?? 0;
  const shortlisted = overview.byStatus.find(item => item.status === 'SHORTLISTED')?.count ?? 0;
  const needsAction = overview.byStatus.filter(item => ['MORE_INFO', 'UNASSESSABLE'].includes(item.status)).reduce((total, item) => total + item.count, 0);

  return <section className={styles.panel} id="reports" aria-labelledby="hq-overview-heading">
    <div className={styles.heading}><div><span className="eyebrow">HQ · programme pulse</span><h2 id="hq-overview-heading">Platform overview</h2><p className={styles.muted}>A scoped view of the network and the current submission funnel.</p></div><span className={styles.live}><i /> Live database</span></div>
    <div className={styles.metrics}>
      <article><span>Organisations</span><strong>{overview.activeOrganisations}<small> / {overview.organisations} total</small></strong></article>
      <article><span>Active staff</span><strong>{overview.activeUsers}<small> / {overview.users} total</small></strong></article>
      <article><span>Submissions</span><strong>{overview.submissions}</strong></article>
      <article><span>Ready for review</span><strong>{ready + shortlisted}</strong></article>
    </div>
    <div className={styles.grid}>
      <div className={styles.card}><h3>Funnel status</h3>{overview.byStatus.length === 0 ? <p className={styles.muted}>No submissions yet.</p> : overview.byStatus.map(item => <div className={styles.bar} key={item.status}><div><span>{label(item.status)}</span><b>{item.count}</b></div><span className={styles.track}><i style={{ width: `${overview.submissions ? Math.max(6, item.count / overview.submissions * 100) : 0}%` }} /></span></div>)}<p className={styles.note}>{needsAction ? `${needsAction} submissions need attention.` : 'No unresolved submission flags.'}</p></div>
      <div className={styles.card}><h3>Network by organisation</h3>{overview.byOrganisation.length === 0 ? <p className={styles.muted}>No organisation activity yet.</p> : <table><thead><tr><th>Organisation</th><th>Type</th><th>Ideas</th></tr></thead><tbody>{overview.byOrganisation.map(item => <tr key={`${item.type}-${item.name}`}><td>{item.name}</td><td>{label(item.type)}</td><td>{item.submissions}</td></tr>)}</tbody></table>}</div>
      <div className={styles.card}><h3>Latest pipeline activity</h3>{pipeline.length === 0 ? <p className={styles.muted}>No submissions are available in the pipeline.</p> : <table><thead><tr><th>Idea</th><th>Status</th><th>Score</th></tr></thead><tbody>{pipeline.map(item => <tr key={item._id}><td>{item.title}</td><td>{label(item.status)}</td><td>{item.score ?? '—'}</td></tr>)}</tbody></table>}</div>
    </div>
    <div className={styles.card} style={{ marginTop: 18 }}><h3>Fairness monitor</h3><p className={styles.muted}>Score distributions are grouped from persisted, non-PII assessment fields. Gaps above five points require review.</p><div className={styles.fairness}>{Object.entries(fairness).map(([dimension, groups]) => <div key={dimension}><strong>{label(dimension)}</strong>{groups.length === 0 ? <span className={styles.muted}>No scored data</span> : groups.map(group => <span key={group._id ?? 'unknown'}>{group._id ?? 'unknown'} · {group.average.toFixed(1)} ({group.count})</span>)}</div>)}</div></div>
    <div className={styles.planned}><span className="eyebrow">Next HQ modules</span><div><span>Programme & rubric versions</span><span>Routing rules</span><span>Second review samples</span><span>Fairness monitoring</span><span>Audit history</span></div><p className={styles.muted}>These modules require their domain contracts and durable audit/event data; no placeholder metrics are shown.</p></div>
  </section>;
}
