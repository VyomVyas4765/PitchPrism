'use client';
import { useMemo, useState } from 'react';
import { domainSchema } from '@pitchprism/contracts';
import styles from './hq.module.css';
import { label, mutate } from './use-resource';

export type Domain = { key: string; label: string; weight: number; lowDescriptor: string; highDescriptor: string; evidenceFields?: string[] };
export type PathwayRules = Partial<{ requestInfoBelowCompleteness: number; highCompleteness: number; fundingMinFeasibility: number; fundingMaxLoan: number;
  skillingMaxReadiness: number; mentoringWeakAtOrBelow: number; mentoringWeakDomains: string[] }>;
export type RubricDraft = { rubricKey: string; name: string; domains: Domain[]; bands: { strong: number; promising: number; minCoverage: number };
  completenessWeights?: Record<string, number>; pathwayRules?: PathwayRules };

// Domain hues from docs/design.md: the prism splits an idea into its rubric domains.
export const HUES = ['#6b4fa0', '#3e57a8', '#1f7fa8', '#1e8c72', '#6e9a2a', '#c49a12', '#d9762b', '#c2452d', '#9a9387'];
const FIELDS = (domainSchema as { definitions: Record<string, { enum?: string[] }> }).definitions.CanonicalField!.enum!;
const EDP_FIELDS = FIELDS.slice(0, 10); // PRD Appendix B.1: the ten EDP questions carry completeness
// Calculator defaults in ai/intel/scoring.py; shown when a rubric leaves a rule unset.
const RULE_DEFAULTS = { requestInfoBelowCompleteness: 70, highCompleteness: 70, fundingMinFeasibility: 4, fundingMaxLoan: 200000, skillingMaxReadiness: 2, mentoringWeakAtOrBelow: 2 };
const RULES: Array<[keyof typeof RULE_DEFAULTS, string, number, number, number]> = [
  ['requestInfoBelowCompleteness', 'Ask for more information below completeness (%)', 0, 100, 1],
  ['highCompleteness', 'Counts as complete from (%)', 0, 100, 1],
  ['fundingMinFeasibility', 'Funding needs feasibility of at least', 1, 5, 1],
  ['fundingMaxLoan', 'Funding: largest loan asked (₹)', 0, 5_000_000, 10_000],
  ['skillingMaxReadiness', 'Skilling when readiness is at or below', 1, 5, 1],
  ['mentoringWeakAtOrBelow', 'Mentoring when a checked domain is at or below', 1, 5, 1],
];

/** Largest-remainder rounding: scale values to total 100 in whole numbers. */
function balance(values: number[]) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!total) return values.map((_, index) => index < 100 % values.length ? Math.ceil(100 / values.length) : Math.floor(100 / values.length));
  const raw = values.map(value => Math.max(0, value) / total * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  raw.map((value, index) => [value - floors[index]!, index] as const).sort((a, b) => b[0] - a[0]).forEach(([, index]) => { if (left > 0) { floors[index]!++; left--; } });
  return floors;
}

/** Same arithmetic as ai/intel/scoring.py, so the preview shows what the calculator will do. */
function preview(draft: RubricDraft, scores: Record<string, number | null>) {
  const assessed = draft.domains.filter(domain => scores[domain.key] != null);
  const covered = assessed.reduce((sum, domain) => sum + domain.weight, 0);
  const potential = covered ? Math.round(100 * assessed.reduce((sum, domain) => sum + domain.weight * scores[domain.key]!, 0) / (5 * covered)) : null;
  const band = covered < draft.bands.minCoverage || potential == null ? 'insufficient' : potential >= draft.bands.strong ? 'strong' : potential >= draft.bands.promising ? 'promising' : 'not_yet';
  return { covered, potential, band };
}

