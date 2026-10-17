'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type AuthResponse, type SessionUser, type Workspace } from '@pitchprism/contracts';
import { api, ApiError } from '../../../lib/api';
import CentreWorkspace from '../../../features/centre/CentreWorkspace';
import AccessAdmin from '../../../features/hq/AccessAdmin';
import DashboardShell from '../../../features/shell/DashboardShell';
import HqWorkspace from '../../../features/hq/HqWorkspace';
import HqAdminTools from '../../../features/hq/HqAdminTools';
import HqOperations from '../../../features/hq/HqOperations';

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
  return <DashboardShell user={user} workspace={workspace} onLogout={logout} busy={busy}>
    <main className="dashboard-page">
      <section className="dashboard-overview" id="overview">
        <div><span className="eyebrow">Your workspace</span><h2>Keep the next decision moving.</h2><p>Review evidence, follow progress, and take the next action for your organisation.</p></div>
        <div className="overview-meta"><span>Organisation</span><strong>{user.orgType ? user.orgType.replaceAll('_', ' ') : 'Personal account'}</strong><span>Access</span><strong>{workspace.permissions.length} permissions</strong></div>
      </section>
      {error && <p className="error dashboard-error" role="alert">{error}</p>}
      {(user.role === 'centre_assessor' || user.role === 'cohort_lead') && <CentreWorkspace />}
      {user.role === 'hq_admin' && <HqWorkspace />}
      {user.role === 'hq_admin' && <HqAdminTools />}
      {user.role === 'hq_admin' && <HqOperations />}
      {workspace.permissions.includes('manage_org_users') && <AccessAdmin isHq={user.role === 'hq_admin'} selfId={user.id} />}
    </main>
  </DashboardShell>;
}
