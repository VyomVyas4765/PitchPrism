# PRD: PitchPrism — AI Idea Screening for Tata STRIVE

Oct 17, 2026 · @Rayyan Shaikh

## 1. Overview

PitchPrism lets aspiring entrepreneurs pitch a business idea by voice, text or PDF in their own language. AI turns it into a scored, evidence-linked idea card that Tata STRIVE centres and partner organisations review, route and track.

**Problem.** Tata STRIVE's Entrepreneurship Development Programme (EDP) asks candidates for a two-page business plan, then a written test, a group activity and an interview ([Tata Trusts Horizons](https://horizons.tatatrusts.org/2024/april/tata-trusts-horizons-trained-to-thrive.html)). Business knowledge is not judged; drive, awareness and the idea are. Yet the written plan filters out people who can explain a business well but cannot write one, and assessors must translate before they can evaluate.

| Pain point (from the problem statement) | Who feels it | What PitchPrism does |
| --- | --- | --- |
| Format diversity: audio, text, PDFs | Assessors | One pipeline turns every format into the same structured idea card |
| Language barriers: many regional languages | Entrepreneurs, assessors | Speech-to-text and translation in the entrepreneur's language; English card for reviewers |
| Manual translation: slow evaluation | Assessors, Tata STRIVE | Automatic transcript, translation and first-pass score in minutes |
| Context gaps: missing local market insight | Assessors | Location-aware notes and relevant government schemes, with sources shown |

**Approach.** The web side is multi-org, built in three layers:

