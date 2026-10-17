'use client';
import { useState, type FormEvent } from 'react';
import type { OrgType, SessionUser } from '@pitchprism/contracts';
import styles from './hq.module.css';
import { formData, label, list, mutate, useResource } from './use-resource';
import RubricBuilder, { HUES, type RubricDraft } from './RubricBuilder';

type Org = { id: string; name: string; type: OrgType; active: boolean; fundingMode?: string; state?: string; districts?: string[]; staff: number };
type Programme = { id: string; orgId: string; name: string; rubricKey?: string; status: 'draft' | 'active' | 'closed'; districts?: string[] };
type Cohort = { id: string; programmeId: string; orgId: string; name: string; status: 'planned' | 'open' | 'closed'; intakeStart?: string; intakeEnd?: string };
type RubricVersion = RubricDraft & { id: string; version: number; status: 'draft' | 'published' | 'archived'; createdAt?: string };
type RubricFamily = { rubricKey: string; name: string; published: number | null; latest: number; versions: RubricVersion[] };
type Trade = { id: string; key: string; label: string; sector: string; osmTags?: string[]; nicCodes?: string[]; active: boolean };
type Rule = { id: string; name: string; partnerOrgId: string; partnerType: 'sector_partner' | 'funding_partner'; tradeKeys?: string[]; sectors?: string[]; districts?: string[]; active: boolean };

