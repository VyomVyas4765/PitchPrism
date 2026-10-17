# Dev 4 · Web Dashboard

**Mission.** Build the screen the judges will remember: an idea card that reads like a well-edited newspaper story about someone's business, where every score can be clicked back to the applicant's own words — and the views that let a centre compare a whole cohort at a glance.

You own what everyone sees.

| | |
| --- | --- |
| **Stack** | Next.js (App Router, TypeScript) · Tailwind CSS · TanStack Query · Recharts · Leaflet + OSM tiles · PDF.js / page images · wavesurfer.js |
| **Code** | `apps/web/` |
| **Design** | [design.md](../design.md) — "The Broadsheet". Read it first; it is yours to extend |
| **Requirements** | W-01 to W-35 (UI) · the live card (A-28 on screen) |
| **You build against** | Dev 2's `Card` fixtures (H3), Dev 1's event replay (H4), Dev 2's analytics fixtures (H18) — you are never blocked |
| **You depend on** | Dev 3's API at H6 for real data |

---

## What "done" looks like

- Dropping the organisers' ZIP makes the queue fill in live, with language and format chips, lanes sorting themselves.
- The idea card has every section in PRD W-10, fills in stage by stage, and every score, flag and quote jumps to the original (page region or audio moment).
- Trade, cohort, cross-cohort, quadrant and map views work on the seeded cohorts.
- Every view has loading, empty and error states, works by keyboard, and meets AA contrast in both the day and night editions.

---

## Order of work

### H0–H2 · Kickoff (with everyone)
- [ ] Next.js app scaffold, Tailwind with the design tokens from [design.md §3](../design.md#3-tokens), fonts loaded (incl. Noto Serif Devanagari / Telugu / Bengali / Oriya)
- [ ] Typed API client generated from `packages/contracts`
- [ ] Agree the `Card` shape with Dev 2 — you are its main consumer

### H2–H8 · The card on fixtures (target: M2)
- [ ] Shell: masthead, edition switcher (day / night), role-aware nav, login (**W-01** login part)
- [ ] **W-10 v1** idea card from the three fixtures: headline, dateline, standfirst, spectrum bar, domain scores with pull-quotes, flags as editor's marks, side-by-side original and translation
- [ ] Live card: replay Dev 1's `StageEvent` fixture; sections ink in as stages finish (the "wire" — design.md §6.6)
- [ ] 🎯 **M2:** switch from fixtures to the real API once Dev 3 lands SSE (H6)

### H8–H14 · The reading room (target: M3)
- [ ] **W-09** review queue with lanes (Ready, Needs attention, Unassessable, Possible duplicate), sort by score / completeness / date / language
- [ ] **W-19** bulk import: drop zone, cohort picker, per-file progress rows, errors
- [ ] **W-20** original viewer: page image with highlighted bbox and struck values drawn as proofreader's deletions; audio waveform that seeks to a segment; blurred regions respected
- [ ] **W-21** data-quality panel (editor's marks in the margin, each linked to its segment)
- [ ] **W-11** decisions with override reason · **W-12** feedback editor (English in, local language + audio out)
- [ ] **W-28** screening quadrant

### H14–H20 · Context and comparison (target: M4)
- [ ] **W-22** similar ideas · **W-23** local market map (Leaflet, radius rings 1/3/10 km, OSM attribution, applicant's claim beside the count, schemes with sources)
- [ ] **W-24** trade view · **W-25** cohort view ("the front page") · **W-26** cross-cohort comparison (small multiples + trade × cohort heatmap)
- [ ] **W-13** routing panel · **W-16** implementation-partner view · **W-17** sector-partner view (anonymous until contact accepted)
- [ ] HQ: **W-01** orgs and users · **W-02** rubric form · **W-03** pipeline · **W-04** routing rules · **W-05** funnel · **W-32** cohort and trade admin

### H20–H24 · Stretch
- [ ] **W-27** idea map (UMAP scatter, named clusters, saturation alerts) · **W-33** model-quality page · **W-34** compare 2–3 ideas · **W-35** duplicate review
- [ ] **W-29** exports (print stylesheet for the one-page assessment — it should look like a newspaper clipping) · **W-31** interview kit (printable) · **W-30** copilot drawer
- [ ] **W-06**, **W-07**, **W-08**, **W-14**, **W-15** if time remains

### H24–H30 · Demo
- [ ] Demo path rehearsed click by click (PRD §24); no spinners longer than a second on cached data
- [ ] 1920×1080 projector check in both editions; font sizes readable from the back of a room
- [ ] Record the backup video (H28) with Dev 3

---

## The ten details that make it feel finished
1. The headline is written for each idea (Dev 2's `summary.headline`); fall back to "A {trade} in {place}".
2. Dateline in small caps: **KOTHAPALLY, RANGA REDDY** — Telugu · PDF + voice · 17 Oct.
3. Pull-quotes show the original script *and* the English, with a ▶ or ⧉ to jump to the source.
4. Struck values look like a proofreader crossed them out, with the correction set in the margin.
5. Numbers use tabular figures and Indian grouping (₹1,00,000).
6. The spectrum bar animates once, left to right, when the score stage lands — never again.
7. Empty states are written like an editor's note: "No market research was given. Ask: …"
8. Every chart is directly labelled; no legends to decode.
9. Keyboard: `j`/`k` next/previous card, `o` open original, `1`–`9` jump to a domain.
10. Print styles exist for the card and the interview kit.

## If you fall behind, ask for help in this order
1. Copilot drawer and exports (Dev 3 has the endpoints).
2. HQ admin forms (functional beats pretty here).
3. Idea map (a table of clusters is acceptable).

## Demo moments you own
Step 2 (the queue filling in), step 3 (the card), step 4 (map), step 6 (quadrant and decision), step 7 (trade, cohort, cross-cohort, idea map), step 10 (model-quality page).

## Done
<!-- One line per finished item: date-time · requirement ID · note -->
