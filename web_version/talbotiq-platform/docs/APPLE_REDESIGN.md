# Apple-language redesign — audit

**Status:** audit only. No implementation code written. Awaiting the gate.

Scope: candidate-side interview in `web_version/talbotiq-platform`. Section numbers refer to the `apple-design` skill.

---

## 0. The brief is written against a stale snapshot — read this first

Four statements in the brief no longer match the repo. All four follow from work merged and deployed earlier today, and two of them ask me to rebuild something already removed.

| Brief says | Reality | Consequence |
| --- | --- | --- |
| `screens/SystemCheck.tsx` exists | **Deleted** | Replaced by `systemcheck/SystemCheckScreen.tsx` |
| `screens/VideoSystemCheck.tsx` exists | **Deleted** | Same replacement |
| Pre-flight is TrackSelect → Welcome → Resume → SystemCheck | It is **Welcome → Resume → SystemCheck** | Three steps, not four |
| "TakeInterviewPage already computes `fixedFormat`" | **No such variable** | The chooser is already gone |

`screens/TrackSelect.tsx` still exists on disk but **nothing imports it** — it is orphaned. The brief's instruction to kill the choose-format step was completed earlier today, and went further than the brief asks: `PreStep` no longer has a `'track'` member, so the chooser is unrepresentable rather than conditionally skipped.

The System Check that replaced those two files is not cosmetic. It verifies **measured signal** — microphone RMS above −50 dBFS across 5 frames, camera liveness by inter-frame variance, face presence, STUN reachability — and gates Start on it. Any pre-flight redesign must carry that gate forward intact. The brief does not mention it because it did not exist when the brief was written.

**None of this blocks the redesign.** It changes section A: three steps to unify, not four, and one of them is a working hardware gate rather than a card.

---

## 1. Current flow

```
  /take/:id  ──▶  useInterviewClock (5s poll; server owns phase + time)
                                  │ status
   created / system_check ────────┼──────── in_progress ──── completed / expired
           │                      │              │                   │
   ┌───────▼────────┐             │      ┌───────▼──────┐     ┌──────▼───────┐
   │ PRE-FLIGHT     │             │      │ track switch │     │ Completion   │
   │ Welcome        │             │      └───────┬──────┘     │ + feedback   │
   │   ↓ mode=wait  │             │              │            │ → redirect   │
   │ Resume (if     │             │   ┌──────────┼──────────┐ └──────────────┘
   │  awaitingResume│             │   │          │          │
   │   ↓ mode=wait  │             │ chatbot   timed      voice / avatar
   │ SystemCheck    │             │   │      (chat,       / two_way
   │   ↓ onBegin    │             │   │       video)          │
   └────────────────┘             │ own screen  InterviewShell   own full screen
                                  │             + QuestionStage
```

Reconnect (invariant 4): `status === 'in_progress'` short-circuits pre-flight for every track — `TakeInterviewPage.tsx:120-155`.

---

## 2. Latency, lockout and non-interruptible motion

### 2.1 Artificial delays on the input path (§1)

| # | Location | Finding |
| --- | --- | --- |
| **L1** | `useChatbotSession.ts:7` | `MIN_THINKING_MS = 3000` — a **3-second floor** before an interviewer message is revealed (`:147`, `:166`). A reply arriving in 400ms is held 2.6s. |
| **L2** | `useAnswerRecorder.ts:97` | `rec.onstop = () => setTimeout(() => resolve(finish()), 1200)` — fixed **1.2s** on the **submit path**. |
| **L3** | `ChatbotStage.tsx:102` | 800ms draft debounce. Right in kind; see 2.4. |
| **L4** | `QuestionStage.tsx:40` | 900ms draft debounce, same. |
| **L5** | `AvatarStage.tsx:117` | `setTimeout` before wrapping the Daily iframe, delaying call attach. |

**On L1.** The code defends it: *"a deliberate floor, not a delay stacked on top of latency (§1)"*. Half right — it is a maximum, not an addition. But the interface still misrepresents how long the model took, and the brief's own AgentStatus rule forbids exactly that: *"Pick the stage from real signals. Never a random label, never fake progress (§16.3)."* Skill and brief agree against the current code. **Recommend deleting**; a fast answer should feel fast.