const ORG_TYPES: OrgType[] = ['centre', 'implementation_partner', 'sector_partner', 'funding_partner'];
const fmtDate = (value?: string) => value ? new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); onDone(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That did not work. Please try again.'); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}
const Status = ({ error, loading, empty, children }: { error: string; loading: boolean; empty?: string | false; children: React.ReactNode }) =>
  error ? <p className="error" role="alert">{error}</p> : loading ? <p className={styles.status} role="status">Loading…</p>
    : empty ? <p className={styles.status}>{empty}</p> : <>{children}</>;

// ---------------------------------------------------------------- W-01 organisations
export function OrganisationsPanel() {
  const orgs = useResource<{ organisations: Org[] }>('/hq/orgs');
  const action = useAction(orgs.reload);
  const [type, setType] = useState<OrgType>('centre');
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const { districts, ...input } = formData(form);
    if (await action.run(() => mutate('/hq/orgs', 'POST', { ...input, type, districts: list(districts) }))) form.reset();
  }
  const parents = orgs.data?.organisations.filter(org => org.type === 'centre' && org.active) ?? [];
  return <section className={styles.section} aria-labelledby="orgs-title">
    <h3 id="orgs-title">Organisations</h3>
    <p className={styles.lede}>Centres, implementation partners, sector partners and funders. Implementation partners report to a centre; everything else reports to HQ. Deactivating an organisation signs its staff out on their next request and stops new invitations.</p>
    <form className={styles.form} onSubmit={create} aria-label="Add an organisation">
      <div><label htmlFor="org-name">Name</label><input id="org-name" name="name" required maxLength={160} /></div>
      <div><label htmlFor="org-type">Type</label><select id="org-type" value={type} onChange={event => setType(event.target.value as OrgType)}>
        {ORG_TYPES.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></div>
      {type === 'funding_partner' && <div><label htmlFor="org-mode">Funding mode</label><select id="org-mode" name="fundingMode" required>
        <option value="lender">Lender (sees loan-ready shortlist)</option><option value="csr">CSR funder (aggregate impact only)</option></select></div>}
      {type === 'implementation_partner' && <div><label htmlFor="org-parent">Reports to centre</label><select id="org-parent" name="parentOrgId" required>
        <option value="">Choose…</option>{parents.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></div>}
      <div><label htmlFor="org-state">State</label><input id="org-state" name="state" maxLength={80} /></div>
      <div><label htmlFor="org-districts">Districts (comma separated)</label><input id="org-districts" name="districts" /></div>
      <div><button type="submit" disabled={action.busy}>Add organisation</button></div>
    </form>
    {action.error && <p className="error" role="alert">{action.error}</p>}
    <Status error={orgs.error} loading={orgs.loading}>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Name</th><th>Type</th><th>Region</th><th className={styles.num}>Staff</th><th>Status</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
        <tbody>{orgs.data?.organisations.map(org => <tr key={org.id}>
          <td>{org.name}</td>
          <td>{label(org.type)}{org.fundingMode && <span className={styles.muted}> · {org.fundingMode}</span>}</td>
          <td className={styles.muted}>{[org.state, org.districts?.join(', ')].filter(Boolean).join(' · ') || '—'}</td>
          <td className={styles.num}>{org.staff}</td>
          <td><span className={`${styles.pill} ${org.active ? styles.ok : styles.bad}`}>{org.active ? 'Active' : 'Inactive'}</span></td>
          <td>{org.type !== 'hq' && <button type="button" className={`secondary ${styles.small}`} disabled={action.busy}
            onClick={() => action.run(() => mutate(`/hq/orgs/${org.id}`, 'PATCH', { active: !org.active }))}>{org.active ? 'Deactivate' : 'Reactivate'}</button>}</td>
        </tr>)}</tbody></table></div>
    </Status>
  </section>;
}

// ---------------------------------------------------------------- W-02 programmes and W-32 cohorts
export function ProgrammesPanel({ user }: { user: SessionUser }) {
  const hq = user.role === 'hq_admin';
  const programmes = useResource<{ programmes: Programme[] }>('/hq/programmes');
  const cohorts = useResource<{ cohorts: Cohort[] }>('/hq/cohorts');
  const orgs = useResource<{ organisations: Org[] }>(hq ? '/hq/orgs' : null);
  const rubrics = useResource<{ rubrics: RubricFamily[] }>('/hq/rubrics');
  const action = useAction(() => { programmes.reload(); cohorts.reload(); });
  const centres = orgs.data?.organisations.filter(org => org.type === 'centre' && org.active) ?? [];
  const orgName = (id: string) => orgs.data?.organisations.find(org => org.id === id)?.name ?? '';
  async function createProgramme(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const { districts, ...input } = formData(form);
    if (await action.run(() => mutate('/hq/programmes', 'POST', { ...input, districts: list(districts) }))) form.reset();
  }
  async function createCohort(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const { districts, ...input } = formData(form);
    if (await action.run(() => mutate('/hq/cohorts', 'POST', { ...input, districts: list(districts) }))) form.reset();
  }
  const open = programmes.data?.programmes.filter(item => item.status !== 'closed') ?? [];
  return <section className={styles.section} aria-labelledby="programmes-title">
    <h3 id="programmes-title">Programmes and cohorts</h3>
    <p className={styles.lede}>{hq ? 'A programme runs at one centre and scores with one rubric family. Cohorts group entrepreneurs for cohort-wise ranking.'
      : 'Open a cohort under one of your centre’s programmes. Cohort-wise ratings compare ideas inside the same cohort.'}</p>
    {hq && <form className={styles.form} onSubmit={createProgramme} aria-label="Add a programme">
      <div><label htmlFor="prog-name">Programme name</label><input id="prog-name" name="name" required maxLength={160} /></div>
      <div><label htmlFor="prog-org">Centre</label><select id="prog-org" name="orgId" required><option value="">Choose…</option>
        {centres.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></div>
      <div><label htmlFor="prog-rubric">Rubric</label><select id="prog-rubric" name="rubricKey"><option value="">Default</option>
        {rubrics.data?.rubrics.map(item => <option key={item.rubricKey} value={item.rubricKey}>{item.name}</option>)}</select></div>
      <div><label htmlFor="prog-status">Status</label><select id="prog-status" name="status"><option value="active">Active</option><option value="draft">Draft</option></select></div>
      <div><label htmlFor="prog-districts">Districts</label><input id="prog-districts" name="districts" /></div>
      <div><button type="submit" disabled={action.busy}>Add programme</button></div>
    </form>}
    <form className={styles.form} onSubmit={createCohort} aria-label="Open a cohort">
      <div><label htmlFor="cohort-name">Cohort name</label><input id="cohort-name" name="name" required maxLength={160} placeholder="November 2026 batch" /></div>
      <div><label htmlFor="cohort-prog">Programme</label><select id="cohort-prog" name="programmeId" required><option value="">Choose…</option>
        {open.map(item => <option key={item.id} value={item.id}>{item.name}{hq ? ` · ${orgName(item.orgId)}` : ''}</option>)}</select></div>
      <div><label htmlFor="cohort-start">Intake opens</label><input id="cohort-start" name="intakeStart" type="date" /></div>
      <div><label htmlFor="cohort-end">Intake closes</label><input id="cohort-end" name="intakeEnd" type="date" /></div>
      <div><label htmlFor="cohort-status">Status</label><select id="cohort-status" name="status"><option value="open">Open</option><option value="planned">Planned</option></select></div>
      <div><button type="submit" disabled={action.busy || !open.length}>Open cohort</button></div>
    </form>
    {action.error && <p className="error" role="alert">{action.error}</p>}
    <Status error={programmes.error || cohorts.error} loading={programmes.loading || cohorts.loading}
      empty={!programmes.data?.programmes.length && (hq ? 'No programmes yet. Add one above.' : 'HQ has not set up a programme for your centre yet.')}>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Programme</th>{hq && <th>Centre</th>}<th>Rubric</th><th>Cohorts</th><th>Status</th></tr></thead>
        <tbody>{programmes.data?.programmes.map(item => {
          const own = cohorts.data?.cohorts.filter(cohort => cohort.programmeId === item.id) ?? [];
          return <tr key={item.id}>
            <td>{item.name}</td>{hq && <td>{orgName(item.orgId)}</td>}
            <td className={styles.muted}>{item.rubricKey ?? 'default'}</td>
            <td>{own.length ? own.map(cohort => <div key={cohort.id}>{cohort.name} <span className={styles.muted}>· {cohort.status} · {fmtDate(cohort.intakeStart)} – {fmtDate(cohort.intakeEnd)}</span>
              {cohort.status !== 'closed' && <button type="button" className="text-button" disabled={action.busy}
                onClick={() => action.run(() => mutate(`/hq/cohorts/${cohort.id}`, 'PATCH', { status: 'closed' }))}>close</button>}</div>)
              : <span className={styles.muted}>None</span>}</td>
            <td>{hq ? <select aria-label={`Status of ${item.name}`} value={item.status} disabled={action.busy}
              onChange={event => action.run(() => mutate(`/hq/programmes/${item.id}`, 'PATCH', { status: event.target.value }))}>
              <option value="draft">draft</option><option value="active">active</option><option value="closed">closed</option></select> : item.status}</td>
          </tr>;
        })}</tbody></table></div>
    </Status>
  </section>;
}

// ---------------------------------------------------------------- W-02 versioned rubrics (the builder is RubricBuilder.tsx)
export function RubricsPanel({ canEdit }: { canEdit: boolean }) {
  const rubrics = useResource<{ rubrics: RubricFamily[] }>('/hq/rubrics');
  const action = useAction(rubrics.reload);
  // null: no builder open; 'new': a new family; otherwise the version the next version starts from.
  const [editing, setEditing] = useState<RubricVersion | 'new' | null>(null);
  const base = (version: RubricVersion): RubricDraft => ({ rubricKey: version.rubricKey, name: version.name, bands: { ...version.bands },
    domains: version.domains.map(domain => ({ ...domain })), completenessWeights: version.completenessWeights, pathwayRules: version.pathwayRules });
  return <section className={styles.section} aria-labelledby="rubrics-title">
    <h3 id="rubrics-title">Rubrics</h3>
    <p className={styles.lede}>Every save creates a new version; nothing is edited in place. Publishing a version archives the one before it, and each assessment records the exact version it was scored with, so rankings only compare like with like.</p>
    {action.error && <p className="error" role="alert">{action.error}</p>}
    {canEdit && !editing && <p><button type="button" className="secondary" onClick={() => setEditing('new')}>New rubric</button></p>}
    {editing && <RubricBuilder key={editing === 'new' ? 'new' : editing.id} base={editing === 'new' ? null : base(editing)}
      onDone={saved => { setEditing(null); if (saved) rubrics.reload(); }} />}
    <Status error={rubrics.error} loading={rubrics.loading} empty={!rubrics.data?.rubrics.length && 'No rubrics yet. Load the fixtures or create one.'}>
      {rubrics.data?.rubrics.map(family => <div key={family.rubricKey} className={styles.section}>
        <h4>{family.name} <span className={styles.muted}>· {family.rubricKey} · published v{family.published ?? '—'} · latest v{family.latest}</span></h4>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Version</th><th>Domains and weights</th><th>Bands</th><th>Status</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
          <tbody>{family.versions.map(version => <tr key={version.id}>
            <td className={styles.num}>v{version.version}</td>
            <td><div className={styles.weights} aria-hidden="true">{version.domains.map((domain, index) =>
              <span key={domain.key} title={`${domain.label} ${domain.weight}`} style={{ width: `${domain.weight}%`, background: HUES[index % HUES.length] }} />)}</div>
              <span className={styles.muted}>{version.domains.map(domain => `${domain.label} ${domain.weight}`).join(' · ')}</span></td>
            <td className={styles.muted}>strong ≥ {version.bands.strong} · promising ≥ {version.bands.promising} · coverage ≥ {version.bands.minCoverage}%</td>
            <td><span className={`${styles.pill} ${version.status === 'published' ? styles.ok : version.status === 'draft' ? styles.warn : styles.muted}`}>{version.status}</span></td>
            <td>{canEdit && <div className={styles.row}>
              <button type="button" className={`secondary ${styles.small}`} onClick={() => setEditing(version)}>Open in builder</button>
              {version.status === 'draft' && <button type="button" className={styles.small} disabled={action.busy}
                onClick={() => action.run(() => mutate(`/hq/rubrics/${version.rubricKey}/${version.version}/publish`, 'POST'))}>Publish</button>}</div>}</td>
          </tr>)}</tbody></table></div>
      </div>)}
    </Status>
  </section>;
}

// ---------------------------------------------------------------- W-32 trades
export function TradesPanel({ canEdit }: { canEdit: boolean }) {
  const trades = useResource<{ trades: Trade[] }>('/hq/trades');
  const action = useAction(trades.reload);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const { osmTags, nicCodes, synonymsHi, ...input } = formData(form);
    const body = { ...input, osmTags: list(osmTags), nicCodes: list(nicCodes), ...(synonymsHi ? { synonyms: { hi: list(synonymsHi) } } : {}) };
    if (await action.run(() => mutate('/hq/trades', 'POST', body))) form.reset();
  }
  return <section className={styles.section} aria-labelledby="trades-title">
    <h3 id="trades-title">Trades</h3>
    <p className={styles.lede}>The normalised business types used for trade-wise ratings and nearby-business search. OpenStreetMap tags drive the location check; a trade key never changes once ideas use it.</p>
    {canEdit && <form className={styles.form} onSubmit={create} aria-label="Add a trade">
      <div><label htmlFor="trade-key">Key</label><input id="trade-key" name="key" required pattern="[a-z0-9_]{2,60}" placeholder="tailoring" /></div>
      <div><label htmlFor="trade-label">Label</label><input id="trade-label" name="label" required maxLength={120} /></div>
      <div><label htmlFor="trade-sector">Sector</label><input id="trade-sector" name="sector" required maxLength={80} /></div>
      <div><label htmlFor="trade-osm">OSM tags</label><input id="trade-osm" name="osmTags" placeholder="shop=tailor, craft=tailor" /></div>
      <div><label htmlFor="trade-nic">NIC codes</label><input id="trade-nic" name="nicCodes" placeholder="14101" /></div>
      <div><label htmlFor="trade-hi">Hindi synonyms</label><input id="trade-hi" name="synonymsHi" lang="hi" /></div>
      <div><button type="submit" disabled={action.busy}>Add trade</button></div>
    </form>}
    {action.error && <p className="error" role="alert">{action.error}</p>}
    <Status error={trades.error} loading={trades.loading} empty={!trades.data?.trades.length && 'No trades yet.'}>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Trade</th><th>Sector</th><th>OSM tags</th><th>NIC</th><th>Status</th></tr></thead>
        <tbody>{trades.data?.trades.map(trade => <tr key={trade.id}>
          <td>{trade.label} <span className={styles.muted}>· {trade.key}</span></td><td>{trade.sector}</td>
          <td className={styles.muted}>{trade.osmTags?.join(', ') || '—'}</td><td className={styles.muted}>{trade.nicCodes?.join(', ') || '—'}</td>
          <td>{canEdit ? <button type="button" className="text-button" disabled={action.busy}
            onClick={() => action.run(() => mutate(`/hq/trades/${trade.id}`, 'PATCH', { active: !trade.active }))}>{trade.active ? 'active' : 'retired'}</button>
            : trade.active ? 'active' : 'retired'}</td>
        </tr>)}</tbody></table></div>
    </Status>
  </section>;
}

// ---------------------------------------------------------------- W-04 routing rules
export function RoutingPanel() {
  const rules = useResource<{ rules: Rule[] }>('/hq/routing-rules');
  const orgs = useResource<{ organisations: Org[] }>('/hq/orgs');
  const action = useAction(rules.reload);
  const [partnerType, setPartnerType] = useState<Rule['partnerType']>('sector_partner');
  const partners = orgs.data?.organisations.filter(org => org.type === partnerType && org.active) ?? [];
  const orgName = (id: string) => orgs.data?.organisations.find(org => org.id === id)?.name ?? '—';
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const { tradeKeys, sectors, districts, ...input } = formData(form);
    if (await action.run(() => mutate('/hq/routing-rules', 'POST', { ...input, partnerType, tradeKeys: list(tradeKeys), sectors: list(sectors), districts: list(districts) }))) form.reset();
  }
  return <section className={styles.section} aria-labelledby="routing-title">
    <h3 id="routing-title">Partner routing</h3>
    <p className={styles.lede}>Rules suggest which partner should see an idea, by trade, sector or district. A suggestion is never a share: the entrepreneur’s consent and a reviewer’s decision are still required.</p>
    <form className={styles.form} onSubmit={create} aria-label="Add a routing rule">
      <div><label htmlFor="rule-name">Rule name</label><input id="rule-name" name="name" required maxLength={160} /></div>
      <div><label htmlFor="rule-type">Partner type</label><select id="rule-type" value={partnerType} onChange={event => setPartnerType(event.target.value as Rule['partnerType'])}>
        <option value="sector_partner">Sector partner</option><option value="funding_partner">Funding partner</option></select></div>
      <div><label htmlFor="rule-org">Partner</label><select id="rule-org" name="partnerOrgId" required><option value="">Choose…</option>
        {partners.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></div>
      <div><label htmlFor="rule-trades">Trades</label><input id="rule-trades" name="tradeKeys" placeholder="tailoring, dairy" /></div>
      <div><label htmlFor="rule-sectors">Sectors</label><input id="rule-sectors" name="sectors" /></div>
      <div><label htmlFor="rule-districts">Districts</label><input id="rule-districts" name="districts" /></div>
      <div><button type="submit" disabled={action.busy}>Add rule</button></div>
    </form>
    {action.error && <p className="error" role="alert">{action.error}</p>}
    <Status error={rules.error} loading={rules.loading} empty={!rules.data?.rules.length && 'No routing rules yet.'}>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Rule</th><th>Partner</th><th>Matches</th><th>Status</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
        <tbody>{rules.data?.rules.map(rule => <tr key={rule.id}>
          <td>{rule.name}</td><td>{orgName(rule.partnerOrgId)} <span className={styles.muted}>· {label(rule.partnerType)}</span></td>
          <td className={styles.muted}>{[rule.tradeKeys?.length && `trades: ${rule.tradeKeys.join(', ')}`, rule.sectors?.length && `sectors: ${rule.sectors.join(', ')}`,
            rule.districts?.length && `districts: ${rule.districts.join(', ')}`].filter(Boolean).join(' · ') || 'Everything'}</td>
          <td><button type="button" className="text-button" disabled={action.busy}
            onClick={() => action.run(() => mutate(`/hq/routing-rules/${rule.id}`, 'PATCH', { active: !rule.active }))}>{rule.active ? 'active' : 'paused'}</button></td>
          <td><button type="button" className={`secondary ${styles.small}`} disabled={action.busy}
            onClick={() => action.run(() => mutate(`/hq/routing-rules/${rule.id}`, 'DELETE'))}>Delete</button></td>
        </tr>)}</tbody></table></div>
    </Status>
  </section>;
}
