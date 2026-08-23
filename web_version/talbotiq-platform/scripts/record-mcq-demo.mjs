/**
 * RECORDER — the ASSESSMENT (MCQ) film.
 *
 *   node scripts/record-mcq-demo.mjs        # dev server must be on :3001
 *
 * Writes public/mimic-shots/mode-mcq.webm + mode-mcq-poster.webp, which are the
 * paths demoVideoSrc('mcq') and demoPosterSrc('mcq') already resolve to.
 *
 * It films /__mcq-take, the dev-only route that mounts the real candidate MCQ
 * screen with its three API calls intercepted here — so this needs no workspace
 * data, no recruiter login and no model key, and it writes nothing anywhere.
 *
 * ONE THING HAD TO BE FIXED IN THE PRODUCT FIRST. The Next and Submit buttons
 * carried `text-on-action`, which is not a class this Tailwind config defines —
 * `action.ink` is the token, so the class is `text-action-ink`. The label
 * inherited its colour from the button's own near-white background and measured
 * at contrast 1.00: a blank white pill, for every candidate sitting an
 * assessment, not just in this film. The selected-answer tick had it too.
 *
 * ── EVERYTHING BELOW IS MEASURED, NOT ASSUMED ─────────────────────────────
 *
 * The three recorder-produced films on disk (measured with the ffmpeg bundled
 * with Playwright, at %LOCALAPPDATA%/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe):
 *
 *   mode-chatbot.webm  1280x800  vp9  DAR 8:5  26.50s  729 kb/s  encoder: Chrome
 *   mode-voice.webm    1280x800  vp9  DAR 8:5  12.27s  735 kb/s  encoder: Chrome
 *   mode-chat.webm     1280x800  vp9  DAR 8:5  17.47s  841 kb/s  encoder: Chrome
 *   (mode-video_avatar.webm is 3840x2160 and hand-captured — not the pattern)
 *
 *   posters: all 1400x875 webp (= exactly 8:5, the film's own aspect;
 *   DemoVideo renders the still at width={1400} height={800*1400/1280=875})
 *
 * `encoder: Chrome` + `alpha_mode: 1` is the signature of Chrome's own WebM
 * muxer, i.e. in-page MediaRecorder — NOT Playwright's recordVideo, which tags
 * the file `ENCODER: Lavf` and emits VP8 at 25fps. Both MediaRecorder routes
 * were tried and neither is usable here:
 *   · tab capture (getDisplayMedia displaySurface:'browser', preferCurrentTab,
 *     --auto-accept-this-tab-capture) grants a track whose getSettings() is only
 *     { deviceId: 'web-contents-media-stream://…' } and delivers ZERO frames —
 *     reproduced twice, with occlusion disabled and a forced rAF repaint.
 *   · monitor capture DOES deliver frames but getSettings() reports
 *     displaySurface:'monitor', deviceId:'screen:0:0' — it films the whole
 *     desktop. Disqualified: it would put the operator's screen in a public asset.
 * And the bundled ffmpeg cannot transcode to VP9 — `-encoders` lists libvpx VP8
 * only, `-decoders` likewise, and there is no webp encoder either.
 *
 * So this recorder uses recordVideo and the output is VP8 / 25fps, 1280x800,
 * DAR 8:5. VP8-in-WebM plays anywhere VP9 does and came out SMALLER per second
 * than the VP9 files. The one real cost is smoothness on framer-motion's 220ms
 * question transition. Nothing in the site cares about the codec: DemoVideo just
 * sets <video width={1280} height={800}> and DEMO_COPY.mcq sets no
 * contentAspect, which is the correct declaration for a clean 1280x800 frame —
 * a letterboxed file would need contentAspect the way video_avatar does.
 *
 * ── DEFECT THAT MUST BE FIXED IN src BEFORE THIS FOOTAGE SHIPS ────────────
 * McqStage.tsx lines 304, 341, 350 use `text-on-action`. That class does not
 * exist: tailwind.config.js exposes the token as action.ink → `text-action-ink`
 * (22 correct uses elsewhere in src). So Next / Submit assessment inherit --ink,
 * which on the dark room ground is #EDF1F8 — the identical value to --action,
 * the button's own background. MEASURED CONTRAST RATIO: 1.00. The primary CTA
 * films as a blank white pill and the chosen-option tick is invisible.
 * FORCE_CTA below patches it at runtime so the beats can be rehearsed; set it
 * false and fix the three class names before recording the shipping file.
 */
import { chromium } from 'playwright'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const OUT = 'public/mimic-shots'
const TMP = '.artifacts/out/_rec'
const BASE = 'http://localhost:3001'
const TRACK = 'mcq'

