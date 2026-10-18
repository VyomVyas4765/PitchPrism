import type { CentrePortfolio, PortfolioGroup, PortfolioIdea, PortfolioRank } from './domain.generated.js';

// Pure comparison arithmetic shared by scoped server reads and unsaved browser batches.
// Callers must provide only their authorised population. This helper grants no access.
export interface PortfolioFilters { q?: string; cohortId?: string; tradeKey?: string; language?: string; state?: string; rubricVersion?: string; sort: 'updated' | 'potential' | 'completeness'; page: number; pageSize: number }
export const PORTFOLIO_DOMAIN_KEYS = ['clarity', 'customer_need', 'market_potential', 'feasibility', 'competition_awareness', 'differentiation', 'financial_logic', 'entrepreneur_readiness'];
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * q;
  return Math.round((sorted[Math.floor(index)]! + (sorted[Math.ceil(index)]! - sorted[Math.floor(index)]!) * (index % 1)) * 10) / 10;
}
function rank(row: PortfolioIdea, peers: PortfolioIdea[], scope: string): PortfolioRank | null {
  if (!row.rankEligible || !peers.length) return null;
  const position = 1 + peers.filter(peer => peer.potential! > row.potential!).length;
  return { rank: position, of: peers.length, percentile: peers.length < 5 ? null : Math.round(100 * (peers.length - position) / (peers.length - 1)), scope };
}
function groups(rows: PortfolioIdea[], key: 'cohortId' | 'tradeKey'): PortfolioGroup[] {
  const buckets = new Map<string, PortfolioIdea[]>();
  for (const row of rows) {
    const id = row[key]; if (!id) continue;
    const bucket = buckets.get(id) ?? []; bucket.push(row); buckets.set(id, bucket);
  }
  return [...buckets].map(([id, members]) => {
    const eligible = members.filter(row => row.rankEligible);
    return { id, label: key === 'cohortId' ? members[0]!.cohortName : members[0]!.tradeLabel,
      total: members.length, assessed: eligible.length, medianPotential: quantile(eligible.map(row => row.potential!), .5),
      meanCompleteness: members.some(row => row.completeness !== null) ? Math.round(members.reduce((sum, row) => sum + (row.completeness ?? 0), 0) / members.filter(row => row.completeness !== null).length) : null,
      distribution: ['0–19', '20–39', '40–59', '60–79', '80–100'].map((label, i) => ({ label, count: eligible.filter(row => Math.min(4, Math.floor(row.potential! / 20)) === i).length })),
      pathways: [...new Set(members.filter(row => row.potential !== null).map(row => row.pathway ?? 'Pending'))].map(label => ({ label, count: members.filter(row => (row.pathway ?? 'Pending') === label).length })),
      domains: PORTFOLIO_DOMAIN_KEYS.map(key => {
        const scores = eligible.flatMap(row => row.domains.filter(domain => domain.key === key && domain.score !== null).map(domain => domain.score!));
        return { key, n: scores.length, median: quantile(scores, .5), q1: quantile(scores, .25), q3: quantile(scores, .75) };
      }) };
  }).sort((a, b) => a.label.localeCompare(b.label));
}
export function buildPortfolio(all: PortfolioIdea[], query: PortfolioFilters, synthetic = false): CentrePortfolio {
  const versions = [...new Set(all.map(row => row.rubricVersion).filter((value): value is string => !!value))];
  const version = query.rubricVersion ?? versions[0] ?? null;
  const pool = all.filter(row => row.rubricVersion === version || row.rubricVersion === null);
  const eligible = pool.filter(row => row.rankEligible);
  for (const row of pool) {
    const tradePeers = eligible.filter(peer => peer.tradeKey === row.tradeKey && !!row.tradeKey);
    const localTradePeers = tradePeers.filter(peer => !!row.cohortId && peer.cohortId === row.cohortId);
    row.tradeRank = rank(row, localTradePeers.length >= 5 ? localTradePeers : tradePeers,
      localTradePeers.length >= 5 ? 'Trade within cohort' : 'Trade across your centre');
    row.cohortRank = row.cohortId ? rank(row, eligible.filter(peer => peer.cohortId === row.cohortId), 'Within cohort') : null;
  }
  const rows = pool.filter(row => (!query.q || `${row.title} ${row.entrepreneurRef} ${row.tradeLabel} ${row.district}`.toLowerCase().includes(query.q.toLowerCase()))
    && (!query.cohortId || row.cohortId === query.cohortId) && (!query.tradeKey || row.tradeKey === query.tradeKey)
    && (!query.language || row.language === query.language) && (!query.state || row.state === query.state));
  rows.sort((a, b) => query.sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) || a.submissionId.localeCompare(b.submissionId)
    : (b[query.sort] ?? -1) - (a[query.sort] ?? -1) || a.submissionId.localeCompare(b.submissionId));
  const scored = rows.filter(row => row.potential !== null), ranked = rows.filter(row => row.rankEligible);
  const cohortGroups = groups(rows, 'cohortId'), tradeGroups = groups(rows, 'tradeKey');
  return { ideas: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize,
    summary: { total: rows.length, assessed: scored.length, ranked: ranked.length, pending: rows.filter(row => !row.reviewAvailable || row.state === 'PENDING_MODEL').length,
      attention: rows.filter(row => row.state === 'NEEDS_ATTENTION').length, shortlisted: rows.filter(row => row.status === 'SHORTLISTED').length,
      medianPotential: quantile(ranked.map(row => row.potential!), .5), medianCompleteness: quantile(rows.flatMap(row => row.completeness === null ? [] : [row.completeness]), .5) },
    rubricVersion: version, versions, excludedOtherVersions: all.length - pool.length, synthetic,
    cohortOptions: groups(all, 'cohortId').map(({ id, label }) => ({ id, label })), tradeOptions: groups(all, 'tradeKey').map(({ id, label }) => ({ id, label })),
    languageOptions: [...new Set(all.map(row => row.language))].sort(),
    points: scored.filter(row => row.completeness !== null).map(row => ({ submissionId: row.submissionId, title: row.title, potential: row.potential!, completeness: row.completeness!, tradeKey: row.tradeKey, needsAttention: row.state === 'NEEDS_ATTENTION', rankEligible: row.rankEligible })),
    distribution: ['0–19', '20–39', '40–59', '60–79', '80–100'].map((label, i) => ({ label, count: ranked.filter(row => Math.min(4, Math.floor(row.potential! / 20)) === i).length })),
    pathways: [...new Set(scored.map(row => row.pathway ?? 'Pending'))].map(label => ({ label, count: scored.filter(row => (row.pathway ?? 'Pending') === label).length })),
    cohorts: cohortGroups, trades: tradeGroups,
    heatmap: cohortGroups.flatMap(cohort => tradeGroups.map(trade => {
      const members = ranked.filter(row => row.cohortId === cohort.id && row.tradeKey === trade.id);
      return { cohortId: cohort.id, tradeKey: trade.id, n: members.length, medianPotential: quantile(members.map(row => row.potential!), .5) };
    })),
  };
}
