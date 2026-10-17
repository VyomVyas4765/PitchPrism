'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type AuthResponse, type SessionUser, type Workspace } from '@pitchprism/contracts';
import { api, ApiError } from '../../lib/api';
import CentreWorkspace from '../../features/centre/CentreWorkspace';
import AccessAdmin from '../../features/hq/AccessAdmin';
import DashboardShell from '../../features/shell/DashboardShell';
import HqWorkspace from '../../features/hq/HqWorkspace';
import HqAdminTools from '../../features/hq/HqAdminTools';
import HqOperations from '../../features/hq/HqOperations';
import { PartnerWorkspace } from '../../features/partners/partner-workspace';

export type DashboardSection = 'overview' | 'pipeline' | 'configuration' | 'operations' | 'access' | 'review-queue' | 'cohorts' | 'submissions' | 'applicants' | 'organisation' | 'opportunities' | 'funding' | 'reports';

export default function DashboardView({ role, section = 'overview' }: { role: string; section?: string }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await api<AuthResponse>('/auth/me');
        if (!active) return;
        if (session.user.role !== role) { router.replace(`/dashboard/${session.user.role}`); return; }
        const result = await api<Workspace>(`/workspaces/${encodeURIComponent(role)}`);
        if (active) { setUser(session.user); setWorkspace(result); }
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) router.replace('/');
        else setError(reason instanceof Error ? reason.message : 'Could not load your workspace.');
      }
    })();
    return () => { active = false; };
  }, [role, router]);

  async function logout() {
    setBusy(true); setError('');
    try { await api('/auth/logout', { method: 'POST' }); router.replace('/'); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) router.replace('/');
      else { setError(reason instanceof Error ? reason.message : 'Sign-out failed.'); setBusy(false); }
    }
  }

  if (!user || !workspace) return <main className="workspace"><h1>PitchPrism</h1><p role={error ? 'alert' : 'status'}>{error || 'Opening your workspace…'}</p>{error && <a href="/">Return to sign in</a>}</main>;

  const isHq = user.role === 'hq_admin';
  const isCentre = user.role === 'centre_assessor' || user.role === 'cohort_lead';
  const content = isHq ? (
    section === 'configuration' ? <HqAdminTools /> :
    section === 'operations' || section === 'audit' || section === 'clusters' ? <HqOperations /> :
    section === 'access' ? <AccessAdmin isHq selfId={user.id} /> :
    <HqWorkspace />
  ) : isCentre ? <CentreWorkspace /> :
    ['implementation_partner', 'sector_partner', 'funding_partner'].includes(user.role) ? <PartnerWorkspace /> :
    workspace.permissions.includes('manage_org_users') ? <AccessAdmin isHq={false} selfId={user.id} /> :
    <section className="dashboard-placeholder"><span className="eyebrow">Workspace section</span><h2>{section.replaceAll('-', ' ')}</h2><p>This role section is ready for its scoped workflow.</p></section>;

  return <DashboardShell user={user} workspace={workspace} onLogout={logout} busy={busy}>
    <main className="dashboard-page">
      {!isCentre && <section className="dashboard-overview">
        <div><span className="eyebrow">Your workspace</span><h2>{isHq ? section === 'overview' ? 'Keep the network moving.' : section.replaceAll('-', ' ') : 'Keep the next decision moving.'}</h2><p>Review evidence, follow progress, and take the next action for your organisation.</p></div>
        <div className="overview-meta"><span>Organisation</span><strong>{user.orgType ? user.orgType.replaceAll('_', ' ') : 'Personal account'}</strong><span>Access</span><strong>{workspace.permissions.length} permissions</strong></div>
      </section>}
      {error && <p className="error dashboard-error" role="alert">{error}</p>}
      {content}
    </main>
  </DashboardShell>;
}
