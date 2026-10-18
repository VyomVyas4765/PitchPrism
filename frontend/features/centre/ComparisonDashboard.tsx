'use client';

import { useEffect, useRef, useState } from 'react';
import { buildPortfolio, type CentrePortfolio, type PortfolioIdea } from '@pitchprism/contracts';
import { api } from '../../lib/api';
import styles from './comparison.module.css';

const domains = [['clarity', 'Clarity'], ['customer_need', 'Customer need'], ['market_potential', 'Market potential'],
  ['feasibility', 'Feasibility'], ['competition_awareness', 'Competition'], ['differentiation', 'Differentiation'],
  ['financial_logic', 'Revenue logic'], ['entrepreneur_readiness', 'Readiness']] as const;
const colors = ['#536f53', '#8972af', '#cc8f40', '#478a9e'];
const display = (value: number | null | undefined, suffix = '') => value == null ? '—' : `${value}${suffix}`;

export default function ComparisonDashboard({ revision, onOpen, local }: { revision: number; onOpen: (idea: Pick<PortfolioIdea, 'submissionId' | 'reviewAvailable'>) => void;
  local?: { ideas: PortfolioIdea[]; cards: Record<string, EvidenceCard> } }) {
  const [data, setData] = useState<CentrePortfolio | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(''), [cohort, setCohort] = useState(''), [trade, setTrade] = useState(''),
    [language, setLanguage] = useState(''), [lane, setLane] = useState(''), [version, setVersion] = useState(''),
    [sort, setSort] = useState<'updated' | 'potential' | 'completeness'>('updated'), [page, setPage] = useState(1);
  const [view, setView] = useState<'ideas' | 'trades' | 'cohorts'>('ideas');
  const [selected, setSelected] = useState<PortfolioIdea[]>([]), [compare, setCompare] = useState(false);
  const [cards, setCards] = useState<Record<string, EvidenceCard>>({}), [cardError, setCardError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => { setSelected([]); setCompare(false); }, [revision]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (local) {
      const result = buildPortfolio(local.ideas.map(row => ({ ...row })), { sort, page, pageSize: 12, q, cohortId: cohort || undefined, tradeKey: trade || undefined, language: language || undefined, state: lane || undefined, rubricVersion: version || undefined });
      setData(result); setLoading(false);
      setSelected(previous => previous.flatMap(row => { const fresh = local.ideas.find(idea => idea.submissionId === row.submissionId && idea.rubricVersion === result.rubricVersion); return fresh ? [fresh] : []; }));
      return;
    }
    const params = new URLSearchParams({ sort, page: String(page), pageSize: '12' });
    for (const [key, value] of Object.entries({ q, cohortId: cohort, tradeKey: trade, language, state: lane, rubricVersion: version })) if (value) params.set(key, value);
    const timer = setTimeout(() => {
      void api<CentrePortfolio>(`/centre/portfolio?${params}`).then(result => {
        if (!active) return;
        setData(result);
        setSelected(previous => previous.filter(row => row.rubricVersion === result.rubricVersion));
      }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load comparison.'); })
        .finally(() => { if (active) setLoading(false); });
    }, q ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [q, cohort, trade, language, lane, version, sort, page, revision, epoch, local]);
  useEffect(() => {
    if (!compare) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCompare(false);
      if (event.key === 'Tab') {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]');
        const first = focusable?.[0], last = focusable?.[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); previous?.focus(); };
  }, [compare]);
  useEffect(() => {
    if (!compare) return;
    let active = true; setCards({}); setCardError('');
    if (local) { setCards(local.cards); return; }
    void Promise.all(selected.map(async row => [row.submissionId, await api<EvidenceCard>(`/centre/submissions/${row.submissionId}/card`)] as const))
      .then(entries => { if (active) setCards(Object.fromEntries(entries)); })
      .catch(reason => { if (active) setCardError(reason instanceof Error ? reason.message : 'Could not load cited evidence.'); });
    return () => { active = false; };
  }, [compare, selected, local]);
  function toggle(row: PortfolioIdea) {
    setSelected(previous => previous.some(item => item.submissionId === row.submissionId)
      ? previous.filter(item => item.submissionId !== row.submissionId) : previous.length < 4 ? [...previous, row] : previous);
  }
  const filtered = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1); setSelected([]); };
  const maxCount = Math.max(1, ...data?.distribution.map(bucket => bucket.count) ?? [1]);
  return <div className={styles.workspace} aria-label="Ideas comparison workspace">
    <div className={styles.heading}><div><span className={styles.eyebrow}>YOUR CENTRE / IDEA PORTFOLIO</span><h3>Compare business ideas</h3></div>
      <button onClick={() => setEpoch(value => value + 1)} disabled={loading}>{loading ? 'Updating…' : '↻ Refresh portfolio'}</button></div>
    {data?.synthetic && <div className={styles.demo}>SYNTHETIC DEMO WORKSPACE <span>Illustrative assessments for the presentation. These are not model accuracy results or real applicants.</span></div>}
    <div className={styles.filters}>
      <label className={styles.search}>Find an idea<input type="search" value={q} placeholder="Business, applicant reference, district…" onChange={event => filtered(setQ)(event.target.value)} /></label>
      <label>Cohort<select value={cohort} onChange={event => filtered(setCohort)(event.target.value)}><option value="">All cohorts</option>{data?.cohortOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label>Trade<select value={trade} onChange={event => filtered(setTrade)(event.target.value)}><option value="">All trades</option>{data?.tradeOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label>Review lane<select value={lane} onChange={event => filtered(setLane)(event.target.value)}><option value="">All ideas</option><option value="READY">Ready</option><option value="NEEDS_ATTENTION">Needs attention</option><option value="PENDING_MODEL">Awaiting evaluation</option><option value="UNASSESSABLE">Unassessable</option></select></label>
      <label>Language<select value={language} onChange={event => filtered(setLanguage)(event.target.value)}><option value="">All languages</option>{data?.languageOptions.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
      <label>Rubric<select value={version} onChange={event => filtered(setVersion)(event.target.value)}><option value="">Latest assessed version</option>{data?.versions.map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    {error && <p role="alert" className={styles.error}>{error} <button onClick={() => setEpoch(value => value + 1)}>Retry</button></p>}
    {loading && <p role="status" className={styles.loading}>Loading the current comparison…</p>}
    {data && <div className={styles.results} aria-busy={loading}>
      <div className={styles.metrics}>
        <Metric label="Ideas in view" value={data.summary.total} note={`${data.summary.assessed} assessed · ${data.summary.pending} pending`} />
        <Metric label="Median potential" value={display(data.summary.medianPotential)} note={`${data.summary.ranked} rankable ideas · /100`} />
        <Metric label="Median completeness" value={display(data.summary.medianCompleteness, '%')} note="Information available for review" />
        <Metric label="Human review" value={data.summary.attention} note={`${data.summary.shortlisted} shortlisted · attention needed`} />
      </div>
      <div className={styles.charts}>
        <section className={styles.panel}><div className={styles.panelHead}><h4>Screening landscape</h4><span>{data.points.length} assessed ideas</span></div>
          <div className={styles.landscape}><span className={styles.yLabel}>POTENTIAL ↑</span><div className={styles.plot}>
            <div className={styles.vertical} /><div className={styles.horizontal} />
            <span className={styles.topLeft}>Ask for information</span><span className={styles.topRight}>Deeper evaluation</span><span className={styles.bottomLeft}>Re-submit with help</span><span className={styles.bottomRight}>Mentoring / skilling</span>
            {data.points.map((point, i) => <button key={point.submissionId} className={`${styles.dot} ${!point.rankEligible ? styles.provisional : ''}`} style={{ left: `clamp(7px, calc(${point.completeness}% - ${data.points.slice(0, i).filter(peer => peer.completeness === point.completeness && peer.potential === point.potential).length * 9}px), calc(100% - 7px))`, bottom: `${point.potential}%`, background: point.needsAttention ? '#cb8944' : colors[(data.tradeOptions.findIndex(trade => trade.id === point.tradeKey) + 4) % 4] }}
              title={`${point.title}: ${point.potential} potential, ${point.completeness}% complete${!point.rankEligible ? ' · insufficient coverage' : ''}`}
              aria-label={`Open ${point.title}, potential ${point.potential}, completeness ${point.completeness} percent`}
              onClick={() => onOpen({ submissionId: point.submissionId, reviewAvailable: true })}><span>{i + 1}</span></button>)}
          </div><span className={styles.xLabel}>COMPLETENESS →</span></div><p className={styles.note}>Click for evidence. Tied points are offset for visibility; outlines indicate insufficient coverage.</p></section>
        <section className={styles.panel}><div className={styles.panelHead}><h4>Potential distribution</h4><span>Rankable ideas only</span></div>
          <div className={styles.histogram}>{data.distribution.map(bucket => <div key={bucket.label}><strong>{bucket.count}</strong><div><i style={{ height: `${Math.max(2, bucket.count / maxCount * 100)}%`, opacity: bucket.count ? 1 : .18 }} /></div><span>{bucket.label}</span></div>)}</div>
          <p className={styles.note}>Same rubric: {data.rubricVersion ?? 'No assessments yet'}. {data.excludedOtherVersions ? `${data.excludedOtherVersions} ideas from other versions excluded.` : 'Low coverage stays outside rankings.'}</p></section>
        <section className={styles.panel}><div className={styles.panelHead}><h4>Suggested next steps</h4><span>Human decides</span></div>
          <div className={styles.pathways}>{data.pathways.length ? data.pathways.map((pathway, i) => <div key={pathway.label}><span><i style={{ background: colors[i % 4] }} />{pathway.label}</span><strong>{pathway.count}</strong><div><i style={{ width: `${pathway.count / Math.max(1, data.summary.assessed) * 100}%`, background: colors[i % 4] }} /></div></div>) : <p className={styles.note}>Pathways appear after assessment.</p>}</div></section>
      </div>
      <details className={styles.scoreExplanation}><summary>How the nine assessment rows and overall score work</summary><p>Eight domains are judged from cited answers on a 1–5 scale. Completeness is a separate computed percentage. Potential is the weighted average of assessed domain scores divided by five, multiplied by 100; absent evidence is excluded and shown as Not assessed. A score needs at least 60% evidence coverage to enter these rankings. Grammar, language and document format are not scoring criteria. All comparisons use the displayed rubric version; confidence and quality flags remain visible for human review.</p></details>
      <div className={styles.tableHeader}><div className={styles.tabs} role="tablist" aria-label="Comparison views">{(['ideas', 'trades', 'cohorts'] as const).map(tab => <button key={tab} role="tab" aria-selected={view === tab} onClick={() => setView(tab)}>{tab === 'ideas' ? 'All ideas' : tab === 'trades' ? 'Trade benchmarks' : 'Cohorts & trends'}</button>)}</div>
        <div className={styles.tableActions}><span>{selected.length}/4 selected</span><button disabled={selected.length < 2} onClick={() => setCompare(true)}>Compare ideas ↗</button></div></div>
      {view === 'ideas' && <section className={styles.panel} aria-label="Business idea entries"><div className={styles.tableTools}><p>{data.total} ideas · select 2–4 to compare the nine assessment rows</p><label>Sort <select aria-label="Sort ideas" value={sort} onChange={event => { setSort(event.target.value as 'updated' | 'potential' | 'completeness'); setPage(1); }}><option value="updated">Recently updated</option><option value="potential">Potential: high to low</option><option value="completeness">Completeness: high to low</option></select></label></div>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th><span className="sr-only">Select</span></th><th>Entrepreneur’s idea</th><th>Trade / cohort</th><th>Potential</th><th>Complete</th><th>Coverage</th><th>Rank: trade / cohort</th><th>Suggested pathway</th><th>Review</th></tr></thead><tbody>
          {data.ideas.map(row => <tr key={row.submissionId} className={selected.some(item => item.submissionId === row.submissionId) ? styles.selectedRow : ''}>
            <td><input type="checkbox" aria-label={`Compare ${row.title}`} checked={selected.some(item => item.submissionId === row.submissionId)} disabled={!row.reviewAvailable || row.potential === null || selected.length >= 4 && !selected.some(item => item.submissionId === row.submissionId)} onChange={() => toggle(row)} /></td>
            <td><button className={styles.ideaLink} onClick={() => onOpen(row)}>{row.title} ↗</button><small>{row.entrepreneurRef} · {row.district}</small></td>
            <td><strong>{row.tradeLabel}</strong><small>{row.cohortName}</small></td>
            <td><b className={styles.score}>{display(row.potential)}</b><small>{row.band ?? 'Awaiting evaluation'}</small></td>
            <td>{display(row.completeness, '%')}</td><td>{display(row.coverage, '%')}{row.potential !== null && !row.rankEligible && <small>Provisional · unranked</small>}</td>
            <td>{row.tradeRank ? `${row.tradeRank.rank} / ${row.tradeRank.of}` : '—'}<small>{row.tradeRank ? row.tradeRank.percentile === null ? 'Small sample' : `${row.tradeRank.percentile}th percentile` : 'No benchmark'}</small><small>{row.cohortRank ? `Cohort: ${row.cohortRank.rank} / ${row.cohortRank.of}` : 'Cohort unranked'}</small></td>
            <td>{row.pathway ?? 'Pending'}<small>{row.status === 'SHORTLISTED' ? '✓ Human shortlist' : row.flagCount ? `${row.flagCount} evidence flags` : row.language.toUpperCase()}</small></td>
            <td><button className={styles.openButton} onClick={() => onOpen(row)}>{row.state === 'NEEDS_ATTENTION' ? 'Needs attention' : row.reviewAvailable ? 'Open review' : 'Evaluate'} →</button></td>
          </tr>)}
        </tbody></table></div>
        {!data.total && <div className={styles.empty}><h4>No ideas in this view yet.</h4><p>Receive a plan above, or adjust your filters. Saved submissions will appear here as the centre receives them.</p></div>}
        <div className={styles.pagination}><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} · benchmarks use the full centre, not this page</span><div><button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>← Previous</button><button disabled={page * data.pageSize >= data.total || loading} onClick={() => setPage(value => value + 1)}>Next →</button></div></div>
      </section>}
      {view === 'trades' && <section className={styles.panel}><div className={styles.panelHead}><h4>How ideas compare within their trade</h4><span>Medians and interquartile ranges · /5</span></div><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Trade</th><th>Rankable / total</th><th>Median potential</th>{domains.map(([key, name]) => <th key={key}>{name}</th>)}</tr></thead><tbody>{data.trades.map(group => <tr key={group.id}><td>{group.label}</td><td>{group.assessed} / {group.total}</td><td>{display(group.medianPotential)}</td>{group.domains.map(domain => <td key={domain.key}><strong>{display(domain.median)}</strong><small>{domain.n ? `${domain.q1}–${domain.q3} · n=${domain.n}` : 'No evidence'}</small></td>)}</tr>)}</tbody></table></div><p className={styles.note}>Percentiles require at least five comparable ideas. Smaller trade/cohort groups use the centre trade benchmark and disclose its size.</p></section>}
      {view === 'cohorts' && <section className={styles.panel}><div className={styles.panelHead}><h4>Cohort comparison</h4><span>Same rubric · your centre</span></div><div className={styles.cohorts}>{data.cohorts.map(group => <div key={group.id}><span>{group.label}</span><strong>{display(group.medianPotential)}<small>/100 median potential</small></strong><div className={styles.cohortBar}><i style={{ width: `${group.medianPotential ?? 0}%` }} /></div><p>{group.assessed} rankable / {group.total} ideas · {display(group.meanCompleteness, '%')} mean completeness</p><div className={styles.cohortDistribution}>{group.distribution.map(bucket => <div key={bucket.label}><strong>{bucket.count}</strong><i style={{height: `${Math.max(2, bucket.count / Math.max(1, group.assessed) * 60)}px`}} /><small>{bucket.label}</small></div>)}</div><p>{group.pathways.map(pathway => `${pathway.label}: ${pathway.count}`).join(' · ')}</p></div>)}</div>
        <div className={styles.tableScroll}><table className={styles.table}><caption>Trade × cohort · median potential (number of ideas)</caption><thead><tr><th>Cohort</th>{data.trades.map(trade => <th key={trade.id}>{trade.label}</th>)}</tr></thead><tbody>{data.cohorts.map(cohort => <tr key={cohort.id}><th>{cohort.label}</th>{data.trades.map(trade => { const cell = data.heatmap.find(cell => cell.cohortId === cohort.id && cell.tradeKey === trade.id); return <td key={trade.id} style={{ background: cell?.n ? `rgba(106, 143, 91, ${.05 + (cell.medianPotential ?? 0) / 300})` : undefined }}>{display(cell?.medianPotential)} <small>{cell?.n ? `n=${cell.n}` : 'No comparable ideas'}</small></td>; })}</tr>)}</tbody></table></div><p className={styles.note}>Completeness is a collection signal. Cohort differences alone do not establish differences in entrepreneur ability.</p></section>}
    </div>}
    {compare && <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) setCompare(false); }}><section ref={dialog} className={styles.compareDialog} role="dialog" aria-modal="true" aria-label="Compare selected business ideas"><header><div><span className={styles.eyebrow}>SIDE BY SIDE / {data?.rubricVersion}</span><h3>Different ideas. Evidence you can compare.</h3></div><button onClick={() => setCompare(false)} aria-label="Close comparison">×</button></header>
      <p className={styles.note}>Each idea keeps its own score, evidence coverage, and business context. Missing evidence is not a zero.</p>{cardError && <p role="alert">{cardError}</p>}
      <div className={styles.tableScroll}><table className={`${styles.table} ${styles.comparisonTable}`}><thead><tr><th>Assessment</th>{selected.map((row, i) => <th key={row.submissionId} style={{ borderTop: `4px solid ${colors[i]}` }}><span>{row.entrepreneurRef}</span><h4>{row.title}</h4><small>{row.tradeLabel} · {row.cohortName}</small><button onClick={() => { setCompare(false); onOpen(row); }}>Inspect original & evidence ↗</button></th>)}</tr></thead><tbody>
        <tr><th>Potential /100</th>{selected.map(row => <td key={row.submissionId}><b className={styles.score}>{row.potential}</b><small>{row.band}</small></td>)}</tr>
        <tr><th>Completeness / coverage</th>{selected.map(row => <td key={row.submissionId}>{row.completeness}% / {row.coverage}%{!row.rankEligible && <small>Insufficient coverage for ranking</small>}</td>)}</tr>
        {domains.map(([key, name]) => <tr key={key}><th>{name} /5</th>{selected.map((row, i) => { const domain = row.domains.find(domain => domain.key === key); const source = cards[row.submissionId]?.evaluation?.domains.find(domain => domain.key === key); return <td key={row.submissionId}><div className={styles.domainValue}><strong>{display(domain?.score)}</strong><div><i style={{ width: `${(domain?.score ?? 0) * 20}%`, background: colors[i] }} /></div></div><small>{domain?.score == null ? 'Not assessed' : `${domain.confidence} confidence`}</small>{source && <p>{source.reason}</p>}{source?.evidence.slice(0, 1).map(id => { const seg = cards[row.submissionId]?.input.segments.find(segment => segment.segId === id); return seg ? <blockquote key={id}>“{seg.textEn}”<small>Original {seg.source.page ? `page ${seg.source.page}` : 'submission'}</small></blockquote> : null; })}</td>; })}</tr>)}
        <tr><th>Trade / cohort position</th>{selected.map(row => <td key={row.submissionId}>{row.tradeRank ? `Trade: ${row.tradeRank.rank} of ${row.tradeRank.of}` : 'Trade unranked'}<small>{row.tradeRank?.scope}</small><p>{row.cohortRank ? `Cohort: ${row.cohortRank.rank} of ${row.cohortRank.of}` : 'Cohort unranked'}</p></td>)}</tr>
        <tr><th>Suggested next step</th>{selected.map(row => <td key={row.submissionId}>{row.pathway}<small>{row.flagCount} quality flags</small></td>)}</tr>
        {([['offering', 'Product / service'], ['customers', 'Intended customers'], ['funding', 'Investment & funding'], ['monthly_revenue', 'Revenue claim']] as const).map(([field, label]) => <tr key={field}><th>{label}</th>{selected.map(row => {
          const card = cards[row.submissionId], ids = card?.input.fields?.[field]?.evidence ?? [];
          return <td key={row.submissionId}>{ids.length ? ids.map(id => { const source = card?.input.segments.find(segment => segment.segId === id); return source ? <blockquote key={id}>{source.textEn}<small>{source.source.page ? `Original page ${source.source.page}` : 'Applicant evidence'}</small></blockquote> : null; }) : <small>{card ? 'No mapped evidence' : 'Loading evidence…'}</small>}</td>;
        })}</tr>)}
        <tr><th>Key follow-ups / gaps</th>{selected.map(row => <td key={row.submissionId}>{cards[row.submissionId]?.followUps?.slice(0, 3).map((q, i) => <p key={i}>{q.questionEn}</p>) ?? <span>Loading evidence…</span>}</td>)}</tr>
      </tbody></table></div>
    </section></div>}
  </div>;
}
function Metric({ label, value, note }: { label: string; value: string | number; note: string }) { return <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
export type EvidenceCard = { input: { fields?: Record<string, { evidence: string[] }>; segments: Array<{ segId: string; textEn: string; source: { page?: number } }> }; evaluation: { domains: Array<{ key: string; reason: string; evidence: string[] }> } | null; followUps?: Array<{ questionEn: string }> };
