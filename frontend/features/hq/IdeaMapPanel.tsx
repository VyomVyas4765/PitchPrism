'use client';
import { useMemo, useState } from 'react';
import styles from './hq.module.css';
import { HUES } from './RubricBuilder';
import { label, useResource } from './use-resource';

type Point = { id: string; x: number; y: number; cluster: number; title: string; status: string; tradeKey: string | null; district: string | null; centre: string | null; cohort: string | null };
type IdeaMap = { method: string; note: string; total: number; truncated: boolean; points: Point[];
  clusters: Array<{ id: number; label: string; size: number; x: number; y: number }>; alerts: Array<{ cluster: number; label: string; district: string; count: number }> };
type ColourBy = 'cluster' | 'trade' | 'cohort';
const SIZE = 560;

// W-27 idea map: every submitted idea placed by similarity, coloured by cluster, trade or cohort.
export default function IdeaMapPanel() {
  const map = useResource<IdeaMap>('/hq/reports/idea-map');
  const [colourBy, setColourBy] = useState<ColourBy>('cluster');
  const [focus, setFocus] = useState<Point | null>(null);
  const groups = useMemo(() => {
    const key = (point: Point) => colourBy === 'cluster' ? String(point.cluster) : colourBy === 'trade' ? point.tradeKey ?? 'unknown' : point.cohort ?? 'no cohort';
    const counts = new Map<string, number>();
    for (const point of map.data?.points ?? []) counts.set(key(point), (counts.get(key(point)) ?? 0) + 1);
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
    return { key, colour: (point: Point) => HUES[Math.min(ordered.indexOf(key(point)), HUES.length - 1)]!, ordered, counts };
  }, [map.data, colourBy]);
  const nameOf = (value: string) => colourBy === 'cluster' ? map.data?.clusters.find(group => String(group.id) === value)?.label ?? value : label(value);

  return <section className={styles.section} aria-labelledby="map-title">
    <div className={styles.row}><h3 id="map-title">Idea map</h3>
      <label className={styles.muted}>colour by <select value={colourBy} onChange={event => setColourBy(event.target.value as ColourBy)}>
        <option value="cluster">cluster</option><option value="trade">trade</option><option value="cohort">cohort</option></select></label></div>
    <p className={styles.lede}>Every submitted idea, placed so that similar ideas sit together. Clusters are named by the words their ideas share; an alert marks a district where several similar ideas compete.</p>
    {map.error ? <p className="error" role="alert">{map.error}</p> : map.loading ? <p className={styles.status} role="status">Placing ideas…</p> :
      !map.data!.points.length ? <p className={styles.status}>No submitted ideas yet.</p> : <>
      <p className={styles.muted}>{map.data!.total} ideas{map.data!.truncated ? ' (latest 3,000)' : ''} · {map.data!.note}</p>
      {!!map.data!.alerts.length && <div className={styles.link} role="status" style={{ borderLeftColor: '#c2452d', background: '#f6e3dc' }}>
        <strong>Saturation alerts</strong>
        <ul style={{ margin: '6px 0 0' }}>{map.data!.alerts.map(alert => <li key={`${alert.cluster}-${alert.district}`}>{alert.count} similar ideas ({alert.label}) in {alert.district}</li>)}</ul>
      </div>}
      <div className={styles.mapWrap}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={styles.map} role="img" aria-label={`Idea map of ${map.data!.total} ideas in ${map.data!.clusters.length} clusters`}>
          <rect x="0" y="0" width={SIZE} height={SIZE} fill="var(--paper-raised)" stroke="var(--rule)" />
          {map.data!.points.map(point => <circle key={point.id} cx={point.x * SIZE} cy={(1 - point.y) * SIZE} r={focus?.id === point.id ? 8 : 5}
            fill={groups.colour(point)} fillOpacity={0.85} stroke={focus?.id === point.id ? 'var(--ink)' : 'none'} strokeWidth={2}
            onMouseEnter={() => setFocus(point)} onMouseLeave={() => setFocus(null)}><title>{point.title}</title></circle>)}
          {colourBy === 'cluster' && map.data!.clusters.map(group => <text key={group.id} x={group.x * SIZE} y={(1 - group.y) * SIZE - 12} textAnchor="middle"
            className={styles.mapLabel}>{group.label}</text>)}
        </svg>
        <div>
          <h4 style={{ marginTop: 0 }}>{colourBy === 'cluster' ? 'Clusters' : colourBy === 'trade' ? 'Trades' : 'Cohorts'}</h4>
          <ul className={styles.legend}>{groups.ordered.map(value => <li key={value}>
            <span className={styles.swatch} style={{ background: HUES[Math.min(groups.ordered.indexOf(value), HUES.length - 1)] }} />
            {nameOf(value)} <span className={styles.muted}>{groups.counts.get(value)}</span></li>)}</ul>
          {focus && <div className={styles.preview} aria-live="polite"><strong>{focus.title}</strong><br />
            <span className={styles.muted}>{[focus.tradeKey && label(focus.tradeKey), focus.district, focus.centre, focus.cohort].filter(Boolean).join(' · ')}</span></div>}
        </div>
      </div>
      <details style={{ marginTop: 16 }}><summary className={styles.muted}>List every idea on the map</summary>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Idea</th><th>{colourBy === 'cluster' ? 'Cluster' : colourBy === 'trade' ? 'Trade' : 'Cohort'}</th><th>District</th><th>Centre</th></tr></thead>
          <tbody>{map.data!.points.map(point => <tr key={point.id}><td>{point.title}</td><td>{nameOf(groups.key(point))}</td><td>{point.district ?? '—'}</td><td>{point.centre ?? '—'}</td></tr>)}</tbody>
        </table></div></details>
    </>}
  </section>;
}