/** Runtime patch for the text-on-action defect. Set false once src is fixed. */
const FORCE_CTA = true

/**
 * Seconds of app-shell to cut off the front.
 *
 * MEASURED, by extracting a frame every 400ms from an untrimmed run: the frame
 * is a flat WHITE 1280x800 (PNG 4.8 KB) until 1.8s, partial at 2.2s, and the
 * paper is fully painted at 2.6s. That white is real — RouteFallback paints
 * `bg-background` while Vite serves the module graph — but it is a white flash
 * opening a dark film, and none of the existing films have one (their first
 * frame is already the interview screen: mean luma 238-241 at t=0).
 *
 * It cannot be avoided by starting the capture later: recordVideo begins when
 * the CONTEXT is created and there is no way to defer it. So it is cut
 * afterwards. Re-encode, not `-c copy` — a stream copy leaves the leading
 * keyframe and the trimmed file still opens white (verified).
 */
const TRIM_SECONDS = 2.6

/** Playwright's own ffmpeg. VP8-capable, which is all the trim needs. */
const FFMPEG = join(
  process.env.LOCALAPPDATA ?? '',
  'ms-playwright', 'ffmpeg-1011', 'ffmpeg-win64.exe',
)

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

/* ── The paper ─────────────────────────────────────────────────────────────
   Each question is exactly McqQuestionPublic from shared/types.ts:
   { id, text, type: 'single'|'multi'|'match', options: McqOption[], points,
     code?, prompts?, matches? }. There is no answer-key field in that shape at
   all — the server builds it by allow-list — so a mock cannot leak one even by
   accident, and e2e/mcq-candidate.spec.ts asserts the page never renders one.

   Same synthetic nursing scenario as the chat and voice films, so the five read
   as one candidate in one product. Four options rather than three: measured, a
   3-option question leaves 359px of empty dark ground at 1280x800, four leaves
   ~200px, and the code-snippet question leaves almost none. */
const QUESTIONS = [
  {
    id: 'q1',
    type: 'single',
    points: 1,
    text: 'A patient just out of surgery is agitated and needs moving to a quieter bay. What do you do first?',
    options: [
      { id: 'a', text: 'Check airway, breathing and pain score, then move them with a colleague.' },
      { id: 'b', text: 'Move them immediately — the noise is what is agitating them.' },
      { id: 'c', text: 'Ask the on-call to prescribe sedation before anything else.' },
      { id: 'd', text: 'Wait for the next observation round and reassess then.' },
    ],
  },
  {
    id: 'q2',
    type: 'multi',
    points: 1,
    text: 'Which of these must be in the handover note?',
    options: [
      { id: 'a', text: 'Current medication and the time of the last dose' },
      { id: 'b', text: 'Known allergies' },
      { id: 'c', text: 'Outstanding investigations and who is chasing them' },
      { id: 'd', text: 'The ward’s WiFi password' },
    ],
  },
  {
    id: 'q3',
    type: 'single',
    points: 2,
    text: 'What does this infusion-rate calculation return for a 70 kg patient at 0.5 mcg/kg/min?',
    // `code` is part of McqQuestionPublic and renders in a monospace, scrollable
    // <pre>. It is in the film because it is the beat that says "not just
    // trivia", and because it fills the frame.
    code: 'rate_ml_hr = (dose_mcg_kg_min * weight_kg * 60)\n             / concentration_mcg_ml\n\ndose_mcg_kg_min   = 0.5\nweight_kg         = 70\nconcentration     = 1000   # mcg per mL',
    options: [
      { id: 'a', text: '2.1 mL/hour' },
      { id: 'b', text: '21 mL/hour' },
      { id: 'c', text: '0.21 mL/hour' },
      { id: 'd', text: '210 mL/hour' },
    ],
  },
  {
    id: 'q4',
    type: 'single',
    points: 1,
    text: 'Two patients need you at the same moment. Which do you attend first?',
    options: [
      { id: 'a', text: 'The one whose condition has changed since the last observation.' },
      { id: 'b', text: 'The one who called first.' },
      { id: 'c', text: 'The one whose scheduled observation is now due.' },
      { id: 'd', text: 'Whichever bay is closer.' },
    ],
  },
]

/** McqPaperState. `sections: null` is deliberate — the type says null means
 *  "unsectioned, do not guess". perQuestionSeconds/totalSeconds are omitted
 *  because McqStage reads NEITHER (grep: no reader anywhere in src). */
