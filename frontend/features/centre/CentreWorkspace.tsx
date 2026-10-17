'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import LiveStages from '../pipeline/LiveStages';

type QueueItem = { submissionId: string; title: string; state: string; status: string; potential: number | null;
  completeness: number | null; band: string | null; updatedAt: string };
type Segment = { segId: string; textEn: string; textOriginal?: string; lang: string; struck?: boolean; supersededBy?: string;
  confidence?: number; source: { type: string; documentId?: string; page?: number; bbox?: number[] } };
type Domain = { key: string; weight: number; score: number | null; runs: number[]; reason: string; evidence: string[]; confidence: string };
type Card = { submissionId: string; title: string; status: string; state: string;
  input: { segments: Segment[]; fields: Record<string, { state: string; evidence: string[] }>;
    context: { businessType?: string; plannedBusinessLocation: { village?: string; district: string; state: string; pincode?: string } } };
  evaluation: { potential: number | null; completeness: number; coverage: number; band: string; pathway: string;
    domains: Domain[]; flags: Array<{ key: string; field: string; evidence: string[] }>;
    rubricVersion: string; needsAttention: boolean } | null;
  quality: { completeness: number; flags: Array<{ key: string; field: string; evidence: string[] }> } | null;
  financialChecks: Array<{ field: string; written: string; expected: string; formula: string; evidence: string[] }>;
  followUps: Array<{ field: string; questionEn: string; reason: string }>;
  planDraft: { sections: Array<{ heading: string; textEn: string; evidence: string[] }> } | null;
  reason: string | null; decision: { decision: string; reason?: string } | null;
  feedback: { textEn: string; status: string } | null };

const label = (value: string) => value.replaceAll('_', ' ');

