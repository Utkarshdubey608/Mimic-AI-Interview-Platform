# MCQ as a first-class track, on every client

Phase 11 of [WEB_MOBILE_CONSISTENCY_PLAN.md](WEB_MOBILE_CONSISTENCY_PLAN.md), planned
separately because it is the one remaining item that is a **build**, not a
reconciliation.

Every other track — chat, video, voice, avatar, two-way — reached both clients by moving
a record into the shared kernel and pointing the second client at it. MCQ cannot, and
the reason is worth stating before any of the tasks make sense.

---

## Why MCQ is different

**1. It is the only track whose questions contain the answers.**

Every other track stores questions as plain strings. An MCQ question carries
`correctOptionIds`, and that key must never reach a candidate's device — not "must not be
displayed", must not be *sent*. The web enforces this with an allow-list projection
(`mcq_public_question`) rather than by deleting fields, so a field added to the stored
question next year is invisible to the client until somebody deliberately adds it to the
public shape.

Any mobile runtime has to inherit that property, not reimplement it.

**2. Its runtime lives in the wrong place.**

Chat, voice and avatar all run through `web_sessions` too — but their scoring is a Gemini
call against a transcript, which `evaluation.score_and_store` already shares. MCQ's
scoring is a comparison against a stored key, and the key lives **inside the session
document**: `sessions.py` resolves the paper into `session["questions"]` at create time,
complete with answers, and `sessions_mcq.py` reads it back from there. Thirteen references
to the session document.

So "put MCQ on mobile" is not a client task. The runtime has to move first.

**3. The paper is referenced, not embedded.**

An MCQ invite writes `screening.mcqSetId` and `questions: []`. Every other track embeds
its questions in the interview document. This is correct — a list of plain strings cannot
express an option list or a key — but it means the mobile client cannot render an MCQ
from the assignment alone, the way it can render a chat interview.

---

## What exists today

| | |
|---|---|
| `web_mcq_sets` | recruiter-authored papers, **owner-scoped**, holds the key |
| `mcq_sets.py` | authoring CRUD, generation from a role, completeness checks |
| `sessions.py` | resolves the paper into a session at create, key included |
| `sessions_mcq.py` | the candidate runtime: fetch, autosave, submit |
| `mcq_scoring.py` | exact comparison against the key — no model involved |
| Flutter | **nothing.** An MCQ invite is gated with "open this on the web" |

The gate (Phase 9.2) is doing its job: an MCQ assignment reaches Flutter as
`type: chat` with `questions: []`, so without it a candidate lands in a chat interview
with nothing in it.

---

## The target

```
SHARED KERNEL
  mcq_sets/{id}            the paper + answer key  (recruiterId-scoped)
  app/mcq.py               the paper model, the PUBLIC projection, completeness
  app/mcq_scoring.py       exact scoring — unchanged, just moved
  app/mcq_runtime.py       resolve a paper for an attempt, store answers, submit

  /api/interviews/{id}/mcq            the candidate runtime, shared surface
  /api/mcq-sets/*                     authoring, shared surface

WEB                              MOBILE
  McqSetsPage      →  both author against /api/mcq-sets
  McqStage         →  both sit papers against /api/interviews/{id}/mcq
```

**One rule governs the whole design:** the answer key exists in exactly two places —
the stored paper, and the scorer. Never in a response, never on a device, never in a log.

---

## Where the attempt lives — the decision to take first

The runtime currently stores a candidate's answers on `web_sessions`. Three options, and
this choice shapes everything after it:

| | Approach | Cost |
|---|---|---|
| **A** | Mobile claims through `/api/web/*` and reuses the web runtime as-is | Nothing to build. But the mobile client now depends on a surface the README defines as "the React app", and the two-surface boundary stops meaning anything |
| **B** | `mcq_attempts/{interviewId}` — a shared collection for the attempt, and the runtime rebuilt against it | A real build. Clean: the attempt is a shared record like `reports`, and neither client needs a session |
| **C** | Merge `web_sessions` into the shared kernel | Largest by far, and it drags the clock, drafts and integrity events with it — none of which MCQ needs |

**Recommendation: B.** An MCQ attempt is not a session — it has no per-question clock, no
prep phase, no transcript, no integrity monitoring. It is a paper, a set of chosen
options, and a submission time. Modelling it as its own small shared record is both less
work than C and more honest than A.

Under B, `web_sessions` keeps running MCQ for existing in-flight attempts until they
drain, exactly as `web_pipelines` did.

---

## Phases

### 11a — Move the runtime into the kernel *(server only, no client change)*

