# TalbotIQ — authenticated product redesign: audit

Recorded from the repository at `web_version/talbotiq-platform`, verified against
a clean `tsc --noEmit` (exit 0), `npm run build` (exit 0, 1m10s) and `npm test`
(all 48 suites pass) on 2026-08-18. Nothing below is asserted from a plan
document; every count is grep-verified against `src/`.

---

## 0. Baseline gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 — 1m10s |
| `npm test` (`scripts/verify-deploy.mjs`) | 48 suites, all pass |
| `npm run lint` | **not runnable** — ESLint 8 installed, no config file present |

Largest built chunks: `vendor-firebase` 668K · `three.module` 668K ·
`ReportPage` 612K · `LiveKitVideoTile` 524K · `IntroCanvas` 356K ·
recharts 344K · `RichTextEditor` 336K. Global CSS 76K. Total `dist/` 23 MB.

Route-level code splitting is already in place and well reasoned (`App.tsx`);
Firebase is correctly held behind `AuthedApp`.

---

## 1. Information architecture — every route

### Public (no identity required)

| Route | Component | Notes |
|---|---|---|
| `/` | `marketing/MimicSite` | marketing home |
| `*` | `marketing/MarketingPage` | catch-all marketing |

### Entry

| Route | Component | Notes |
|---|---|---|
| `/login` | `features/auth/LoginPage` + `features/intro/MimicIntro` | WebGL splash overlays the form; form paints first |
| `/access-denied` | `features/auth/AccessDenied` | |
| `/workspace` | `guards.HomeRedirect` | role-based redirect |

### Candidate (`RequireCandidate`)

| Route | Component |
|---|---|
| `/candidate` | `features/candidate/CandidateHome` |
| `/take/:sessionId` | `features/interview/TakeInterviewPage` |

`TakeInterviewPage` is the state machine for the whole candidate journey:
`track → welcome → resume → systemcheck` pre-flight, then one of seven runtime
stages, then `Completion`.

### Recruiter (`RequireRecruiter`)

| Route | Component | Inside `RecruiterShell`? |
|---|---|---|
| `/live/:id` | `recruiter/LiveInterviewPage` | **no** — full-bleed dark host room |
| `/sessions` | `recruiter/SessionsPage` | yes |
| `/sessions/new` | `recruiter/InviteWizard` | yes |
| `/sessions/:id/report` | `recruiter/ReportPage` | yes |
| `/pipelines` | `recruiter/PipelinesPage` | yes |
| `/pipelines/:id` | `recruiter/PipelineBoardPage` | yes |
| `/templates` | `recruiter/TemplatesPage` | yes |
| `/templates/:id` | `recruiter/TemplateEditorPage` | yes |
| `/question-sets` | `recruiter/QuestionSetsPage` | yes |
| `/analytics` | `pages/AnalyticsPage` | yes |
| `/setup` | `pages/SetupPage` (Avatar studio) | yes |
| `/interview` | `avatar-screening/AvatarScreeningGate` → `pages/InterviewPage` | yes |
| `/results` | `pages/ResultsPage` (avatar screening results) | yes |
| `/replicas` | `pages/ReplicasPage` | yes |
| `/personas` | `pages/PersonasPage` | yes |
| `/settings` | `pages/SettingsPage` | yes |

Nav exposes seven of these sixteen. `/interview`, `/results`, `/replicas`,
`/personas` are routable but unlisted — reachable only from Avatar studio.

### The seven interview modes and where they render

| Mode | `track` key | Stage component | Surface |
|---|---|---|---|
| Timed Q&A | `chat` | `screens/QuestionStage` | light card in `InterviewShell` |
| AI chatbot | `chatbot` | `screens/ChatbotStage` | light, **own full screen** |
| Voice | `voice` | `screens/VoiceStage` | light card, **own full screen** |
| Recorded video | `video` | `screens/VideoStage` | light card in `InterviewShell` |
| Avatar / AI video | `video_avatar` | `screens/AvatarStage` | **dark** `bg-brand-black`, own full screen |
| Two-way live | `two_way` | `screens/TwoWayStage` | **dark** `bg-brand-black`, own full screen |
| Two-way, recruiter side | — | `recruiter/LiveInterviewPage` | **dark**, outside the shell |

---

## 2. Shared visual system as it actually ships

Source of truth: `tailwind.config.js`, `src/index.css`, `src/components/ui/index.tsx`.

The system in the code is **"THE RECORD"** — a legal-evidence-bundle metaphor:

- **Ground** `#EEF0F4` (desk) · **surface** `#FFFFFF` (record page) · **rule** `#E3E6ED`
- **Primary** registrar ink `#1D3FA0` · **ink** `#0E1420`
- **Exhibit ramp** — six functional colours, one per interview format:
  chat `#B45309` · chatbot `#0F766E` · voice `#4338CA` · avatar `#BE185D` ·
  video `#15803D` · two-way `#0369A1`
- **Dark surfaces** via legacy `brand.*` keys: `brand.black #0E1420`,
  `brand.card #1A2231`, `brand.border #2A3446`, `brand.gold #8AA6F0` (accent on dark)
- **Type** Archivo (one family; display voice is the same face at
  `font-stretch: 118%`) plus Chivo Mono for machine values only
- **Radii** deliberately squared: 2 / 3 / 4 / 5 / 6 / 8 / 10px — no pills
- **Shadows** ink-toned, offset plus soft blur

### Primitives in `components/ui/index.tsx` (490 lines)

`cn` · `Button` (6 variants × 4 sizes) · `Input` · `Textarea` · `Select` ·
`Toggle` · `Slider` · `Badge` · `Card` · `SectionTitle` · `PageHeader` ·
`RecordSection` · `ExhibitTab` · `Citation` · `StatCard` · `Modal` ·
`JsonPreview` · `EmptyState` · `Skeleton` · `RecordRows` · `ErrorState` ·
`Divider` · `InfoRow`. Imported by 39 files.

**Absent from the primitive set**, and therefore hand-rolled per page:
table, filter bar, pagination, tabs, drawer, side panel, split pane, toast
wrapper, command bar / palette, date-range control, confirmation flow,
interview transport controls, connection-quality indicator, identity chip,
step indicator, breadcrumb.

---

## 3. Findings

### 3.1 The system is designed but only half-shipped — the largest single issue

The two signature affordances of The Record exist as components and are
essentially not used:

| Primitive | Files using it, excluding its own definition |
|---|---|
| `RecordSection` | **0** |
| `Citation` | **1** (`SessionsPage`) |
| `ExhibitTab` | **4** (`SessionsPage`, `TemplatesPage`, `CandidateHome`) |
| `StatCard` | sparse |

Every workspace page still hand-builds its own section headers, so "one coherent
visual system" is currently a property of the token file rather than of the
screens.

### 3.2 The stated shape grammar is contradicted 191 times

`index.css` states "Nothing in this world is pill-shaped." `rounded-full`
appears **191 times across 20 files** — `LiveInterviewPage` 20, `ReportPage` 15,
`ResultsPage` 14, `AnalyticsPage` 13, `TemplateEditorPage` 13, `MimicGuide` 13,
`InviteWizard` 12, `TemplatesPage` 8, `GenerateFromResumeModal` 8.

### 3.3 Token bypass — roughly 200 hardcoded hex literals in TSX

Heaviest: `ResultsPage` 28 · `AnalyticsPage` 27 · `EmotionTimeline` 12 ·
`FacialAnalysisPanel` 12 · `PerQuestionCard` 10 · `LiveEmotionBar` 10 ·
`ReportPage` 9 · `ATSScorecardPanel` 7 · `EmotionRadar` 7.
The entire analysis-panel family (`components/hume/*`, `components/ats/*`) and
both analytics surfaces will not re-skin with the token layer.

### 3.4 The design documentation describes a product that no longer exists

`web_version/DESIGN.md` documents the **violet Eightfold** system —
`primary #6B2BE0`, `background #F7F5FB`, pill radii on every control, Figtree
plus Roboto Mono. None of that ships. `talbotiq-platform/DESIGN_SPEC.md`
documents an even older green system and is marked superseded. Anyone building
from either document builds the wrong product.

### 3.5 Two brand names in one session

The recruiter spine wordmark reads **Mimic** (`Nav.tsx:126`, `Nav.tsx:207`, plus
`aria-label="Mimic home"`); login and candidate surfaces render the **TalbotIQ**
logo asset. 51 `Mimic` against 42 `TalbotIQ` references in TSX.

### 3.6 The candidate journey is two different products

`InterviewShell` — brand bar, `max-w-2xl` centred stage, 3px progress rail — is
used by only **two** of seven modes: Timed Q&A and recorded video. Chatbot,
voice, avatar and two-way each bypass it and build their own full screen; avatar
and two-way are dark, chatbot and voice are light. A candidate moving between
modes sees a different application. There is no shared Interview Stage.