function differences(base: RubricDraft | null, draft: RubricDraft) {
  if (!base) return ['New rubric family.'];
  const out: string[] = [];
  const before = new Map(base.domains.map(domain => [domain.key, domain]));
  const after = new Map(draft.domains.map(domain => [domain.key, domain]));
  for (const [key, domain] of after) {
    const old = before.get(key);
    if (!old) { out.push(`Adds ${domain.label || key} (${domain.weight})`); continue; }
    if (old.weight !== domain.weight) out.push(`${domain.label}: weight ${old.weight} → ${domain.weight}`);
    if (old.lowDescriptor !== domain.lowDescriptor || old.highDescriptor !== domain.highDescriptor) out.push(`${domain.label}: descriptors reworded`);
    if ((old.evidenceFields ?? []).join() !== (domain.evidenceFields ?? []).join()) out.push(`${domain.label}: evidence fields changed`);
  }
  for (const [key, domain] of before) if (!after.has(key)) out.push(`Removes ${domain.label || key}`);
  if (base.domains.map(domain => domain.key).join() !== draft.domains.map(domain => domain.key).join() && !out.length) out.push('Reorders domains');
  for (const band of ['strong', 'promising', 'minCoverage'] as const) if (base.bands[band] !== draft.bands[band]) out.push(`${band === 'minCoverage' ? 'Minimum coverage' : `${label(band)} band`}: ${base.bands[band]} → ${draft.bands[band]}`);
  if (JSON.stringify(base.pathwayRules ?? {}) !== JSON.stringify(draft.pathwayRules ?? {})) out.push('Pathway rules changed');
  if (JSON.stringify(base.completenessWeights ?? {}) !== JSON.stringify(draft.completenessWeights ?? {})) out.push('Completeness weights changed');
  if (base.name !== draft.name) out.push('Renamed');
  return out;
}

