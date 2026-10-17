# Dev 3 · API, Data and Mobile

**Mission.** Build the spine everyone plugs into — contracts, database, tenancy, queue, live events — by hour 6, then build the voice-first Flutter app that lets Sunita pitch in Marathi on a ₹7,000 phone.

You unblock the other three in the first block. After that, you own the entrepreneur's whole experience.

| | |
| --- | --- |
| **Stack** | Node.js LTS · Express · TypeScript · Zod · Mongoose · BullMQ · Redis · Firebase (OTP, FCM) · Flutter (`record`, `drift`/`hive`, `dio`, `just_audio`) |
| **Code** | `packages/contracts/` · `services/api/` · `apps/mobile/` · `data/seed/` loader · `docker-compose.yml` |
| **Requirements** | PRD §19 data model, §20 API, §21 security · M-01 to M-23 · server side of W-01 to W-35 |
| **You unblock** | Everyone at H2 (contracts, seed) and H6 (upload, queue, SSE) |
| **You depend on** | Dev 1 for TTS/translation helpers (H12); Dev 2 for analytics data (H18) |

---

## What "done" looks like

- One `docker compose up` + `pnpm dev` runs Mongo, Redis, API and dashboard; `make worker` runs Python.
- Every staff request is scoped by the tenancy plugin; a test per role proves sibling orgs can't see each other.
- A file uploaded anywhere reaches the worker, and every `StageEvent` reaches the right dashboard over SSE.
- Sunita can pick Marathi, consent by voice, pitch, fix her transcript, answer a follow-up, hear her plan, confirm, hear feedback and accept a partner's contact request — on a low-end Android phone, partly offline.

---

## Order of work

### H0–H2 · Kickoff — you lead this block
- [ ] Monorepo scaffold (D-02), `docker-compose.yml` (Mongo, Redis), `.env.example`, README with run commands
- [ ] `packages/contracts`: JSON Schemas for `Submission`, `Segment`, `QA`, `Evaluation`, `Flag`, `Card`, `JobPayload`, `StageEvent`, `ImportBatch`; generators for TS and Pydantic; pre-commit hook (D-03)
- [ ] Seed loader: HQ, Nashik and Varanasi centres, one implementation partner, one agri sector partner; one user per role; EDP programme; two cohorts (Varanasi Oct 2026, Telangana Oct 2026); trades, rubric, schemes, question bank from Dev 1 and Dev 2
- [ ] 🎯 **M1:** tag contracts v1

### H2–H8 · The spine (target: M2)
- [ ] Mongoose models for every collection in PRD §19, generated from contracts where possible; indexes (incl. 2dsphere, TTL)
- [ ] **Tenancy plugin**: injects scope into every `find` / `aggregate` on tenant collections; throws if missing; passes scope to vector-search pre-filters
- [ ] Staff auth: `POST /auth/login`, JWT httpOnly cookie, role guard; dev-only role switcher
- [ ] Uploads: signed URLs, `POST /submissions`, `/upload-url`, `/process`
- [ ] Queue producer (BullMQ) and the Q-14 check with Dev 1 by **H4**
- [ ] `stage-events` subscriber → `GET /events` (SSE) filtered by viewer scope
- [ ] 🎯 **H6:** upload → job → events reach the dashboard. Tell Dev 4 and Dev 1.
- [ ] `GET /queue`, `GET /submissions/:id/card` (assembles the `Card` from submission + evaluation + links)

### H8–H14 · Imports, decisions, and the app's first screens (target: M3)
- [ ] `POST /imports`, `/imports/:id/start`: unzip, one document per file, group files by applicant hints (same name in filename, same contact), `import.progress` events
- [ ] `/decision`, `/feedback`, `/rescore`, `/similarity-links`, `/pages/:n` (rendered page, blurred per role), `/original` (signed URL)
- [ ] Partner projection without name/phone until contact accepted (two projections, PRD §19)
- [ ] Flutter: **M-01** language picker with audio prompts (6 languages) · **M-02** OTP · **M-03** consent read aloud · **M-04** profile by voice or tap · **M-05** Speak / Type / Upload · **M-06** guided prompt cards with re-record · **M-11** local save + resumable upload · **M-19** large targets, audio labels

### H14–H20 · Close the loops (target: M4)
- [ ] App: **M-08** transcript review with tap-to-edit · **M-09** follow-ups as text + audio, answered by voice · **M-10** plan read-back with Confirm / Fix · **M-12** status timeline + push · **M-13** feedback text + audio · **M-15** Idea Passport (grant, revoke, accept contact)
- [ ] Assisted mode: **M-17** facilitator login, new applicant, recorded consent · **M-18** offline queue with per-item sync
- [ ] API: consents, shares, `/interest`, `/contact-response`, routing rules, outcomes, admin CRUD (`/orgs`, `/users`, `/programmes`, `/cohorts`, `/trades`, `/rubrics`, `/schemes`)
- [ ] Analytics endpoints serving Dev 2's data: `/analytics/funnel`, `/domains`, `/trades/:key`, `/cohorts/:id`, `/cohorts/compare`, `/clusters`, `/map`

### H20–H24 · Stretch
- [ ] **M-14** not-yet path · **M-22** "what improved" · **M-23** schemes in their language · **M-07** free-talk mode · **M-20** PWA intake
- [ ] Exports (`/exports/*.pdf`, `.xlsx`), `/copilot/query` (with Dev 2), `/eval-runs`, audit log writes on view / score / route / export
- [ ] Role tests: one per role proving scope; one proving revoked consent hides a share on the next request

### H24–H30 · Demo
- [ ] Install the release APK on the demo phone; test on mobile data and in airplane mode
- [ ] Demo accounts and a reset script that restores the seed + cached results in under a minute

---

## Contract checklist (things others will ask you about)
- `StageEvent.ownerOrgId` must be set so SSE can filter without a DB call.
- `Card` is assembled by the API, not stored; Dev 2's fixtures define its shape.
- Page images for partners are blurred server-side using Dev 1's blur boxes — never send unblurred images and blur in CSS.
- Never log request bodies on submission routes.

## Mobile design notes
Follow [design.md](../design.md) §7, "The Radio". Voice first, script-native type, icons with audio labels, nothing that requires reading English.

## If you fall behind, ask for help in this order
1. Exports and copilot (Dev 4 can do client-side PDF).
2. Free-talk and PWA intake.
3. Audit log viewer (writes still required).

## Demo moments you own
Step 2 (import plumbing), step 8 (Sunita's pitch on the phone), step 9 (consent routing: name hidden → accepted → visible).

## Done
<!-- One line per finished item: date-time · requirement ID · note -->
