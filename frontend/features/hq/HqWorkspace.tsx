'use client';
import type { SessionUser } from '@pitchprism/contracts';
import styles from './hq.module.css';
import TeamPanel from './TeamPanel';
import { OrganisationsPanel, ProgrammesPanel, RoutingPanel, RubricsPanel, TradesPanel } from './ConfigPanels';
import { AuditPanel, FairnessPanel, OverviewPanel, PipelinePanel, SamplingPanel } from './ReportPanels';
import IdeaMapPanel from './IdeaMapPanel';

export const HQ_SECTIONS = ['overview', 'pipeline', 'map', 'fairness', 'sampling', 'audit', 'orgs', 'team', 'programmes', 'rubrics', 'trades', 'routing'] as const;
export type HqSection = typeof HQ_SECTIONS[number];

// HQ desk (Dev 3): cross-organisation reporting and platform configuration, one section at a time; the dashboard
// shell's sidebar is the navigation. Every action is re-authorised by the API.
export default function HqWorkspace({ user, section }: { user: SessionUser; section: HqSection }) {
  return <section className={styles.desk} aria-label="HQ desk">
    {section === 'overview' && <OverviewPanel />}
    {section === 'pipeline' && <PipelinePanel />}
    {section === 'map' && <IdeaMapPanel />}
    {section === 'fairness' && <FairnessPanel />}
    {section === 'sampling' && <SamplingPanel />}
    {section === 'audit' && <AuditPanel />}
    {section === 'orgs' && <OrganisationsPanel />}
    {section === 'team' && <TeamPanel user={user} />}
    {section === 'programmes' && <ProgrammesPanel user={user} />}
    {section === 'rubrics' && <RubricsPanel canEdit />}
    {section === 'trades' && <TradesPanel canEdit />}
    {section === 'routing' && <RoutingPanel />}
  </section>;
}
