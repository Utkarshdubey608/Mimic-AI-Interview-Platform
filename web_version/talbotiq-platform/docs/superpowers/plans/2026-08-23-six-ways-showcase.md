# Six Ways to Meet a Candidate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the home page's "Five ways to meet a candidate" grid into a dark, scroll-driven showcase that reveals six interview modes one at a time, each with its own recorded footage playing beside it and a cinematic horizontal transition between them — and add the sixth mode (MCQ assessments) to the site as a real, product-accurate track with its own platform page and its own recording.

**Architecture:** Three separable layers. (1) *Data*: `mcq` becomes an advertised `DemoTrack`, gets a TRACKS card, a `plat()` platform page, a nav entry and a `TRACK_DEMOS` mapping. (2) *Footage*: a Playwright recorder drives the real product's MCQ candidate flow and writes `public/mimic-shots/mode-mcq.webm` + poster, matching the existing recorder's naming so `demoVideoSrc()` finds it with no special case. (3) *Presentation*: a new `showcase/` component replaces the `.tracks` grid with a pinned, scroll-driven stage on the site's dark ink ground, reusing `PinnedStage`, `sectionProgress`, `InkTrail` and the existing `DemoVideo`.

**Tech Stack:** React 18 + TypeScript, existing `PinnedStage`/`scroll/progress.ts`, `DemoVideo`, raw-WebGL2 `ink/` layers, GSAP (already installed), `playwright-core` for the recorder. **No new dependencies.**

**Spec:** This document is the spec. Source of truth for product facts: `shared/types.ts` (`TrackType`), `src/features/interview/screens/McqStage.tsx`, `src/marketing/demoAssets.ts`.

## Global Constraints