export default function CentreWorkspace() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [lane, setLane] = useState('all');
  const [sort, setSort] = useState('updated');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');

  const refresh = useCallback(async () => {
    const result = await api<{ items: QueueItem[] }>('/centre/queue');
    setItems(result.items);
  }, []);
  useEffect(() => {
    let active = true;
    refresh().catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load the queue.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  async function open(id: string) {
    setSelected(id); setCard(null); setEvidence(null); setError('');
    try {
      const result = await api<Card>(`/centre/submissions/${id}/card`);
      setCard(result); setFeedback(result.feedback?.textEn ?? '');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open the assessment.'); }
  }
  async function decide(decision: 'shortlist' | 'not_yet' | 'more_info') {
    if (!card) return;
    setBusy(true); setError('');
    try {
      await api(`/centre/submissions/${card.submissionId}/decision`, { method: 'POST', body: JSON.stringify({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
      await Promise.all([refresh(), open(card.submissionId)]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the decision.'); }
    finally { setBusy(false); }
  }
  async function saveFeedback() {
    if (!card) return;
    setBusy(true); setError('');
    try {
      await api(`/centre/submissions/${card.submissionId}/feedback`, { method: 'PUT', body: JSON.stringify({ textEn: feedback }) });
      await open(card.submissionId);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save feedback.'); }
    finally { setBusy(false); }
  }
  const visible = useMemo(() => items.filter(item => lane === 'all' || item.state === lane).sort((a, b) => {
    if (sort === 'potential') return (b.potential ?? -1) - (a.potential ?? -1);
    if (sort === 'completeness') return (b.completeness ?? -1) - (a.completeness ?? -1);
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }), [items, lane, sort]);
  const cited = card?.input.segments.find(segment => segment.segId === evidence);
  const flags = card?.evaluation?.flags ?? card?.quality?.flags ?? [];

  return <section className="centre-workspace" aria-label="Centre review">
    <div className="centre-heading"><div><span className="eyebrow">Assessment desk</span><h2>Centre review</h2>
      <p>Read the evidence, then record a human decision.</p></div><button className="secondary" onClick={() => { void refresh().catch(err => setError(String(err))); }}>Refresh queue</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="centre-controls"><label>Lane <select value={lane} onChange={event => setLane(event.target.value)}>
      <option value="all">All</option><option value="READY">Ready</option><option value="NEEDS_ATTENTION">Needs attention</option>
      <option value="UNASSESSABLE">Unassessable</option><option value="PENDING_MODEL">Pending model</option>
    </select></label><label>Sort <select value={sort} onChange={event => setSort(event.target.value)}>
      <option value="updated">Recently updated</option><option value="potential">Potential</option><option value="completeness">Completeness</option>
    </select></label></div>
    <div className="centre-grid"><div className="centre-list" aria-label="Review queue">
      {loading ? <p role="status">Loading assessments…</p> : visible.length === 0 ? <p>No assessments in this lane yet. PDF extraction and app upload are being integrated by Dev 1.</p> :
        visible.map(item => <button key={item.submissionId} className={selected === item.submissionId ? 'case-row active' : 'case-row'} onClick={() => void open(item.submissionId)}>
          <strong>{item.title}</strong><span>{label(item.state)} · {item.band ?? 'Awaiting score'}</span>
          <small>Potential {item.potential ?? '—'} · Completeness {item.completeness ?? '—'}</small>
        </button>)}
    </div><article className="centre-card">
      {!selected ? <p>Select an assessment to see its evidence.</p> : !card ? <p role="status">Opening assessment…</p> : <>
        <header><span className="eyebrow">{label(card.state)}</span><h3>{card.title}</h3>
          <p>{card.evaluation ? `${card.evaluation.band} · ${card.evaluation.pathway}` : card.reason ?? 'Assessment pending'}</p>
          <p className="caption">Planned business site: {[card.input.context.plannedBusinessLocation.village,
            card.input.context.plannedBusinessLocation.district, card.input.context.plannedBusinessLocation.state,
            card.input.context.plannedBusinessLocation.pincode].filter(Boolean).join(', ')}
            {card.input.context.businessType ? ` · ${card.input.context.businessType}` : ''}</p></header>
        <LiveStages submissionId={card.submissionId} canRescore onFinished={() => { void refresh(); void open(card.submissionId); }} />
        <div className="score-strip"><div><strong>{card.evaluation?.potential ?? '—'}</strong><span>Potential / 100</span></div>
          <div><strong>{card.evaluation?.completeness ?? card.quality?.completeness ?? '—'}</strong><span>Completeness / 100</span></div>
          <div><strong>{card.evaluation?.coverage ?? '—'}</strong><span>Coverage / 100</span></div></div>
        {card.evaluation && <><p className="caption">Rubric {card.evaluation.rubricVersion}. Scores are suggestions; citations below support each judgement.</p>
          <h4>Domain assessment</h4>{card.evaluation.domains.map(domain => <div className="domain" key={domain.key}>
            <div><strong>{label(domain.key)}</strong><span>{domain.score === null ? 'Not assessed' : `${domain.score} / 5`}</span></div>
            <p>{domain.reason}</p><small>Confidence {domain.confidence}{domain.runs.length ? ` · runs ${domain.runs.join(', ')}` : ''}</small>
            <div className="citations">{domain.evidence.map(id => <button key={id} className="secondary" onClick={() => setEvidence(id)}>View evidence {id}</button>)}</div>
          </div>)}</>}
        {flags.length > 0 && <><h4>Data quality</h4><ul>{flags.map((flag, index) => <li key={`${flag.field}-${index}`}>{label(flag.field)}: {label(flag.key)}
          {flag.evidence.map(id => <button key={id} className="text-button" onClick={() => setEvidence(id)}>Evidence {id}</button>)}</li>)}</ul></>}
        {card.financialChecks.length > 0 && <><h4>Financial checks</h4><ul>{card.financialChecks.map((check, index) => <li key={`${check.field}-${index}`}>
          {check.field}: written {check.written}, expected {check.expected} ({check.formula}).
          {check.evidence.filter(id => !id.startsWith('check:')).map(id => <button key={id} className="text-button" onClick={() => setEvidence(id)}>Evidence {id}</button>)}
        </li>)}</ul></>}
        {card.followUps.length > 0 && <><h4>Questions to ask</h4><ol>{card.followUps.map(question => <li key={question.field}>
          {question.questionEn} <small>({label(question.reason)})</small></li>)}</ol></>}
        {card.planDraft && <><h4>Summary plan draft</h4><p className="caption">For entrepreneur confirmation; English draft until translation is available.</p>
          {card.planDraft.sections.map(section => <div className="plan-section" key={section.heading}><strong>{section.heading}</strong><p>{section.textEn}</p>
            {section.evidence.map(id => <button className="text-button" key={id} onClick={() => setEvidence(id)}>Evidence {id}</button>)}</div>)}</>}
        {cited && <aside className="evidence-panel"><h4>Evidence {cited.segId}</h4>
          {cited.textOriginal && <p lang={cited.lang}><strong>Original:</strong> {cited.struck ? <del>{cited.textOriginal}</del> : cited.textOriginal}</p>}
          <p><strong>English:</strong> {cited.textEn}</p><small>
          {cited.source.type === 'pdf' ? `PDF page ${cited.source.page ?? 'unknown'}${cited.source.bbox ? ` · region ${cited.source.bbox.join(', ')}` : ''}` : label(cited.source.type)} · language {cited.lang}
          {cited.confidence !== undefined ? ` · read confidence ${Math.round(cited.confidence * 100)}%` : ''}
        </small><p className="caption">Original PDF viewing will appear when the private-file endpoint is connected.</p></aside>}
        {!card.decision && card.evaluation && card.state !== 'UNASSESSABLE' && <section className="decision-panel"><h4>Human decision</h4>
          <label htmlFor="decision-reason">Reason for any override</label><textarea id="decision-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} />
          <div className="decision-actions"><button disabled={busy} onClick={() => void decide('shortlist')}>Shortlist</button>
            <button disabled={busy} className="secondary" onClick={() => void decide('not_yet')}>Not yet</button>
            <button disabled={busy} className="secondary" onClick={() => void decide('more_info')}>More information</button></div>
        </section>}
        {card.decision && <p className="decision-saved">Decision: {label(card.decision.decision)}. {card.decision.reason}</p>}
        <section className="feedback-panel"><h4>Feedback draft</h4><p className="caption">Save an English draft. Translation and delivery remain pending integration.</p>
          <textarea aria-label="Feedback in English" value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={4000} />
          <button disabled={busy || feedback.trim().length < 10} onClick={() => void saveFeedback()}>Save feedback draft</button>
          {card.feedback && <small>Status: {label(card.feedback.status)}</small>}</section>
      </>}
    </article></div>
  </section>;
}