// W-02 visual rubric builder (P1). Saving always creates the next draft version; publishing is a separate step.
export default function RubricBuilder({ base, onDone }: { base: RubricDraft | null; onDone: (saved: boolean) => void }) {
  const [draft, setDraft] = useState<RubricDraft>(() => base ? structuredClone(base) : {
    rubricKey: '', name: '', bands: { strong: 70, promising: 50, minCoverage: 60 },
    domains: [{ key: 'clarity', label: 'Clarity of the idea', weight: 100, lowDescriptor: '', highDescriptor: '', evidenceFields: ['offering'] }],
  });
  const [selected, setSelected] = useState(0);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const total = draft.domains.reduce((sum, domain) => sum + (Number(domain.weight) || 0), 0);
  const completenessTotal = Object.values(draft.completenessWeights ?? {}).reduce((sum, value) => sum + value, 0);
  const result = preview(draft, scores);
  const changes = useMemo(() => differences(base, draft), [base, draft]);
  const rules = { ...RULE_DEFAULTS, ...draft.pathwayRules };
  const set = (patch: Partial<RubricDraft>) => setDraft(value => ({ ...value, ...patch }));
  const setDomain = (index: number, patch: Partial<Domain>) => set({ domains: draft.domains.map((domain, i) => i === index ? { ...domain, ...patch } : domain) });
  const move = (index: number, by: number) => {
    const next = [...draft.domains];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    set({ domains: next }); setSelected(index + by);
  };
  const setRule = (key: keyof PathwayRules, value: number | string[]) => set({ pathwayRules: { ...draft.pathwayRules, [key]: value } });
  const valid = total === 100 && (!draft.completenessWeights || completenessTotal === 100) && draft.bands.promising <= draft.bands.strong
    && draft.domains.every(domain => /^[a-z_]{2,40}$/.test(domain.key) && domain.label && domain.lowDescriptor && domain.highDescriptor)
    && new Set(draft.domains.map(domain => domain.key)).size === draft.domains.length && /^[a-z0-9_-]{2,60}$/.test(draft.rubricKey) && !!draft.name;

  async function save() {
    setBusy(true); setError('');
    try {
      const body = { ...draft, domains: draft.domains.map(({ evidenceFields, ...domain }) => ({ ...domain, ...(evidenceFields?.length ? { evidenceFields } : {}) })),
        ...(draft.pathwayRules && Object.keys(draft.pathwayRules).length ? {} : { pathwayRules: undefined }) };
      await mutate('/hq/rubrics', 'POST', body);
      onDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this version.'); setBusy(false); }
  }

  return <div className={styles.builder} aria-label="Rubric builder">
    <div className={styles.builderHead}>
      <div><label htmlFor="rb-key">Rubric key</label><input id="rb-key" value={draft.rubricKey} readOnly={!!base} onChange={event => set({ rubricKey: event.target.value })} placeholder="edp-default" /></div>
      <div style={{ flex: 2 }}><label htmlFor="rb-name">Name</label><input id="rb-name" value={draft.name} onChange={event => set({ name: event.target.value })} maxLength={160} /></div>
    </div>

    <h4>Domains <span className={total === 100 ? styles.ok : styles.bad}>· {total} of 100</span></h4>
    <div className={styles.prism} role="group" aria-label="Domain weights">
      {draft.domains.map((domain, index) => <button key={index} type="button" title={`${domain.label} ${domain.weight}`} aria-label={`${domain.label || domain.key}, weight ${domain.weight}`}
        onClick={() => setSelected(index)} className={index === selected ? styles.prismActive : ''}
        style={{ flexGrow: Math.max(domain.weight, 0.5), background: HUES[index % HUES.length] }}>{domain.weight >= 8 ? domain.weight : ''}</button>)}
    </div>
    <div className={styles.row} style={{ margin: '8px 0 16px' }}>
      <button type="button" className={`secondary ${styles.small}`} onClick={() => set({ domains: balance(draft.domains.map(domain => domain.weight)).map((weight, index) => ({ ...draft.domains[index]!, weight })) })}>Balance to 100</button>
      <button type="button" className={`secondary ${styles.small}`} onClick={() => { set({ domains: [...draft.domains, { key: '', label: '', weight: 0, lowDescriptor: '', highDescriptor: '' }] }); setSelected(draft.domains.length); }}>Add domain</button>
    </div>

    {draft.domains.map((domain, index) => <fieldset key={index} className={`${styles.domainCard} ${index === selected ? styles.domainSelected : ''}`} onFocus={() => setSelected(index)}>
      <legend><span className={styles.swatch} style={{ background: HUES[index % HUES.length] }} />{domain.label || 'New domain'}</legend>
      <div className={styles.domainGrid}>
        <div><label htmlFor={`d-label-${index}`}>Label</label><input id={`d-label-${index}`} value={domain.label} maxLength={80} onChange={event => setDomain(index, { label: event.target.value })} /></div>
        <div><label htmlFor={`d-key-${index}`}>Key</label><input id={`d-key-${index}`} value={domain.key} onChange={event => setDomain(index, { key: event.target.value })} placeholder="customer_need" /></div>
        <div className={styles.weightControl}><label htmlFor={`d-weight-${index}`}>Weight {domain.weight}</label>
          <input id={`d-weight-${index}`} type="range" min={0} max={50} step={1} value={domain.weight} onChange={event => setDomain(index, { weight: Number(event.target.value) })} /></div>
        <div><label htmlFor={`d-low-${index}`}>What earns a 1</label><textarea id={`d-low-${index}`} value={domain.lowDescriptor} maxLength={400} onChange={event => setDomain(index, { lowDescriptor: event.target.value })} /></div>
        <div><label htmlFor={`d-high-${index}`}>What earns a 5</label><textarea id={`d-high-${index}`} value={domain.highDescriptor} maxLength={400} onChange={event => setDomain(index, { highDescriptor: event.target.value })} /></div>
      </div>
      <p className={styles.muted} style={{ margin: '4px 0' }}>Evidence fields (answers the score may cite)</p>
      <div className={styles.chips}>{FIELDS.map(field => {
        const on = domain.evidenceFields?.includes(field) ?? false;
        return <button key={field} type="button" aria-pressed={on} className={`${styles.chip} ${on ? styles.chipOn : ''}`}
          onClick={() => setDomain(index, { evidenceFields: on ? domain.evidenceFields!.filter(item => item !== field) : [...(domain.evidenceFields ?? []), field] })}>{label(field)}</button>;
      })}</div>
      <div className={styles.row} style={{ marginTop: 10 }}>
        <button type="button" className={`secondary ${styles.small}`} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${domain.label} up`}>↑</button>
        <button type="button" className={`secondary ${styles.small}`} disabled={index === draft.domains.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${domain.label} down`}>↓</button>
        <button type="button" className={`secondary ${styles.small}`} disabled={draft.domains.length === 1} onClick={() => { set({ domains: draft.domains.filter((_, i) => i !== index) }); setSelected(0); }}>Remove</button>
        <label className={styles.muted} style={{ marginLeft: 'auto' }}>Preview score <select value={scores[domain.key] ?? ''} onChange={event => setScores({ ...scores, [domain.key]: event.target.value ? Number(event.target.value) : null })}>
          <option value="">no evidence</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
    </fieldset>)}

    <h4>Bands</h4>
    <div className={styles.bandScale} aria-hidden="true">
      <span style={{ width: `${draft.bands.promising}%`, background: '#d5ccba' }}>not yet</span>
      <span style={{ width: `${Math.max(0, draft.bands.strong - draft.bands.promising)}%`, background: '#e9d29a' }}>promising</span>
      <span style={{ width: `${100 - draft.bands.strong}%`, background: '#b9d7c6' }}>strong</span>
      {result.potential != null && <i style={{ left: `${result.potential}%` }} title={`Preview ${result.potential}`} />}
    </div>
    <div className={styles.domainGrid}>
      {(['promising', 'strong', 'minCoverage'] as const).map(key => <div key={key}><label htmlFor={`band-${key}`}>{key === 'minCoverage' ? `Score only with evidence for ${draft.bands.minCoverage}% of the weight` : `${label(key)} from ${draft.bands[key]}`}</label>
        <input id={`band-${key}`} type="range" min={0} max={100} value={draft.bands[key]} onChange={event => set({ bands: { ...draft.bands, [key]: Number(event.target.value) } })} /></div>)}
    </div>
    <p className={styles.preview} role="status">Preview: {result.potential == null ? 'no domains scored' : <>potential <strong>{result.potential}</strong> from {result.covered}% of the weight → <strong>{label(result.band)}</strong></>}</p>

    <h4>Pathway rules</h4>
    <div className={styles.domainGrid}>
      {RULES.map(([key, text, min, max, step]) => <div key={key}><label htmlFor={`rule-${key}`}>{text}</label>
        <input id={`rule-${key}`} type="number" min={min} max={max} step={step} value={rules[key]} onChange={event => setRule(key, Number(event.target.value))} /></div>)}
    </div>
    <p className={styles.muted} style={{ margin: '4px 0' }}>Domains checked for the mentoring rule</p>
    <div className={styles.chips}>{draft.domains.filter(domain => domain.key).map(domain => {
      const list = draft.pathwayRules?.mentoringWeakDomains ?? [];
      const on = list.includes(domain.key);
      return <button key={domain.key} type="button" aria-pressed={on} className={`${styles.chip} ${on ? styles.chipOn : ''}`}
        onClick={() => setRule('mentoringWeakDomains', on ? list.filter(item => item !== domain.key) : [...list, domain.key])}>{domain.label || domain.key}</button>;
    })}</div>

    <h4>Completeness <span className={!draft.completenessWeights || completenessTotal === 100 ? styles.ok : styles.bad}>· {draft.completenessWeights ? `${completenessTotal} of 100` : 'calculator default'}</span></h4>
    {!draft.completenessWeights ? <button type="button" className={`secondary ${styles.small}`} onClick={() => set({ completenessWeights: Object.fromEntries(EDP_FIELDS.map((field, index) => [field, balance(EDP_FIELDS.map(() => 1))[index]!])) })}>Set completeness weights</button> : <>
      <div className={styles.domainGrid}>{Object.entries(draft.completenessWeights).map(([field, weight]) => <div key={field}><label htmlFor={`cw-${field}`}>{label(field)}</label>
        <input id={`cw-${field}`} type="number" min={0} max={100} value={weight} onChange={event => set({ completenessWeights: { ...draft.completenessWeights, [field]: Number(event.target.value) } })} /></div>)}</div>
      <button type="button" className={`secondary ${styles.small}`} onClick={() => { const keys = Object.keys(draft.completenessWeights!); const values = balance(Object.values(draft.completenessWeights!));
        set({ completenessWeights: Object.fromEntries(keys.map((key, index) => [key, values[index]!])) }); }}>Balance to 100</button>
    </>}

    <h4>What changes</h4>
    <ul className={styles.muted}>{changes.length ? changes.map(change => <li key={change}>{change}</li>) : <li>Nothing yet.</li>}</ul>
    {error && <p className="error" role="alert">{error}</p>}
    <div className={styles.row}>
      <button type="button" onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : base ? 'Save as a new version' : 'Save first version'}</button>
      <button type="button" className="secondary" onClick={() => onDone(false)}>Cancel</button>
      {!valid && <span className={styles.muted}>Weights must total 100, every domain needs a key, label and both descriptors, and promising cannot be above strong.</span>}
    </div>
  </div>;
}
