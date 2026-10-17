'use client';
import { useState, type FormEvent } from 'react';
import { ROLE_LABELS, ROLE_ORG_TYPES, type OrgType, type Role, type SessionUser } from '@pitchprism/contracts';
import styles from './hq.module.css';
import { formData, label, mutate, useResource } from './use-resource';

type Staff = { id: string; displayName: string; email: string | null; role: Role; orgId: string | null; disabled: boolean };
type Invitation = { id: string; email: string | null; role: Role; orgId: string; expiresAt: string; status: 'pending' | 'accepted' | 'expired' | 'revoked' };
type Org = { id: string; name: string; type: OrgType; active: boolean };
const statusClass = { pending: styles.warn, accepted: styles.ok, expired: styles.muted, revoked: styles.bad };

/** Roles the caller may grant in an organisation of this type (the API re-checks; this only shapes the form). */
function grantable(actor: SessionUser, orgType: OrgType | null) {
  return (Object.keys(ROLE_ORG_TYPES) as Role[]).filter(role => role !== 'entrepreneur' && orgType && ROLE_ORG_TYPES[role].includes(orgType)
    && (actor.role === 'hq_admin' || role !== 'hq_admin'));
}

// W-01 team and one-time invitation links (D-27). HQ manages every organisation; other staff their own.
export default function TeamPanel({ user }: { user: SessionUser }) {
  const hq = user.role === 'hq_admin';
  const orgs = useResource<{ organisations: Org[] }>(hq ? '/hq/orgs' : null);
  const [orgId, setOrgId] = useState(hq ? '' : user.orgId ?? '');
  const query = orgId ? `?orgId=${orgId}` : '';
  const staff = useResource<{ users: Staff[] }>(`/team/staff${query}`);
  const invitations = useResource<{ invitations: Invitation[] }>(`/team/invitations${query}`);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const orgName = (id: string | null) => orgs.data?.organisations.find(org => org.id === id)?.name ?? (id === user.orgId ? 'Your organisation' : '—');
  const targetType = hq ? orgs.data?.organisations.find(org => org.id === orgId)?.type ?? null : user.orgType;
  const roles = grantable(user, targetType);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); staff.reload(); invitations.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That did not work. Please try again.'); }
    finally { setBusy(false); }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = formData(form);
    await run(async () => {
      const result = await mutate('/team/invitations', 'POST', { ...input, orgId }) as { link: string };
      setLink(result.link); setCopied(false); form.reset();
    });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  }

  return <section className={styles.section} aria-labelledby="team-title">
    <h3 id="team-title">Team and invitations</h3>
    <p className={styles.lede}>Invite a colleague with a one-time link. It works once, expires after 72 hours and is shown only here, once. Send it yourself through a channel you trust.</p>
    <form className={styles.form} onSubmit={invite} aria-label="Invite a colleague">
      {hq && <div><label htmlFor="invite-org">Organisation</label>
        <select id="invite-org" value={orgId} onChange={event => setOrgId(event.target.value)} required>
          <option value="">Choose…</option>
          {orgs.data?.organisations.filter(org => org.active).map(org => <option key={org.id} value={org.id}>{org.name} · {label(org.type)}</option>)}
        </select></div>}
      <div><label htmlFor="invite-role">Role</label>
        <select id="invite-role" name="role" required disabled={!roles.length}>
          {roles.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
        </select></div>
      <div><label htmlFor="invite-name">Name (optional)</label><input id="invite-name" name="displayName" maxLength={120} /></div>
      <div><label htmlFor="invite-email">Email (optional, locks the link to it)</label><input id="invite-email" name="email" type="email" maxLength={254} /></div>
      <div><button type="submit" disabled={busy || !orgId || !roles.length}>{busy ? 'Creating…' : 'Create invite link'}</button></div>
    </form>
    {link && <div className={styles.link} role="status">
      <strong>Invite link ready.</strong> Copy it now; it will not be shown again.
      <code>{link}</code>
      <div className={styles.row}><button type="button" className={styles.small} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        <button type="button" className={`secondary ${styles.small}`} onClick={() => setLink('')}>Done</button></div>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}

    <h4>Staff</h4>
    {staff.error ? <p className="error" role="alert">{staff.error}</p> : staff.loading ? <p className={styles.status} role="status">Loading staff…</p> :
      !staff.data!.users.length ? <p className={styles.status}>No staff yet. Invite the first colleague above.</p> :
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Name</th><th>Role</th>{hq && <th>Organisation</th>}<th>Access</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
        <tbody>{staff.data!.users.map(member => {
          const self = member.id === user.id;
          const options = grantable(user, hq ? orgs.data?.organisations.find(org => org.id === member.orgId)?.type ?? null : user.orgType);
          const locked = self || (member.role === 'hq_admin' && !hq);
          return <tr key={member.id}>
            <td>{member.displayName}{self && <span className={styles.muted}> (you)</span>}<br /><span className={styles.muted}>{member.email}</span></td>
            <td>{locked ? ROLE_LABELS[member.role] : <select aria-label={`Role for ${member.displayName}`} value={member.role} disabled={busy}
              onChange={event => run(() => mutate(`/team/staff/${member.id}`, 'PATCH', { role: event.target.value }))}>
              {options.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select>}</td>
            {hq && <td>{orgName(member.orgId)}</td>}
            <td><span className={`${styles.pill} ${member.disabled ? styles.bad : styles.ok}`}>{member.disabled ? 'Disabled' : 'Active'}</span></td>
            <td>{!locked && <button type="button" className={`secondary ${styles.small}`} disabled={busy}
              onClick={() => run(() => mutate(`/team/staff/${member.id}`, 'PATCH', { disabled: !member.disabled }))}>{member.disabled ? 'Restore access' : 'Disable'}</button>}</td>
          </tr>;
        })}</tbody></table></div>}

    <h4>Invitations</h4>
    {invitations.error ? <p className="error" role="alert">{invitations.error}</p> : invitations.loading ? <p className={styles.status} role="status">Loading invitations…</p> :
      !invitations.data!.invitations.length ? <p className={styles.status}>No invitations sent.</p> :
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>For</th><th>Role</th>{hq && <th>Organisation</th>}<th>Status</th><th>Expires</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
        <tbody>{invitations.data!.invitations.map(item => <tr key={item.id}>
          <td>{item.email ?? <span className={styles.muted}>Anyone with the link</span>}</td><td>{ROLE_LABELS[item.role]}</td>
          {hq && <td>{orgName(item.orgId)}</td>}
          <td><span className={`${styles.pill} ${statusClass[item.status]}`}>{item.status}</span></td>
          <td className={styles.muted}>{new Date(item.expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td>{item.status === 'pending' && <button type="button" className={`secondary ${styles.small}`} disabled={busy}
            onClick={() => run(() => mutate(`/team/invitations/${item.id}/revoke`, 'POST'))}>Withdraw</button>}</td>
        </tr>)}</tbody></table></div>}
  </section>;
}
