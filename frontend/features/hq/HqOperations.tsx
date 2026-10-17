'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import styles from './hq-workspace.module.css';

type Rule = { _id: string; partnerOrgId: string; trades: string[]; sectors: string[]; districts: string[]; active: boolean };
type Audit = { _id: string; action: string; resourceType: string; resourceId?: string; createdAt: string };
type Evaluation = { _id: string; promptVersion?: string; models: string[]; metrics: Record<string, unknown>; createdAt: string };
type Point = { submissionId: string; x: number; y: number; cluster: string; method: string };

export default function HqOperations() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function load() {
    const [rulesResult, auditResult, evaluationsResult] = await Promise.all([
      api<{ rules: Rule[] }>('/hq/routing-rules'), api<{ events: Audit[] }>('/hq/audit'), api<{ runs: Evaluation[] }>('/hq/evaluations'),
    ]);
    setRules(rulesResult.rules); setAudit(auditResult.events); setEvaluations(evaluationsResult.runs);
  }
  useEffect(() => { load().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load HQ operations.')); }, []);
  async function generateClusters() {
    setError(''); setMessage('');
    try { const result = await api<{ points: Point[] }>('/hq/clusters'); setPoints(result.points); setMessage(`${result.points.length} ideas mapped using deterministic title similarity.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not generate the idea map.'); }
  }
  async function sampleReviews() {
    setError(''); setMessage('');
    try { const result = await api<{ samples: unknown[] }>('/hq/review-samples', { method: 'POST', body: JSON.stringify({ limit: 10 }) }); setMessage(`${result.samples.length} quality-review samples prepared.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not prepare review samples.'); }
  }
  return <section className={styles.panel}>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className={styles.note} role="status">{message}</p>}
    <div className={styles.grid} id="audit">
      <div className={styles.card}><h3>Routing rules</h3>{rules.length === 0 ? <p className={styles.muted}>No routing rules configured.</p> : <table><thead><tr><th>Partner</th><th>Match fields</th><th>Status</th></tr></thead><tbody>{rules.map(rule => <tr key={rule._id}><td>{rule.partnerOrgId}</td><td>{[...rule.trades, ...rule.sectors, ...rule.districts].join(', ') || 'All matching values'}</td><td>{rule.active ? 'Active' : 'Paused'}</td></tr>)}</tbody></table>}</div>
      <div className={styles.card}><h3>Audit history</h3>{audit.length === 0 ? <p className={styles.muted}>No audit events yet.</p> : <table><thead><tr><th>Action</th><th>Resource</th><th>When</th></tr></thead><tbody>{audit.slice(0, 12).map(event => <tr key={event._id}><td>{event.action}</td><td>{event.resourceType}</td><td>{new Date(event.createdAt).toLocaleString()}</td></tr>)}</tbody></table>}</div>
    </div>
    <div className={styles.grid} id="clusters" style={{ marginTop: 18 }}>
      <div className={styles.card}><h3>Quality review</h3><p className={styles.muted}>Prepare a deterministic sample of scored submissions for a second human review.</p><button onClick={sampleReviews}>Prepare sample</button><h3>Model evaluations</h3>{evaluations.length === 0 ? <p className={styles.muted}>No evaluation runs have been ingested.</p> : evaluations.slice(0, 5).map(run => <p className={styles.note} key={run._id}>{run.promptVersion ?? 'Unversioned'} · {new Date(run.createdAt).toLocaleDateString()}</p>)}</div>
      <div className={styles.card}><h3>Idea map</h3><p className={styles.muted}>Generate persisted coordinates and clusters from available submission titles. This is transparent and repeatable; it does not claim semantic model quality.</p><button onClick={generateClusters}>Generate map</button>{points.length > 0 && <div className={styles.map}>{points.map(point => <i key={point.submissionId} title={`Cluster ${point.cluster}`} style={{ left: `${point.x * 90 + 5}%`, top: `${point.y * 80 + 10}%` }} />)}</div>}</div>
    </div>
  </section>;
}
