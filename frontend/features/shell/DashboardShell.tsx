'use client';

import { useState, type ReactNode } from 'react';
import { ROLE_LABELS, type Permission, type SessionUser, type Workspace } from '@pitchprism/contracts';

// Navigation only: every section re-checks access on the API. Shell by Rayyan; sections map to role panels.
type NavigationItem = { label: string; section: string; group?: string; show: (user: SessionUser, can: (permission: Permission) => boolean) => boolean };
const hq = (user: SessionUser) => user.role === 'hq_admin';
const PARTNER = ['implementation_partner', 'sector_partner', 'funding_partner'];

export const NAVIGATION: NavigationItem[] = [
  { label: 'Overview', section: 'overview', show: () => true },
  { label: 'Review queue', section: 'review-queue', show: (user, can) => can('review_centre') && !hq(user) },
  { label: 'Programmes and cohorts', section: 'cohorts', show: (user, can) => can('manage_cohorts') && !hq(user) },
  { label: 'Partner workspace', section: 'partner', show: user => PARTNER.includes(user.role) },
  { label: 'Team', section: 'team', show: (user, can) => can('invite_users') && !hq(user) },
  { label: 'Pipeline', section: 'pipeline', group: 'Across every centre', show: (_, can) => can('view_all_analytics') },
  { label: 'Idea map', section: 'map', show: (_, can) => can('view_all_analytics') },
  { label: 'Fairness', section: 'fairness', show: (_, can) => can('view_all_analytics') },
  { label: 'Second review', section: 'sampling', show: (_, can) => can('view_all_analytics') },
  { label: 'Audit history', section: 'audit', show: (_, can) => can('view_audit_log') },
  { label: 'Organisations', section: 'orgs', group: 'Configuration', show: (_, can) => can('manage_orgs') },
  { label: 'People and access', section: 'team', show: user => hq(user) },
  { label: 'Programmes and cohorts', section: 'programmes', show: user => hq(user) },
  { label: 'Rubrics', section: 'rubrics', show: (_, can) => can('configure_rubrics') },
  { label: 'Trades', section: 'trades', show: (_, can) => can('manage_trades') },
  { label: 'Partner routing', section: 'routing', show: (_, can) => can('manage_routing') },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export default function DashboardShell({ user, workspace, section, onLogout, busy, children }: {
  user: SessionUser; workspace: Workspace; section: string; onLogout: () => void; busy: boolean; children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const can = (permission: Permission) => workspace.permissions.includes(permission);
  const items = NAVIGATION.filter(item => item.show(user, can));
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
        {items.map(item => <span key={`${item.group ?? ''}${item.section}`}>
          {item.group && <span className="sidebar-group">{item.group}</span>}
          <a href={item.section === 'overview' ? basePath : `${basePath}/${item.section}`} aria-current={item.section === section ? 'page' : undefined}
            onClick={() => setSidebarOpen(false)}>{item.label}</a>
        </span>)}
      </nav>
      <div className="sidebar-account">
        <div className="avatar" aria-hidden="true">{initials(user.displayName)}</div>
        <div className="account-copy"><strong>{user.displayName}</strong><span>{ROLE_LABELS[user.role]}</span></div>
        <a className="sidebar-logout" href="/account">Account</a>
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
