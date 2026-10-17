'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, type AuthResponse, type SessionUser, type Workspace } from '@pitchprism/contracts';
import { api, ApiError } from '../../../lib/api';

export default function Dashboard({ params }: { params: Promise<{ role: string }> }) {
  const { role } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setUser(null); setWorkspace(null); setError('');
    void (async () => {
      try {
        const session = await api<AuthResponse>('/auth/me');
        if (!active) return;
        if (session.user.role !== role) { router.replace(`/dashboard/${session.user.role}`); return; }
        const result = await api<Workspace>(`/workspaces/${encodeURIComponent(role)}`);
        if (active) { setUser(session.user); setWorkspace(result); }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) router.replace('/');
        else setError(error instanceof Error ? error.message : 'Could not load your workspace.');
      }
    })();
    return () => { active = false; };
  }, [role, router]);
  async function logout() {
    setBusy(true); setError('');
    try { await api('/auth/logout', { method: 'POST' }); router.replace('/'); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) router.replace('/');
      else { setError(error instanceof Error ? error.message : 'Sign-out failed.'); setBusy(false); }
    }
  }
  if (!user || !workspace) return <main className="workspace"><h1>PitchPrism</h1><p role={error ? 'alert' : 'status'}>{error || 'Opening your workspace…'}</p>{error && <a href="/">Return to sign in</a>}</main>;
  return <main className="workspace">
    <header className="workspace-header"><div><span className="eyebrow">Tata STRIVE</span><h1>PitchPrism</h1></div><button className="secondary" onClick={logout} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button></header>
    <div className="spectrum" aria-hidden="true" />
    <section className="workspace-body"><span className="eyebrow">{ROLE_LABELS[user.role]}</span><h2>Welcome, {user.displayName}.</h2><p>Your sign-in is complete. This workspace is ready for your role’s features.</p>
      <dl><dt>Organisation</dt><dd>{user.orgType ? user.orgType.replaceAll('_', ' ') : 'Personal account'}</dd><dt>Access</dt><dd>{workspace.permissions.map(permission => permission.replaceAll('_', ' ')).join(' · ')}</dd></dl>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  </main>;
}
