'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthResponse } from '@pitchprism/contracts';
import { api } from '../lib/api';

export default function Login() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<AuthResponse>('/auth/me').then(({ user }) => { if (active) router.replace(`/dashboard/${user.role}`); })
      .catch(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [router]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const { user } = await api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
      router.replace(`/dashboard/${user.role}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in failed.'); setBusy(false); }
  }
  return <main className="login-page">
    <header className="masthead"><span className="eyebrow">Tata STRIVE · Entrepreneurship Development</span><h1>PitchPrism</h1><div className="spectrum" aria-hidden="true" /></header>
    <section className="login-grid">
      <div className="intro"><span className="eyebrow">The assessment desk</span><h2>Every idea deserves<br /><em>a careful reading.</em></h2><p>One place to review business ideas, understand the evidence, and help entrepreneurs take their next step.</p><p className="caption">Entrepreneurs: use the mobile app to sign in with your phone.</p></div>
      <div className="login-panel"><h2>Staff sign in</h2><p>Use the account provided by your organisation.</p>
        {checking ? <p role="status">Checking your session…</p> : <form onSubmit={login}>
          <label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
          <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
          {error && <p role="alert" className="error">{error}</p>}
          <button disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in →'}</button>
        </form>}
      </div>
    </section>
  </main>;
}