**On L2.** Not safe to simply delete. The 1.2s is grace for the final Deepgram result to round-trip; removing it truncates the last words of an answer. The correct fix resolves on the relay's final-result event with the timeout as fallback. **Flagged, not fixed** — it touches transcript integrity, adjacent to invariant 1.

### 2.2 Input lockout during transitions (§3)

- `AnimatePresence mode="wait"` at `TakeInterviewPage.tsx:175,204` and `VideoStage.tsx:256` forces exit-before-enter: the incoming step is not interactive until the outgoing one has left. This is the structural reason section A exists.
- Twelve `disabled={… busy}` sites (`ChatbotStage:337,356,400`; `QuestionStage:132,175,189`; `ResumeUpload:147`; `VideoIntro:82`; `VideoStage:217,227`). Most legitimately prevent double-submit; each needs a call between "destructive if repeated" and "locked for tidiness".

### 2.3 CSS motion where a spring belongs (§3, §11)

`transition-all duration-150` on pressable controls — `ChatbotStage.tsx:155,391,417`, `AvatarStage.tsx:198,251`, `InterviewFeedback.tsx:98`. CSS transitions cannot be grabbed and reversed from their presentation value, and every one of these is on something a finger can hit.

`animate-pulse` at `AvatarStage.tsx:228,306,307` and `CircularCountdown.tsx:56` is a looping CSS oscillation. §14 warns against slow loops near 0.2 Hz — and the countdown one fires exactly when the candidate is most stressed.

### 2.4 Feedback kinds (§16)

Draft autosave has **no visible status at all** — L3/L4 save silently. §16 asks for ongoing status to be exposed. Today there is neither toast nor indicator.

### 2.5 Accessibility signals (§14)

`prefers-reduced-motion` is handled in 10 candidate files — good coverage. **`prefers-reduced-transparency` and `prefers-contrast` are handled nowhere in `src/`** outside the standalone marketing CSS. The redesign introduces translucent chrome everywhere, so both must be added or the §12 material work ships inaccessible.

### 2.6 Countdown truth (invariant 2)

`CircularCountdown` renders the raw `remaining` prop and hard-swaps colour at thresholds (`:37-38`) — an abrupt brightness jump (§14). `useInterviewClock:69-81` already interpolates between polls, so the smoothing layer must wrap the **presentation** value only and must not touch `secondsLeft`, which drives auto-submit.

---

## 3. Token collision plan

### 3.1 They can coexist

THE RECORD is documented in `tailwind.config.js` and `src/index.css`: Archivo with its width axis as a second typeface, radii 6–24px, flat hairline shadows in cool ink, `#F5F5F7` desk, Chivo Mono for machine values, and 13 `:root` properties already namespaced `--ex-*`, `--ink*`, `--rule`, `--desk`, `--registrar`.

That existing prefix convention is what makes coexistence safe: an `--ap-*` namespace collides with nothing, and radii/shadows are Tailwind keys, so `apple-*` keys sit alongside rather than replacing.

### 3.2 Plan

1. `--ap-*` properties under `[data-surface="candidate"]` in `src/index.css` — scoped selector, never `:root`, so recruiter trees cannot match.
2. `apple-*` keys in `theme.extend` (`rounded-apple-*`, `shadow-apple-*`, `ease-apple`). Purely additive.
3. `data-surface="candidate"` on the interview root in `InterviewShell` **and** on the four stages that bypass the shell — `ChatbotStage`, `VoiceStage`, `AvatarStage`, `TwoWayStage` all return outside it (`TakeInterviewPage.tsx:125-155`).
4. Migrate candidate screens only.

### 3.3 The collision the brief did not anticipate

The brief's step 3 says "upgraded UI kit". **`src/components/ui/index.tsx` is imported by 7 candidate files and 24 recruiter/page files.** Any change to it lands on the recruiter side and breaks the byte-identical invariant.

- **(a) Variant prop** — `<Button surface="candidate">`. Recruiter call sites unchanged. Cost: conditional branches through the kit.
- **(b) Parallel candidate kit** — `src/features/interview/ui/`. Zero shared-file edits. Cost: duplication.
- **(c) No kit change** — restyle candidate screens with `apple-*` classes directly. Cost: no shared candidate primitives.

