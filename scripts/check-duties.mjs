import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const prd = await readFile(new URL('PitchPrism.md', root), 'utf8');
const rows = [...prd.matchAll(/^\| ([AMW]-\d+) \|/gm)].map(match => match[1]);
const assignments = JSON.parse(await readFile(new URL('docs/duties/requirements.json', root), 'utf8'));
const expected = new Set(rows);
for (const id of expected) {
  const assignment = assignments[id];
  if (!assignment || !/^dev-[1-4]-/.test(assignment.owner)) throw new Error(`Missing or invalid owner: ${id}`);
  for (const field of ['implementation', 'execution', 'local_strategy', 'cost_exposure', 'acceptance_test', 'status']) {
    if (!assignment[field]) throw new Error(`Missing implementation-matrix field ${field}: ${id}`);
  }
  if (!Array.isArray(assignment.dependencies) || !assignment.dependencies.length) throw new Error(`Missing dependencies: ${id}`);
  const brief = await readFile(new URL(`docs/duties/${assignment.owner}.md`, root), 'utf8');
  if (!brief.includes(`**${id}**`)) throw new Error(`Requirement absent from its owner's brief: ${id}`);
}
for (const id of Object.keys(assignments)) if (!expected.has(id)) throw new Error(`Unknown requirement: ${id}`);
console.log(`All ${expected.size} PRD requirements have one primary owner and a duty checklist entry.`);