| # | Task |
|---|---|
| 11a.1 | `app/mcq.py`: the question/section/option model, `public_question` (the allow-list), `set_faults` completeness. Promote to `KERNEL`. |
| 11a.2 | `app/mcq_scoring.py`: moved unchanged. It is already pure — a comparison, no I/O. |
| 11a.3 | `app/mcq_runtime.py`: `resolve_paper(interview)`, `save_answers`, `submit`. Reads the set by id, writes `mcq_attempts/{interviewId}`. |
| 11a.4 | `mcq_attempts` collection + `firestore.rules`. **Server-written only** — unlike `practice_sessions`, this decides a score. |
| 11a.5 | Golden fixtures for the public projection, in `contracts/`, asserted by Python **and** Dart. The key's absence is the property; pin it in both languages before either renders a paper. |

**Verification:** a test that takes every field on a stored `McqQuestion`, sends the
public shape through JSON, and asserts `correctOptionIds` appears nowhere in the bytes.
Not on the projection — on the serialised response, which is where a leak would reach
someone.

**Risk:** low. Nothing user-facing changes.

### 11b — The shared candidate runtime *(server only)*

| # | Task |
|---|---|
| 11b.1 | `GET /api/interviews/{id}/mcq` — the paper, public shape, plus whatever is answered so far |
| 11b.2 | `POST /api/interviews/{id}/mcq/answers` — autosave. A refresh must not cost a candidate their answers |
| 11b.3 | `POST /api/interviews/{id}/mcq/submit` — score and finish. Writes `interviews.result` + `reports/{id}`, the same split every other track uses |
| 11b.4 | Completeness enforced at **use**: a paper with an unanswered key scores everyone zero, so sending one out is what must fail, not saving a draft |
| 11b.5 | The web runtime delegates to it — one scorer, as with `evaluation.score_and_store` |

**Verification:** the same paper, sat through the web route and the shared route, scores
identically. Assert it, don't assume it.

**Risk:** medium. `sessions_mcq.py` is live; keep it serving in-flight attempts and
migrate on completion rather than mid-paper.

### 11c — The Flutter candidate runtime

| # | Task |
|---|---|
| 11c.1 | `McqPaperPage`: sections, single/multi/match, code snippets, a passage |
| 11c.2 | Autosave on every change, offline-tolerant — a candidate on a train must not lose a page of answers |
| 11c.3 | Submit → the shared result screen. **No score shown**: `resultPublished` still gates it, as with every other track |
| 11c.4 | Remove the Phase 9.2 gate |

**Verification:** a widget test asserting `correctOptionIds` is absent from every model
the page can construct — the Dart mirror of 11a's byte-level test.

**Risk:** medium. Net-new surface, but the scoring is already exact and shared.

### 11d — Flutter authoring *(lowest priority)*

Recruiters have the web for this, and it is the largest surface of the four. Worth doing
for parity, worth doing **last**.

| # | Task |
|---|---|
| 11d.1 | Set list + editor, against `/api/mcq-sets` |
| 11d.2 | Sections, question types, the match-pairing editor |
| 11d.3 | Generate-from-role, reusing the existing endpoints |

---

## Open decisions

**Scoping for `mcq_sets`.** Recruiter-scoped today, deliberately: the set *contains the
answers*, and `db.py` argues that shared storage would let every recruiter on the
deployment read every assessment's key. Company scoping (Phase 7's model for templates)
weakens that, though colleagues sharing a question bank is normal.

*Recommendation: keep recruiter-scoped, add explicit opt-in sharing if asked.* Do not
fold it into the company migration by default.

**Whether a candidate may retake.** Every other track answers this with `maxAttempts` on
the assignment. MCQ has a stronger reason to refuse: the paper does not change between
attempts, so a second sitting is a memory test of the first. Worth deciding explicitly
rather than inheriting.

**What a recruiter sees per question.** MCQ is the only track where "what did they answer"
is a closed, comparable value across candidates — an item-analysis view (which questions
everyone got wrong) is possible here and nowhere else. Out of scope for parity; worth
noting before the report shape is fixed.

---

## Sequencing

```
11a  kernel runtime          server only, no client change    ← ship first
11b  shared candidate API    server only, web delegates to it
11c  Flutter candidate       removes the "open on the web" gate
11d  Flutter authoring       parity; lowest priority
```

11a and 11b are server-only and independently shippable — after them, **nothing has
changed for anyone**, which is the point: the risky half is done and proven before a
single client is touched.

11c is what a candidate notices.

---

---

# What was built

*Appended 2026-08-22. 11a–11d are shipped; the gate from Phase 9.2 is gone.*

## The decision taken

