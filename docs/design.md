# Design · "The Broadsheet"

PitchPrism's dashboard is a newspaper about entrepreneurs' ideas. Every submission is a story, every assessor is an editor, and every score is a fact you can check against the source.

This is a direction, not a rulebook. Bend it when the product needs it; just keep the two ideas below intact.

---

## 1. The two ideas

### Idea one · Editors read carefully
Screening is careful reading. So the screen borrows from the craft that has spent 300 years making careful reading pleasant: **the broadsheet newspaper.** Serif headlines, a dateline, a standfirst, column rules, pull-quotes, margin notes, and a front page that ranks the day's stories.

Everyone else at the hackathon will ship a white SaaS dashboard with rounded cards and a blue primary button. We ship something that looks like it was **edited**.

### Idea two · A prism splits light
Our name is the second idea. A prism takes one beam of white light and shows you what it is made of. PitchPrism takes one idea and splits it into **nine assessment domains**, each with its own colour in spectral order.

That split is our signature: **the spectrum bar** (§6.2). It appears on every card, in every list, on the phone, and on the opening slide. Each band's width is the domain's weight; its fill is the score. An idea with full marks is a complete rainbow. A weak or incomplete one shows gaps you can see from across the room.

Everything else is quiet ink on paper so that the spectrum is the only colour that shouts.

---

## 2. Principles

1. **Evidence before verdict.** On every card, the quotes come before the total. The band and pathway sit at the top, but you can't reach the number without passing the words that earned it (this also fights rubber-stamping, PRD §25).
2. **The original is sacred.** The applicant's own script is never hidden behind the translation. Telugu sits beside English at the same size, not in a tooltip.
3. **Mark it, don't fix it.** Data-quality problems are shown the way a copy editor marks a proof: in the margin, in red pencil. We never silently "clean" a submission.
4. **One colour system for meaning.** Spectrum = assessment domains. Red pencil = editor's marks (flags). Everything else is ink, paper and rules.
5. **Calm by default, alive on arrival.** The page is still. Only new information moves: the wire ticks, a section inks in, the spectrum fills once.
6. **Respect the reader.** Big enough to read from the back of a room; dense enough to review 50 ideas a week.

---

## 3. Tokens

Two editions: **Day** (warm newsprint) and **Night** (the late edition: deep ink-blue paper, cream type). Paste into `apps/web/app/globals.css`.

```css
:root {
  /* Paper and ink — Day edition */
  --paper:        #F4EFE4;   /* newsprint */
  --paper-raised: #FBF8F1;   /* cards, the clipping */
  --paper-sunk:   #EAE3D3;   /* wells, code, inputs */
  --ink:          #1C1B18;   /* body text, 15.2:1 on paper */
  --ink-2:        #4A4740;   /* secondary text, 8.3:1 */
  --ink-3:        #77726A;   /* captions, datelines, 4.6:1 */
  --rule:         #1C1B18;   /* column rules, hairlines at 1px */
  --rule-soft:    #D5CCBA;

  /* Editor's marks (data-quality flags) */
  --pencil:       #B3261E;   /* red pencil: block / warn */
  --pencil-soft:  #F3D9D4;
  --graphite:     #5B5F6B;   /* info notes in the margin */

  /* Bands and pathways */
  --strong:       #1F6B4A;
  --promising:    #A26A00;
  --not-yet:      #5B5F6B;
  --insufficient: repeating-linear-gradient(135deg, var(--rule-soft) 0 4px, transparent 4px 8px);

  /* The spectrum — nine assessment domains in refraction order */
  --d-clarity:         #6B4FA0;  /* violet */
  --d-customer-need:   #3E57A8;  /* indigo */
  --d-market:          #1F7FA8;  /* blue */
  --d-feasibility:     #1E8C72;  /* teal-green */
  --d-competition:     #6E9A2A;  /* leaf */
  --d-differentiation: #C49A12;  /* ochre-yellow */
  --d-revenue:         #D9762B;  /* orange */
  --d-readiness:       #C2452D;  /* vermilion */
  --d-completeness:    #9A9387;  /* the white light left over — neutral */

  /* Type */
  --font-display: "Fraunces", "Noto Serif Devanagari", "Noto Serif Telugu", Georgia, serif;
  --font-text:    "Newsreader", "Noto Serif Devanagari", "Noto Serif Telugu", "Noto Serif Bengali", "Noto Serif Oriya", Georgia, serif;
  --font-ui:      "Inter Tight", "Noto Sans Devanagari", "Noto Sans Telugu", system-ui, sans-serif;
  --font-figures: "IBM Plex Mono", ui-monospace, monospace;

  /* Space: a 4px base, set in "picas" for fun */
  --p-1: 4px; --p-2: 8px; --p-3: 12px; --p-4: 16px; --p-6: 24px; --p-8: 32px; --p-12: 48px; --p-16: 64px;
  --measure: 66ch;            /* body text never wider than this */
  --radius: 2px;              /* paper has corners */
}

[data-edition="night"] {
  --paper:        #10151F;
  --paper-raised: #161D2A;
  --paper-sunk:   #0B0F16;
  --ink:          #EFE8D8;
  --ink-2:        #C4BCAA;
  --ink-3:        #8F887A;
  --rule:         #EFE8D8;
  --rule-soft:    #2A3242;
  --pencil:       #FF7A6E;
  --pencil-soft:  #3A1E1E;
  /* spectrum lifts ~12% in lightness for night; keep the same hues */
}
```

