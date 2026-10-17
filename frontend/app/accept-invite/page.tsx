'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, type AuthResponse, type Role } from '@pitchprism/contracts';
import { api } from '../../lib/api';

type Preview = { organisation: string; orgType: string; role: Role; email: string | null; displayName: string | null; expiresAt: string };

// Staff sign-up: the only way to create a staff account is a one-time invitation link (D-27). The token travels
// in the URL fragment, which browsers never send to servers or proxies, and is wiped from the address bar on read.
export default function AcceptInvite() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const value = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) { setError('This invitation link is incomplete. Copy the whole link you were sent.'); return; }
    setToken(value);
    api<Preview>('/invitations/accept/preview', { method: 'POST', body: JSON.stringify({ token: value }) })
      .then(result => { if (active) setPreview(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'This invitation could not be opened.'); });
    return () => { active = false; };
  }, []);
  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirm')) { setFormError('The two passwords do not match.'); return; }
    setBusy(true); setFormError('');
    try {
      const { user } = await api<AuthResponse>('/invitations/accept', { method: 'POST', body: JSON.stringify({
        token, displayName: form.get('displayName'), email: form.get('email'), password: form.get('password') }) });
      router.replace(`/dashboard/${user.role}`);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : 'Could not create your account.'); setBusy(false); }
  }
  return <main className="login-page">
    <header className="masthead"><span className="eyebrow">Tata STRIVE · Entrepreneurship Development</span><h1>PitchPrism</h1><div className="spectrum" aria-hidden="true" /></header>
    <section className="login-grid">
      <div className="intro"><span className="eyebrow">An invitation</span>
        {preview ? <><h2>Join <em>{preview.organisation}</em><br />as {ROLE_LABELS[preview.role].toLowerCase()}.</h2>
          <p>Your role and organisation were chosen by the person who invited you. This link works once and expires on {new Date(preview.expiresAt).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}.</p></>
          : <><h2>Every idea deserves<br /><em>a careful reading.</em></h2><p>Staff accounts are created from an invitation sent by your organisation or Tata STRIVE HQ.</p></>}
        <p className="caption">Entrepreneurs: use the mobile app to sign in with your phone.</p>
      </div>
      <div className="login-panel"><h2>Create your account</h2>
        {error ? <><p role="alert" className="error">{error}</p><p><a href="/">Go to staff sign in</a></p></>
          : !preview ? <p role="status">Checking your invitation…</p>
          : <form onSubmit={accept}>
            <label htmlFor="displayName">Your name</label><input id="displayName" name="displayName" required maxLength={120} defaultValue={preview.displayName ?? ''} autoComplete="name" />
            <label htmlFor="email">Email address</label><input id="email" name="email" type="email" required maxLength={254} autoComplete="username"
              defaultValue={preview.email ?? ''} readOnly={!!preview.email} />
            <label htmlFor="password">Password (at least 12 characters)</label><input id="password" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
            <label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
            {formError && <p role="alert" className="error">{formError}</p>}
            <button disabled={busy} type="submit">{busy ? 'Creating your account…' : 'Create account and sign in →'}</button>
          </form>}
      </div>
    </section>
  </main>;
}