**I recommend (b).** The invariant is that recruiter output is unchanged; (b) makes that true *structurally* rather than by careful review.

### 3.4 Byte-identical proof — done, and the first criterion was wrong

Screenshotting ATS pages needs recruiter auth, which Playwright does not have. A
stronger and cheaper proof was available: diff the **compiled stylesheet**. If no rule a
recruiter element can match has changed, recruiter rendering cannot change.

First run of that check **failed**, which is the point of having it:

```
baseline rules : 1169      final rules : 1191
rules LOST     : 2         added : 24 (20 scoped, 4 not)
```

Both losses were real, and neither is a recruiter risk:

| Rule | Why it went |
| --- | --- |
| `.bg-neutral-400` | Used only by the deleted `ThinkingIndicator` |
| `.ml-1\.5` | Same |

Tailwind purged them because nothing references them any more. Verified: **0
recruiter-side files use either class**, and 0 use any of the 4 newly-emitted utilities
(`.bg-current`, `.gap-[3px]`, `.w-[5px]`, `.text-[var(--ap-label-tertiary)]`). A utility
definition only affects elements carrying that class.

So the criterion "zero rules lost" was too strict — it flags dead-class purging, which is
a consequence of *deleting candidate code*, not of touching recruiter tokens. The correct
invariant, and the one now verified:

> **No rule that a recruiter element matches has changed, and every added scoped rule is
> under `[data-surface="candidate"]`.**

Result: **PASS.** All 20 scoped additions are candidate-only; the 4 unscoped additions are
new utilities no recruiter file references; the 2 removals are classes no recruiter file
references.

---

## 4. Proposed new flows

**A. Pre-flight — one anchored container.** Three steps, not four. One container, content springing between steps, persistent progress rail, `layoutId` on the brand mark and primary action. `mode="wait"` removed so the incoming step is live immediately. **The measured hardware gate carries forward unchanged.**

**B. Consent and readiness as a sheet.** Résumé, name and permissions in a drag-dismissable sheet: `setPointerCapture`, grab offset, 1:1 tracking, `project(v, 0.998)`, `rubberband()`, spring `damping 0.8 / response 0.3`. Asked at the moment of need (§16.3).

**C. Per mode** as specified, with two amendments:
- **Chatbot:** delete `MIN_THINKING_MS` as *part of* AgentStatus — the honest status system replaces the fake floor rather than sitting on top of it.
- **Timed Q&A:** the spring smooths a presentation value only; `secondsLeft` and auto-submit read the server value untouched (invariant 2).

**D. AgentStatus.** Four stages from real signals: `thinking` (request in flight, zero tokens), `reading` (context being consumed), `cooking` (streaming, rate follows actual stream rate), `almost` (tail). Copy cycles only past ~2.5s. `aria-live="polite"`, one announcement per stage change, reserved row, zero layout shift.

---

## 5. Decisions I need before implementing

1. **UI kit — (a), (b) or (c)?** I recommend (b).
2. **Confirm deleting `MIN_THINKING_MS` (L1).** Someone chose that 3s floor deliberately. Removing it makes fast answers feel fast rather than considered. Skill §1 and the brief's §16.3 rule both say delete; it is still your product call.
3. **Leave L2 (the 1.2s transcript grace) out of scope?** Deleting it truncates answers. Doing it properly means resolving on the relay's final-result event, adjacent to invariant 1. I would rather scope it separately than fold it into a visual redesign.
4. **Scope.** Six modes, full flow rebuild, new token layer, motion primitives, new kit, cross-engine verification — substantially larger than anything else this session. If you want it in one pass I will follow your commit order. If you would rather see **Chatbot land first and judge the language** before I touch the other five, that is the cheaper way to discover we disagree about the feel.

---

## 6. No skill-versus-invariant conflict found

The collision I expected — §1 "delete every artificial delay" against invariant 2 "timer truth stays server-side" — does not materialise. L1 through L5 are all presentation-side; none is load-bearing for the clock. `useInterviewClock` keeps its authority in every proposal above.