**Contrast.** Body and secondary text pass AA in both editions. Spectrum colours are never used for text; they always sit next to a printed label and number, so colour is never the only signal (§10).

---

## 4. Typography

| Role | Font | Size / leading | Notes |
| --- | --- | --- | --- |
| Masthead | Fraunces, 900, optical size 144, soft 0 | 40 / 40 | "PitchPrism", tight tracking, with a hairline spectrum underneath |
| Headline (card) | Fraunces, 600, opsz 72 | 36 / 40 | Sentence case. Written per idea |
| Section head | Inter Tight, 600, small caps | 12 / 16, +8% tracking | "THE IDEA", "THE EVIDENCE", "THE MARKET" |
| Standfirst | Newsreader italic | 20 / 30 | One-sentence summary under the headline |
| Body | Newsreader | 17 / 27 | Max `--measure` |
| Pull-quote | Fraunces italic, 400 | 24 / 32 | Original script set in Noto Serif at the same size |
| Dateline, captions | Inter Tight, small caps | 12 / 16 | `--ink-3` |
| UI (buttons, filters, tables) | Inter Tight | 14 / 20 | |
| Figures | IBM Plex Mono, tabular | 14 / 20 | Money, scores, ranks. Indian grouping: ₹1,00,000 |

**Indian scripts.** Pair every Latin face with Noto Serif (text) or Noto Sans (UI) for Devanagari, Telugu, Bengali and Oriya, loaded with `unicode-range` so only the scripts present are fetched. Increase line-height by 10% for Telugu and Odia; their vowel signs need room above and below. Never fake-bold or italicise Indic scripts — use weight only.

**Drop cap.** The standfirst's first letter on a card's opening paragraph is a 3-line Fraunces drop cap in the colour of the idea's strongest domain. It's the only time spectrum colour touches type, and it's decorative, so it's safe.

---

## 5. Grid

- **12 columns, 24px gutters, 1px column rules** between the main column and the margin. The rules are real `border-left`s, not shadows.
- **Idea card layout:** 8 columns of story, 1 column of air, 3 columns of **margin** for editor's marks, the dateline, and the rank. On narrow screens the margin folds under each paragraph as a footnote.
- **Front page (cohort view):** a lead story spans 8 columns; the next four run as 4-column teasers; the rest as a dense "In brief" list with spectrum bars.
- **No cards with drop shadows.** Separation comes from rules, whitespace and the slightly raised paper of a "clipping".

---

## 6. Components

### 6.1 Masthead
`PitchPrism` in Fraunces 900, the edition date in small caps on the right ("THURSDAY 17 OCTOBER 2026 · VARANASI EDITION" = current centre), a hairline spectrum rule underneath, and the day/night edition toggle styled as a tiny ☀ / ☾ switch.

### 6.2 The spectrum bar (signature)

```
 clarity  need   market  feasib.  comp. diff. revenue  ready compl.
 ▓▓▓▓▓░ ▓▓▓▓▓▓▓▓▓░ ▓▓▓▓▓▓░░░ ▓▓▓▓▓▓▓▓▓ ▓▓▓▓░░ ▓▓░░░░ ▓▓▓▓▓▓▓░░ ▓▓▓░ ▓▓▓▓▓░
 └ band width = weight · fill = score/5 · hatched = not assessed · grey = completeness
```

- Nine segments in spectral order, 1px paper gaps between them.
- **Width** = domain weight; **fill** from the left = score ÷ 5; **hatched** = Not assessed (missing ≠ weak, D-11).
- Sizes: 6px tall in lists, 14px on the card, 48px on the hero slide. Hover/focus on a segment shows "Market potential · 3/5 · 2 quotes".
- Clicking a segment scrolls to that domain's evidence.
- Under the bar: potential (big, mono), completeness, coverage, band chip, pathway.

