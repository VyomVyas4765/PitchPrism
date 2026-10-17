'use client';
import { useEffect, useState } from 'react';
import type { SessionUser } from '@pitchprism/contracts';
import styles from './hq.module.css';
import TeamPanel from './TeamPanel';
import { OrganisationsPanel, ProgrammesPanel, RoutingPanel, RubricsPanel, TradesPanel } from './ConfigPanels';

const TABS = [
  { key: 'orgs', label: 'Organisations' }, { key: 'team', label: 'Team' }, { key: 'programmes', label: 'Programmes and cohorts' },
  { key: 'rubrics', label: 'Rubrics' }, { key: 'trades', label: 'Trades' }, { key: 'routing', label: 'Routing' },
] as const;
type Tab = typeof TABS[number]['key'];

// HQ desk (Dev 3): platform configuration. Every action is re-authorised by the API; tabs only organise the page.
export default function HqWorkspace({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>('orgs');
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (TABS.some(item => item.key === hash)) setTab(hash as Tab);
  }, []);
  const choose = (next: Tab) => { setTab(next); history.replaceState(null, '', `#${next}`); };
  return <section className={styles.desk} aria-labelledby="hq-title">
    <div className={styles.deskHead}><div><span className="eyebrow">HQ desk</span><h2 id="hq-title">Run the platform</h2></div></div>
    <div className={styles.tabs} role="tablist" aria-label="HQ sections">
      {TABS.map(item => <button key={item.key} type="button" role="tab" id={`tab-${item.key}`} aria-selected={tab === item.key}
        aria-controls="hq-panel" className={styles.tab} onClick={() => choose(item.key)}>{item.label}</button>)}
    </div>
    <div id="hq-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'orgs' && <OrganisationsPanel />}
      {tab === 'team' && <TeamPanel user={user} />}
      {tab === 'programmes' && <ProgrammesPanel user={user} />}
      {tab === 'rubrics' && <RubricsPanel canEdit />}
      {tab === 'trades' && <TradesPanel canEdit />}
      {tab === 'routing' && <RoutingPanel />}
    </div>
  </section>;
}
