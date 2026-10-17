'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type AuthResponse, type SessionUser, type Workspace } from '@pitchprism/contracts';
import { api, ApiError } from '../../lib/api';
import CentreWorkspace from '../../features/centre/CentreWorkspace';
import HqWorkspace, { HQ_SECTIONS, type HqSection } from '../../features/hq/HqWorkspace';
import TeamPanel from '../../features/hq/TeamPanel';
import { ProgrammesPanel } from '../../features/hq/ConfigPanels';
import { PartnerWorkspace } from '../../features/partners/partner-workspace';
import DashboardShell, { NAVIGATION } from '../../features/shell/DashboardShell';

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
  const centre = user.role === 'centre_assessor' || user.role === 'cohort_lead';
  const title = NAVIGATION.find(item => item.section === section)?.label ?? 'Overview';
  // A section outside this role's navigation shows nothing but a way back; the API refuses its data anyway.
  const content = !allowed ? <p className="dashboard-placeholder">This section is not part of your workspace. <a href={`/dashboard/${user.role}`}>Go to your overview</a></p>
    : isHq ? <HqWorkspace user={user} section={(HQ_SECTIONS as readonly string[]).includes(section) ? section as HqSection : 'overview'} />
    : section === 'team' ? <section className="centre-workspace"><TeamPanel user={user} /></section>
    : section === 'cohorts' ? <section className="centre-workspace"><ProgrammesPanel user={user} /></section>
    : centre ? <CentreWorkspace />
    : PARTNER.includes(user.role) ? <PartnerWorkspace />
    : <section className="dashboard-placeholder"><span className="eyebrow">Mobile first</span><h2>Your work happens in the PitchPrism app.</h2>
      <p>{user.role === 'facilitator' ? 'Register applicants, record their consent and pitches, and submit them from the app, even offline.' : 'Record your pitch, track your idea and read feedback in the app.'}</p></section>;

  return <DashboardShell user={user} workspace={workspace} section={section} onLogout={logout} busy={busy}>
    <main className="dashboard-page">
      {/* The centre desk fills the page on its own. */}
      {!(allowed && centre && section !== 'team' && section !== 'cohorts') && <section className="dashboard-overview">
        <div><span className="eyebrow">Your workspace</span><h2>{section === 'overview' ? isHq ? 'Keep the network moving.' : 'Keep the next decision moving.' : title}</h2>
          <p>Review evidence, follow progress, and take the next action for your organisation.</p></div>
        <div className="overview-meta"><span>Organisation</span><strong>{user.orgType ? user.orgType.replaceAll('_', ' ') : 'Personal account'}</strong><span>Access</span><strong>{workspace.permissions.length} permissions</strong></div>
      </section>}
      {error && <p className="error dashboard-error" role="alert">{error}</p>}
      {content}
    </main>
  </DashboardShell>;
}