**Option B.** `mcq_attempts/{interviewId}` — a shared record for the attempt, and the
runtime rebuilt against it. An MCQ attempt is not a session: no per-question clock, no
prep phase, no transcript, no integrity monitoring. `web_sessions` keeps running MCQ for
attempts already in flight, exactly as `web_pipelines` did.

## Where everything ended up

```
KERNEL                          what it owns
  app/mcq.py                    where a paper lives, where an attempt lives, the public
                                projection, the paper store
  app/mcq_scoring.py            the comparison + mcq_public_question (moved, unchanged)
  app/mcq_runtime.py            resolve / save / submit, and the one scorer
  app/mcq_authoring.py          cleaning, validation, faults — one set of rules
  app/mcq_gen.py                prompts, response schemas, normalisation

SHARED ROUTES
  /api/interviews/{id}/mcq      sitting a paper          app/routers/mcq.py
  /api/mcq-sets                 authoring a paper        app/routers/mcq_sets.py

CLIENTS
  Flutter candidate   features/interviews/candidate/mcq/   (models, store, page)
  Flutter authoring   features/recruiter/…/mcq_sets_page   + editor + generate sheet
  React               unchanged — its session routes now delegate to the kernel
```

## The rule, and how it is held

**The answer key exists in exactly two places: the stored paper, and the scorer.**

Four independent things enforce it, because one would not be enough:

1. `mcq_public_question` is an ALLOW-LIST. A field added to a stored question is
   invisible until somebody names it there.
2. An attempt document never holds the paper. The web runtime resolved questions into
   the session at create time, key included — that is precisely what welded MCQ to one
   surface.
3. `contracts/mcq_paper.fixtures.json`, asserted in **both** languages: Python on the
   serialised bytes, Dart on whether the reader has anywhere to put a key at all.
4. The Flutter candidate model has no field for one. `mcq_models.dart` is deliberately
   the mirror of `mcq_set.dart`, which does carry the key because its reader wrote the
   paper.

`firestore.rules` denies clients both `mcq_sets` and `mcq_attempts` outright — listed
explicitly rather than left to the default deny, because the reason is not obvious.
Unlike `practice_sessions` next door, an attempt DECIDES A SCORE, so the candidate being
graded must not be able to write it.

## What one scorer means in practice

Both surfaces call `mcq_runtime.score`. Two tests keep it that way:

* `test_the_shared_route_and_the_web_route_score_identically` — one paper, both paths.
* `test_scoring_is_the_same_whichever_surface_ran_it` — greps both route modules for a
  direct `score_submission(` call, because the drift would arrive as a reintroduced
  second scorer rather than as a wrong number.

The same shape guards authoring: `test_both_surfaces_clean_a_body_identically` runs one
body through both cleaners and compares everything but the minted ids.

## Open sub-decisions, resolved

| | |
|---|---|
| **`mcq_sets` scoping** | **Recruiter-scoped, kept.** Dropping the `web_` prefix does not widen access — ownership was never the prefix, it is a `recruiterId` filter on every query plus a rules deny. The prefix only made the paper unreachable from the other client. |
| **Retakes** | **Refused.** `submit` returns 409 on a second attempt rather than rescoring. The paper does not change between sittings, so a retake is a memory test of the first — and the result must not depend on how many times a button was pressed. Recorded in `mcq_runtime.submit`. |
| **Item analysis** | Still out of scope. The data is there (`reports/{id}.mcq.questions`), and MCQ remains the only track where "what did they answer" is comparable across candidates. |

## Deliberately not done

**The React runtime still goes through `web_sessions`.** Its routes now delegate to the
kernel for projection, cleaning and scoring — so there is no second implementation — but
the attempt is still stored on the session. Moving it would give up the session's clock,
integrity events and branding for no gain the candidate would notice, and 11b's own risk
note says to migrate in-flight attempts on completion rather than mid-paper.

**Generation authenticates differently on each surface.** The prompts and normalisation
are shared (`app/mcq_gen.py`); the CALL is not. The web resolves a recruiter's saved key
through its settings document, the common surface uses `providers.GeminiClient` and the
environment. Unifying that means promoting the web settings document into the kernel — a
much larger change than "both clients can generate a paper" needs.

*(The assignment gap that stood here is closed — see **11e** below.)*

---

# 11e — Assigning an MCQ from Flutter

*Appended 2026-08-22. Not in the original 11a–11d; it was the parity gap they left.*

A recruiter could author a paper on the phone but not send one: `RoundKind` had no `mcq`,
so an MCQ round could not go on a timeline and the create form could not produce one.