1. **Hub-and-spoke backbone (build fully).** Tata STRIVE HQ is the hub; centres and implementation partners are spokes. This mirrors how Tata STRIVE already works through its own centres, extension centres and trained partners ([Tata STRIVE](https://tatastrive.com/what_we_do/enabling-jobs-and-livelihoods/)).
2. **Consent-based routing (standout feature).** The entrepreneur submits once. With their consent, the idea reaches the partners who can help: sector partners, lenders, mentors.
3. **Outcome tracking (light layer and vision).** Selected ideas are followed through training, funding and business status, feeding impact reports.

**Surfaces.** A Flutter mobile app for entrepreneurs and field facilitators. A Next.js web dashboard for HQ, centres and partners. A Node.js backend with MongoDB, and Sarvam AI for voice, translation and documents.

## 2. Goals, non-goals and success metrics

PitchPrism succeeds if an entrepreneur can pitch by voice in under 5 minutes and an assessor can review that pitch in under 3. Targets below are proposals for the team to confirm.

**Goals**

- **G1. Pitch in your own language.** Submit by voice, text or PDF in Hindi, Marathi, Odia or English at launch. These cover EDP's current states: Maharashtra, Odisha, Uttar Pradesh and Haryana.
- **G2. Review without translating.** Assessors read an English idea card with scores, not raw audio.
- **G3. Explainable scores.** Every score links to the sentence in the transcript that earned it.
- **G4. One platform, many orgs.** HQ, centres and partners share one system with strict data isolation and consent.
- **G5. Nobody leaves empty-handed.** Every applicant gets a next step in their language: shortlist, improve and resubmit, or a skilling course.

**Non-goals for the MVP**

- AI making final selection decisions. A human assessor always decides.
- Replacing EDP's group activity or personal interview.
- Loan disbursal, payments or billing between orgs.
- Delivering skilling courses inside the app. It links out to them.
- iOS polish. Android comes first, since most target users are likely on low-cost Android phones.

**Success metrics**

| Metric | Proposed target | How it is measured |
| --- | --- | --- |
| Submission completion rate | ≥ 70% of started pitches | App events: started vs submitted |
| Time from submit to idea card | ≤ 5 min at p90 | Pipeline job timestamps |
| Assessor review time | ≤ 3 min median | Dashboard time on card |
| Assessor agreement with AI recommendation | Tracked; review if < 60% | Final decision vs AI band |
| Transcript fixes needed | ≤ 20% of submissions | Entrepreneur or facilitator edits |
| Score gap across languages | Within 5 points on a 100-point scale | Fairness monitor |
| Applicants receiving feedback in their language | 100% | Feedback delivery log |

## 3. Users, organisations and roles

PitchPrism serves one entrepreneur-facing role on mobile and five organisation roles on the web, plus field facilitators who use the mobile app on someone's behalf.

**Personas**

- **Sunita, entrepreneur (mobile).** 32, from a village near Nashik, speaks Marathi, reads a little. Runs a self-help group and wants to start a papad and pickle unit. Comfortable with WhatsApp voice notes, not with forms.
- **Ravi, field facilitator (mobile, assisted mode).** Works at a Tata STRIVE centre or partner NGO. Records pitches for people without a smartphone or data, often with poor connectivity.
- **Meera, centre assessor (web).** EDP staff at a Tata STRIVE centre. Reviews 20 to 50 ideas a week, speaks Hindi and English, not Odia or Marathi.
- **Arjun, HQ programme admin (web).** Sets the scoring rubric, onboards partner orgs, checks quality and reports to funders.
- **Partner reviewers (web).** Staff at implementation partners, sector partners (such as auto or agri) and funding partners. Each sees only what their role and the entrepreneur's consent allow.

**Organisation types**

| Org type | Example (illustrative, not confirmed partners) | Role in the network |
| --- | --- | --- |
| HQ | Tata STRIVE programme team | Owns rubrics, partner onboarding, quality checks, analytics |
| Centre | Tata STRIVE skill development or extension centre | Collects and reviews ideas in its region; decides shortlists |
| Implementation partner | NGO, ITI or college trained by Tata STRIVE | Collects ideas in the field; first-level review |
| Sector partner | Auto-sector or agri-sector company | Mentoring and market links for ideas in its sector |
| Funding partner | Lender or CSR funder | Lenders see loan-ready shortlists; CSR funders see impact reports only |

**Permission matrix**

| Capability | HQ admin | Centre assessor | Implementation partner | Sector partner | Funding partner | Facilitator (mobile) |
| --- | --- | --- | --- | --- | --- | --- |
| Configure rubrics and programmes | Yes | No | No | No | No | No |
| Onboard orgs and users | Yes | Own centre users | Own org users | Own org users | Own org users | No |
| See ideas | All | Own centre | Own org | Consented only | Consented shortlist only | Own submissions |
| See name and phone number | Yes | Own centre | Own org | After entrepreneur accepts | After entrepreneur accepts | Own submissions |
| Score and decide | Override | Yes | First-level review | No | No | No |
| Add mentoring notes | Yes | Yes | Yes | Yes | No | No |
| Route an idea to partners | Yes | Yes | Suggest only | No | No | No |
| Aggregate analytics | All orgs | Own centre | Own org | Own org | Impact reports | No |
| Submit on someone's behalf | No | No | No | No | No | Yes |

## 4. Multi-org model

PitchPrism runs as one hub with many spokes, adds consent-gated routing to partners, and keeps a light outcome record for every selected idea.

&#91;embedded content: multi-org model · 3 layers\]

Ideas move up from entrepreneurs to centres and HQ; they move sideways to partners only through the entrepreneur's consent. Funding partners join the routing layer later (W-18).

- **Layer 1, hub-and-spoke.** Every org has a parent: centres report to HQ, implementation partners to a centre. The centre owns each submission; the partner that collected it is recorded as its source. HQ sees everything; sibling orgs never see each other's ideas.
- **Layer 2, consent-based routing.** A routing rule maps a sector and a set of districts to partner orgs. Suggestions only include partner types the entrepreneur allowed. A share moves through Suggested, Sent, Viewed, Interested, Contact requested, then Contact accepted or Declined. The entrepreneur can revoke at any time.
- **Layer 3, outcome tracking.** Centres record stages after selection. HQ and funders see totals, never personal data.
- **Adding an org needs no code.** HQ creates the org, sets its type, parent, region and sectors, then invites its first admin. The same setup could later onboard other incubators or CSR programmes.

## 5. Main user flows

The core flow takes an idea from a voice pitch to a partner match, with a human decision in the middle and a feedback path for everyone who is not shortlisted.

&#91;embedded content: main flow, 4 lanes, 1 human decision\]

The entrepreneur and the AI pass the idea back and forth until it is complete; only then does an assessor see it. A third decision, More info, sends new questions back to the Answer follow-ups step.

**Other flows**

1. **Assisted pitch.** A facilitator logs in, adds a new applicant, records their spoken consent, then runs the same pitch steps on a shared phone. Submissions queue offline and sync later; the centre sees the facilitator's org as the source.
2. **Partner-collected idea.** An implementation partner does a first review and forwards the idea to its linked centre, which makes the decision.
3. **Revoking consent.** In the Idea Passport, the entrepreneur turns off sharing for a partner type. Open shares close, and partners lose access on their next request.
4. **Not yet and resubmit.** The entrepreneur gets an improvement checklist and suggested courses, edits or re-records, and resubmits. The new evaluation is linked to the old one.
5. **HQ onboards a partner.** HQ creates the org, sets its type, parent and sectors, adds a routing rule, and invites its first admin.

## 6. Mobile app requirements (Flutter)

The mobile app is voice-first and works for someone who cannot read well, has a cheap Android phone and patchy data. P0 = must ship for the demo, P1 = build if time allows, P2 = later.

| ID | Area | Requirement | Priority |
| --- | --- | --- | --- |
| M-01 | Onboarding | First screen is a language picker with an audio prompt per language (Hindi, Marathi, Odia, English) | P0 |
| M-02 | Onboarding | Phone number login with OTP | P0 |
| M-03 | Onboarding | Consent screen read aloud in the chosen language. Processing consent is required; partner sharing is separate and optional | P0 |
| M-04 | Onboarding | Short profile by voice or tap: name, district or pincode, trade or skill, optional gender | P0 |
| M-05 | Pitching | Home has three large options: Speak, Type, Upload (PDF or photo of a handwritten plan) | P0 |
| M-06 | Pitching | Guided voice mode: 5 spoken prompt cards (what you will sell, who buys, where, money needed, your skills), up to 2 minutes each, pause and re-record | P0 |
| M-07 | Pitching | Free-talk mode: one recording of up to 5 minutes for people who prefer to just talk | P1 |
| M-08 | Pitching | Transcript review in the user's script, with tap-to-edit and audio playback | P0 |
| M-09 | Pitching | AI follow-up questions: 3 to 5 questions about gaps, asked in text and audio, answered by voice | P0 |
| M-10 | Pitching | Plan read-back: the generated 2-page plan in the user's language, played aloud, with Confirm or Fix something | P0 |
| M-11 | Pitching | Recordings saved on the device and uploaded when online; resumes after the app closes | P0 |
| M-12 | Status | Status timeline: Submitted, Under review, Decision, with push notification on change | P0 |
| M-13 | Feedback | Feedback in the user's language as text and audio: strengths, gaps, and one clear next step | P0 |
| M-14 | Feedback | Not-yet path: an improvement checklist, suggested skilling courses and a Resubmit button | P1 |
| M-15 | Idea Passport | See which organisations can see the idea; grant or revoke sharing per partner type; accept or decline a partner's contact request | P0 |
| M-16 | Notifications | SMS fallback when push fails | P1 |
| M-17 | Assisted mode | Facilitator login with org role; New applicant flow on a shared device; recorded spoken consent plus a checkbox | P0 |
| M-18 | Assisted mode | Queue of many applicants offline with per-item sync status; facilitator sees only their own submissions | P0 |
| M-19 | App-wide | Large touch targets, icons with audio labels, Android 8 and above, small download size | P0 |

## 7. Web dashboard requirements (Next.js)

The dashboard is one Next.js app; what each user sees depends on their org type and role. The centre assessor's idea card is the most important screen in the product.

| ID | View | Requirement | Priority |
| --- | --- | --- | --- |
| W-01 | HQ | Create orgs (type, region, languages), invite users, assign roles | P0 |
| W-02 | HQ | Programme and rubric setup: criteria, weights, score descriptors, band thresholds; each change saved as a new version | P0 (form), P1 (visual builder) |
| W-03 | HQ | Pipeline across all orgs, filtered by centre, language, sector, district, status and score band | P0 |
| W-04 | HQ | Routing rules: which partner orgs receive which sectors and districts | P0 |
| W-05 | HQ | Funnel analytics by centre: submitted, reviewed, shortlisted, enrolled, funded | P0 |
| W-06 | HQ | Quality check: a random sample of AI-scored ideas for a second human review; overrides logged | P1 |
| W-07 | HQ | Fairness monitor: score distributions by language, gender and district, with alerts on large gaps | P1 |
| W-08 | HQ | Audit log of who viewed, scored, routed or exported which idea | P1 |
| W-09 | Centre | Review queue for the centre, sortable by score, date and language | P0 |
| W-10 | Centre | Idea card: summary, structured fields, score per criterion with the quote that earned it, missing information, local context with sources, transcript and translation side by side, audio player that jumps to the quoted moment | P0 |
| W-11 | Centre | Decisions: Shortlist, Not yet, or Ask for more information (sends questions to the app). Overriding the AI band requires a reason | P0 |
| W-12 | Centre | Edit AI-drafted feedback in English; it is translated back and sent as text and audio | P0 |
| W-13 | Centre | Route to partners: suggested partners with the reason, limited to partner types the entrepreneur allowed | P0 |
| W-14 | Centre | Mentoring notes and mentor assignment | P1 |
| W-15 | Centre | Outcome updates: enrolled, training completed, loan applied or received, business started, 3-month and 6-month status | P1 |
| W-16 | Implementation partner | Own submissions, first-level review, forward to the linked centre | P0 |
| W-17 | Sector partner | Consented ideas in its sector; Express interest sends a contact request to the entrepreneur | P0 (one partner type in demo) |
| W-18 | Funding partner | Consented loan-ready shortlist; CSR impact report with totals only, no personal data | P2 |

## 8. AI pipeline

Sarvam AI handles everything language-related; a separate LLM handles understanding and scoring, behind an adapter so it can be swapped. Every output keeps segment IDs so any score can be traced back to the exact words and audio moment.

| Job | Service | Notes |
| --- | --- | --- |
| Speech to text | Sarvam Saaras v3, `mode="transcribe"` | 22 Indian languages, code-mixed speech, language detection ([Sarvam STT docs](https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/overview)) |
| Translation | Sarvam translation (Mayura or Sarvam-Translate) | Segment by segment, so IDs survive |
| Text to speech | Sarvam Bulbul v3 | Follow-up questions, plan read-back, feedback ([Sarvam docs](https://docs.sarvam.ai/index.md)) |
| Scanned PDFs and photos | Sarvam Document AI (Sarvam Vision) | Only when a PDF has no text layer |
| Extraction, scoring, feedback drafts | LLM via adapter: Sarvam-105B or another provider | Open question Q-04; JSON output validated against a schema |

**Limit that shapes the design.** Sarvam's synchronous speech-to-text accepts at most 30 seconds per request; longer audio goes to the Batch API, which takes files up to 2 hours ([Sarvam STT FAQ](https://docs.sarvam.ai/api-reference-docs/speech-to-text/faq.md)). PitchPrism splits audio at pauses into chunks under 30 seconds and transcribes them in parallel. That is faster than a batch job and keeps timestamps for each chunk. Free-talk recordings over 5 minutes fall back to the Batch API.

**Pipeline steps**

1. **Ingest.** The file goes to object storage; a submission record is created and a job is queued.
2. **Normalise.** Audio is converted to 16 kHz mono and split at silences into chunks under 30 seconds, each with its start time. PDFs use their text layer, or Document AI if there is none.
3. **Transcribe.** Chunks are transcribed in parallel within Sarvam's rate limits. Output: segments with ID, language, text, start and end time.
4. **Entrepreneur check.** The transcript goes back to the app for edits (M-08). Edits create a new transcript version.
5. **Translate.** Each segment is translated to English, keeping its ID.
6. **Extract.** The LLM fills the idea fields: product, customer, location, price, start-up cost, revenue model, skills, team. Each field cites segment IDs. Missing fields are listed.
7. **Follow up.** The LLM writes 3 to 5 questions about missing fields. They are translated, voiced and sent to the app; answers rerun steps 2 to 6.
8. **Draft the 2-page plan.** The LLM fills a plan template in English. It is translated and voiced for read-back (M-10).
9. **Add local context.** District and sector are matched against a curated dataset of schemes and local notes, each with a source link. The LLM only phrases what the dataset returns; it never invents a scheme.
10. **Score.** The LLM scores each rubric criterion from 1 to 5 with a reason, evidence segment IDs and a confidence level. It runs twice; if the runs differ by more than 1 point on any criterion, the idea is flagged for close human review. Weighted totals and bands are computed in code, not by the LLM.
11. **Draft feedback.** Strengths, gaps and one next step in English. After the assessor edits it, it is translated and voiced.
12. **Suggest routes.** Routing rules (W-04) filter partners by sector and district, then by the entrepreneur's consent. Each suggestion shows its reason.

**Guardrails.** Prompts and rubrics are versioned and stored with each result. Phone numbers and addresses never go to the LLM. Low temperature, schema validation and one automatic retry on invalid output.

## 9. Scoring rubric and fairness

The default rubric scores what EDP values (drive, local awareness and the idea itself) and explicitly ignores how well someone writes or speaks. HQ can edit criteria and weights per programme; weights below are a proposed starting point.

| Criterion | Weight | Scores 1 when… | Scores 5 when… |
| --- | --- | --- | --- |
| Problem and customer clarity | 20% | No clear buyer or need | Names who buys, why, and how often |
| Local market awareness | 20% | No sense of local demand or competition | Knows local demand, competitors and suppliers by name or place |
| Feasibility and resources | 20% | Start-up cost unknown or far beyond reach | Realistic cost, within reach of the programme's support (EDP loans go up to ₹2 lakh, per [Tata Trusts Horizons](https://horizons.tatatrusts.org/2024/april/tata-trusts-horizons-trained-to-thrive.html)) |
| Skill fit | 15% | No link between skills and the business | Trade, training or experience matches the business |
| Entrepreneurial drive | 15% | Idea only, no action | Has tested, sold, saved or started something already |
| Revenue logic | 10% | No idea how money is made | Basic price, cost and margin reasoning |

**Bands (AI suggestion only; the assessor decides).** 70 and above: Strong. 50 to 69: Promising, needs mentoring. Below 50: Not yet.

**Never scored.** Grammar, English, business jargon, accent, pitch length or file format. The scoring prompt says so explicitly, and the calibration set tests it.

**Evidence rules**

- Every criterion score cites 1 to 3 segment IDs. The idea card shows the English quote, the original words and a play button at that timestamp.
- Missing is not weak. If a criterion has no evidence, the AI asks a follow-up question before scoring. If it is still missing after follow-ups, the score is capped at 2 and marked Not mentioned.
- Each score carries a confidence level. Low confidence, or two scoring runs that disagree, puts the idea in a Needs attention lane.

**Fairness checks**

- **What the LLM never sees.** Name, gender, phone and exact address are never sent. Gender is optional and used only for aggregate monitoring.
- **Calibration set.** The team records 20 to 30 sample pitches across the four languages, with expected bands, and reruns them after every prompt or rubric change.
- **Same idea, different language.** The same pitch recorded in two languages should score within 5 points; larger gaps block a prompt release.
- **Live monitor (W-07).** Average scores by language, gender and district. A gap above 5 points raises an alert for HQ, since it often points to a transcription problem rather than weaker ideas.

## 10. System architecture and tech stack

Both apps talk only to one Node.js API, which scopes every query by org; slow AI work runs in a separate worker off a job queue, so the app never waits on Sarvam or the LLM.

&#91;embedded content: system architecture, 11 components\]

The worker writes results back to MongoDB and the API pushes status to the phone through Firebase and to the dashboard through server-sent events.

| Layer | Choice | Why |
| --- | --- | --- |
| Mobile | Flutter (Dart); `record` for Opus audio, `hive` or `drift` for the offline queue, `dio` for resumable uploads, `just_audio` for playback | One codebase, good on low-end Android |
| Web | Next.js (App Router, TypeScript), Tailwind CSS, TanStack Query, Recharts | Fast to build role-based dashboards |
| Backend | Node.js LTS, Express, TypeScript, Zod validation, Mongoose | Team's chosen stack; one language across API and worker |
| Audio processing | ffmpeg with silence detection, run in the worker | Splits audio into chunks under 30 seconds |
| Database | MongoDB Atlas in an India region | Flexible documents for evolving idea fields |
| Queue | Redis with BullMQ (Q-14) | Retries, rate limiting, job dashboard |
| File storage | S3-compatible bucket in an India region | Private files behind signed URLs |
| Voice and language | Sarvam AI: Saaras v3, translation, Bulbul v3, Document AI | Built for Indian languages |
| Reasoning | LLM behind an adapter (Q-04) | Swap providers without code changes |
| Auth | Firebase phone OTP for entrepreneurs; JWT in an httpOnly cookie for staff | Simple OTP on Flutter; staff roles stay in our API |
| Notifications | Firebase Cloud Messaging; SMS later (M-16) | Free push; SMS for feature-phone reach |
| Hosting | Vercel for Next.js; API and worker on a container host; India region for the pilot (Q-13) | Quick to deploy during the hackathon |
| Monitoring | Sentry, structured logs, BullMQ dashboard | See pipeline failures quickly |

## 11. Data model (MongoDB)

One MongoDB database holds every org's data; isolation is enforced in the backend on every query, because MongoDB has no row-level security of its own. Every submission carries the org that owns it and the org that collected it.

| Collection | Key fields | Notes |
| --- | --- | --- |
| `orgs` | name, type (HQ, CENTRE, IMPL\_PARTNER, SECTOR\_PARTNER, FUNDER), parentOrgId, state, districts, languages, sectors | parentOrgId links a spoke to its hub |
| `users` | orgId, name, email, phone, role, status | Staff only: HQ\_ADMIN, ASSESSOR, PARTNER\_REVIEWER, MENTOR, FUNDER\_VIEWER, FACILITATOR |
| `entrepreneurs` | phone (encrypted), name, language, district, pincode, trade, gender (optional), homeOrgId, createdVia, facilitatorId | homeOrgId = the centre that owns the relationship |
| `consents` | entrepreneurId, purpose, scope (org type or org), status, grantedAt, revokedAt, method, noticeVersion, evidenceUrl | evidenceUrl = recorded spoken consent in assisted mode |
| `programmes` | orgId, name, rubricVersionId, languages, districts, status | Example: EDP Nashik agri 2026 |
| `rubrics` | programmeId, version, criteria (key, label, weight, descriptors), bands | Never edited in place; each change is a new version |
| `submissions` | entrepreneurId, ownerOrgId, sourceOrgId, programmeId, status, inputs, language, fields (each with segment IDs), followUps, plan, context notes | ownerOrgId = centre, sourceOrgId = who collected it |
| `transcripts` | submissionId, version, segments (segId, start, end, text, lang, textEn), editedBy | Kept apart from submissions so documents stay small |
| `evaluations` | submissionId, rubricVersionId, promptVersion, model, criteria (score, reason, evidence, confidence), total, band, needsAttention | One per scoring; old ones kept for audit |
| `decisions` | submissionId, orgId, userId, decision, overrideReason, feedbackEn, feedbackLocal, audioUrl | Human decisions only |
| `shares` | submissionId, fromOrgId, toOrgId, reason, consentId, status | SUGGESTED, SENT, VIEWED, INTERESTED, CONTACT\_REQUESTED, CONTACT\_ACCEPTED, DECLINED |
| `outcomes` | submissionId, stage, value, date, recordedBy | ENROLLED, TRAINED, LOAN\_APPLIED, LOAN\_RECEIVED, BUSINESS\_STARTED, STATUS\_3M, STATUS\_6M |
| `schemes` | name, sectors, states, eligibility, sourceUrl, lastVerified | Curated reference data for local context |
| `auditLogs` | actorId, orgId, action, targetType, targetId, at | Append only |

**Multi-tenancy rules**

- **One scope function.** Every staff request builds its filter from the user's role: HQ sees all; centres filter on ownerOrgId; implementation partners on sourceOrgId; sector and funding partners only on submissions with an active share and an active consent.
- **No unscoped queries.** A Mongoose plugin injects the scope into every find and aggregate on tenant collections and throws if it is missing.
- **Two projections.** Partners get an idea projection without name or phone until the entrepreneur accepts their contact request.
- **Indexes.** submissions on (ownerOrgId, status, createdAt) and (sourceOrgId, status); shares on (toOrgId, status); consents on (entrepreneurId, purpose, status).
- **Revocation is immediate.** Revoking consent flips related shares to DECLINED, and the scope function drops them on the next request.

## 12. API overview

One REST API under `/api/v1` serves both apps; the role in the JWT decides what each call returns. Pipeline progress reaches the app through push notifications and the dashboard through server-sent events.

| Method and path | Used by | Purpose |
| --- | --- | --- |
| `POST /auth/otp/verify` | Mobile | Exchange a verified phone OTP for an app token |
| `POST /auth/login` | Web, facilitator | Staff login |
| `GET, PUT /me` | Mobile | Entrepreneur profile and language |
| `POST /consents`, `POST /consents/:id/revoke` | Mobile | Grant or revoke a consent |
| `POST /submissions` | Mobile | Create a draft submission |
| `POST /submissions/:id/upload-url` | Mobile | Signed URL to upload audio, text or PDF |
| `POST /submissions/:id/process` | Mobile | Start the pipeline |
| `GET /submissions/:id` | Mobile | Status, transcript, follow-ups, plan, feedback |
| `PUT /submissions/:id/transcript` | Mobile | Save transcript edits as a new version |
| `POST /submissions/:id/followups/:qid/answer` | Mobile | Upload a voice answer |
| `POST /submissions/:id/plan/confirm` | Mobile | Confirm the 2-page plan and submit |
| `GET /me/passport`, `POST /shares/:id/contact-response` | Mobile | See who can view the idea; accept or decline contact |
| `POST /assisted/applicants`, `GET /assisted/submissions` | Facilitator | Create an applicant with consent evidence; list own submissions |
| `GET /queue` | Web | Review queue, filtered by status, language and band |
| `GET /submissions/:id/card` | Web | Full idea card with evaluation and evidence |
| `POST /submissions/:id/decision` | Web | Shortlist, Not yet or More info, with override reason |
| `PUT /submissions/:id/feedback` | Web | Edit and send feedback |
| `GET /submissions/:id/route-suggestions`, `POST /shares` | Web | Suggested partners; send a share |
| `POST /shares/:id/interest` | Web (partner) | Express interest and request contact |
| `POST /submissions/:id/outcomes` | Web | Record an outcome stage |
| `/orgs`, `/users`, `/programmes`, `/rubrics`, `/routing-rules` | Web (HQ) | Admin setup; a rubric POST creates a new version |
| `GET /analytics/funnel`, `GET /analytics/fairness` | Web | Funnel and fairness monitor |
| `GET /audit-logs` | Web (HQ) | Audit trail |
| `GET /events` | Web | Server-sent events for pipeline and queue updates |

## 13. Security, privacy and DPDP compliance

PitchPrism is designed to meet India's DPDP Rules from day one, because sharing an entrepreneur's idea across orgs is only acceptable with clear, revocable consent. The Rules were notified on 13 November 2025, with most notice, consent, security and breach duties taking effect 18 months later ([Mondaq summary](https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified)). The team should check for 2026 amendments before the pitch (Q-12).

| DPDP requirement (per the summary above) | How PitchPrism meets it |
| --- | --- |
| Notice in clear, plain language listing the data, purposes, and how to withdraw or complain | Consent screen in the user's language, read aloud, with a link to withdraw and a grievance contact (M-03) |
| Withdrawing consent as easy as giving it | One-tap revoke per partner in the Idea Passport (M-15); takes effect on the next request |
| Security safeguards: encryption, access control, logging, backups | Encrypted phone numbers, role-based scoping on every query, append-only audit log, daily backups |
| Logs kept for at least a year | Audit logs retained 12 months minimum |
| Breach reported to the Data Protection Board within 72 hours | Incident runbook with owner and contacts (outside the MVP build, written into the plan) |
| Erase data when the purpose ends or consent is withdrawn | Delete my data in the app; scheduled cleanup of abandoned drafts |

**Other safeguards**

- **Least data to AI.** Only idea content goes to the LLM; name, phone, gender and exact address never do.
- **Partner view is anonymous by default.** Partners see the idea, not the person, until the entrepreneur accepts contact.
- **Assisted-mode consent is recorded.** The facilitator records the applicant saying yes, stored as consent evidence.
- **Files.** Audio and PDFs sit in private storage, reached only through short-lived signed URLs.
- **Staff accounts.** Strong passwords, optional two-factor login for HQ admins, sessions that expire.

## 14. Non-functional requirements

The product must work on a cheap phone over a weak connection, and keep all personal data in India. Pilot-scale numbers are proposals until Tata STRIVE shares real volumes (Q-03).

| Area | Requirement |
| --- | --- |
| Speed | Idea card ready within 5 minutes at p90 for a 10-minute pitch; dashboard pages load in under 2 seconds on 4G; non-AI API calls under 500 ms at p95 |
| Low bandwidth | Audio recorded as Opus at about 16 kbps, so a 10-minute pitch is about 1.2 MB; uploads are chunked and resumable |
| Offline | Recording, transcript viewing and the assisted-mode queue work offline; the queue survives app restarts |
| Devices | Android 8 and above, phones with 2 GB RAM |
| Pilot scale (proposed) | 5,000 submissions a month, 200 staff users, 20 orgs |
| Availability | 99% monthly during the pilot |
| Languages | All mobile text and audio prompts in Hindi, Marathi, Odia and English; web in English |
| Accessibility | Web meets WCAG 2.1 AA contrast and keyboard use; mobile has screen-reader labels |
| Data residency | Database, files and backend hosted in an India region; Sarvam is India-based; the LLM provider's data location is Q-04 |
| Cost visibility | AI cost per submission logged by step, shown on the HQ dashboard |
| Observability | Structured logs, a job queue dashboard, error tracking and alerts on failed pipeline steps |

## 15. Scope, phasing and build plan

The hackathon MVP builds the hub-and-spoke backbone end to end, one working consent-based route, and shows outcome tracking with sample data. Everything else is a roadmap slide.

| Phase | What ships | Requirement IDs |
| --- | --- | --- |
| MVP (hackathon demo) | Guided voice pitch, transcript check, follow-ups, plan read-back, Idea Passport, assisted mode; HQ setup, centre queue and idea card, decisions and feedback, routing to one sector partner, implementation-partner view, funnel | M-01 to M-06, M-08 to M-13, M-15, M-17 to M-19; W-01 to W-05, W-09 to W-13, W-16, W-17 |
| V2 (pilot) | Free-talk mode, Not-yet path, SMS fallback, quality checks, fairness monitor, audit log viewer, mentoring, outcome updates, visual rubric builder | M-07, M-14, M-16; W-06 to W-08, W-14, W-15 |
| Vision (pitch slide) | Funding-partner view and CSR impact reports, WhatsApp intake, scoring tuned with real outcomes, more languages, other incubators and CSR programmes as orgs | W-18 and new items |

**Build plan for a team of four (adjust to Q-01 and Q-02)**

1. **Everyone, first block.** Agree the API contract (section 12), the MongoDB schemas (section 11) and the demo script (section 16). Seed orgs, users, one programme and one rubric.
2. **Backend and AI engineer.** Upload, audio chunking, Sarvam transcription and translation, extraction and scoring prompts, job queue, scope plugin.
3. **Flutter engineer.** Language picker, OTP, consent, guided recording with offline queue, transcript check, follow-ups, plan read-back, status and feedback, Idea Passport, assisted mode.
4. **Next.js engineer.** Login, centre queue, idea card with evidence and audio jump, decisions and feedback, routing, sector-partner view, HQ setup and funnel.
5. **AI quality and pitch owner.** Record the calibration pitches in four languages, curate the schemes dataset with source links, tune prompts, build the deck and rehearse the demo.
6. **Everyone, last block.** End-to-end run of the demo script three times on a real low-end phone, with a recorded backup video.

## 16. Demo script

The demo follows one entrepreneur, Sunita, from a Marathi voice note to a partner match in about 6 minutes, switching between the phone and the dashboard. Adjust timing once the demo length is known (Q-02).

1. **The problem (30 s).** Show the old path: a two-page written plan, manual translation, days of waiting.
2. **Sunita pitches (60 s).** On a low-cost Android phone, pick Marathi, give consent by voice, answer two guided prompts live.
3. **The AI listens back (45 s).** Show her Marathi transcript, then a spoken follow-up question about pricing; she answers by voice.
4. **Her plan, in her language (30 s).** Play part of the 2-page plan read back in Marathi; she taps Confirm.
5. **The assessor's view (75 s).** On the Nashik centre dashboard, open her English idea card. Click the Local market awareness score to jump to her exact words and audio. Show the scheme note with its source.
6. **Decision and feedback (30 s).** Shortlist, edit one line of feedback, send. Her phone plays the feedback in Marathi.
7. **The network (45 s).** The routing suggestion shows an agri partner, limited to what she allowed. Switch to the partner's view: idea visible, name hidden. Express interest; Sunita accepts on her phone; her contact appears.
8. **HQ and impact (30 s).** HQ funnel across centres, fairness monitor and sample outcome tracking.
9. **Close (15 s).** The roadmap: more languages, WhatsApp intake, and outcome-tuned scoring.

## 17. Risks and mitigations

The biggest risks are wrong transcripts leading to wrong scores, and partner data leaking across orgs; both have checks built into the MVP.

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Dialects or noisy audio transcribed badly | Wrong words lead to wrong scores | Entrepreneur or facilitator checks the transcript; a noise check before upload asks to re-record; low-confidence ideas go to Needs attention |
| Data leaks between orgs | Breaks trust and DPDP duties | One scope plugin on every query, automated tests per role, anonymous partner view until contact is accepted |
| AI invents schemes or market facts | Misleads entrepreneurs and assessors | Local context comes only from the curated dataset, each note with a source link |
| Scores unfair to some languages or groups | Excludes the people the programme exists for | Calibration set, cross-language test, live fairness monitor, human makes every decision |
| Assessors rubber-stamp AI scores | Human review becomes a formality | Evidence shown before the total, override tracking, random quality-check sample |
| Consent not truly understood | Sharing without meaningful agreement | Consent read aloud in the user's language, partner sharing off by default, one-tap revoke |
| Handwritten plans read poorly | PDF and photo route fails | Treat photo uploads as P1; prompt users to speak instead |
| Sarvam or LLM outage, or rate limits, during the demo | Live demo fails | Retries with backoff, cached results for demo pitches, recorded backup video |
| Multi-org scope eats build time | Core flow unfinished | Only HQ, one centre, one implementation partner and one sector partner live; others are seeded data |
| AI cost grows with volume | Unaffordable at scale | Cost logged per step; cheaper model for extraction, stronger model only for scoring |

## 18. Open questions for the team

These decisions change scope, data model or the demo; each has a default the PRD assumes until the team answers.

| ID | Question | Why it matters | Default if unanswered |
| --- | --- | --- | --- |
| Q-01 | How many people are on the team, and who is strongest in Flutter, Next.js, Node and prompt writing? | Decides the build split | Four people, split as in section 15 |
| Q-02 | How long is the build, and how long is the demo and pitch slot? Is there a screening round first? | Decides MVP scope and demo script | 6-minute demo |
| Q-03 | Will organisers share real material: application volumes, sample pitches, the actual EDP rubric or two-page plan template? | Real templates beat guessed ones with judges | Proposed rubric in section 9 |
| Q-04 | Which LLM for extraction and scoring: Sarvam-105B or another provider? Who has API credits, and where is data processed? | Cost, quality and data residency | Adapter; use whichever has credits, compare on the calibration set |
| Q-05 | Which languages will you demo live, and who on the team can record Marathi or Odia calibration pitches? | Calibration and demo depend on real speakers | Hindi and Marathi live; Odia as a recorded sample |
| Q-06 | Android only, or must the app also run on iOS? | Testing time | Android only |
| Q-07 | Do assessors need the mobile app, or only the web dashboard? | Extra screens | Web only |
| Q-08 | Can one entrepreneur apply to several programmes or centres at once? | Changes ownership rules in the data model | One active submission per programme; centre assigned by district |
| Q-09 | When a partner collects an idea, who owns the relationship: the partner or the centre? | Changes who sees and decides | Centre owns; partner is recorded as the source |
| Q-10 | Should funding partners see anything in the MVP? | Extra view and consent type | No; vision slide only |
| Q-11 | Phone OTP via Firebase Auth, or an Indian SMS provider? | Setup time and SMS cost | Firebase Auth |
| Q-12 | Have 2026 amendments changed DPDP consent or timelines? Mondaq lists a 2026 Removal of Difficulties Order on consent and data audits | The compliance slide must be current | Design to the November 2025 Rules; verify before the pitch |
| Q-13 | Where will you host? | Data residency claim | MongoDB Atlas and backend in an India region |
| Q-14 | Add Redis for the job queue (BullMQ), or stay MongoDB-only (Agenda)? | One more service to run | BullMQ with hosted Redis |
| Q-15 | Must PitchPrism connect to any existing Tata STRIVE system, such as their learning platform? | Integration work | Link out only |
| Q-16 | What are the judging criteria and their weights? | Where to spend the last hours | Equal weight to impact, feasibility, innovation and demo |
| Q-17 | Product name? | Branding in the deck and app | Decided: PitchPrism |

## Sources

- [Trained to thrive, Tata Trusts Horizons](https://horizons.tatatrusts.org/2024/april/tata-trusts-horizons-trained-to-thrive.html): EDP selection steps, loans up to ₹2 lakh, support base
- [Enabling jobs and livelihoods, Tata STRIVE](https://tatastrive.com/what_we_do/enabling-jobs-and-livelihoods/): centres, extension centres, implementation partners
- [Sarvam speech-to-text overview](https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/overview) and [FAQ](https://docs.sarvam.ai/api-reference-docs/speech-to-text/faq.md): Saaras v3 modes, 30-second sync limit, Batch API
- [Sarvam developer documentation](https://docs.sarvam.ai/index.md): Bulbul v3, translation, Document AI
- [DPDP Rules, 2025 notified, Mondaq](https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified): commencement timeline and duties
