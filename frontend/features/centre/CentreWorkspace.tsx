'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../lib/api';
import type { PortfolioRank } from '@pitchprism/contracts';
import styles from './centre-workspace.module.css';
import ComparisonDashboard from './ComparisonDashboard';
import LiveInbox from './LiveInbox';
import BatchWorkspace from './BatchWorkspace';

type QueueItem = { submissionId: string; title: string; state: string; status: string; potential: number | null;
  completeness: number | null; band: string | null; updatedAt: string; reviewAvailable: boolean };
type Segment = { segId: string; textEn: string; textOriginal?: string; lang: string; struck?: boolean;
  confidence?: number; source: { type: string; page?: number; bbox?: number[] } };
type Domain = { key: string; score: number | null; runs: number[]; reason: string; evidence: string[]; confidence: string };
type Card = { submissionId: string; state: string; input: { segments: Segment[] };
  evaluation: { potential: number | null; completeness: number; coverage: number; band: string; pathway: string;
    domains: Domain[]; flags: Array<{ key: string; field: string; evidence: string[] }>;
    rubricVersion: string; needsAttention: boolean } | null;
  quality: { completeness: number; flags: Array<{ key: string; field: string; evidence: string[] }> } | null;
  financialChecks: Array<{ field: string; written: string; expected: string; formula: string; evidence: string[] }>;
  followUps: Array<{ field: string; questionEn: string; reason: string }>;
  planDraft: { sections: Array<{ heading: string; textEn: string; evidence: string[] }> } | null;
  reason: string | null; interview?: Interview | null; decision: { decision: string; reason?: string; applicantMessage?: string; comparisonSnapshot?: { rubricVersion: string; tradeRank: PortfolioRank | null; cohortRank: PortfolioRank | null } } | null;
  feedback: { textEn: string; status: string } | null };
type Interview = { status: 'awaiting_choice' | 'confirmed' | 'other_times_requested'; chosenSlotId: string | null; respondedAt: string | null; note: string | null;
  slots: Array<{ id: string; at: string; mode: 'in_person' | 'phone' | 'video'; details: string }> };
type SlotDraft = { at: string; mode: 'in_person' | 'phone' | 'video'; details: string };
const emptySlots = (): SlotDraft[] => [0, 1, 2].map(() => ({ at: '', mode: 'in_person', details: '' }));
const modeLabel = { in_person: 'In person', phone: 'Phone call', video: 'Video call' } as const;
const slotTime = (at: string) => new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
type Profile = { gender: string | null; village: string | null; block: string | null; district: string | null; state: string | null; pincode: string | null;
  education: string | null; workBackground: string | null; creditScore: number | null };
type Plan = { submissionId: string; title: string; status: string; synthetic?: boolean; processingConsent: boolean; applicant: { name: string | null; phone: string | null };
  source?: 'app_chat' | 'centre_upload' | null; brief?: { url: string } | null; profile?: Profile;
  details: { district: string | null; trade: string | null; language: string | null; format: string | null };
  document: { id: string; bytes: number; pages: number; sha256: string; url: string } | null };
export type PreviewResult = { input: Card['input']; assessment: Pick<Card, 'evaluation' | 'quality' | 'financialChecks' | 'followUps' | 'planDraft' | 'reason'> & { status: 'assessed' | 'pending_model' }; document: { pages: number; bytes: number }; saved: false };

const rubric = [
  ['clarity', 'Clarity', '#6f55a5'], ['customer_need', 'Customer need', '#435eab'],
  ['market_potential', 'Market potential', '#2789ae'], ['feasibility', 'Feasibility', '#23947b'],
  ['competition_awareness', 'Competition', '#6b9e34'], ['differentiation', 'Differentiation', '#c9a51d'],
  ['financial_logic', 'Revenue logic', '#df7b30'], ['entrepreneur_readiness', 'Readiness', '#bd4934'],
  ['completeness', 'Completeness', '#a29b90'],
] as const;
const nice = (value: string) => value.replaceAll('_', ' ');
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const languageName: Record<string, string> = { en: 'English', hi: 'Hindi', mr: 'Marathi', te: 'Telugu', or: 'Odia', bn: 'Bengali' };
// Mirrors the English notice shown in app/lib/l10n/strings.dart for this version.
const consentNotice = 'PitchPrism will record and read your business idea so that your Tata STRIVE centre can review it and help you. We keep your name and phone number private and never send them to AI tools. Your recordings and answers are stored securely. You can withdraw your permission at any time from Idea Passport. For questions or complaints, contact your centre.';
const consentNoticeVersion = 'consent-notice-2026-10-17';
const demoPreviewEnabled = process.env.NODE_ENV !== 'production';