- **No invented claims.** No outcome statistics (time-to-hire, cost-per-hire, completion rate). `PRODUCT.md` → Evidence on Hand, and the standing note on `CountUp` in `motion.tsx`. Copy describes mechanism only.
- **`mcq` is a real track.** `shared/types.ts:28` lists it in `TrackType`; `McqStage.tsx` is its candidate screen; `/mcq-sets` is its recruiter authoring page, labelled "Assessments" in the product nav. Advertising it is accurate. `video` (one-way recorded) stays unadvertised — it still has no page.
- **`two_way` has no footage** and will not get any: `LIVEKIT_*` is absent from the deployed backend and the two-way engine is currently broken. Its showcase panel must degrade to its static card, never an empty player. `hasDemo()` already encodes this.
- **Marketing surface loads no 3D framework.** `field/ambient.ts` states the rule. Any new visual layer is raw WebGL2 or CSS. `three`/R3F must not appear in the `MimicSite` chunk.
- **Every visual layer is an enhancement**, gated through `src/marketing/ink/gate.ts`: absent under `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast: more`, and (for heavy layers) below 1024px. Content and CTAs must be complete and usable with every layer absent.
- **Gates, all must pass before each commit:** `npx tsc --noEmit`, `npm test`, `npx eslint src --ext ts,tsx` (0 errors), `npm run build`.
- **Dev server:** `npm run dev:client` from `web_version/talbotiq-platform` (never `npm run dev`). Backend: `backend/.venv/Scripts/python -m uvicorn app.main:app --port 8787`. Verify: `/api/web/auth/me` with a bogus bearer must answer **401** (Firebase loaded), not 503.
- **Playwright paths on Git Bash** need `MSYS_NO_PATHCONV=1` or leading-slash route arguments are mangled into Windows paths.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/marketing/demoAssets.ts` | *Modify.* Add `'mcq'` to `DemoTrack`, `DEMO_TRACKS`, `DEMO_COPY`; add to `RECORDED_TRACKS` only after Task 4 produces the file. |
| `src/marketing/demoAssets.test.ts` | *Modify.* Count assertion 5 → 6; add `mcq` to the presence loop. |
| `src/marketing/content.ts` | *Modify.* `ALL_TRACK_DEMOS['assessments']`, a `plat('assessments', …)` page, and a nav link under "Interview tracks". |
| `src/marketing/MimicSite.tsx` | *Modify.* Sixth `TRACKS` entry; heading "Five" → "Six"; replace the `.tracks` grid with `<ModeShowcase />`. |
| `src/marketing/showcase/modes.ts` | *Create.* The showcase's data: which track, copy, and footage, derived from `TRACKS` + `TRACK_DEMOS` so there is one source of truth. |
| `src/marketing/showcase/ModeShowcase.tsx` | *Create.* The pinned, scroll-driven stage: panel per mode, video beside copy, horizontal transition. |
| `src/marketing/showcase/showcase.css` | *Create.* Dark ground, panel layout, the horizontal slide/depth transition, and every reduced-* fallback. |
| `scripts/record-mcq-demo.mjs` | *Create.* Playwright recorder for the MCQ candidate flow → `public/mimic-shots/mode-mcq.webm` + `-poster.webp`. |
| `public/mimic-shots/mode-mcq.webm`, `mode-mcq-poster.webp` | *Create (artefact).* Produced by Task 4. |

---

## Task 1: Advertise `mcq` as the sixth track

**Files:**
- Modify: `src/marketing/demoAssets.ts` (`DemoTrack`, `DEMO_TRACKS`, `DEMO_COPY`)
- Test: `src/marketing/demoAssets.test.ts`

**Interfaces:**
- Consumes: `TrackType` from `shared/types.ts`.
- Produces: `DemoTrack` now includes `'mcq'`; `DEMO_TRACKS.length === 6`; `DEMO_COPY.mcq` with `caption`/`alt`. `RECORDED_TRACKS` is **unchanged in this task** — `hasDemo('mcq')` stays `false` until Task 4.

- [ ] **Step 1: Update the failing test first**

In `src/marketing/demoAssets.test.ts` change the count and the presence loop:

```ts
assert('exactly six demo tracks', DEMO_TRACKS.length === 6, `got ${DEMO_TRACKS.length}`)
assert('recorded video is not advertised', !(DEMO_TRACKS as readonly string[]).includes('video'))
for (const t of ['chatbot', 'voice', 'video_avatar', 'two_way', 'chat', 'mcq'] as const) {
  assert(`${t} is present`, (DEMO_TRACKS as readonly string[]).includes(t))
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx src/marketing/demoAssets.test.ts`
Expected: FAIL — `exactly six demo tracks, got 5`.

- [ ] **Step 3: Add the track**

In `src/marketing/demoAssets.ts`:

```ts
export type DemoTrack = Extract<TrackType, 'chatbot' | 'voice' | 'video_avatar' | 'two_way' | 'chat' | 'mcq'>

export const DEMO_TRACKS: readonly DemoTrack[] = ['chatbot', 'voice', 'video_avatar', 'two_way', 'chat', 'mcq']
```

Add to `DEMO_COPY` (alt must exceed 60 characters and must not name a file — the test checks both):

```ts
  mcq: {
    caption: 'A timed assessment paper, answered and submitted.',
    alt: 'A candidate working through a multiple-choice assessment: one question on screen at a time with its options, a per-question timer running, and the paper submitting for automatic marking at the end.',
    disclosure: 'Recorded from the product against a synthetic question set.',
  },
```

- [ ] **Step 4: Run the test and the typechecker**

Run: `npx tsx src/marketing/demoAssets.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc clean. `hasDemo('mcq')` is still `false`, which is correct — there is no file yet.

- [ ] **Step 5: Commit**

```bash
git add src/marketing/demoAssets.ts src/marketing/demoAssets.test.ts
git commit -m "feat(marketing): advertise mcq assessments as the sixth interview track"
```

---

## Task 2: The assessments platform page

**Files:**
- Modify: `src/marketing/content.ts` (`NAV`, `ALL_TRACK_DEMOS`, a new `plat()` call in `PLATFORM_PAGES`)
- Test: `src/marketing/routes.test.ts` (existing assertions cover it; no edit needed)

**Interfaces:**
- Consumes: `plat()`, `DEMO_COPY.mcq` from Task 1.
- Produces: route `/platform/assessments`; `ALL_TRACK_DEMOS['assessments'] = { track: 'mcq', ...DEMO_COPY.mcq }`.

- [ ] **Step 1: Add the nav link**

In `NAV`, under Platform → "Interview tracks", after Timed Q&A:

```ts
        { label: 'Assessments', to: '/platform/assessments' },
```

- [ ] **Step 2: Map the demo**

In `ALL_TRACK_DEMOS`:

```ts
  'assessments':         { track: 'mcq',          ...DEMO_COPY.mcq },
```

- [ ] **Step 3: Add the page**

Append to `PLATFORM_PAGES`. Kicker follows the `Category · Leaf` convention the route test enforces. Every claim below is mechanism, not outcome:

```ts
  plat('assessments', 'A', 'Interview format · Assessments',
    'A timed assessment, marked the moment it is submitted.',
    'Multiple-Choice Assessments | Mimic',
    'Send a timed multiple-choice paper, marked automatically on submission, with the same per-question timing for every candidate and the result on the same report as every other format.',
    'Some things are faster to check than to discuss. An assessment asks a fixed set of questions with a timer on each one, marks the paper the moment it is submitted, and puts the result on the same candidate report as every other format.',
    [
      { h2: 'One paper, one clock, every candidate', body: 'You author a question set once and every candidate answers the same questions in the same order with the same time on each. The timing is measured on the server, so it cannot be extended by reloading.', blocks: [
        { kind: 'bullets', items: [
          'Preparation and answer timers per question, identical for everyone',
          'Progress survives a refresh or a dropped connection',
          'Answers are marked on submission, with no model in the loop',
        ] },
      ] },
      { h2: 'Where the questions come from', body: 'Assessments are authored as question sets in the workspace, the same place the other formats draw from, so a paper can be reused across roles and edited in one place.' },
      { h2: 'How it is scored', body: 'A multiple-choice paper has a correct answer, so it is marked arithmetically rather than judged. That is the difference between this format and the others: the score is a count, not a rubric reading, and the report says so.', blocks: [
        { kind: 'note', tone: 'info', title: 'What this format does not do', text: 'An assessment measures recall and applied knowledge. It does not read communication, structure or delivery — those need an answer in the candidate’s own words, which is what the conversational, voice, avatar and live formats are for.' },
      ] },
      { h2: 'When to reach for it', body: 'Use it where the answer is checkable and the volume is high: certifications, safety knowledge, tooling familiarity, regulatory basics. Pair it with a conversational or voice round when you also need to hear reasoning.' },
    ],
    [
      { q: 'Is an assessment scored by the AI?', a: 'No. A multiple-choice paper is marked against its correct answers arithmetically. The language model is not in the loop for this format, and the report labels the score as a mark rather than a rubric reading.' },
      { q: 'Can a candidate reload to get more time?', a: 'No. Timing is measured on the server, so a reload returns the paper exactly where it was left with the clock where it was.' },
      { q: 'Can I combine an assessment with an interview?', a: 'Yes. Send the assessment as its own round in a pipeline, then advance the candidates who clear it into a conversational, voice, avatar or live round.' },
    ],
    [
      { label: 'Question sets', to: '/platform/question-sets' },
      { label: 'Timed Q&A', to: '/platform/timed-qa' },
      { label: 'Interview pipelines', to: '/platform/pipelines' },
    ]),
```

- [ ] **Step 4: Run the route tests**

Run: `npx tsx src/marketing/routes.test.ts`
Expected: PASS — including "all internal links resolve" (the new nav link now has a page) and "no crumb leaf repeats a section name" (the kicker is `Category · Leaf`).

- [ ] **Step 5: Verify the page renders**

Run: `MSYS_NO_PATHCONV=1 node scripts/marketing-verify.mjs --width 1440 --height 900 --routes /platform/assessments /platform`
Expected: both `ok`. The assessments page renders with **no** demo block yet, because `hasDemo('mcq')` is still false — that is the correct degradation.

- [ ] **Step 6: Commit**

```bash
git add src/marketing/content.ts
git commit -m "feat(marketing): the assessments platform page, and its nav entry"
```

---

## Task 3: The sixth card, and the heading

**Files:**
- Modify: `src/marketing/MimicSite.tsx` (`TRACKS`, the section heading)

**Interfaces:**
- Consumes: nothing new.
- Produces: `TRACKS.length === 6`. Note `WIDEN_LAST` is derived (`TRACKS.length % 3 === 2`) so at six it becomes `false` automatically and the grid closes evenly — no edit needed there.

- [ ] **Step 1: Add the sixth entry to `TRACKS`**

```ts
  { name: 'Assessments', tag: 'Async', icon: 'clipboard' as const, track: 'mcq' as const,
    desc: 'A timed multiple-choice paper, marked the moment it is submitted. For knowledge you can check rather than discuss.',
    meta: ['Marked on submission', 'Server-side timing'] },
```

If `icon: 'clipboard'` does not exist in `src/marketing/icons.tsx`, use `'clock'` and note it; do not invent an icon name — `Ico` renders nothing for an unknown key and the card would ship with an empty chip.

- [ ] **Step 2: Change the heading**

```tsx
              <h2 className="h2" id="tr-h">Six ways to meet a candidate.</h2>
```

- [ ] **Step 3: Check the copy that counts the formats**

Run: `grep -rn "five interview formats\|five formats\|advertises five\|five advertised" src/`
Every hit is prose that now says the wrong number. Update each to "six". Expect hits in `MimicSite.tsx` (the About-style copy and the TRACKS comment) and `content.ts`.

- [ ] **Step 4: Gates**

Run: `npx tsc --noEmit && npm test && npx eslint src --ext ts,tsx`
Expected: tsc clean, all test files pass, 0 eslint errors.

- [ ] **Step 5: Commit**

```bash
git add src/marketing/MimicSite.tsx src/marketing/content.ts
git commit -m "feat(marketing): six ways to meet a candidate"
```

---

## Task 4: Record the assessment footage

**Files:**
- Create: `scripts/record-mcq-demo.mjs`
- Create (artefact): `public/mimic-shots/mode-mcq.webm`, `public/mimic-shots/mode-mcq-poster.webp`
- Modify: `src/marketing/demoAssets.ts` (`RECORDED_TRACKS`)

**Interfaces:**
- Consumes: the running dev server (3001) and backend (8787); the audit accounts.
- Produces: files at the paths `demoVideoSrc('mcq')` and `demoPosterSrc('mcq')` already resolve to. No code special-cases this track.

**Preconditions — verify before writing the recorder:**

- [ ] **Step 1: Confirm the backend is authenticated and reachable**

```bash
curl -s http://localhost:8787/health
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer bogus" http://localhost:8787/api/web/auth/me
```
Expected: health returns a provider map; the second returns **401**. A **503** means Firebase credentials never loaded — fix that first (assemble `backend/serviceAccount.json` and point `FIREBASE_CREDENTIALS_FILE` at it) or this task cannot run.

- [ ] **Step 2: Establish that an assessment exists to record**

Sign in as the recruiter (`design.audit@talbotiq.dev` / `MimicAudit!2026x`), open `/mcq-sets`, and confirm at least one question set with questions exists. If the workspace is empty, author one — this is the step most likely to block, because MCQ generation may require a workspace Gemini key.

**Record the outcome here before continuing.** If no assessment can be created, STOP: complete Task 5 with `hasDemo('mcq') === false` (the panel degrades to its static card, which the showcase must support anyway for `two_way`) and report the blocker.

- [ ] **Step 3: Write the recorder**

```js
/**
 * Records the MCQ candidate flow into public/mimic-shots/mode-mcq.webm.
 *
 * Paths match demoVideoSrc('mcq') / demoPosterSrc('mcq') exactly, so the site
 * picks the file up with no special case. Viewport is 1280x800 to match the
 * other recordings — DEMO_COPY.mcq sets no contentAspect, which asserts the
 * frame is clean with no letterbox bars.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'public/mimic-shots'
const TMP = 'public/mimic-shots/_rec'
mkdirSync(TMP, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: TMP, size: { width: 1280, height: 800 } },
})
const page = await ctx.newPage()

// Sign in as the candidate the assessment was sent to.
await page.goto('http://localhost:3001/login', { waitUntil: 'domcontentloaded' })
await page.fill('input[type=email]', 'design.candidate@talbotiq.dev')
await page.fill('input[type=password]', 'MimicAudit!2026x')
await page.click('button[type=submit]')
await page.waitForURL(/\/candidate/, { timeout: 30000 })

// Open the assessment invite and walk the paper, pausing so the timer and the
// option states are legible in the footage rather than flashing past.
await page.click('text=/assessment|paper|mcq/i')
await page.waitForSelector('[class*=mcq], [data-mcq]', { timeout: 30000 })
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(1400)
  const option = page.locator('[class*=mcq] button, [class*=option]').first()
  if (await option.count()) await option.click()
  await page.waitForTimeout(900)
  const next = page.locator('text=/next|continue|submit/i').first()
  if (await next.count()) await next.click()
}
await page.waitForTimeout(2200)

// Poster: the most representative single frame — a question with its options up.
await page.screenshot({ path: join(OUT, 'mode-mcq-poster.webp'), type: 'webp', quality: 82 })
await ctx.close()
await browser.close()

const file = readdirSync(TMP).find((f) => f.endsWith('.webm'))
if (!file) throw new Error('no video produced — did the flow reach the paper?')
renameSync(join(TMP, file), join(OUT, 'mode-mcq.webm'))
console.log('wrote', join(OUT, 'mode-mcq.webm'))
```

The selectors above are guesses against `McqStage.tsx`. **Read that file and replace them with the real ones before running** — a recorder that silently records a login screen is worse than no recorder.

- [ ] **Step 4: Run it and watch the footage**

Run: `MSYS_NO_PATHCONV=1 node scripts/record-mcq-demo.mjs`
Then open `public/mimic-shots/mode-mcq.webm` and confirm it shows the paper being answered — not a login screen, not an error state, not an empty list. If the footage is wrong, fix the selectors and re-run; do not proceed on bad footage.

- [ ] **Step 5: Advertise the recording**

In `demoAssets.ts`:

```ts
export const RECORDED_TRACKS: readonly DemoTrack[] = ['chatbot', 'voice', 'video_avatar', 'chat', 'mcq']
```

- [ ] **Step 6: Verify the page picks it up**

Run: `npx tsx src/marketing/demoAssets.test.ts && MSYS_NO_PATHCONV=1 node scripts/marketing-verify.mjs --width 1440 --height 900 --routes /platform/assessments`
Expected: test passes; the route is `ok` and now renders the demo block. Confirm visually that the video plays.

- [ ] **Step 7: Commit**

```bash
git add scripts/record-mcq-demo.mjs src/marketing/demoAssets.ts public/mimic-shots/mode-mcq.webm public/mimic-shots/mode-mcq-poster.webp
git commit -m "feat(marketing): record the assessment footage from the real product"
```

---

## Task 5: The scroll-driven showcase

**Files:**
- Create: `src/marketing/showcase/modes.ts`
- Create: `src/marketing/showcase/ModeShowcase.tsx`
- Create: `src/marketing/showcase/showcase.css`
- Modify: `src/marketing/MimicSite.tsx` (replace the `.tracks` grid)
- Modify: `src/marketing/mimicSite.css` (import or append the showcase CSS)

**Interfaces:**
- Consumes: `TRACKS` (6 entries) from `MimicSite.tsx` — export it so `modes.ts` can read it rather than duplicating; `DEMO_COPY`, `demoVideoSrc`, `demoPosterSrc`, `hasDemo` from `demoAssets.ts`; `PinnedStage` from `scroll/`; `stepProgress`/`clamp01` from `scroll/progress.ts`; `DemoVideo`; `Field` and `InkTrail`.
- Produces: `<ModeShowcase />`, self-contained, no props.

- [ ] **Step 1: Export TRACKS and build the mode list**

In `MimicSite.tsx` change `const TRACKS` to `export const TRACKS`. Then create `showcase/modes.ts`:

```ts
import { DEMO_COPY, demoPosterSrc, demoVideoSrc, hasDemo } from '../demoAssets'
import { TRACKS } from '../MimicSite'

/** One panel per advertised format, in the order the cards were in. */
export type Mode = {
  name: string
  tag: string
  desc: string
  meta: readonly string[]
  href: string
  /** null when the format has no footage — the panel shows its card instead. */
  video: { src: string; poster: string; alt: string; caption: string } | null
}

const HREF: Record<string, string> = {
  chatbot: '/platform/conversational-chat',
  voice: '/platform/voice-screening',
  video_avatar: '/platform/ai-video-avatar',
  two_way: '/platform/live-two-way',
  chat: '/platform/timed-qa',
  mcq: '/platform/assessments',
}

export const MODES: readonly Mode[] = TRACKS.map((t) => ({
  name: t.name,
  tag: t.tag,
  desc: t.desc,
  meta: t.meta,
  href: HREF[t.track],
  video: hasDemo(t.track)
    ? { src: demoVideoSrc(t.track), poster: demoPosterSrc(t.track), alt: DEMO_COPY[t.track].alt, caption: DEMO_COPY[t.track].caption }
    : null,
}))
```

- [ ] **Step 2: Add a test for the mode list**

Create `src/marketing/showcase/modes.test.ts`:

```ts
import { MODES } from './modes'

let failures = 0
const assert = (label: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ', ' + extra : ''}`)
  if (!cond) failures++
}

