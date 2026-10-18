'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type AuthResponse, type SessionUser, type Workspace } from '@pitchprism/contracts';
import { api, ApiError } from '../../lib/api';
import CentreWorkspace from '../../features/centre/CentreWorkspace';
import DashboardShell, { NAVIGATION } from '../../features/shell/DashboardShell';
import HqWorkspace, { type HqSection } from '../../features/hq/HqWorkspace';
import TeamPanel from '../../features/hq/TeamPanel';
import { ProgrammesPanel } from '../../features/hq/ConfigPanels';
import { PartnerWorkspace } from '../../features/partners/partner-workspace';

const PARTNER = ['implementation_partner', 'sector_partner', 'funding_partner'];

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

  const can = (permission: Parameters<typeof workspace.permissions.includes>[0]) => workspace.permissions.includes(permission);
  const allowed = NAVIGATION.some(item => item.section === section && item.show(user, can));
  const isHq = user.role === 'hq_admin';
  const isCentre = user.role === 'centre_assessor' || user.role === 'cohort_lead';
  const content = !allowed ?
    <section className="dashboard-placeholder"><h2>Section unavailable</h2><p>This section is not available for your role.</p></section> :
    isHq ? <HqWorkspace user={user} section={section as HqSection} /> :
    section === 'team' ? <TeamPanel user={user} /> :
    isCentre ? section === 'cohorts' ? <ProgrammesPanel user={user} /> : <CentreWorkspace /> :
    PARTNER.includes(user.role) ? <PartnerWorkspace /> :
    <section className="dashboard-placeholder"><span className="eyebrow">Workspace section</span><h2>{section.replaceAll('-', ' ')}</h2><p>This role section is ready for its scoped workflow.</p></section>;

  return <DashboardShell user={user} workspace={workspace} section={section} onLogout={logout} busy={busy}>
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