export default function CentreWorkspace() {
  const [mode, setMode] = useState<'live' | 'portfolio' | 'batch'>('live');
  const [revision, setRevision] = useState(0);
  const [intakeOptions, setIntakeOptions] = useState<{cohorts: Array<{id: string; label: string}>; trades: Array<{key: string; label: string}>}>({cohorts: [], trades: []});
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [sourcePage, setSourcePage] = useState<number | null>(null);
  const [tab, setTab] = useState<'assessment' | 'document' | 'notes'>('assessment');
  const [showUpload, setShowUpload] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [applicantMessage, setApplicantMessage] = useState('');
  const [slots, setSlots] = useState<SlotDraft[]>(emptySlots);
  const [feedback, setFeedback] = useState('');
  const [consentFile, setConsentFile] = useState<File | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const previewFile = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const openRequest = useRef(0);

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  const refresh = useCallback(async () => {
    const result = await api<{ items: QueueItem[] }>('/centre/queue');
    setItems(result.items); setRevision(value => value + 1);
    return result.items;
  }, []);
  const open = useCallback(async (item: Pick<QueueItem, 'submissionId' | 'reviewAvailable'>) => {
    const request = ++openRequest.current;
    if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }
    setSelected(item.submissionId); setPlan(null); setCard(null); setEvidence(null); setSourcePage(null); setError(''); setTab('assessment');
    setConsentFile(null); setConsentConfirmed(false); setApplicantMessage(''); setSlots(emptySlots());
    try {
      const [planResult, cardResult] = await Promise.all([
        api<Plan>(`/centre/submissions/${item.submissionId}/plan`),
        item.reviewAvailable ? api<Card>(`/centre/submissions/${item.submissionId}/card`) : Promise.resolve(null),
      ]);
      if (request === openRequest.current) { setPlan(planResult); setCard(cardResult); setFeedback(cardResult?.feedback?.textEn ?? ''); setApplicantMessage(cardResult?.feedback?.textEn ?? ''); }
    } catch (err) { if (request === openRequest.current) setError(err instanceof Error ? err.message : 'Could not open the assessment.'); }
  }, []);
  useEffect(() => {
    let active = true;
    refresh()
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load the queue.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => { void api<typeof intakeOptions>('/centre/intake-options').then(setIntakeOptions).catch(() => {}); }, []);
  useEffect(() => {
    if (!detailOpen && !showUpload) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDetailOpen(false); setShowUpload(false); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [detailOpen, showUpload]);

  async function uploadPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError('Choose a two-page PDF first.'); return; }
    const form = event.currentTarget;
    const fields = new FormData(form);
    fields.set('plan', file);
    if (!fields.get('cohortId')) fields.delete('cohortId');
    if (!fields.get('tradeKey')) fields.delete('tradeKey');
    if (!fields.get('phone')) fields.delete('phone');
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/centre/plans', { method: 'POST', credentials: 'same-origin', body: fields });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not receive the plan.');
      const rows = await refresh();
      const item = rows.find(row => row.submissionId === result.submissionId);
      if (item) await open(item);
      setShowUpload(false); setDetailOpen(true); setFile(null); form.reset();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not receive the plan.'); }
    finally { setBusy(false); }
  }
  async function evaluatePreview(event: ChangeEvent<HTMLInputElement>) {
    const pdf = event.target.files?.[0];
    event.target.value = '';
    if (!pdf) return;
    ++openRequest.current;
    if (pdf.size > 12 * 1024 * 1024) { setError('The PDF must be 12 MB or smaller.'); return; }
    const fields = new FormData();
    fields.set('plan', pdf);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/centre/evaluate-preview', { method: 'POST', credentials: 'same-origin', body: fields });
      const result = await response.json() as PreviewResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not evaluate this PDF.');
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(pdf);
      openPreview(result, pdf, previewUrl.current);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not evaluate this PDF.';
      setError(`${message} Selected file: ${pdf.name.slice(0, 120)} (${pdf.size} bytes).`);
    }
    finally { setBusy(false); }
  }
  function openPreview(result: PreviewResult, pdf: File, url: string) {
    ++openRequest.current;
    const evaluated = result.assessment.evaluation as (NonNullable<Card['evaluation']> & {
      financialChecks?: Card['financialChecks']; followUps?: Card['followUps']; planDraft?: Card['planDraft'];
    }) | null;
    setSelected('preview'); setDetailOpen(true); setTab('assessment'); setEvidence(null); setSourcePage(null);
    setPlan({ submissionId: 'preview', title: pdf.name.replace(/\.pdf$/i, ''), status: 'PREVIEW', processingConsent: false,
      applicant: { name: null, phone: null }, details: { district: null, trade: null, language: 'en', format: 'pdf' },
      document: { id: 'preview', bytes: result.document.bytes, pages: result.document.pages, sha256: '', url } });
    setCard({ submissionId: 'preview', state: result.assessment.status === 'assessed' ? 'READY' : 'PENDING_MODEL', input: result.input,
      evaluation: evaluated ?? null, quality: result.assessment.quality ?? null,
      financialChecks: result.assessment.financialChecks ?? evaluated?.financialChecks ?? [],
      followUps: result.assessment.followUps ?? evaluated?.followUps ?? [], planDraft: result.assessment.planDraft ?? evaluated?.planDraft ?? null,
      reason: result.assessment.reason ?? null, decision: null, feedback: null });
  }
  async function decide(decision: 'shortlist' | 'not_yet' | 'more_info') {
    if (!selected || selected === 'preview' || !card) return;
    setBusy(true); setError('');
    try {
      const offered = slots.filter(slot => slot.at && slot.details.trim().length >= 2).map(slot => ({ at: new Date(slot.at).toISOString(), mode: slot.mode, details: slot.details.trim() }));
      await api(`/centre/submissions/${selected}/decision`, { method: 'POST', body: JSON.stringify({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(applicantMessage.trim() ? { applicantMessage: applicantMessage.trim() } : {}), ...(decision === 'shortlist' ? { interviewSlots: offered } : {}) }) });
      const rows = await refresh();
      const item = rows.find(row => row.submissionId === selected);
      if (item) await open(item);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the decision.'); }
    finally { setBusy(false); }
  }
  async function saveFeedback() {
    if (!selected || selected === 'preview' || !card) return;
    setBusy(true); setError('');
    try {
      await api(`/centre/submissions/${selected}/feedback`, { method: 'PUT', body: JSON.stringify({ textEn: feedback }) });
      const result = await api<Card>(`/centre/submissions/${selected}/card`);
      setCard(result);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save feedback.'); }
    finally { setBusy(false); }
  }

  async function evaluatePdf() {
    if (!selected || selected === 'preview' || !plan?.document || !plan.processingConsent) return;
    setBusy(true); setError('');
    try {
      await api(`/centre/submissions/${selected}/evaluate-pdf`, { method: 'POST' });
      const rows = await refresh();
      const row = rows.find(item => item.submissionId === selected);
      if (row) await open(row);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not evaluate this PDF.'); }
    finally { setBusy(false); }
  }

  async function recordProcessingConsent() {
    if (!selected || !consentFile || !consentConfirmed) return;
    const fields = new FormData();
    fields.set('evidence', consentFile);
    fields.set('confirmed', 'true');
    fields.set('noticeVersion', consentNoticeVersion);
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/centre/submissions/${selected}/processing-consent`,
        { method: 'POST', credentials: 'same-origin', body: fields });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not record processing consent.');
      setPlan(await api<Plan>(`/centre/submissions/${selected}/plan`));
      setConsentFile(null); setConsentConfirmed(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not record processing consent.'); }
    finally { setBusy(false); }
  }

  const selectedItem = items.find(item => item.submissionId === selected);
  const evaluation = card?.evaluation;
  const cited = card?.input.segments.find(segment => segment.segId === evidence);
  const flags = evaluation?.flags ?? card?.quality?.flags ?? [];
  const lookup = new Map(evaluation?.domains.map(domain => [domain.key, domain]) ?? []);
  const segmentsById = new Map(card?.input.segments.map(segment => [segment.segId, segment]) ?? []);
  const documentUrl = plan?.document?.url;
  const viewedDocumentUrl = documentUrl && sourcePage ? `${documentUrl.split('#')[0]}#page=${sourcePage}` : documentUrl;

  return <section className={styles.desk} aria-label="Centre evaluator dashboard">
    <header className={styles.overviewHeader}>
      <div><span className={styles.kicker}>PITCHPRISM / CENTRE ASSESSOR</span><h2>Evaluator desk<span className={styles.liveDot} aria-label="Workspace active" /></h2>
        <p>Compare incoming ideas, inspect evidence, and record the next decision.</p></div>
      <div className={styles.overviewActions}><button className={styles.ghostButton} onClick={() => void refresh().catch(err => setError(String(err)))}>↻ Refresh</button>
        <button className={styles.ghostButton} onClick={() => setShowUpload(true)}>+ Receive a plan</button>
        {demoPreviewEnabled && <><button className={styles.receiveButton} disabled={busy} onClick={() => previewFile.current?.click()}>{busy ? 'Evaluating PDF…' : '↑ Evaluate PDF'}</button>
        <input ref={previewFile} type="file" accept="application/pdf,.pdf" hidden style={{ display: 'none' }} aria-label="Choose a two-page PDF for demo evaluation" onChange={event => void evaluatePreview(event)} /></>}</div>
    </header>
    {error && <div className={styles.error} role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {busy && <div className={styles.previewBanner} role="status">Processing this plan and checking its cited evidence. The comparison updates when the saved assessment finishes.</div>}
    {selected === 'preview' && <div className={styles.previewBanner}>Unsaved PDF preview · excluded from portfolio rankings. <button onClick={() => setDetailOpen(true)}>Open preview ↗</button></div>}
    <div className={styles.modeTabs} role="tablist" aria-label="Evaluator mode">
      <button role="tab" aria-selected={mode === 'live'} onClick={() => { setMode('live'); setDetailOpen(false); }}>Live from app</button>
      <button role="tab" aria-selected={mode === 'portfolio'} onClick={() => { setMode('portfolio'); setDetailOpen(false); }}>Demo & saved portfolio</button>
      <button role="tab" aria-selected={mode === 'batch'} onClick={() => { setMode('batch'); setDetailOpen(false); }}>Batch upload & evaluate</button>
    </div>
    <div style={{ display: mode === 'live' ? 'block' : 'none' }}><LiveInbox active={mode === 'live'} onOpen={item => { void open(item); setDetailOpen(true); }} /></div>
    <div style={{ display: mode === 'portfolio' ? 'block' : 'none' }}><ComparisonDashboard revision={revision} onOpen={item => { void open(item); setDetailOpen(true); }} /></div>
    <div style={{ display: mode === 'batch' ? 'block' : 'none' }}><BatchWorkspace enabled={demoPreviewEnabled} onDiscard={url => { if (selected === 'preview' && (!url || plan?.document?.url === url)) { setSelected(null); setPlan(null); setCard(null); setDetailOpen(false); } }} onOpen={entry => openPreview(entry.result, entry.file, entry.url)} /></div>

    {detailOpen && <div className={styles.reviewBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDetailOpen(false); }}>
      <div className={styles.reviewDrawer} role="dialog" aria-modal="true" aria-label="Full plan review">
        <div className={styles.reviewToolbar}><span>FULL PLAN REVIEW</span><button onClick={() => setDetailOpen(false)} aria-label="Close full review">×</button></div>
      <article className={styles.casePanel}>
        {plan?.synthetic && <div className={styles.previewBanner}>Synthetic demo case · existing fixture scores are illustrative assessments, not model accuracy results. Real uploads still require processing consent before inference.</div>}
        {!selected ? <div className={styles.selectEmpty}><span>01 / THE IDEA CARD</span><h3>Select a plan to begin.</h3><p>The original document, assessment domains, and decision path will appear here.</p></div>
          : !plan ? <div className={styles.selectEmpty} role="status">Opening plan…</div> : <>
          <div className={styles.caseHero}>
            <div><span className={styles.kicker}>IDEA CARD &nbsp; / &nbsp; {selected?.slice(-6).toUpperCase()}</span>
              <h3>{plan.title}</h3><p>{plan.applicant.name ?? 'Applicant details pending'} <span>·</span> {plan.details.trade ?? 'Trade not recorded'} <span>·</span> {plan.details.district ?? 'District not recorded'}</p>
              <div className={styles.chips}><span>{languageName[plan.details.language ?? ''] ?? 'Language pending'}</span><span>{plan.details.format?.toUpperCase() ?? 'FORMAT PENDING'}</span>
                <span>{plan.document ? `${plan.document.pages} PAGE PLAN` : plan.brief ? 'APP · IDEA BRIEF' : 'ORIGINAL PENDING'}</span></div>
            </div><div className={styles.caseState}><span>SCREENING STATUS</span><strong>{evaluation ? evaluation.band : 'Awaiting evaluation'}</strong>
              <small>{evaluation ? `Rubric ${evaluation.rubricVersion}` : 'No score has been generated'}</small></div>
          </div>
          <div className={styles.tabs} role="tablist" aria-label="Idea card views">
            <button role="tab" aria-selected={tab === 'assessment'} className={tab === 'assessment' ? styles.activeTab : ''} onClick={() => setTab('assessment')}>Assessment</button>
            <button role="tab" aria-selected={tab === 'document'} className={tab === 'document' ? styles.activeTab : ''} onClick={() => setTab('document')}>{plan.brief && !plan.document ? 'Idea brief (PDF)' : 'Original plan'} {plan.document || plan.brief ? '↗' : ''}</button>
            <button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? styles.activeTab : ''} onClick={() => setTab('notes')}>Review notes</button>
          </div>
          {tab === 'assessment' && <div className={styles.assessment}>
            <div className={styles.pendingNote}><span className={styles.pendingIcon}>{evaluation ? '✓' : '◷'}</span><div><strong>{evaluation ? 'Evidence-linked assessment available' : 'Plan received. Evaluation is next.'}</strong>
              <p>{evaluation ? selected === 'preview' ? 'Inspect the cited domains in this unsaved demo preview.' : 'Review each domain and its cited evidence before making the final call.' : selected === 'preview' ? card?.reason ?? 'A score appears only when the PDF and citations pass validation.' : plan.processingConsent ? 'Run the guarded evaluator from the dashboard. A score appears only when the PDF and citations pass validation.' : 'The original is stored privately. Active processing consent is needed before scoring.'}</p></div></div>
            <div className={styles.scoreLayout}>
              <section className={styles.scoreCard} aria-label="Potential score"><span className={styles.cardKicker}>01 / OVERALL POTENTIAL</span>
                <div className={styles.gauge} style={{ '--score': `${evaluation?.potential ?? 0}%` } as React.CSSProperties}>
                  <div><strong>{evaluation?.potential ?? '—'}</strong><span>OUT OF 100</span></div></div>
                <p>{evaluation ? evaluation.band : 'Awaiting the scoring rubric'}</p><small>Only scored when source evidence is available.</small>
              </section>
              <section className={styles.domainCard} aria-label="Assessment domain chart"><div className={styles.cardTitle}><span className={styles.cardKicker}>02 / ASSESSMENT DOMAINS</span><span>{evaluation ? 'SCORED / 5' : 'PENDING'}</span></div>
                {rubric.map(([key, name, color]) => { const domain = lookup.get(key); const value = key === 'completeness'
                  ? evaluation?.completeness ?? card?.quality?.completeness ?? null : domain?.score ?? null;
                  const percent = value === null ? 0 : key === 'completeness' ? value : value * 20;
                  return <div className={styles.barRow} key={key}><span><i style={{ backgroundColor: color }} />{name}</span><div className={styles.barTrack}><i style={{ width: `${percent}%`, backgroundColor: color }} /></div><strong>{value === null ? evaluation && key !== 'completeness' ? 'Not assessed' : '—' : key === 'completeness' ? `${value}%` : `${value}/5`}</strong></div>;
                })}
                <p className={styles.chartFoot}>Missing evidence is left unscored. A human makes the final decision.</p>
              </section>
            </div>
            <div className={styles.lowerGrid}>
              <section className={styles.quadrantCard}><span className={styles.cardKicker}>03 / SCREENING QUADRANT</span><h4>Where could this idea go?</h4>
                <div className={styles.quadrantWrap}><span className={styles.axisY}>POTENTIAL ↑</span><div className={styles.quadrant}>
                  <div>Ask for more<br />information</div><div>Deeper evaluation<br />or funding</div>
                  <div>Re-submit<br />with help</div><div>Mentoring<br />or skilling</div>
                  {evaluation && evaluation.potential !== null && <i className={styles.quadrantPoint} style={{ left: `${evaluation.completeness}%`, bottom: `${evaluation.potential}%` }} title={`${evaluation.potential} potential, ${evaluation.completeness} completeness`} />}
                </div></div><span className={styles.axisX}>COMPLETENESS →</span>
                <p className={styles.quadrantResult}>{evaluation ? `Visual position only. Suggested pathway: ${evaluation.pathway}` : 'A position appears only after a valid score is recorded.'}</p>
              </section>
              <section className={styles.insightCard}><span className={styles.cardKicker}>04 / REVIEW SIGNALS</span><h4>What needs a closer look?</h4>
                {evaluation ? <><p className={styles.insightLine}><strong>Suggested pathway</strong><span>{evaluation.pathway}</span></p>
                  <p className={styles.insightLine}><strong>Evidence coverage</strong><span>{evaluation.coverage}%</span></p>
                  <p className={styles.insightLine}><strong>Quality flags</strong><span>{flags.length}</span></p>
                  {flags.map((flag, index) => <p key={`${flag.field}-${index}`} className={styles.signal}>⚑ &nbsp; {nice(flag.field)}: {nice(flag.key)}</p>)}</>
                  : <div className={styles.insightEmpty}><span>↗</span><strong>No claims before evidence.</strong><p>Strengths, gaps, quality flags and follow-up questions will populate from the approved pipeline.</p></div>}
              </section>
            </div>
            {evaluation && <section className={styles.evidenceSection}><span className={styles.cardKicker}>05 / WHY THESE SCORES</span><h4>Trace the judgement</h4>
              <div className={styles.domainReasons}>{evaluation.domains.map(domain => <div key={domain.key}><div><strong>{nice(domain.key)}</strong><span>{domain.score === null ? 'Not scored' : `${domain.score}/5`}</span></div>
                <p>{domain.reason}</p><small>Confidence: {domain.confidence}{domain.runs.length ? ` · runs ${domain.runs.join(', ')}` : ''}</small>
                {domain.evidence.length > 0 && <div className={styles.domainSources} aria-label={`${nice(domain.key)} source evidence`}>
                  {domain.evidence.map(id => { const source = segmentsById.get(id);
                    return <div key={id} className={styles.domainSource}>
                      <span>{source?.source.type === 'pdf' && source.source.page ? `PDF page ${source.source.page}` : `Source ${id}`}</span>
                      <blockquote>{source?.textEn ?? 'Source text unavailable'}</blockquote>
                      {source && <div className={styles.citationLinks}>
                        <button onClick={() => { setEvidence(id); setTab('notes'); }}>Inspect cited answer ↗</button>
                        {source.source.type === 'pdf' && source.source.page && plan.document && <button onClick={() => { setSourcePage(source.source.page ?? null); setTab('document'); }}>Open PDF page {source.source.page} ↗</button>}
                      </div>}
                    </div>;
                  })}
                </div>}</div>)}</div></section>}
          </div>}
          {tab === 'document' && <div className={styles.documentView}>{plan.document ? <>
            <div className={styles.documentMeta}><div><span className={styles.cardKicker}>ORIGINAL SOURCE / PDF</span><h4>Entrepreneur&apos;s pitch plan</h4>
              <p>{plan.document.pages} pages · {(plan.document.bytes / 1024).toFixed(0)} KB · {selected === 'preview' ? 'Browser-local demo preview' : 'Private to this centre'}</p></div>
              <a href={viewedDocumentUrl} target="_blank" rel="noopener noreferrer">Open original{sourcePage ? ` at page ${sourcePage}` : ''} ↗</a></div>
            <iframe key={viewedDocumentUrl} src={viewedDocumentUrl} title={sourcePage ? `Original pitch plan, page ${sourcePage}` : 'Original two-page pitch plan'} className={styles.pdfFrame} /></>
            : plan.brief ? <>
            <div className={styles.documentMeta}><div><span className={styles.cardKicker}>FROM THE APP / BUSINESS IDEA BRIEF</span><h4>What the entrepreneur sent to the evaluator</h4>
              <p>Built from the chat in the app · the same PDF the entrepreneur can download · private to this centre</p></div>
              <a href={plan.brief.url} target="_blank" rel="noopener noreferrer">Open brief ↗</a></div>
            <iframe key={plan.brief.url} src={plan.brief.url} title="Business Idea Brief sent from the app" className={styles.pdfFrame} /></>
            : <div className={styles.selectEmpty}><h4>Original document pending</h4><p>This record has no centre-uploaded PDF linked yet.</p></div>}</div>}
          {tab === 'notes' && <div className={styles.notesView}>
            {selected !== 'preview' && !plan.processingConsent && plan.document && plan.details.language === 'en' && <section className={styles.consentPanel}>
              <span className={styles.cardKicker}>BEFORE SCORING / PROCESSING CONSENT</span><h4>Record the applicant&apos;s permission</h4>
              <p>Read this notice aloud and record the applicant agreeing. The recording is kept privately with this plan.</p>
              <blockquote>{consentNotice}</blockquote><p><strong>Agreement:</strong> I agree that PitchPrism may process my idea for review.</p>
              <label>Applicant&apos;s spoken-consent recording<input type="file" accept="audio/webm,audio/ogg,audio/wav,audio/mp4,.webm,.ogg,.wav,.m4a,.mp4" onChange={event => setConsentFile(event.target.files?.[0] ?? null)} /></label>
              <label className={styles.consentCheck}><input type="checkbox" checked={consentConfirmed} onChange={event => setConsentConfirmed(event.target.checked)} /> I played the notice and the recording captures the applicant agreeing.</label>
              <button disabled={busy || !consentFile || !consentConfirmed} onClick={() => void recordProcessingConsent()}>{busy ? 'Saving…' : 'Save recorded consent'}</button>
            </section>}
            <section><span className={styles.cardKicker}>APPLICANT DETAILS</span><h4>At a glance</h4>
              <dl><div><dt>Entrepreneur</dt><dd>{plan.applicant.name ?? 'Not available'}</dd></div><div><dt>Phone</dt><dd>{plan.applicant.phone ?? 'Not provided'}</dd></div>
                <div><dt>Trade</dt><dd>{plan.details.trade ?? 'Not recorded'}</dd></div><div><dt>District</dt><dd>{plan.details.district ?? 'Not recorded'}</dd></div>
                <div><dt>Language</dt><dd>{languageName[plan.details.language ?? ''] ?? 'Not recorded'}</dd></div>
                {plan.profile && <>
                  <div><dt>Gender</dt><dd>{plan.profile.gender ? nice(plan.profile.gender) : 'Not shared'}</dd></div>
                  <div><dt>Village / area</dt><dd>{plan.profile.village ?? 'Not recorded'}</dd></div>
                  <div><dt>Block</dt><dd>{plan.profile.block ?? 'Not recorded'}</dd></div>
                  <div><dt>State</dt><dd>{plan.profile.state ?? 'Not recorded'}</dd></div>
                  <div><dt>Pincode</dt><dd>{plan.profile.pincode ?? 'Not recorded'}</dd></div>
                  <div><dt>Education</dt><dd>{plan.profile.education ?? 'Not recorded'}</dd></div>
                  <div><dt>Work background</dt><dd>{plan.profile.workBackground ?? 'Not recorded'}</dd></div>
                  <div><dt>Credit score</dt><dd>{plan.profile.creditScore ?? 'Not shared'}</dd></div>
                </>}</dl>
              {plan.brief && <p><a href={plan.brief.url} target="_blank" rel="noopener noreferrer">Open the Business Idea Brief sent from the app ↗</a></p>}</section>
            {cited && <section className={styles.citationPanel}><span className={styles.cardKicker}>SOURCE / {cited.segId}</span><h4>Cited evidence</h4>
              {cited.textOriginal && <p lang={cited.lang}>{cited.struck ? <del>{cited.textOriginal}</del> : cited.textOriginal}</p>}
              <blockquote>{cited.textEn}</blockquote><small>{cited.source.type === 'pdf' ? `PDF page ${cited.source.page ?? 'unknown'}` : nice(cited.source.type)} · {cited.lang}
                {cited.confidence !== undefined ? ` · read confidence ${Math.round(cited.confidence * 100)}%` : ''}</small>
              {plan.document && <button onClick={() => { setSourcePage(cited.source.page ?? null); setTab('document'); }}>View original{cited.source.page ? ` page ${cited.source.page}` : ' plan'} ↗</button>}</section>}
            {card?.financialChecks && card.financialChecks.length > 0 && <section><span className={styles.cardKicker}>FINANCIAL CHECKS</span><h4>Numbers to verify</h4>
              {card.financialChecks.map((check, index) => <p key={`${check.field}-${index}`}>{check.field}: written {check.written}; expected {check.expected} ({check.formula}).</p>)}</section>}
            {card?.followUps && card.followUps.length > 0 && <section><span className={styles.cardKicker}>FOLLOW-UP QUESTIONS</span><h4>Ask the entrepreneur</h4>
              <ol>{card.followUps.map(question => <li key={question.field}>{question.questionEn}</li>)}</ol></section>}
            {card?.planDraft && <section><span className={styles.cardKicker}>SUMMARY PLAN DRAFT</span><h4>For entrepreneur confirmation</h4>
              {card.planDraft.sections.map(section => <p key={section.heading}><strong>{section.heading}</strong><br />{section.textEn}</p>)}</section>}
            {card?.decision && <section className={styles.savedDecision}><strong>Human decision: {nice(card.decision.decision)}</strong><p>{card.decision.reason}</p>
              {card.decision.applicantMessage && <p><strong>Sent to the applicant:</strong> {card.decision.applicantMessage}</p>}
              {card.interview && <div><strong>Interview · {card.interview.status === 'confirmed' ? 'confirmed by the applicant' : card.interview.status === 'other_times_requested' ? 'applicant asked for other times' : 'waiting for the applicant to pick a time'}</strong>
                <ul>{card.interview.slots.map(slot => <li key={slot.id}>{slot.id === card.interview?.chosenSlotId ? '✓ ' : ''}{slotTime(slot.at)} · {modeLabel[slot.mode]} · {slot.details}</li>)}</ul>
                {card.interview.note && <p>Applicant&apos;s note: {card.interview.note}</p>}</div>}
              {card.decision.comparisonSnapshot && <p>Position when decided ({card.decision.comparisonSnapshot.rubricVersion}): {card.decision.comparisonSnapshot.tradeRank ? `trade rank ${card.decision.comparisonSnapshot.tradeRank.rank} of ${card.decision.comparisonSnapshot.tradeRank.of}` : 'trade unranked'} · {card.decision.comparisonSnapshot.cohortRank ? `cohort rank ${card.decision.comparisonSnapshot.cohortRank.rank} of ${card.decision.comparisonSnapshot.cohortRank.of}` : 'cohort unranked'}. The portfolio shows current ranks.</p>}</section>}
            {selected !== 'preview' && evaluation && !card?.decision && card?.state !== 'UNASSESSABLE' && <section><span className={styles.cardKicker}>HUMAN DECISION</span><h4>Make the final call</h4>
              <label htmlFor="centre-message">Message to the applicant (shown in their app)</label>
              <textarea id="centre-message" value={applicantMessage} onChange={event => setApplicantMessage(event.target.value)} maxLength={2000}
                placeholder="Your review: what was strong, what to improve, or what information is missing. Required for Not yet and More information." />
              <fieldset className={styles.slotFields}><legend>Interview slots for a shortlist (offer 1–3; the applicant picks one in the app)</legend>
                {slots.map((slot, index) => <div key={index} className={styles.slotRow}>
                  <input type="datetime-local" aria-label={`Slot ${index + 1} date and time`} value={slot.at} onChange={event => setSlots(all => all.map((item, i) => i === index ? { ...item, at: event.target.value } : item))} />
                  <select aria-label={`Slot ${index + 1} type`} value={slot.mode} onChange={event => setSlots(all => all.map((item, i) => i === index ? { ...item, mode: event.target.value as SlotDraft['mode'] } : item))}>
                    <option value="in_person">In person</option><option value="phone">Phone call</option><option value="video">Video call</option></select>
                  <input aria-label={`Slot ${index + 1} place or link`} placeholder="Centre address, phone number or meeting link" maxLength={200} value={slot.details}
                    onChange={event => setSlots(all => all.map((item, i) => i === index ? { ...item, details: event.target.value } : item))} />
                </div>)}</fieldset>
              <label htmlFor="centre-reason">Internal reason for an override (not shown to the applicant)</label><textarea id="centre-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} />
              <div className={styles.decisionActions}>
                <button disabled={busy || !slots.some(slot => slot.at && slot.details.trim().length >= 2)} title="Offer at least one interview slot" onClick={() => void decide('shortlist')}>Shortlist &amp; offer interview</button>
                <button disabled={busy || applicantMessage.trim().length < 10} onClick={() => void decide('more_info')}>More information</button>
                <button disabled={busy || applicantMessage.trim().length < 10} onClick={() => void decide('not_yet')}>Not yet</button></div></section>}
            {selected !== 'preview' && card && <section><span className={styles.cardKicker}>FEEDBACK DRAFT</span><h4>Words for the applicant</h4>
              <p>Saved in English and shown to the applicant in their app (My ideas → Evaluator feedback, and in their chat), translated into their language.</p><textarea aria-label="Feedback in English" value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={4000} />
              <button disabled={busy || feedback.trim().length < 10} onClick={() => void saveFeedback()}>Save feedback draft</button></section>}
            {!card && <section className={styles.notesPending}><h4>Review tools open after assessment</h4><p>The original plan and applicant details are ready. Scoring, questions and decisions wait for the evaluator pipeline.</p></section>}
          </div>}
          <div className={styles.caseFooter}><span>IDEA CARD / {selected?.slice(-6).toUpperCase()}</span><span>{selectedItem ? `Received ${date(selectedItem.updatedAt)}` : ''}</span></div>
        </>}
      </article>
      </div>
    </div>}

    {showUpload && <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowUpload(false); }}>
      <section className={styles.uploadModal} role="dialog" aria-modal="true" aria-labelledby="upload-title"><button className={styles.modalClose} onClick={() => setShowUpload(false)} aria-label="Close">×</button>
        <span className={styles.kicker}>NEW CENTRE INTAKE</span><h3 id="upload-title">Receive a pitch plan.</h3>
        <p>Record the entrepreneur&apos;s details and attach their original two-page PDF. The plan enters the review queue without an invented score.</p>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <form onSubmit={event => void uploadPlan(event)}><div className={styles.formGrid}>
          <label>Plan or business title<input name="title" required maxLength={160} placeholder="e.g. Neighbourhood tailoring studio" /></label>
          <label>Entrepreneur name<input name="applicantName" required maxLength={100} placeholder="Name on the plan" /></label>
          <label>Trade or business type<input name="trade" required maxLength={80} placeholder="e.g. Tailoring" /></label>
          <label>Cohort<select name="cohortId" defaultValue=""><option value="">Unassigned</option>{intakeOptions.cohorts.map(cohort => <option key={cohort.id} value={cohort.id}>{cohort.label}</option>)}</select></label>
          <label>Comparison trade<select name="tradeKey" defaultValue=""><option value="">Unclassified</option>{intakeOptions.trades.map(trade => <option key={trade.key} value={trade.key}>{trade.label}</option>)}</select></label>
          <label>District<input name="district" required maxLength={80} placeholder="e.g. Pune" /></label>
          <label>Plan language<select name="language" defaultValue="en">{Object.entries(languageName).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <label>Phone (optional)<input name="phone" inputMode="tel" placeholder="Applicant contact" /></label>
        </div><label className={styles.fileDrop}>ORIGINAL PITCH DOCUMENT<input name="plan" type="file" accept="application/pdf,.pdf" required onChange={event => setFile(event.target.files?.[0] ?? null)} />
          <span>{file ? file.name : 'Choose a two-page PDF · up to 12 MB'}</span></label>
          <div className={styles.modalActions}><button disabled={busy}>{busy ? 'Receiving plan…' : 'Add to review queue →'}</button>
            <button type="button" className={styles.cancelButton} onClick={() => setShowUpload(false)}>Cancel</button></div>
        </form>
      </section></div>}
  </section>;
}