| | |
|---|---|
| `RoundKind.mcq` | `usesAiInterviewer: false` — no prompt, no question list, no avatar, no voice. `needsMcqPaper: true`. `isInterview: true`, because a candidate SITS a paper (only a résumé round is false). |
| `Interview.mcqSetId` | Read from `screening.mcqSetId`, falling back to a top-level `mcqSetId`. Written nested on create; written as a **dotted path** on update, so a `screening.mcqConfig` the web wrote keeps its value. Absent → `FieldValue.delete()`, because a blank id would leave the document claiming a paper that is not there. |
| Create form | An MCQ segment on the kind toggle (now three per row — six across a phone truncates every label), and a paper picker in place of the script card. The picker shows readiness, because sending an unfinished paper is the one failure that screen can still prevent. |
| Round config | An MCQ round inherits the DELIVERY settings only — `language`, `maxAttempts`, `allowedDevices` — via an allow-list, not a list of exclusions. A setting added there next year has to be considered for MCQ deliberately rather than arriving on a round with no runtime for it. |

**Three fields have to be exactly right, and each breaks a candidate differently:**
`mode: 'mcq'` (routing keys off it), `type: 'chat'` (the server's bucket for mcq —
disagreeing with `mode` is the class of bug `mode` exists to close), and
`screening.mcqSetId` (which paper). `test/mcq_assignment_test.dart` pins all three plus
the round trip through Firestore; `tests/test_mcq_routes.py` asserts the backend accepts
the document the *phone* writes, including the absence of `mcqConfig` — the phone has no
UI for scoring rules, so the defaults must apply rather than erroring.

**`attemptsUsed` is deliberately not incremented on opening a paper.** Every other track
counts a launch because a launch consumes the thing — a video call happens once. A paper
is resumable by design; counting each open would lock somebody out of one they were
halfway through, which is what autosave exists to prevent. What can only happen once is
the submit, and the server refuses a second one.

**Two things fixed on the way, both latent before MCQ:**

* `round_step_tile` counted `config['questions']` for anything `isInterview`, so a
  two-way round read "Live Interview · 0 question(s)". Now keyed on
  `usesAiInterviewer`, which is what a question count actually means.
* The round editor seeded starter questions for any `isInterview` kind, including
  two-way — a script the editor then hid and nobody ever read.

**Still web-only, and correctly so:** `screening.mcqConfig` — a total time limit,
`showScoreToCandidate`, a pass threshold, partial-credit rules. The phone assigns a paper
with the documented defaults. Adding that UI is a product decision about how much
configuration belongs on a phone, not a consistency gap: the same paper scores identically
either way unless a recruiter deliberately changes a rule.

**One cosmetic inconsistency, matching the server:** a single-round MCQ test's
`tests/{id}` summary carries `type: chat`, so the dashboard row shows a chat icon. The
server's `build_test_summary` does exactly the same through `type_for_mode`, so the two
clients agree — `TestSummary.type` simply has no MCQ value to hold.

## To run before this reaches production

```bash
# Copies web_mcq_sets → mcq_sets. Idempotent; nothing is deleted.
.venv/bin/python scripts/migrate_web_mcq_sets.py --dry-run
.venv/bin/python scripts/migrate_web_mcq_sets.py

# Rules: both files gained mcq_sets and mcq_attempts.
firebase deploy --only firestore:rules
```

Existing papers keep their ids, and they have to: an interview already sent out carries
`screening.mcqSetId`, so a paper copied to a new id would leave every outstanding invite
pointing at nothing.

---

## Testing it end to end

Both clients, one paper. The point of the walkthrough is that step 3 and step 6 can be
different devices and nothing changes.

1. **Author** — Manage → Assessments → New assessment. Add a section, a single-answer
   question, a multi-answer one, a code snippet, and a matching question. Save. The
   banner names anything unfinished; save works anyway.
2. **Check the readiness rule** — unmark the correct answer on one question and save. It
   saves, and reports "Question 1 has no correct answer marked". Re-mark it.
3. **Assign** — New interview → kind **MCQ** → pick the paper → add a candidate email.
   A paper that is not ready is shown as such in the picker.
4. **Sit it** — sign in as the candidate on either client. The paper opens; there is no
   "open this in a browser" gate. Answer some questions, leave the screen, come back:
   the answers are still there (autosave, plus the attempt is keyed by the interview).
5. **Verify the key never arrives** — with the paper open, nothing in the response
   carries `correctOptionIds`. `tests/test_mcq_routes.py` asserts this on the response
   bytes; the same route serves the device.
6. **Submit** — the completion screen shows no score. Submit again: refused.
7. **Read the result** — as the recruiter, on either client. `overallScore` is exact,
   the scorer reads "scored automatically" rather than "AI draft", and no re-score is
   offered — the number cannot change.

---

*Written 2026-08-21 against `development`, completed 2026-08-22 (11a–11d, then 11e).*
