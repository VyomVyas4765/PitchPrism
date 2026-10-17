'use client';

import { useState, type ReactNode } from 'react';
import { ROLE_LABELS, type Permission, type SessionUser, type Workspace } from '@pitchprism/contracts';

type NavigationItem = { label: string; permission?: Permission; section: string };

const NAVIGATION: NavigationItem[] = [
  { label: 'Overview', section: 'overview' },
  { label: 'Review queue', permission: 'review_centre', section: 'review-queue' },
  { label: 'Cohorts', permission: 'manage_cohorts', section: 'cohorts' },
  { label: 'My submissions', permission: 'submit_own', section: 'submissions' },
  { label: 'Applicants', permission: 'submit_assisted', section: 'applicants' },
  { label: 'Organisation work', permission: 'review_own_org', section: 'organisation' },
  { label: 'Opportunities', permission: 'view_consented', section: 'opportunities' },
  { label: 'Funding shortlist', permission: 'view_funding', section: 'funding' },
  { label: 'People and access', permission: 'manage_org_users', section: 'access' },
  { label: 'Platform reports', permission: 'manage_platform', section: 'reports' },
  { label: 'Configuration', permission: 'manage_platform', section: 'configuration' },
  { label: 'Audit history', permission: 'manage_platform', section: 'audit' },
  { label: 'Idea map', permission: 'manage_platform', section: 'clusters' },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export default function DashboardShell({
  user,
  workspace,
  onLogout,
  busy,
  children,
}: {
  user: SessionUser;
  workspace: Workspace;
  onLogout: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const items = NAVIGATION.filter(item => !item.permission || workspace.permissions.includes(item.permission));
  const basePath = `/dashboard/${user.role}`;

  return <div className="dashboard-shell">
    {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className={`dashboard-sidebar${sidebarOpen ? ' is-open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark">P</span>
        <div><strong>PitchPrism</strong><span>Assessment desk</span></div>
        <button className="sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>×</button>
      </div>
      <nav aria-label="Dashboard navigation">
        <span className="sidebar-label">Workspace</span>
        {items.map(item => <a key={item.section} href={`${basePath}/${item.section}`} onClick={() => setSidebarOpen(false)}>{item.label}</a>)}
      </nav>
      <div className="sidebar-account">
        <div className="avatar" aria-hidden="true">{initials(user.displayName)}</div>
        <div className="account-copy"><strong>{user.displayName}</strong><span>{ROLE_LABELS[user.role]}</span></div>
        <button className="sidebar-logout" onClick={onLogout} disabled={busy}>{busy ? '…' : 'Sign out'}</button>
      </div>
    </aside>
    <div className="dashboard-main">
      <header className="dashboard-topbar">
        <button className="menu-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button>
        <div><span className="eyebrow">Tata STRIVE · {ROLE_LABELS[user.role]}</span><h1>Good to see you, {user.displayName.split(' ')[0]}.</h1></div>
        <div className="topbar-status"><span className="status-dot" /> Workspace active</div>
      </header>
      <div className="dashboard-content">{children}</div>
    </div>
  </div>;
}
