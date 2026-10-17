'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';

type Preview = { displayName: string; email: string | null };

// One-time reset link from an administrator. The token travels in the URL fragment and is wiped on read.
export default function ResetPassword() {
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let active = true;
    const value = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) { setError('This reset link is incomplete. Copy the whole link you were sent.'); return; }
    setToken(value);
    api<Preview>('/password-reset/preview', { method: 'POST', body: JSON.stringify({ token: value }) })
      .then(result => { if (active) setPreview(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'This reset link could not be opened.'); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirm')) { setFormError('The two passwords do not match.'); return; }
    setBusy(true); setFormError('');
    try { await api('/password-reset', { method: 'POST', body: JSON.stringify({ token, password: form.get('password') }) }); setDone(true); }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : 'Could not set your password.'); setBusy(false); }
  }
  return <main className="login-page">
    <header className="masthead"><span className="eyebrow">Tata STRIVE · Entrepreneurship Development</span><h1>PitchPrism</h1><div className="spectrum" aria-hidden="true" /></header>
    <section className="login-grid">
      <div className="intro"><span className="eyebrow">Password reset</span>
        <h2>{preview ? <>Welcome back,<br /><em>{preview.displayName}.</em></> : <>Every idea deserves<br /><em>a careful reading.</em></>}</h2>
        <p>Choose a new password. Every device signed in to this account is signed out when you save it.</p>
      </div>
      <div className="login-panel"><h2>Set a new password</h2>
        {error ? <><p role="alert" className="error">{error}</p><p><a href="/">Go to staff sign in</a></p></>
          : done ? <><p role="status">Your password is changed.</p><p><a href="/">Sign in with your new password →</a></p></>
          : !preview ? <p role="status">Checking your link…</p>
          : <form onSubmit={submit}>
            {preview.email && <><label htmlFor="email">Email address</label><input id="email" type="email" value={preview.email} readOnly autoComplete="username" /></>}
            <label htmlFor="password">New password (at least 12 characters)</label><input id="password" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
            <label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
            {formError && <p role="alert" className="error">{formError}</p>}
            <button disabled={busy} type="submit">{busy ? 'Saving…' : 'Set password →'}</button>
          </form>}
      </div>
    </section>
  </main>;
}