const PAPER = {
  sessionId: 'e2e-session',
  status: 'in_progress',
  questions: QUESTIONS,
  sections: null,
  answers: {},
  submittedAt: null,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── The API. Exactly three endpoints, and no others ───────────────────────
   Verified by logging every /api/ request the harness makes: the ONLY ones are
   the three below. Paths are httpBase() + api.ts's mcqSessionApi, i.e.
   '/api/web' + '/sessions/e2e-session/mcq…' — no auth, no /auth/me (the
   harness route sits outside AuthedApp), no branding fetch.

   The handler must REMEMBER, and must be idempotent: React 18 StrictMode fires
   McqStage's load effect twice in dev, so the GET is served twice per page load
   (measured). A handler that reset state on GET would wipe the first answer. */
function makeServer() { return { answers: {}, saves: 0, submitted: false } }

async function mockApi(page, server) {
  await page.route('**/api/web/sessions/**/mcq**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    // POST /api/web/sessions/e2e-session/mcq/answers
    //   body    { answers: Record<string, string[] | Record<string,string>> }
    //   returns { ok: boolean, saved: number }
    if (path.endsWith('/mcq/answers')) {
      server.saves += 1
      server.answers = req.postDataJSON().answers ?? {}
      return json({ ok: true, saved: Object.keys(server.answers).length })
    }

    // POST /api/web/sessions/e2e-session/mcq/submit
    //   body    { answers } — McqStage always sends them, never trusting the
    //           last debounced auto-save
    //   returns McqPaperState with status 'completed' and submittedAt set;
    //           either one flips McqStage to <Completion/>
    if (path.endsWith('/mcq/submit')) {
      const late = req.postDataJSON()?.answers
      if (late) server.answers = late
      server.submitted = true
      // 550ms of deliberate latency so the button's Loader2 spinner is legible
      // instead of the screen cutting straight to the completion card.
      await sleep(550)
      return json({
        ...PAPER, status: 'completed', answers: server.answers,
        submittedAt: new Date().toISOString(), result: null,
      })
    }

    // GET /api/web/sessions/e2e-session/mcq → McqPaperState
    return json({
      ...PAPER,
      answers: server.answers,
      submittedAt: server.submitted ? new Date().toISOString() : null,
    })
  })
}

/** The runtime equivalent of fixing `text-on-action` in McqStage.tsx. */
const CTA_FIX = `
  .max-w-2xl button.bg-action { color: var(--on-action) !important; }
  [role=radio][aria-checked=true] > span[aria-hidden],
  [role=checkbox][aria-checked=true] > span[aria-hidden] { color: var(--on-action) !important; }
`

/* ── Beat sheet ────────────────────────────────────────────────────────────
   Dwells sum to 14.9s. Measured overhead on top of the dwells — goto, the
   waitFor calls, Playwright's actionability checks, the mocked submit latency —
   is ~4.7s, and the trim removes 2.6s, so the shipped file lands ~19.5-20s:
   inside the existing band (voice 12.3s → chat 17.5s → chatbot 26.5s).

   Every dwell has a reason. Nothing is padded to reach a length.

     paper up, Q1 and four options readable                        1700ms
     hover A (border lifts to rule-strong), then choose it           320 + 1400
       → tick fills, rail animates 300ms, count goes 1 of 4
     Next → framer 220ms slide, Q2, "Select all that apply."        1300ms
     choose two, 450ms apart → both stay lit, count 2 of 4           450 + 1000
     Next → Q3, the code snippet. LONGEST DWELL: it has to be
       readable, and it is the beat that says the paper is not
       multiple-choice trivia                                       2400ms
     choose an option                                               1000ms
     Next → Q4, the LAST question: this is where Submit appears
       and where the "1 question still unanswered" warning does     1800ms
     answer it → warning clears, rail hits 100%, 4 of 4             1400ms
     press Submit → Loader2 spinner over the mocked 550ms            800ms
     the completion card: "All done, thank you."                    2300ms
     close — WELL before ReturnToSite's 20s countdown navigates to
       the marketing site, which would otherwise be in the film      */

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: TMP, size: { width: 1280, height: 800 } },
  deviceScaleFactor: 1,             // 1280x800 CSS px == 1280x800 video px
  reducedMotion: 'no-preference',   // the 220ms question slide is part of the film
})
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const server = makeServer()
await mockApi(page, server)
await page.goto(`${BASE}/__mcq-take`, { waitUntil: 'domcontentloaded' })
if (FORCE_CTA) await page.addStyleTag({ content: CTA_FIX })