### 3.7 A live voice call is rendered as a form page

`VoiceStage` is `bg-background` with a centred white card and a coloured orb. It
is the only realtime, eyes-free surface in the product and it looks like a
settings screen — no connection-quality signal, no transcript affordance in the
primary layout.

### 3.8 Page geometry is inconsistent

Container widths: `max-w-[1440px]` (Sessions, Templates, Question sets,
Pipelines, Analytics, Setup) · `max-w-[1100px]` (Report) · `max-w-5xl` (Results)
· `max-w-2xl` (Settings). Horizontal padding: only `SessionsPage` steps down on
mobile (`px-4 sm:px-6`); every other page is a flat `px-6` at 320px.
`RecruiterShell` also reserves `md:pr-20` on every page for the floating guide
launcher — a permanent 5rem dead column beside the widest tables in the product.

### 3.9 Tenant accent colour is injected inline and untokenized

Candidate screens do `style={{ background: branding.accentColor }}` and build
tints by string concatenation (`accent + '14'`, `accent + '0A'`). The tenant
accent can be any hex, so contrast on text-over-accent is unguaranteed and the
palette is unbounded. `Welcome`, `SystemCheck`, `VideoIntro`,
`VideoSystemCheck`, `AvatarStage` and `InterviewShell` all do this.

### 3.10 There is no command layer

No global search, no command palette, no notification surface, no workspace
switcher, no breadcrumbs, no keyboard shortcuts. Recruiter navigation is the
spine and nothing else; account control is a single Sign out at the spine top.

### 3.11 Dead API kept alive

`PageHeader.kicker` is accepted, documented as deprecated, and deliberately not
rendered — while roughly 40 call sites still pass it.

### 3.12 Accessibility

Working: a global `:focus-visible` ring · a global `prefers-reduced-motion`
block · `useReducedMotion` honoured in 17 components ·
`aria-expanded`/`aria-controls` on the mobile nav · `role="progressbar"` with a
real `aria-valuenow` in `InterviewShell`.

Risks: 142 `<button>` against 131 `aria-label` occurrences, so icon-only
controls are not uniformly labelled · 7 `onClick` handlers on `<div>` · only 7
files use a real `<table>`, so most tabular data is a div grid with no row or
column semantics · the reduced-motion block is a blunt
`transition-duration: 0.01ms !important` on `*`, which removes legitimate state
feedback (focus, hover) as well as motion · status is colour-plus-text in badges
but colour-only in several chart and pipeline surfaces.

### 3.13 Performance

Route splitting is good; the concerns are per-route weight. `ReportPage` 612K
(recharts plus jsPDF plus html2canvas in one chunk) · `LiveKitVideoTile` 524K ·
`IntroCanvas` 356K of WebGL on `/login` · `three.module` 668K. `MimicGuide`
(1,332 lines) mounts globally inside `AuthedApp` on every authenticated route.

---

## 4. Keep / refactor / replace

### Keep unchanged

- All data flow: `lib/api.ts`, TanStack Query keys and mutations,
  `store/useAppStore`, `services/*`, `hooks/*`, `shared/types.ts`, server contracts.
- Auth: `AuthProvider`, `guards.tsx`, role routing.
- Interview engines: `useInterviewClock`, `useChatbotSession`, `useVoiceSession`,
  `useDailyCall`, `useLiveKitCall`, `useAnswerRecorder`, `useIntegrityMonitor`.
- The route map, exactly as it is.
- Integrations: Tavus, LiveKit, Daily, Hume, Deepgram, Rekognition, Gemini.

### Keep and build on

- The token layer's *structure* in `tailwind.config.js`: semantic keys, one type
  family with a width axis, squared radii, ink-toned shadows.
- The exhibit ramp as **functional** format coding. This is the strongest idea in
  the existing system and should survive any re-skin.
- Route-level code splitting in `App.tsx`.
- `Button` / `Input` / `Textarea` / `Select` / `Modal` / `EmptyState` /
  `ErrorState` / `Skeleton` / `RecordRows`.

### Refactor

- `components/ui/index.tsx` — split into a real primitive directory, add the
  missing primitives listed in §2, add non-colour status encoding.
- `Nav` and `RecruiterShell` — add the command layer, drop the `pr-20` dead
  column, make collapse deliberate.
- `InterviewShell` into a genuine `InterviewStage` consumed by all seven modes.
- Every page's ad-hoc section markup onto `RecordSection` or its successor.
- `components/hume/*` and `components/ats/*` onto tokens, no hex literals.