### 6.3 Headline, dateline, standfirst
```
A tailoring unit for Kothapally's school uniforms and boutique orders
KOTHAPALLY, RANGA REDDY · Telugu · PDF + voice · 17 Oct · Tailoring · Cohort: Telangana Oct 2026
Ramesh Goud wants to stitch blouses, kurtis and uniforms from a rented room on the main road,
promising five-day delivery and doorstep pickup against three slower tailors nearby.
```
The headline is generated (Dev 2) from cited fields only — factual, specific, no hype words ("revolutionary", "innovative"). The dateline is computed.

### 6.4 Evidence pull-quote
Each domain gets a short verdict line and its pull-quotes:

```
MARKET POTENTIAL  ▓▓▓▓▓▓▓▓░░ 4/5
"I spoke to 25 households and 4 boutiques within 5 km."
 25 కుటుంబాలతో మరియు 5 కి.మీ పరిధిలోని 4 బొటిక్‌లతో మాట్లాడాను.        ⧉ p.2  ▶ 0:41
```
English in Fraunces italic, original script below at the same size in Noto Serif, source jump on the right: `⧉ p.2` opens the page with the region highlighted, `▶ 0:41` plays the audio from that moment.

### 6.5 Editor's marks (data-quality flags)
Flags live in the **margin** in red pencil, drawn like proof corrections:

| Flag | Mark |
| --- | --- |
| Overwritten | ~~Rs 20,000~~ → **Rs 60,000 per month** — the struck value with a hand-drawn strike (SVG path, slightly wobbly), correction in the margin |
| Missing | ‸ caret with "no answer given" |
| Not asked | ◌ "the form didn't ask this" in graphite, not red — not the applicant's fault |
| Irrelevant | wavy underline + "off-topic: talks about cricket" |
| Implausible | ⁇ "₹1 crore/day vs ₹95,200 invested" |
| Inconsistent | ≠ "D = ₹10,000, but C = ₹50,000" |
| Language mismatch | ⇄ "answered in Telugu" in graphite — information only |
| Low read confidence | ◎ with the image crop |
| Possible duplicate | ⧉⧉ "looks like submission #214 (same contact)" |

The SVG marks are drawn once per kind and reused; each links to its segment.

### 6.6 The wire (live pipeline)
While a card is processing, a narrow column on the right runs like a news wire, newest at top, in mono:

```
11:04:12  READ        24 segments · Telugu, English · page 2 re-read by OCR
11:04:15  TRANSLATED  10 answers from Telugu
11:04:19  CHECKED     1 struck value · 0 missing
11:04:23  COMPARED    3 similar ideas · 1 in the same village
11:04:27  MAPPED      5 tailors within 3 km (OpenStreetMap, today)
11:04:31  SCORED      potential 74 · completeness 92 · Deeper evaluation
```
Each line maps to a `StageEvent`. As each lands, its section of the card "inks in" (§9). In the bulk-import view the wire becomes the whole right rail and shows every file.

### 6.7 The ledger (financial checks)
The EDP financial model as a ruled ledger: label, written value, expected value, status. Figures in Plex Mono, right-aligned, Indian grouping. Mismatches get a red-pencil ≠ and the formula in the margin ("D = C"). Looks like an accountant's book, because that's what the applicant was asked to fill.

### 6.8 The front page (cohort view, W-25)
Ranked stories, newspaper style: lead story (highest potential with high completeness), four teasers, then "In brief" rows with spectrum bars, band, pathway and flags. A sidebar box, "THIS COHORT IN NUMBERS", carries the distributions. A shortlist builder lets the cohort lead "pin to tomorrow's edition".

