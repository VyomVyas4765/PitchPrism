'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABELS, type Role } from '@pitchprism/contracts';
import { api } from '../../lib/api';
import styles from './access-admin.module.css';

type OrgOption = { id: string; name: string; type: string; roles: Role[] };
type Invite = { id: string; email: string; role: Role; orgName: string | null; expiresAt: string; status: string };
type StaffUser = { id: string; displayName: string; email: string | null; role: Role; orgId: string | null; orgName: string | null; disabled: boolean };
type Org = { id: string; name: string; type: string; active: boolean; parentName: string | null; region: string | null; users: number };

const label = (value: string) => value.replaceAll('_', ' ');
const LANGUAGES = [['hi', 'Hindi'], ['mr', 'Marathi'], ['te', 'Telugu'], ['or', 'Odia'], ['bn', 'Bengali'], ['en', 'English']] as const;

/** W-01: invitation-only staff onboarding. The server enforces every scope; this view only offers what it allows. */
export default function AccessAdmin({ isHq, selfId }: { isHq: boolean; selfId: string }) {
  const [options, setOptions] = useState<OrgOption[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState('centre');

  const refresh = useCallback(async () => {
    const [opts, inv, staff, orgList] = await Promise.all([
      api<{ orgs: OrgOption[] }>('/access/options'), api<{ invites: Invite[] }>('/invites'),
      api<{ users: StaffUser[] }>('/users'), api<{ orgs: Org[] }>('/orgs'),
    ]);
    setOptions(opts.orgs); setInvites(inv.invites); setUsers(staff.users); setOrgs(orgList.orgs);
    setOrgId(current => current && opts.orgs.some(org => org.id === current) ? current : opts.orgs[0]?.id ?? '');
  }, []);
  useEffect(() => { refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load access settings.')); }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That did not work. Please try again.'); }
    finally { setBusy(false); }
  }

  const selectedOrg = options.find(org => org.id === orgId);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = event.currentTarget;
    await run(async () => {
      const result = await api<{ link: string }>('/invites', { method: 'POST',
        body: JSON.stringify({ email: form.get('email'), role: form.get('role'), orgId }) });
      setLink(result.link); setCopied(false); target.reset();
    });
  }
  async function createOrg(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = event.currentTarget;
    await run(async () => {
      await api('/orgs', { method: 'POST', body: JSON.stringify({
        name: form.get('name'), type: newType, region: form.get('region') || undefined,
        languages: form.getAll('languages'),
        ...(newType === 'implementation_partner' ? { parentOrgId: form.get('parentOrgId') } : {}),
        ...(newType === 'funding_partner' ? { fundingMode: form.get('fundingMode') } : {}),
      }) });
      target.reset(); setNewType('centre');
    });
  }

  return <section className={styles.panel} aria-labelledby="access-heading">
    <span className="eyebrow">{isHq ? 'HQ · organisations and access' : 'Your organisation · access'}</span>
    <h2 id="access-heading">People and access</h2>
    <p className={styles.muted}>Staff join only by invitation. Each link works once, expires after 72 hours, and fixes the role and organisation you choose here.</p>
    {error && <p role="alert" className="error">{error}</p>}

    <h3>Invite a staff member</h3>
    {options.length === 0 ? <p className={styles.muted}>You cannot invite anyone from this account.</p> :
      <form onSubmit={invite} className={styles.grid}>
        <div><label htmlFor="invite-org">Organisation</label>
          <select id="invite-org" value={orgId} onChange={event => setOrgId(event.target.value)}>
            {options.map(org => <option key={org.id} value={org.id}>{org.name} ({label(org.type)})</option>)}
          </select></div>
        <div><label htmlFor="invite-role">Role</label>
          <select id="invite-role" name="role" required>
            {selectedOrg?.roles.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select></div>
        <div><label htmlFor="invite-email">Email address</label><input id="invite-email" name="email" type="email" required maxLength={254} /></div>
        <div><button type="submit" disabled={busy}>Create invitation</button></div>
      </form>}
    {link && <div className={styles.link} role="status">
      <code>{link}</code>
      <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy link'}</button>
    </div>}
    {link && <p className={styles.muted}>Send this link to the person yourself. It is shown only once; create a new invitation if it is lost.</p>}

    <h3>Invitations</h3>
    {invites.length === 0 ? <p className={styles.muted}>No invitations yet.</p> :
      <table className={styles.table}><thead><tr><th>Email</th><th>Role</th><th>Organisation</th><th>Status</th><th /></tr></thead><tbody>
        {invites.map(item => <tr key={item.id}>
          <td>{item.email}</td><td>{ROLE_LABELS[item.role]}</td><td>{item.orgName}</td>
          <td>{item.status}{item.status === 'pending' && <span className={styles.muted}> · until {new Date(item.expiresAt).toLocaleDateString()}</span>}</td>
          <td>{item.status === 'pending' && <button type="button" className="secondary" disabled={busy}
            onClick={() => run(() => api(`/invites/${item.id}/revoke`, { method: 'POST', body: '{}' }))}>Revoke</button>}</td>
        </tr>)}
      </tbody></table>}

    <h3>Staff accounts</h3>
    <table className={styles.table}><thead><tr><th>Name</th><th>Role</th><th>Organisation</th><th>Status</th><th /></tr></thead><tbody>
      {users.map(user => {
        const roles = options.find(org => org.id === user.orgId)?.roles ?? [];
        const editable = user.id !== selfId && roles.includes(user.role);
        return <tr key={user.id}>
          <td>{user.displayName}<br /><span className={styles.muted}>{user.email}</span></td>
          <td>{editable ? <select aria-label={`Role for ${user.displayName}`} value={user.role} disabled={busy}
            onChange={event => run(() => api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: event.target.value }) }))}>
            {roles.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select> : ROLE_LABELS[user.role]}</td>
          <td>{user.orgName}</td><td>{user.disabled ? 'Disabled' : 'Active'}</td>
          <td>{editable && <button type="button" className="secondary" disabled={busy}
            onClick={() => run(() => api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ disabled: !user.disabled }) }))}>
            {user.disabled ? 'Enable' : 'Disable'}</button>}</td>
        </tr>;
      })}
    </tbody></table>

    {isHq && <>
      <h3>Organisations</h3>
      <table className={styles.table}><thead><tr><th>Name</th><th>Type</th><th>Reports to</th><th>Staff</th><th /></tr></thead><tbody>
        {orgs.map(org => <tr key={org.id}>
          <td>{org.name}{org.region && <><br /><span className={styles.muted}>{org.region}</span></>}</td><td>{label(org.type)}</td>
          <td>{org.parentName ?? '—'}</td><td>{org.users}{!org.active && ' · inactive'}</td>
          <td>{org.type !== 'hq' && <button type="button" className="secondary" disabled={busy}
            onClick={() => run(() => api(`/orgs/${org.id}`, { method: 'PATCH', body: JSON.stringify({ active: !org.active }) }))}>
            {org.active ? 'Deactivate' : 'Reactivate'}</button>}</td>
        </tr>)}
      </tbody></table>
      <form onSubmit={createOrg} className={styles.grid} style={{ marginTop: 20 }}>
        <div><label htmlFor="org-name">New organisation name</label><input id="org-name" name="name" required minLength={2} maxLength={120} /></div>
        <div><label htmlFor="org-type">Type</label>
          <select id="org-type" value={newType} onChange={event => setNewType(event.target.value)}>
            {['centre', 'implementation_partner', 'sector_partner', 'funding_partner'].map(type => <option key={type} value={type}>{label(type)}</option>)}
          </select></div>
        {newType === 'implementation_partner' && <div><label htmlFor="org-parent">Reports to centre</label>
          <select id="org-parent" name="parentOrgId" required>
            {orgs.filter(org => org.type === 'centre' && org.active).map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select></div>}
        {newType === 'funding_partner' && <div><label htmlFor="org-funding">Funding mode</label>
          <select id="org-funding" name="fundingMode" required><option value="lender">Lender</option><option value="csr">CSR (aggregate reports only)</option></select></div>}
        <div><label htmlFor="org-region">Region (optional)</label><input id="org-region" name="region" maxLength={80} /></div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontSize: 13, marginBottom: 8 }}>Languages</legend>
          {LANGUAGES.map(([code, name]) => <label key={code} style={{ display: 'inline-flex', gap: 6, marginRight: 12 }}>
            <input type="checkbox" name="languages" value={code} style={{ width: 'auto', minHeight: 0, margin: 0 }} />{name}</label>)}
        </fieldset>
        <div><button type="submit" disabled={busy}>Create organisation</button></div>
      </form>
    </>}
  </section>;
}