### Replace

- `DESIGN.md`, which documents a retired system.
- `VoiceStage`'s layout: form page becomes a live room.
- Per-page container and padding decisions: one page-shell primitive.
- Inline `branding.accentColor` styling: a tokenized tenant-accent channel with a
  guaranteed-contrast text pairing.

---

## 5. Proposed component architecture

```
src/design/
  tokens.css            single source: colour, type, space, radius, elevation,
                        motion, z-index, breakpoints — as CSS custom properties
  tokens.ts             typed mirror for TS consumers (charts, canvas, WebGL)
  motion.ts             durations, easings, variants; one reduced-motion gate

src/components/ui/
  primitives/           Button Input Select Textarea Toggle Slider Checkbox Radio
  data/                 Table DataGrid FilterBar Pagination StatFigure Sparkline
  feedback/             Badge StatusMark(non-colour-safe) Toast Skeleton
                        EmptyState ErrorState LoadingState ConfirmDialog
  overlay/              Modal Drawer SidePanel Popover Tooltip CommandPalette
  layout/               PageShell PageHeader RecordSection SplitPane Toolbar
  index.ts              flat re-export, so the 39 existing importers do not break

src/components/shell/
  RecruiterShell        spine + command bar + content region
  Spine                 grouped nav, deliberate collapse
  CommandBar            search, notifications, account, contextual actions
  AmbientField          context-varying background (CSS/SVG; WebGL opt-in)

src/features/interview/stage/
  InterviewStage        one shell for all seven modes: identity, phase, time,
                        integrity notice, support, connection, transport
  StagePanel            mode-specific content region
  Transport             mic / camera / screen / end, with confirmation
  ConnectionMeter       quality and reconnect states
  TranscriptRail        captions and transcript affordance
```

`components/ui/index.ts` re-exports every current named export, so no existing
import path changes and the migration is incremental rather than a big bang.

---

## 6. Open decisions that change the work

1. **Foundation.** The brief asks for a dark-indigo / near-black foundation with
   electric-violet, cool-blue and mint accents. The product currently ships a
   deliberate **light** recruiter surface (The Record) with dark rooms for
   avatar, two-way and the live host view. The brief also asks for one identity
   that works in "dark immersive interview rooms *and* light/neutral data-heavy
   recruiter pages", which is what the current split already attempts. These need
   reconciling before any token work.

2. **Scope of this pass.** Sixteen authenticated routes, seven interview modes,
   eight recruiter modules, roughly 37k lines. Sequencing matters more than breadth.

3. **Brand name.** Mimic or TalbotIQ. It cannot stay both.

---

## 7. Palette decision, recorded after implementation

The brief asked for a dark-indigo foundation with electric-violet, cool-blue and
mint accents. During implementation the user directed the product to follow the
**marketing site's** palette instead. That site was then read directly rather
than described, and its rules turned out to be narrower than the brief's:

| Rule | Source in `src/marketing/mimicSite.css` |
|---|---|
| The primary action is **ink** `#0E1420`, hover `#1B2436` | `.btn-primary { background: var(--mm-ink) }` |
| Registrar blue `#1D3FA0` is for **links and the focus ring only** | `a { color: var(--mm-reg) }`, `:focus-visible { outline: 2px solid var(--mm-reg) }` |
| The six **exhibit** colours are the only saturation on the site | `--mm-ex-*` |
| There is **no violet** anywhere | — |
| The hero ground is a 7% registrar wash over `#F4F6F9 → #FFFFFF` | `.hero { background: … }` |

So the product is ink-and-paper with one blue for navigation and one colour per
interview format. Consequences applied across this pass:

- `--action` (ink) drives every primary button, the progress rail, the step
  chip, selection marks and the candidate's own chat bubbles. Blue no longer
  fills anything.
- The electric violet added in the first draft was removed. AI provenance is
  marked by a glyph and a word (`ProvenanceMark`) rather than by a hue that
  exists nowhere else in the brand.
- Sign-in moved from a near-black room onto the marketing hero's own ground.
- The voice room moved onto paper as well: its subject is an orb we draw, not a
  video feed, so nothing needed a dark surround.

**Still dark, deliberately:** the avatar room, the two-way call, the recruiter's
live host room, and the recruiter spine. Each of those carries live video or is
navigational chrome, where a dark ground is doing real work rather than
decorating. `--action` inverts to near-white with ink text on those surfaces,
which is what the marketing site itself does in its dark sections (`.btn-light`).