// Selectors read off McqStage.tsx, not guessed. The options are <button>s with
// role=radio (single) or role=checkbox (multi); the header text is
// `Question {i+1} of {n}`; the CTAs are named Next / Submit assessment / Back.
await page.getByText('Question 1 of 4').waitFor({ timeout: 20000 })
await page.getByRole('heading', { level: 1 }).waitFor()
await sleep(1700)

const radios = () => page.getByRole('radio')
const boxes = () => page.getByRole('checkbox')
const next = () => page.getByRole('button', { name: 'Next' })

// Q1 — single answer.
await radios().nth(0).hover()
await sleep(320)
await radios().nth(0).click()
await sleep(1400)

// Q2 — multi-select.
await next().click()
await page.getByText('Select all that apply.').waitFor()
await sleep(1300)
await boxes().nth(0).click()
await sleep(450)
await boxes().nth(1).click()
await sleep(1000)

// Q3 — the code snippet.
await next().click()
await page.locator('pre code').waitFor()
await sleep(2400)
await radios().nth(1).click()
await sleep(1000)

// Q4 — the last question. Submit and the unanswered warning appear together.
await next().click()
await page.getByRole('button', { name: 'Submit assessment' }).waitFor()
await page.getByText(/1 question still unanswered/).waitFor()
await sleep(1800)
await radios().nth(0).click()
await sleep(1400)

// Submit, and the shared completion screen every track ends on.
await page.getByRole('button', { name: 'Submit assessment' }).click()
await sleep(800)
await page.getByText('All done, thank you.').waitFor({ timeout: 15000 })
await sleep(2300)

const filmServer = { ...server }
await ctx.close()     // flushes and finalises the .webm

/* ── Poster ────────────────────────────────────────────────────────────────
   A SECOND context at 1400x875, because that is what the existing posters
   measure (all three recorder-made ones are exactly 1400x875 = 8:5, and
   DemoVideo renders the still at width={1400} height={875}). Screenshotting the
   1280x800 recording context would make this the only poster at that size.

   Frame: Q1 with the answer chosen and the save confirmed. Options readable,
   tick filled, rail started — which is what DEMO_COPY.mcq's caption describes.
   Note `still` and `poster` are the SAME file for a track (FormatShowcase passes
   `still={m.video.poster}`), so there is no third asset to produce. */
const shotServer = makeServer()
const shotCtx = await browser.newContext({ viewport: { width: 1400, height: 875 }, deviceScaleFactor: 1 })
const shot = await shotCtx.newPage()
await mockApi(shot, shotServer)
await shot.goto(`${BASE}/__mcq-take`, { waitUntil: 'domcontentloaded' })
if (FORCE_CTA) await shot.addStyleTag({ content: CTA_FIX })
await shot.getByText('Question 1 of 4').waitFor({ timeout: 20000 })
await shot.getByRole('radio').nth(0).click()
await shot.getByText('Answers saved').waitFor()
await sleep(700)     // let the rail finish its 300ms width transition
await shot.screenshot({ path: join(OUT, `mode-${TRACK}-poster.webp`), type: 'webp', quality: 82 })
await shotCtx.close()
await browser.close()

/* ── Finalise: rename, then trim the white app-shell off the front ─────── */
const raw = readdirSync(TMP).find((f) => f.endsWith('.webm'))
if (!raw) throw new Error('no video produced — did the flow reach the paper?')
const untrimmed = join(TMP, raw)
const final = join(OUT, `mode-${TRACK}.webm`)

execFileSync(FFMPEG, [
  '-hide_banner', '-loglevel', 'error',
  '-ss', String(TRIM_SECONDS), '-i', untrimmed,
  '-c:v', 'libvpx', '-b:v', '900k', '-crf', '30',
  '-deadline', 'good', '-cpu-used', '2', '-auto-alt-ref', '0',
  '-an', '-y', final,
], { stdio: 'inherit' })

rmSync(TMP, { recursive: true, force: true })

// `ffmpeg -i` with no output file always exits 1 — it is being used as a probe,
// so the non-zero exit is expected and the useful text is on stderr.
let probe = ''
try { execFileSync(FFMPEG, ['-hide_banner', '-i', final], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
catch (e) { probe = String(e.stderr ?? '') }
console.log('film   ', final, statSync(final).size, 'bytes')
console.log('poster ', join(OUT, `mode-${TRACK}-poster.webp`), statSync(join(OUT, `mode-${TRACK}-poster.webp`)).size, 'bytes')
console.log('answers', JSON.stringify(filmServer))
console.log('errors ', errors.length ? errors : 'none')
console.log(probe)