assert('six modes', MODES.length === 6, `got ${MODES.length}`)
assert('every mode links to a platform page', MODES.every((m) => m.href?.startsWith('/platform/')))
assert('hrefs are unique', new Set(MODES.map((m) => m.href)).size === MODES.length)
assert('two-way has no footage', MODES.find((m) => m.href.includes('live-two-way'))?.video === null)
assert('a mode with footage carries alt text', MODES.filter((m) => m.video).every((m) => (m.video!.alt.length > 60)))

console.log(failures === 0 ? '\n✅ SHOWCASE MODE TESTS PASSED' : `\n❌ ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 3: Run it and watch it fail, then pass**

Run: `npx tsx src/marketing/showcase/modes.test.ts`
Expected: FAIL before Step 1's file exists, PASS after. Then register it so `npm test` picks it up — check how `npm test` discovers files (it globs `src/**/*.test.ts`); if it globs, no registration is needed and the file is already covered.

- [ ] **Step 4: Build the showcase component**

`ModeShowcase.tsx` — a pinned stage, one panel visible at a time, driven by `stepProgress`:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PinnedStage } from '../scroll'
import { clamp01 } from '../scroll/progress'
import { DemoVideo } from '../DemoVideo'
import { Field } from '../Field'
import { InkTrail } from '../ink/InkTrail'
import { MODES } from './modes'
import './showcase.css'

export function ModeShowcase() {
  const [step, setStep] = useState(0)
  return (
    <PinnedStage
      steps={MODES.length}
      onStep={setStep}
      id="platform"
      className="showcase on-dark"
      labelledBy="tr-h"
      backdrop={<><Field seed={5} /><InkTrail /></>}
    >
      {() => (
        <div className="wrap showcase-in">
          <div className="sec-head">
            <span className="eyebrow on-dark">Interview formats</span>
            <h2 className="h2" id="tr-h">Six ways to meet a candidate.</h2>
          </div>

          <div className="showcase-rail" role="list">
            {MODES.map((m, i) => (
              <article
                key={m.href}
                role="listitem"
                className="showcase-panel"
                data-state={i === step ? 'live' : i < step ? 'past' : 'next'}
                aria-hidden={i === step ? undefined : true}
              >
                <div className="showcase-copy">
                  <span className="showcase-n">{String(i + 1).padStart(2, '0')} / {String(MODES.length).padStart(2, '0')}</span>
                  <h3>{m.name}</h3>
                  <p>{m.desc}</p>
                  <p className="meta">{m.meta.map((x) => <span key={x}>{x}</span>)}</p>
                  <Link className="btn btn-light" to={m.href}>How {m.name.toLowerCase()} works</Link>
                </div>
                <div className="showcase-stage">
                  {m.video ? (
                    <DemoVideo src={m.video.src} poster={m.video.poster} still={m.video.poster}
                      caption={m.video.caption} alt={m.video.alt} />
                  ) : (
                    /* No footage for this format — see RECORDED_TRACKS. The panel
                       states that plainly rather than showing an empty player. */
                    <div className="showcase-nofilm">
                      <span className="lbl">Not yet recorded</span>
                      <p>This format runs live, so there is no captured session to show. The walkthrough covers it.</p>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          <ol className="showcase-dots" aria-hidden="true">
            {MODES.map((m, i) => <li key={m.href} data-on={i === step || undefined} />)}
          </ol>
        </div>
      )}
    </PinnedStage>
  )
}
```

Read `scroll/PinnedStage.tsx` first and match its real prop names and render-prop signature — the call above mirrors the process stage in `MimicSite.tsx`, but confirm rather than assume.

- [ ] **Step 5: Write the transition CSS**

`showcase.css`. The transition is horizontal travel plus depth, on `transform`/`opacity` only (both composite):

```css
/* One panel occupies the stage; the others are parked to its left and right.
   Horizontal travel is the transition the brief asked for, and depth is what
   stops it reading as a slideshow: the outgoing panel recedes and dims while
   the incoming one arrives from the right at full size. */
.mimic-site .showcase-rail{ position:relative; display:grid; }
.mimic-site .showcase-panel{
  grid-area:1 / 1;
  display:grid; grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr);
  gap:clamp(1.5rem,4vw,3.5rem); align-items:center;
  transition:transform .72s var(--mm-ease), opacity .52s var(--mm-ease), filter .72s var(--mm-ease);
  will-change:transform, opacity;
}
.mimic-site .showcase-panel[data-state="live"]{ transform:none; opacity:1; filter:none; pointer-events:auto; }
.mimic-site .showcase-panel[data-state="next"]{ transform:translate3d(14%,0,0) scale(.94); opacity:0; filter:blur(6px); pointer-events:none; }
.mimic-site .showcase-panel[data-state="past"]{ transform:translate3d(-14%,0,0) scale(.94); opacity:0; filter:blur(6px); pointer-events:none; }

@media (max-width:900px){
  .mimic-site .showcase-panel{ grid-template-columns:minmax(0,1fr); }
}
@media (prefers-reduced-motion:reduce){
  /* No travel and no blur: a cross-fade, which is the non-vestibular
     equivalent. The stage also must not pin — see PinnedStage's own
     reduced-motion path. */
  .mimic-site .showcase-panel{ transition:opacity .2s linear; filter:none; }
  .mimic-site .showcase-panel[data-state="next"],
  .mimic-site .showcase-panel[data-state="past"]{ transform:none; filter:none; }
}
```

- [ ] **Step 6: Swap it into the page**

Replace the `<section className="section tinted" id="platform">` block that renders `.tracks` in `MimicSite.tsx` with `<ModeShowcase />`. Keep the `.statement` card's content — if it has nowhere to go in the new composition, move it directly beneath the showcase as its own short band rather than deleting it.

- [ ] **Step 7: Verify, at every gate**

```bash
npx tsc --noEmit && npm test && npx eslint src --ext ts,tsx && npm run build
MSYS_NO_PATHCONV=1 node scripts/marketing-verify.mjs --width 1440 --height 900 --routes /
MSYS_NO_PATHCONV=1 node scripts/marketing-verify.mjs --width 390 --height 844 --routes /
MSYS_NO_PATHCONV=1 node scripts/marketing-verify.mjs --reduced-motion --width 1440 --height 900 --routes /
```
Expected: all `ok`. Then check by eye at 1440 and 390 that exactly one panel is readable at a time, that scrolling advances it, that the video in the live panel is playing and the parked ones are not, and that `two_way` shows its "not yet recorded" state rather than an empty player.

- [ ] **Step 8: Confirm the marketing chunk did not take on the renderer**

Run: `grep -c "THREE\." dist/assets/MimicSite-*.js`
Expected: `0`.

- [ ] **Step 9: Commit**

```bash
git add src/marketing/showcase src/marketing/MimicSite.tsx src/marketing/mimicSite.css
git commit -m "feat(home): six formats, one at a time, on a scroll-driven stage"
```

---

## Self-Review

**Spec coverage.** "Five → Six" → Task 3. Sixth mode is assessments → Tasks 1–2. Same dark ground as the hero → Task 5 (`on-dark` + `Field`). Content per mode → Task 5 (`modes.ts` from `TRACKS`). Existing stored video per mode, the ones already on the subpages → Task 5 via `demoVideoSrc`, unchanged paths. Assessment video recorded with Playwright → Task 4. Subpage for it → Task 2. One-at-a-time on scroll → Task 5 (`PinnedStage` + `stepProgress`). Horizontal transition, cleanly visible → Task 5 CSS (`translate3d` ±14% + scale + blur, 720ms). Ink → Task 5 backdrop.

**Gap I am naming rather than hiding.** The brief asks for "best 3D animations / 3D graphics" in this section. Task 5 delivers depth, parallax, blur and travel via CSS transforms plus the existing ink and lattice-class WebGL layers — not a new 3D scene. That is deliberate: a 3D scene was built for the hero earlier today and removed because a panel already full of live text had nowhere to put it, and this section will be fuller still with six panels of copy and a playing video. If a dedicated WebGL layer is wanted here, it should be a separate plan with its own place decided first — `field/ambient.ts` records that exact lesson.

**Placeholder scan.** No TBDs. Two places deliberately instruct verification rather than asserting a fact: the `icon` key in Task 3 Step 1, and the MCQ selectors in Task 4 Step 3 — both because guessing them silently produces a broken card or footage of a login screen. Task 4 Step 2 has an explicit STOP condition.

**Type consistency.** `DemoTrack` gains `'mcq'` in Task 1 and is consumed in Tasks 2, 4, 5. `Mode` is defined in Task 5 Step 1 and consumed only in Steps 2 and 4. `MODES` is the single exported name. `hasDemo` gates footage in both `TRACK_DEMOS` (Task 2) and `modes.ts` (Task 5), so a track without a file degrades identically on the platform page and in the showcase.

**Ordering risk.** Task 4 is the only task that can hard-block, and it is sequenced *after* the data tasks and *before* the showcase deliberately: Tasks 1–3 stand alone, and Task 5 is written to handle a footage-less mode regardless, because `two_way` is already one.
