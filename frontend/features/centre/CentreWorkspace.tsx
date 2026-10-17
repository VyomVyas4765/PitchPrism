'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../../lib/api';
import styles from './centre-workspace.module.css';

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
  reason: string | null; decision: { decision: string; reason?: string } | null;
  feedback: { textEn: string; status: string } | null };
type Plan = { submissionId: string; title: string; status: string; processingConsent: boolean; applicant: { name: string | null; phone: string | null };
  details: { district: string | null; trade: string | null; language: string | null; format: string | null };
  document: { id: string; bytes: number; pages: number; sha256: string; url: string } | null };
type PreviewResult = { input: Card['input']; assessment: Pick<Card, 'evaluation' | 'quality' | 'financialChecks' | 'followUps' | 'planDraft' | 'reason'> & { status: 'assessed' | 'pending_model' }; document: { pages: number; bytes: number }; saved: false };

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
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [sourcePage, setSourcePage] = useState<number | null>(null);
  const [lane, setLane] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('updated');
  const [tab, setTab] = useState<'assessment' | 'document' | 'notes'>('assessment');
  const [showUpload, setShowUpload] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [consentFile, setConsentFile] = useState<File | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const previewFile = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  const refresh = useCallback(async () => {
    const result = await api<{ items: QueueItem[] }>('/centre/queue');
    setItems(result.items);
    return result.items;
  }, []);
  const open = useCallback(async (item: QueueItem) => {
    if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }
    setSelected(item.submissionId); setPlan(null); setCard(null); setEvidence(null); setSourcePage(null); setError(''); setTab('assessment');
    setConsentFile(null); setConsentConfirmed(false);
    try {
      const [planResult, cardResult] = await Promise.all([
        api<Plan>(`/centre/submissions/${item.submissionId}/plan`),
        item.reviewAvailable ? api<Card>(`/centre/submissions/${item.submissionId}/card`) : Promise.resolve(null),
      ]);
      setPlan(planResult); setCard(cardResult); setFeedback(cardResult?.feedback?.textEn ?? '');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open the assessment.'); }
  }, []);
  useEffect(() => {
    let active = true;
    refresh().then(rows => { if (active && rows[0]) void open(rows[0]); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load the queue.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, open]);
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
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/centre/plans', { method: 'POST', credentials: 'same-origin', body: fields });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not receive the plan.');
      const rows = await refresh();
      const item = rows.find(row => row.submissionId === result.submissionId);
      if (item) await open(item);
      setShowUpload(false); setFile(null); form.reset();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not receive the plan.'); }
    finally { setBusy(false); }
  }
  async function evaluatePreview(event: ChangeEvent<HTMLInputElement>) {
    const pdf = event.target.files?.[0];
    event.target.value = '';
    if (!pdf) return;
    if (pdf.size > 12 * 1024 * 1024) { setError('The PDF must be 12 MB or smaller.'); return; }
    const fields = new FormData();
    fields.set('plan', pdf);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/centre/evaluate-preview', { method: 'POST', credentials: 'same-origin', body: fields });
      const result = await response.json() as PreviewResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not evaluate this PDF.');
      const evaluated = result.assessment.evaluation as (NonNullable<Card['evaluation']> & {
        financialChecks?: Card['financialChecks']; followUps?: Card['followUps']; planDraft?: Card['planDraft'];
      }) | null;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(pdf);
      setSelected('preview'); setDetailOpen(false); setTab('assessment'); setEvidence(null); setSourcePage(null);
      setPlan({ submissionId: 'preview', title: pdf.name.replace(/\.pdf$/i, ''), status: 'PREVIEW', processingConsent: false,
        applicant: { name: null, phone: null }, details: { district: null, trade: null, language: 'en', format: 'pdf' },
        document: { id: 'preview', bytes: result.document.bytes, pages: result.document.pages, sha256: '', url: previewUrl.current } });
      setCard({ submissionId: 'preview', state: result.assessment.status === 'assessed' ? 'READY' : 'PENDING_MODEL', input: result.input,
        evaluation: evaluated ?? null, quality: result.assessment.quality ?? null,
        financialChecks: result.assessment.financialChecks ?? evaluated?.financialChecks ?? [],
        followUps: result.assessment.followUps ?? evaluated?.followUps ?? [],
        planDraft: result.assessment.planDraft ?? evaluated?.planDraft ?? null,
        reason: result.assessment.reason ?? null, decision: null, feedback: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not evaluate this PDF.';
      setError(`${message} Selected file: ${pdf.name.slice(0, 120)} (${pdf.size} bytes).`);
    }
    finally { setBusy(false); }
  }
  async function decide(decision: 'shortlist' | 'not_yet' | 'more_info') {
    if (!selected || selected === 'preview' || !card) return;
    setBusy(true); setError('');
    try {
      await api(`/centre/submissions/${selected}/decision`, { method: 'POST', body: JSON.stringify({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
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

  const visible = useMemo(() => items.filter(item => (lane === 'all' || item.state === lane) &&
    item.title.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => {
      if (sort === 'potential') return (b.potential ?? -1) - (a.potential ?? -1);
      if (sort === 'completeness') return (b.completeness ?? -1) - (a.completeness ?? -1);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }), [items, lane, search, sort]);
  const selectedItem = items.find(item => item.submissionId === selected);
  const evaluation = card?.evaluation;
  const cited = card?.input.segments.find(segment => segment.segId === evidence);
  const flags = evaluation?.flags ?? card?.quality?.flags ?? [];
  const scoredCount = items.filter(item => item.potential !== null).length;
  const waitingCount = items.filter(item => !item.reviewAvailable).length;
  const reviewCount = items.filter(item => item.state === 'NEEDS_ATTENTION').length;
  const lookup = new Map(evaluation?.domains.map(domain => [domain.key, domain]) ?? []);
  const segmentsById = new Map(card?.input.segments.map(segment => [segment.segId, segment]) ?? []);
  const documentUrl = plan?.document?.url;
  const viewedDocumentUrl = documentUrl && sourcePage ? `${documentUrl.split('#')[0]}#page=${sourcePage}` : documentUrl;

  return <section className={styles.desk} aria-label="Centre evaluator dashboard">
    <header className={styles.overviewHeader}>
      <div><span className={styles.kicker}>PITCHPRISM / CENTRE ASSESSOR</span><h2>Evaluator desk<span className={styles.liveDot} aria-label="Workspace active" /></h2>
        <p>Everything you need for the first pass, in one place.</p></div>
      <div className={styles.overviewActions}><button className={styles.ghostButton} onClick={() => void refresh().catch(err => setError(String(err)))}>↻ Refresh</button>
        <button className={styles.ghostButton} onClick={() => setShowUpload(true)}>+ Receive a plan</button>
        {demoPreviewEnabled && <><button className={styles.receiveButton} disabled={busy} onClick={() => previewFile.current?.click()}>{busy ? 'Evaluating PDF…' : '↑ Evaluate PDF'}</button>
        <input ref={previewFile} type="file" accept="application/pdf,.pdf" hidden aria-label="Choose a two-page PDF for demo evaluation" onChange={event => void evaluatePreview(event)} /></>}</div>
    </header>
    <div className={styles.miniMetrics} aria-label="Queue summary">
      <div><strong>{items.length.toString().padStart(2, '0')}</strong><span>Plans in desk</span></div>
      <div><strong>{waitingCount.toString().padStart(2, '0')}</strong><span>Awaiting evaluation</span></div>
      <div><strong>{scoredCount.toString().padStart(2, '0')}</strong><span>Scored</span></div>
      <div><strong>{reviewCount.toString().padStart(2, '0')}</strong><span>Needs attention</span></div>
    </div>
    {error && <div className={styles.error} role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {busy && <div className={styles.previewBanner} role="status">Reading the two-page PDF and validating evidence-linked scores. This can take up to three minutes.</div>}
    {selected === 'preview' && <div className={styles.previewBanner} role="status">Demo preview · The PDF and result are only in this browser session. The redacted answers were evaluated with Groq. Use “Receive a plan” for the saved, consent-gated workflow.</div>}

    <div className={styles.overviewGrid}>
      <aside className={styles.queue} aria-label="Review queue">
        <div className={styles.queueTools}>
          <label className={styles.searchLabel}><span className="sr-only">Search plans</span><input type="search" placeholder="Search plans…" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className={styles.filters}><label>Lane<select value={lane} onChange={event => setLane(event.target.value)}>
            <option value="all">All plans</option><option value="READY">Ready</option><option value="NEEDS_ATTENTION">Needs attention</option>
            <option value="UNASSESSABLE">Unassessable</option><option value="PENDING_MODEL">Awaiting evaluation</option>
          </select></label><label>Sort<select value={sort} onChange={event => setSort(event.target.value)}>
            <option value="updated">Latest</option><option value="potential">Potential</option><option value="completeness">Completeness</option>
          </select></label></div>
        </div>
        <div className={styles.queueRows}>{loading ? <p className={styles.queueEmpty}>Loading plans…</p> : visible.length === 0
          ? <div className={styles.queueEmpty}><strong>No plans in this view.</strong><p>{demoPreviewEnabled ? 'Choose “Evaluate PDF” to see an immediate demo result.' : 'Receive a two-page PDF to start the centre review.'}</p></div>
          : visible.map(item => <button key={item.submissionId} className={`${styles.queueRow} ${selected === item.submissionId ? styles.selected : ''}`}
            onClick={() => void open(item)} aria-pressed={selected === item.submissionId}>
            <span className={styles.rowTop}><span className={styles.rowId}>PLAN / {item.submissionId.slice(-6).toUpperCase()}</span><span>{date(item.updatedAt)}</span></span>
            <strong>{item.title}</strong><span className={styles.rowBottom}><span className={`${styles.statusPill} ${item.reviewAvailable ? styles.readyPill : ''}`}>{item.reviewAvailable ? nice(item.state) : 'Awaiting evaluation'}</span>
              <span className={styles.rowScore}>{item.potential === null ? 'Score —' : `${item.potential}/100`} ↗</span></span>
          </button>)}
        </div>
        <div className={styles.queueFooter}>PRIVATE CENTRE RECORDS <span>↗</span></div>
      </aside>

      <main className={styles.overviewMain} aria-label="Selected plan overview">
        {!selected ? <div className={styles.overviewEmpty}><span className={styles.cardKicker}>START HERE</span><h3>Evaluate a business idea.</h3><p>{demoPreviewEnabled ? 'Choose a supported two-page English digital business idea PDF. Its scores, chart, and original will appear here together.' : 'Receive a plan to begin the consent-gated centre review.'}</p>{demoPreviewEnabled && <button className={styles.receiveButton} disabled={busy} onClick={() => previewFile.current?.click()}>↑ Evaluate PDF</button>}</div>
          : !plan ? <div className={styles.overviewEmpty} role="status">Opening the selected plan…</div> : <>
          <div className={styles.overviewTitle}><div><span className={styles.cardKicker}>{selected === 'preview' ? 'UNSAVED DEMO PREVIEW' : `SELECTED PLAN / ${selected.slice(-6).toUpperCase()}`}</span>
            <h3>{plan.title}</h3><p>{plan.applicant.name ?? 'Applicant pending'} · {plan.details.trade ?? 'Trade pending'} · {plan.details.district ?? 'District pending'}</p></div>
            <span className={`${styles.overviewStatus} ${evaluation ? styles.scoredStatus : ''}`}>{evaluation ? evaluation.band : 'Awaiting evaluation'}</span></div>
          <div className={styles.overviewScoreArea}>
            <section className={styles.overviewPotential} aria-label="Potential score"><span className={styles.cardKicker}>POTENTIAL</span>
              <div className={styles.overviewGauge} style={{ '--score': `${evaluation?.potential ?? 0}%` } as React.CSSProperties}>
                <div><strong>{evaluation?.potential ?? '—'}</strong><small>/ 100</small></div></div>
              <p>{evaluation ? 'Evidence-linked score' : 'Scoring pending'}</p>
              <small>{evaluation ? `Rubric ${evaluation.rubricVersion}` : 'No assessment has been generated'}</small></section>
            <section className={styles.overviewChart} aria-label="Nine assessment domains"><div className={styles.overviewCardTop}><span className={styles.cardKicker}>ASSESSMENT DOMAINS</span><button onClick={() => { setTab('assessment'); setDetailOpen(true); }}>See evidence ↗</button></div>
              {rubric.map(([key, name, color]) => { const domain = lookup.get(key); const value = key === 'completeness'
                ? evaluation?.completeness ?? card?.quality?.completeness ?? null : domain?.score ?? null;
                const percent = value === null ? 0 : key === 'completeness' ? value : value * 20;
                return <div className={styles.overviewBar} key={key}><span><i style={{ backgroundColor: color }} />{name}</span><div><i style={{ width: `${percent}%`, backgroundColor: color }} /></div><strong>{value === null ? evaluation && key !== 'completeness' ? 'Not assessed' : '—' : key === 'completeness' ? `${value}%` : `${value}/5`}</strong></div>;
              })}
              {evaluation && lookup.get('entrepreneur_readiness')?.score === null && <p className={styles.readinessNote}>Readiness needs evidence of skills, experience, or action already taken. Ask the applicant before scoring it.</p>}</section>
          </div>
          <div className={styles.overviewBottom}>
            <section className={styles.overviewQuadrant}><div className={styles.overviewCardTop}><span className={styles.cardKicker}>SCREENING QUADRANT</span><span>Potential ↑ &nbsp; Completeness →</span></div>
              <div className={styles.miniQuadrant}><div>Ask for more<br />information</div><div>Deeper evaluation<br />or funding</div><div>Re-submit<br />with help</div><div>Mentoring<br />or skilling</div>
                {evaluation && evaluation.potential !== null && <i className={styles.quadrantPoint} style={{ left: `${evaluation.completeness}%`, bottom: `${evaluation.potential}%` }} />}</div>
              <p>{evaluation ? `Suggested pathway: ${evaluation.pathway}` : 'Position appears after a valid assessment.'}</p></section>
            <section className={styles.overviewNext}><span className={styles.cardKicker}>NEXT STEP</span><div className={styles.nextIcon}>{evaluation ? '✓' : '◷'}</div>
              <h4>{evaluation ? 'Review the evidence' : selected === 'preview' ? 'Score unavailable' : 'Ready for evaluation'}</h4><p>{evaluation ? selected === 'preview' ? 'Inspect the cited claims in this unsaved demo preview.' : 'Check the cited claims before making a human decision.' : selected === 'preview' ? card?.reason ?? 'The PDF could not be scored safely.' : plan?.processingConsent ? 'The original is ready for evidence-linked scoring.' : 'Processing consent must be recorded before the plan can be scored.'}</p>
              {evaluation ? <button onClick={() => { setTab('assessment'); setDetailOpen(true); }}>{selected === 'preview' ? 'Inspect score evidence →' : 'Open full review →'}</button>
                : selected === 'preview' ? <button onClick={() => previewFile.current?.click()}>Try another PDF →</button>
                : plan.processingConsent ? <button disabled={busy || !plan.document || !!card?.decision} onClick={() => void evaluatePdf()}>{busy ? 'Evaluating…' : 'Evaluate plan →'}</button>
                  : <button onClick={() => { setTab('notes'); setDetailOpen(true); }}>Record consent →</button>}</section>
          </div>
        </>}
      </main>

      <aside className={styles.overviewSide} aria-label="Original and applicant details">
        <section className={styles.sideDocument}><div className={styles.sideHeading}><span className={styles.cardKicker}>ORIGINAL PITCH PLAN</span><span>{plan?.document ? `${plan.document.pages} PAGES` : 'PENDING'}</span></div>
          {plan?.document ? <><div className={styles.sidePreview}><iframe src={`${plan.document.url}#toolbar=0&navpanes=0`} title="Preview of original pitch plan" /></div>
            <button onClick={() => { setTab('document'); setDetailOpen(true); }}>Open document ↗</button></>
            : <div className={styles.sidePlaceholder}><span>▤</span><p>{selected ? 'No original PDF is linked to this record.' : 'Choose a plan to preview its original.'}</p></div>}</section>
        <section className={styles.sideFacts}><span className={styles.cardKicker}>ENTREPRENEUR & CONTEXT</span>
          <dl><div><dt>Entrepreneur</dt><dd>{plan?.applicant.name ?? '—'}</dd></div><div><dt>Trade</dt><dd>{plan?.details.trade ?? '—'}</dd></div>
            <div><dt>District</dt><dd>{plan?.details.district ?? '—'}</dd></div><div><dt>Language</dt><dd>{languageName[plan?.details.language ?? ''] ?? '—'}</dd></div></dl>
          {plan && <button onClick={() => { setTab('notes'); setDetailOpen(true); }}>All details & notes ↗</button>}</section>
        <section className={styles.sideSignal}><span className={styles.cardKicker}>REVIEW SIGNAL</span><strong>{evaluation ? `${flags.length} quality ${flags.length === 1 ? 'flag' : 'flags'}` : 'Awaiting evidence'}</strong>
          <p>{evaluation ? `${evaluation.coverage}% evidence coverage · ${selected === 'preview' ? 'preview only' : `human decision ${card?.decision ? 'recorded' : 'pending'}`}` : card?.reason ?? 'Missing information is not treated as a weak idea.'}</p></section>
      </aside>
    </div>

    {detailOpen && <div className={styles.reviewBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDetailOpen(false); }}>
      <div className={styles.reviewDrawer} role="dialog" aria-modal="true" aria-label="Full plan review">
        <div className={styles.reviewToolbar}><span>FULL PLAN REVIEW</span><button onClick={() => setDetailOpen(false)} aria-label="Close full review">×</button></div>
      <article className={styles.casePanel}>
        {!selected ? <div className={styles.selectEmpty}><span>01 / THE IDEA CARD</span><h3>Select a plan to begin.</h3><p>The original document, assessment domains, and decision path will appear here.</p></div>
          : !plan ? <div className={styles.selectEmpty} role="status">Opening plan…</div> : <>
          <div className={styles.caseHero}>
            <div><span className={styles.kicker}>IDEA CARD &nbsp; / &nbsp; {selected?.slice(-6).toUpperCase()}</span>
              <h3>{plan.title}</h3><p>{plan.applicant.name ?? 'Applicant details pending'} <span>·</span> {plan.details.trade ?? 'Trade not recorded'} <span>·</span> {plan.details.district ?? 'District not recorded'}</p>
              <div className={styles.chips}><span>{languageName[plan.details.language ?? ''] ?? 'Language pending'}</span><span>{plan.details.format?.toUpperCase() ?? 'FORMAT PENDING'}</span>
                <span>{plan.document ? `${plan.document.pages} PAGE PLAN` : 'ORIGINAL PENDING'}</span></div>
            </div><div className={styles.caseState}><span>SCREENING STATUS</span><strong>{evaluation ? evaluation.band : 'Awaiting evaluation'}</strong>
              <small>{evaluation ? `Rubric ${evaluation.rubricVersion}` : 'No score has been generated'}</small></div>
          </div>
          <div className={styles.tabs} role="tablist" aria-label="Idea card views">
            <button role="tab" aria-selected={tab === 'assessment'} className={tab === 'assessment' ? styles.activeTab : ''} onClick={() => setTab('assessment')}>Assessment</button>
            <button role="tab" aria-selected={tab === 'document'} className={tab === 'document' ? styles.activeTab : ''} onClick={() => setTab('document')}>Original plan {plan.document ? '↗' : ''}</button>
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
                <div><dt>Language</dt><dd>{languageName[plan.details.language ?? ''] ?? 'Not recorded'}</dd></div></dl></section>
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
            {card?.decision && <section className={styles.savedDecision}><strong>Human decision: {nice(card.decision.decision)}</strong><p>{card.decision.reason}</p></section>}
            {selected !== 'preview' && evaluation && !card?.decision && card?.state !== 'UNASSESSABLE' && <section><span className={styles.cardKicker}>HUMAN DECISION</span><h4>Make the final call</h4>
              <label htmlFor="centre-reason">Reason for an override</label><textarea id="centre-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} />
              <div className={styles.decisionActions}><button disabled={busy} onClick={() => void decide('shortlist')}>Shortlist</button>
                <button disabled={busy} onClick={() => void decide('more_info')}>More information</button><button disabled={busy} onClick={() => void decide('not_yet')}>Not yet</button></div></section>}
            {selected !== 'preview' && card && <section><span className={styles.cardKicker}>FEEDBACK DRAFT</span><h4>Words for the applicant</h4>
              <p>Saved in English; translation and delivery remain pending.</p><textarea aria-label="Feedback in English" value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={4000} />
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
