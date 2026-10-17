'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, type AuthResponse, type Role } from '@pitchprism/contracts';
import { api } from '../../lib/api';

type Preview = { email: string; role: Role; orgName: string; expiresAt: string };

// The invitation token travels in the URL fragment, which browsers never send to servers or proxies.
export default function AcceptInvite() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = window.location.hash.slice(1);
    // Drop the token from the address bar and history once it has been read.
    window.history.replaceState(null, '', window.location.pathname);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) { setError('This invitation link is incomplete. Copy the whole link from your administrator.'); return; }
    setToken(value);
    api<Preview>('/auth/invites/preview', { method: 'POST', body: JSON.stringify({ token: value }) })
      .then(setPreview).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not open this invitation.'));
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirm')) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const { user } = await api<AuthResponse>('/auth/invites/accept', { method: 'POST',
        body: JSON.stringify({ token, displayName: form.get('displayName'), password: form.get('password') }) });
      router.replace(`/dashboard/${user.role}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create your account.'); setBusy(false); }
  }

  return <main className="login-page">
    <header className="masthead"><span className="eyebrow">Tata STRIVE · Entrepreneurship Development</span><h1>PitchPrism</h1><div className="spectrum" aria-hidden="true" /></header>
    <section className="login-grid">
      <div className="intro"><span className="eyebrow">Staff invitation</span><h2>Set up your<br /><em>PitchPrism account.</em></h2>
        <p>Your role and organisation were chosen by the administrator who invited you. Choose your name and a password to finish.</p></div>
      <div className="login-panel">
        {preview ? <>
          <h2>{ROLE_LABELS[preview.role]}</h2>
          <p>{preview.orgName} · {preview.email}</p>
          <p className="caption">This link works once and expires {new Date(preview.expiresAt).toLocaleString()}.</p>
          <form onSubmit={accept}>
            <label htmlFor="displayName">Your name</label><input id="displayName" name="displayName" required minLength={2} maxLength={120} autoComplete="name" />
            <label htmlFor="password">Password (at least 12 characters)</label><input id="password" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
            <label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
            {error && <p role="alert" className="error">{error}</p>}
            <button disabled={busy} type="submit">{busy ? 'Creating your account…' : 'Create account →'}</button>
          </form>
        </> : error ? <><h2>Invitation unavailable</h2><p role="alert" className="error">{error}</p><a href="/">Go to sign in</a></>
          : <p role="status">Checking your invitation…</p>}
      </div>
    </section>
  </main>;
}
