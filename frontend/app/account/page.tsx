'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, type AuthResponse, type SessionUser } from '@pitchprism/contracts';
import { api, ApiError } from '../../lib/api';

// Staff account: change your own password. Other signed-in devices are signed out; this one stays signed in.
export default function Account() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<AuthResponse>('/auth/me').then(({ user }) => setUser(user))
      .catch(reason => { if (reason instanceof ApiError && reason.status === 401) router.replace('/'); else setError('Could not load your account.'); });
  }, [router]);
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (form.get('next') !== form.get('confirm')) { setError('The two new passwords do not match.'); return; }
    setBusy(true); setError(''); setStatus('');
    try {
      await api('/account/password', { method: 'POST', body: JSON.stringify({ current: form.get('current'), next: form.get('next') }) });
      formElement.reset(); setStatus('Password changed. Your other devices have been signed out.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change your password.'); }
    finally { setBusy(false); }
  }
  return <main className="workspace">
    <header className="workspace-header"><div><span className="eyebrow">Tata STRIVE</span><h1>PitchPrism</h1></div>
      {user && <a href={`/dashboard/${user.role}`}>← Back to your workspace</a>}</header>
    <div className="spectrum" aria-hidden="true" />
    <section className="workspace-body">
      <span className="eyebrow">Your account</span>
      {!user ? <p role={error ? 'alert' : 'status'}>{error || 'Loading…'}</p> : <>
        <h2>{user.displayName}</h2>
        <dl><dt>Email</dt><dd>{user.email ?? '—'}</dd><dt>Role</dt><dd>{ROLE_LABELS[user.role]}</dd></dl>
        {user.role !== 'entrepreneur' && <form onSubmit={change} aria-label="Change password" style={{ maxWidth: 420 }}>
          <h3>Change password</h3>
          <label htmlFor="current">Current password</label><input id="current" name="current" type="password" required maxLength={128} autoComplete="current-password" />
          <label htmlFor="next">New password (at least 12 characters)</label><input id="next" name="next" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
          <label htmlFor="confirm">Confirm new password</label><input id="confirm" name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
          {error && <p role="alert" className="error">{error}</p>}
          {status && <p role="status">{status}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>}
      </>}
    </section>
  </main>;
}
