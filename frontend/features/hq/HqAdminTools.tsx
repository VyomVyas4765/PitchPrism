'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import styles from './hq-workspace.module.css';

type Item = { _id: string; name: string; version?: number; status?: string; definition?: Record<string, unknown> };
type Trade = { _id: string; name: string; synonyms: string[]; osmTags: string[] };

export default function HqAdminTools() {
  const [programmes, setProgrammes] = useState<Item[]>([]);
  const [rubrics, setRubrics] = useState<Item[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [programmeResult, rubricResult, tradeResult] = await Promise.all([
      api<{ items: Item[] }>('/hq/programmes'), api<{ items: Item[] }>('/hq/rubrics'), api<{ trades: Trade[] }>('/hq/trades'),
    ]);
    setProgrammes(programmeResult.items); setRubrics(rubricResult.items); setTrades(tradeResult.trades);
  }
  useEffect(() => { refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load HQ configuration.')); }, []);
  async function create(event: FormEvent<HTMLFormElement>, path: string, definition: Record<string, unknown>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await api(path, { method: 'POST', body: JSON.stringify({ name: form.get('name'), definition }) }); event.currentTarget.reset(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save configuration.'); } finally { setBusy(false); }
  }
  async function createTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await api('/hq/trades', { method: 'POST', body: JSON.stringify({ name: form.get('name'), synonyms: [], osmTags: [] }) }); event.currentTarget.reset(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save trade.'); } finally { setBusy(false); }
  }
  return <section className={styles.panel} id="configuration">
    <span className="eyebrow">HQ · configuration</span><h2>Programme, rubric and trade setup</h2>
    <p className={styles.muted}>Each programme and rubric save creates a new version. These settings are server-owned and never inferred from the browser.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className={styles.grid}>
      <div className={styles.card}><h3>New programme version</h3><form onSubmit={event => create(event, '/hq/programmes', { domains: [], weights: {}, descriptors: {}, bands: [], pathwayRules: [] })}><input name="name" placeholder="Programme name" required /><button disabled={busy}>Save version</button></form><ul>{programmes.map(item => <li key={item._id}>{item.name} · v{item.version} · {item.status}</li>)}</ul></div>
      <div className={styles.card}><h3>New rubric version</h3><form onSubmit={event => create(event, '/hq/rubrics', { domains: [], weights: {}, descriptors: {}, bands: [], pathwayRules: [] })}><input name="name" placeholder="Rubric name" required /><button disabled={busy}>Save version</button></form><ul>{rubrics.map(item => <li key={item._id}>{item.name} · v{item.version} · {item.status}</li>)}</ul></div>
    </div>
    <div className={styles.card} style={{ marginTop: 18 }}><h3>Trade list</h3><form onSubmit={createTrade} className="grid"><input name="name" placeholder="Trade name" required /><button disabled={busy}>Add trade</button></form><p className={styles.muted}>{trades.length} active trades configured.</p></div>
  </section>;
}