### 6.9 The quadrant (W-28)
Potential on Y, completeness on X, quadrant labels set like section heads ("READY TO INTERVIEW", "ASK FOR MORE", "MENTOR", "RE-SUBMIT WITH HELP"). Dots are tiny spectrum rings (each ring's arcs = the domains). Hover shows the headline.

### 6.10 The beat (local market map, W-23)
Leaflet on OSM tiles, desaturated and warmed to sit on newsprint (CSS filter: `grayscale(.85) sepia(.15) contrast(.95)`). Radius rings at 1, 3, 10 km as dotted hairlines; similar businesses as small ink dots; the applicant's pin as a spectrum-ringed marker. A caption box beside the map: "**5 tailors** within 3 km on OpenStreetMap (fetched today; rural coverage is incomplete). The applicant named **3**." OSM attribution always visible.

### 6.11 Related coverage (similar ideas, W-22)
Styled like "Related stories" at the foot of an article: headline, place, distance, similarity as a thin bar, status. Duplicates get a red-pencil "same applicant?" tag.

### 6.12 The idea map (W-27)
A full-bleed scatter on night paper — ideas as points of light coloured by trade, clusters labelled in Fraunces italic like constellation names ("Varanasi food stalls", "Guntur organic inputs"). Saturation alerts glow faintly. This is the screenshot for the deck.

### 6.13 Buttons and controls
Text buttons in Inter Tight small caps with an underline that thickens on hover. The primary action ("Shortlist") is ink-filled paper-on-ink. No pill shapes, no gradients, `--radius: 2px`.

---

## 7. The mobile app · "The Radio"

The entrepreneur's app is the same publication's **radio edition**: voice first, words second, English never required.

- **Home** is three huge tiles — Speak, Type, Upload — each with an illustrated icon (lino-cut style, two colours: ink + one spectrum hue) and a speaker button that says its name aloud.
- **Script-native type.** The UI is set in Noto Sans in the chosen script at 20px minimum; headings at 28px. Numbers in the user's numerals where customary (Devanagari, Bengali digits) with Western digits beside money.
- **Recording** is a single large circular button with a live waveform drawn as a spectrum ribbon — the pitch literally becomes the prism's light. Prompt cards show one question each, with a picture and a play button.
- **Plan read-back** looks like a printed pamphlet: a cover with their business name, then one card per section, each with ▶.
- **Idea Passport** looks like a real passport: navy cover, stamps for each organisation that has seen the idea, a big toggle per partner type. Revoking consent "un-stamps" with a small animation.
- **Feedback** arrives as a "letter from your centre": a short audio clip first, text below, one clear next step at the bottom as a big button.
- Tap targets ≥ 56px; works one-handed; no screen depends on reading.

---

## 8. Charts

- Thin ink lines, no gridlines except a hairline baseline, no chart borders.
- **Direct labels** on lines and bars; no legends.
- Small multiples over one crowded chart (cross-cohort comparison: one mini distribution per cohort, shared axis).
- Heatmap (trade × cohort) in a single-hue ink ramp; numbers printed in each cell.
- Distributions as dot strips or box-and-whisker in ink; the current idea as a red-pencil tick.
- Always print `n =` in the caption.

---

## 9. Motion

| Moment | Motion |
| --- | --- |
| A card section's data arrives | "Inks in": opacity 0 → 1 with a 2px upward settle, 240ms, ease-out |
| Score stage lands | Spectrum bar fills left to right once, 600ms, staggered 40ms per domain |
| Wire line arrives | Slides down from the top of the wire, 160ms |
| Editor's mark appears | The red strike draws itself (SVG stroke-dashoffset), 300ms |
| Everything else | Nothing |

Respect `prefers-reduced-motion`: replace all of the above with instant state changes.

---

## 10. Accessibility

- AA contrast on all text in both editions; the spectrum is never the only carrier of meaning (label + number always beside it, hatching for Not assessed).
- Spectrum hues are spaced for common colour-vision deficiencies; checked with a simulator before the demo, and segments have 1px gaps so they're distinguishable without colour.
- Full keyboard path through the queue and card (`j`/`k`, `o`, `1`–`9`); visible focus ring as a 2px ink underline-offset outline.
- `lang` attribute on every original-script span so screen readers switch voice.
- Audio controls have text equivalents; every image crop has alt text from the OCR.

---

## 11. Voice and copy

Write like a good sub-editor: short, concrete, kind.

| Instead of | Write |
| --- | --- |
| "Error: field null" | "No answer was given for suppliers." |
| "Low score: market" | "Market potential: 2 of 5 — no evidence of local demand yet." |
| "AI recommends rejection" | "Suggested next step: mentoring on pricing. You decide." |
| "Invalid input detected" | "These answers don't seem to be about the business. Ask again in Telugu?" |
| "Duplicate!" | "This looks like submission #214 — same phone number, similar idea." |

Never use: "revolutionary", "AI-powered" in the UI, exclamation marks, or anything that sounds like a verdict on the person rather than the plan.

---

## 12. Don'ts

- No rounded SaaS cards with drop shadows, no blue primary buttons, no gradients (except the spectrum, which is discrete).
- No colour on text except red pencil for marks.
- No hiding the original script behind a toggle.
- No number without its evidence one click away.
- No personal details on screenshots or the deck (D-19) — use the redaction blur, which is styled as a black censor bar, very newspaper.
