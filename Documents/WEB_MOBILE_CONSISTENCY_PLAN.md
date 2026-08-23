# Web & Mobile Consistency — Final Implementation Plan

Companion to [WEB_MOBILE_CONSISTENCY.md](WEB_MOBILE_CONSISTENCY.md), which holds the audit and
the defects (D1–D11). This is the authoritative build order, covering **recruiter and candidate,
Flutter and web**.

---

## Principles

**The mobile implementation is the reference for the product model.** Rounds, outcomes,
publishing, candidate disclosure, test grouping and pagination discipline are all better
thought through there, and web adopts them.

**Web is the reference for the interview runtime**, and this is not a hedge — it is where web is
genuinely ahead, and blanket-adopting mobile would be a regression:

- The clock is **server-enforced**, and `web/services/timing.py` stamps transitions at the
  *deadline* rather than whenever the server noticed, so a slow request cannot shorten a
  candidate's answer time.
- Integrity monitoring, the integrity gate and preflight have no mobile equivalent.
- The system check is far more thorough — mic, camera, speaker, connectivity and face, each with
  its own guidance.

**So: adopt the mobile product model, keep the web runtime.** Two runtimes, one contract.

**A runtime may be per-platform. A record may not.** If a recruiter or candidate can see it, it
lives in the shared kernel and has exactly one shape.

---

## Target architecture

```
SHARED KERNEL (both surfaces, both clients)
  users/{uid}                       identity, role, company, preferences
  interviews/{id}                   one assignment — the single record of an attempt
  tests/{testId}                    batch metadata
  tests/{testId}/rounds/{roundId}   the round model  ← mobile's, adopted by web
  reports/{interviewId}             the scored report, one shape
  interview_templates/{id}          role/track/rubric/timing   (companyKey-scoped)
  question_sets/{id}                                           (companyKey-scoped)
  email_templates/{id}              invite + notification      (recruiterId-scoped)
  mcq_sets/{id}                     papers + answer key        (recruiterId-scoped)
  feedback/{interviewId}            candidate's view of the experience
  practice_sessions/{uid}/…         a candidate's own rehearsal record

WEB-ONLY, AND CORRECTLY SO
  web_sessions     the web interview ENGINE: clock, drafts, integrity events
  web_leads        marketing lead capture
  web_voice_jobs   async voice-analysis jobs
  web_settings     server-held vendor credentials

RETIRED BY THIS PLAN
  web_pipelines  web_pipeline_candidates   → tests/{id}/rounds
  web_templates  web_question_sets         → promoted, company-scoped
  web_invite_email_templates               → merged into email_templates
  web_reports                              → promoted to reports
  web_mcq_sets                             → promoted to mcq_sets
  web_feedback                             → promoted to feedback
```

### The layering gate

`tests/test_layering.py` allows `app/web/` to import only `app.config`, `app.security`,
`app.firebase`, `app.ratelimit`, `app.providers`, `app.mailer`. Everything else in `app.*` is
common-surface domain logic and off limits.

Every promotion is a deliberate three-part act: move the module into the kernel, add it to
`KERNEL` in the test, and accept that **a change to it is now a change to the mobile contract**,
reviewed against both surfaces — exactly as `app.mailer` already documents for itself.

That test is the review gate for this entire plan. **If a phase compiles without touching it,
the sharing did not actually happen.**

---

## The candidate disclosure contract

Read this before writing any candidate-facing code. It is the most safety-critical decision in
the plan, and the mobile client already gets it right —
[candidate_result_page.dart](../mobile_desktop_app_version/lib/features/interviews/candidate/candidate_result_page.dart).

**The entire candidate-facing result is three fields:**

| Field | Meaning |
|---|---|
| `result.outcome` | `selected` \| `notSelected` \| `pending` |
| `result.rank` / `rankOf` | optional — "4 of 32" |
| `result.candidateNote` | optional — what the recruiter wrote *for them* |

**Never shown to a candidate:** `overallScore`, `recommendation`, `summary`, `strengths`,
`improvements`, `detail.perQuestion`, `detail.kpiAverages`, `twoWayReview.notes`, the résumé
score, or anything else in `result`. Those are a language model's opinion written in hiring
vocabulary, kept for the recruiter to review and edit. Publishing them hands the candidate a
judgement nobody wrote for them and the recruiter may not agree with.

Three properties to preserve exactly:

1. **It is an allowlist, not a filter.** Anything new landing in `result` stays invisible until
   somebody deliberately adds it. A filter leaks by default; an allowlist cannot.
2. **`pending` exists for legacy documents.** A result published before outcomes existed reads
   "we'll be in touch" instead of leaking its raw score.
3. **`resultPublished` is the only gate**, and only a recruiter sets it. No automated path
   writes it — `sync_result`, `save_evaluation` and `save_resume_submission` all document why.

> **Correction to an earlier draft of this plan:** it proposed widening `/sessions/mine`'s
> "never includes a score" rule for *published* results. That was wrong. The rule is correct as
> written and stays. What web is missing is the outcome allowlist, not the score.

---

# Stage A — Foundation

*Server-only. No client release. Ship first.*

## Phase 0 — Contract and guardrails

The audit found the `interviews` field names known independently by `app/interviews.py` and
`app/web/services/interview_invite.py`. That duplication is how the clients drifted, and nothing
currently prevents it recurring.

| # | Task |
|---|---|
| 0.1 | Promote `app/interviews.py` into the kernel; add to `KERNEL` in `test_layering.py` |
| 0.2 | Rewrite `interview_invite.build_document` to build through it — delete the second copy of the field names |
| 0.3 | Add `contracts/interview_document.fixtures.json`, a golden file both Python and Dart assert against, as `invite_email.fixtures.json` already works |
| 0.4 | Put the `mode` value set, the `TestSummary` shape and **the candidate disclosure allowlist** in that contract, with a test that fails if a non-allowlisted field reaches a candidate response |

**Verification:** `pytest tests/test_layering.py` green with the new entry; Dart and Python
fixture tests green; no behavioural diff in the live smoke run.

**Risk:** none. Pure consolidation. 0.4 is the test that protects Phase 2.

## Phase 1 — The shared record

Closes D1, D2, D3 and the gap found in review: **`POST /api/web/sessions` writes no `interviews`
document at all**, so a template-created web session is invisible to mobile including its score.

| # | Task | Closes |
|---|---|---|
| 1.1 | `interview_invite` writes `tests/{testId}` alongside the invite batch, in the mobile `TestSummary` shape | D1 |
| 1.2 | `POST /sessions` writes an `interviews/{id}`; session id becomes the interview id, as the invite bridge already does | new |
| 1.3 | Promote `web_reports` → `reports/{interviewId}` into the kernel | D3 |
| 1.4 | Split the result contract: flat summary + score on `interviews.result` (which the frozen Dart reader already reads), rich per-question / KPI / integrity detail in `reports/{interviewId}` | D3 |
| 1.5 | `sync_result` writes for **every** session, not only `viaInvite` — that flag stops being a branch | dec. 3 |
| 1.6 | Mobile's `save_evaluation` writes the same two places | dec. 3 |
| 1.7 | Web sessions list and report route read the shared record. Delete the `"overallScore": None` line in `_recruiter_pending_invites` | D2, D3 |

**On 1.4** — this is what makes decision 3 a standardization rather than a fallback. Flat fields
stay where the frozen mobile model already reads them; rich detail gets one home addressed by
interview id. No reader needs to know which platform ran the interview.

**Verification:** run a batch on web, take it on mobile, confirm score and full report on both.
Then the reverse. Both directions before this phase closes.

**Risk:** low. Additive writes, widened reads. `resultPublished` untouched throughout.

---

# Stage B — Parity

*Close every visible gap in what a person can see and do. This is the stage that makes it one
product.*

## Phase 2 — The candidate's outcome on web

Closes D11, the largest gap of the eleven. Verified: the web surface writes `resultPublished`
**only ever as `False`**, at creation, and never sets it true — there is no publish action on the
web surface at all. Web's `CandidateHome` shows pending interviews, a "Completed" badge and a
Start button, and the web source contains **no** `candidateNote`, `result.rank` or `RoundOutcome`
anywhere.

So today a recruiter on web cannot release a result, and a candidate on web is told nothing —
not even about a result published from mobile. It is the last thing a candidate experiences.

**Recruiter side — the writer:**

| # | Task |
|---|---|
| 2.1 | Publish endpoint mirroring mobile's `setPublished`, plus the batch form (`publishTest`) |
| 2.2 | Outcome endpoint writing `result.outcome` / `rank` / `rankOf` / `candidateNote` with **dotted field paths**, so a decision never clobbers the evaluation stored alongside it |
| 2.3 | Batch outcomes mirroring `applyRoundOutcomes`: selected move forward, the rest do not, ranks **stamped** from position — never recomputed on read, or a re-score elsewhere shifts a candidate under them |
| 2.4 | Recruiter UI for deciding a round and releasing it in one go |

**Candidate side — the reader:**

| # | Task |
|---|---|
| 2.5 | Candidate results view on web, gated on `resultPublished` alone |
| 2.6 | Render **only** outcome, rank and note — the Phase 0.4 allowlist, enforced server-side, not by the component |
| 2.7 | Name the round: "Round 2 · Technical Screen". "You're through" means nothing without it |
| 2.8 | `notSelected` is not an error state. Mobile uses `onSurfaceVariant`, not red, deliberately: this is a decision, not a fault |
| 2.9 | Leave `/sessions/mine`'s "never includes a score" rule **exactly as it is** |

**Depends on:** Phase 1 (reads the shared record), Phase 0.4 (the allowlist test).

**Verification:** publish on mobile → visible on web; publish on web → visible on mobile. **An
unpublished result stays invisible to the candidate on both platforms** — write that test before
the feature. Then assert no candidate-facing response contains any non-allowlisted `result` key.

**Risk: medium, and it is disclosure risk, not breakage.** Every read path here is one a
candidate reaches. Review 2.5–2.9 as one change, against `resultPublished` and the allowlist.

## Phase 3 — Recruiter action parity on web

Three mobile capabilities with no web equivalent. Surfaced while checking recruiter parity for
this final plan.

| # | Task |
|---|---|
| 3.1 | **Round leaderboard.** Mobile's `fetchLeaderboardPage` ranks best-score-first and only ranks *scored* candidates, with an explicit `>= 0` filter — so a `result` map carrying a null `overallScore` is not ranked, and the UI reports the gap rather than looking complete. Port both properties |
| 3.2 | **Evaluation retry.** `fetchRetryableEvaluations` finds completed interviews with an empty `evaluatedBy` and stored `responses`, so a failed scoring run is re-runnable **without making the candidate sit the interview again**. Web has no equivalent; a failed evaluation is currently terminal |
| 3.3 | **Clear result / retake.** Mobile's `clearResult` drops the result, un-publishes and resets status while keeping the assignment — distinct from deleting it |
| 3.4 | Ensure `completeWithoutScore` semantics hold on web: **no `overallScore` key at all**, never a 0. A 0 puts the candidate on the leaderboard in last place as though they earned it |

**Already at parity — do not "fix" it:** two-way recruiter review exists on both, and both map
stars × 20 onto the same 0–100 scale (`sessions_twoway.py:229`, `saveTwoWayReview`).

**Verification:** a failed evaluation is retryable from either client; a cleared result lets the
candidate retake on either client; leaderboards agree.

**Risk:** low. Mobile's implementations are the spec.

## Phase 4 — Quick fixes

| # | Task | Closes |
|---|---|---|
| 4.1 | Stop mapping mobile `type: video` onto `video_avatar` in `invite_bridge.track_for` — degrade to the same track, never a richer one with a different vendor and cost | D5 (server half) |
| 4.2 | Password reset on the web `LoginPage` — one `sendPasswordResetEmail`, mirroring mobile | D9 |

**Risk:** none. Independent of everything; ship whenever convenient.

## Phase 5 — Unify email templates

Deliberately separate from Phase 7 so a low-risk merge is not gated behind a high-risk migration.

| # | Task |
|---|---|
| 5.1 | Promote `app/templates_store.py` into the kernel; add to `KERNEL` |
| 5.2 | Point the web surface at `email_templates`; retire `web_invite_email_templates` |
| 5.3 | Unify the ownership key on `recruiterId` — a uid cannot change, an email can. Mobile documents already carry the field |
| 5.4 | Reconcile defaults on mobile's **unstored built-ins**: web seeds a copy per recruiter, which then drifts from the product default and cannot be improved centrally |
| 5.5 | Migrate existing documents, preserving verified-sender config |
| 5.6 | `/api/templates` keeps its path and response shape — frozen contract — serving the unified collection |

**Verification:** a template saved on either platform appears on the other. Locked-token
validation still rejects a template missing the link token.
`contracts/invite_email.fixtures.json` green.

**Risk:** low-medium. Sender config is the part to check by hand.

## Phase 6 — Analytics on the shared record

The two dashboards aggregate different cohorts, so the same recruiter sees different numbers
depending on which client they opened: web joins `web_reports` with `web_sessions` (only
interviews that produced a *web* report), mobile aggregates every `interviews` document.

| # | Task |
|---|---|
| 6.1 | Both surfaces aggregate `interviews` joined with `reports/{interviewId}` |
| 6.2 | Keep web's `coverage` honesty — a KPI only two of fifty interviews scored must still say so |
| 6.3 | Keep mobile's grouping by `testId`, the recruiter's real unit of work |

**Verification:** identical totals, averages and coverage for the same recruiter on both. A
straightforward equality test; automate it.

**Risk:** low. Read-only, and the numbers become checkable rather than merely plausible.

---

# Stage C — Tenancy and settings

## Phase 7 — Company tenancy

*Both clients, plus a backfill. **The riskiest phase in the plan.** Gate it.*

Today `store.templates.all()` and `store.question_sets.all()` return every recruiter's content to
every recruiter on the deployment. Scoping this is correct and it is a **visible regression** —
recruiters will see a smaller list than they do now. Do not ship it quietly.

| # | Task | Order |
|---|---|---|
| 7.1 | Promote `web_templates` → `interview_templates`, `web_question_sets` → `question_sets` into the kernel | first |
| 7.2 | Wire `company_key` — it currently has **no importers anywhere in `app/`** | |
| 7.3 | **Backfill before switching:** derive each document's `companyKey` from its creating recruiter's user doc | before 7.5 |
| 7.4 | Documents with no resolvable company stay visible to their creating recruiter alone. **Never write a blank key** — `company_key` already refuses one, and a blank-key bucket is the exact leak it exists to prevent | before 7.5 |
| 7.5 | Switch the reads: `.all()` → `where('companyKey', '==', …)` | last |
| 7.6 | Mobile sign-up collects company, writing `company` + `companyKey` in the web's shape | client |
| 7.7 | Existing accounts with no company: prompt once on next sign-in, both clients | client |

**Verification:** two recruiters in one company see each other's templates; two in different
companies do not; a recruiter with no company sees only their own and is prompted. Run
`test_web_company.py` and `companyKey.test.ts` — they already mirror each other case for case,
including the `ß` divergence between `casefold()` and `toLowerCase()`.

**Risk: high**, and more support risk than technical. Announce it. Keep the backfill idempotent
and re-runnable. Document a rollback to `.all()` that does not require reverting the promotion.

## Phase 8 — Account-level settings

The Gemini model choice is device-local on mobile (`SharedPreferences`) and a **global
singleton** on web (`web_settings`) — so it is neither per-account today, and it decides how
candidates are scored.

| # | Task |
|---|---|
| 8.1 | Move the model choice to `users/{uid}.preferences.geminiModel` |
| 8.2 | Mobile drops `SharedPreferences` persistence and reads the user doc |
| 8.3 | Web reads the same field instead of `web_settings` |
| 8.4 | The Gemini **key** stays a server-side credential in `web_settings`. Only the model choice becomes per-account |

**Why `users/{uid}`:** both clients *already* stream that document live — `AuthGate` on mobile,
`AuthProvider` on web. The preference reaches every signed-in device with no new plumbing and no
polling.

**Verification:** change the model on web, watch it take effect on mobile without a restart.

**Risk:** low. Keep 8.4 strictly separate in review — the key must not follow the preference.

## Phase 9 — Mobile release batch

*Everything needing a Flutter release, shipped together.*

| # | Task | Closes |
|---|---|---|
| 9.1 | Write `mode` on every interview the mobile client creates — additive, nothing renamed | D5 complete |
| 9.2 | ~~Candidate home recognises `mode: "mcq"` and says "open this on the web"~~ **superseded by 11.3** — candidate home now opens `McqPaperPage` | D6 interim |
| 9.3 | Company at sign-up (from 7.6) | D10 |
| 9.4 | Gemini model from the server (from 8.2) | D8 |
| 9.5 | Read the shared report detail from `reports/{interviewId}` | D3 |

**On 9.2** — an MCQ invite reaches mobile as `type: "chat"` with `questions: []`, so without a
gate it opened an empty chat interview. The gate did its job and is **gone**: Phase 11 shipped and
`_launchMcq` opens the paper instead. Routing is still keyed on `mode` rather than `type`, and has
to be — see the comment in `candidate_home.dart`.

**Risk:** low. Release coordination is the real cost — hold 9.1–9.5 until all are ready.

---

# Stage D — Convergence

## Phase 10 — Rounds convergence

*Web adopts the mobile round model; `web_pipelines` retires.*

Three properties make the mobile model the better one. All three must survive the port — they are
the reason for the decision, not incidental detail:

- **Round state is derived from the clock** (`InterviewRound.stateAt`), so nothing stores a status
  field and nothing can go stale. Web currently *authors* status in `web_pipeline_candidates`.
- **The window is propagated onto each assignment** (`_propagateWindow`), because the candidate's
  device has no permission to read round documents. Any web writer inherits this obligation —
  including "end round now", where writing `closedAt` alone locks nobody out.
- **Ranks are stamped, not recomputed.**

| # | Task |
|---|---|
| 10.1 | Promote the round model into the kernel — reader *and* writer, not just today's criteria reader |
| 10.2 | Web writes `tests/{testId}/rounds/{roundId}` and stamps `roundId` / `roundOrder` / `roundKind` on each assignment |
| 10.3 | Port window propagation and stamped ranks to the web writer |
| 10.4 | Migrate `web_pipelines` → rounds; `web_pipeline_candidates` status → assignment stamps |
| 10.5 | Rebuild the pipeline board on the rounds model — keep the board UI, change what backs it |
| 10.6 | Port transition emails onto round outcomes; reuse Phase 2's outcome writer rather than a second path |
| 10.7 | **Support the résumé round kind on web.** Adopting the round model means adopting `roundKind`, and a résumé-scoring round is mobile-only today: `RoundCriteria` (`requiredSkills`, `niceToHave`, `minYears`, `minScore`) is read by `app/interviews.py` and scored by the mobile surface's `/api/resume`. Web's `ResumeUpload` is a different thing — it generates adaptive questions, it does not screen |
| 10.8 | Adopt mobile's `adoptLegacyAssignments` repair: assignments predating a timeline belong to no round, and re-assigning creates a second document per candidate — the same test twice on their screen, both launchable |
| 10.9 | Retire `web_pipelines` and `web_pipeline_candidates` |

**Verification:** a candidate advanced on web appears correctly in the mobile timeline and
leaderboard, and the reverse. **"End round now" on either platform actually locks the candidate
out on the other** — that is the test that catches a missed `_propagateWindow`.

**Risk: high.** Migration plus UI rebuild. Run both models in parallel behind a flag before 10.9,
and keep the old collections read-only for one release rather than deleting them.

## Phase 11 — MCQ on both platforms

*Completes D6. No permanent web-only flow.*

| # | Task | |
|---|---|---|
| 11.1 | Promote `web_mcq_sets` → `mcq_sets` into the kernel | ✅ `scripts/migrate_web_mcq_sets.py` |
| 11.2 | MCQ authoring on Flutter — sections, question types, the pairing that cannot leak its key | ✅ |
| 11.3 | MCQ candidate runtime on Flutter, **through the backend**, so the answer key never reaches the device | ✅ |
| 11.4 | Reuse `mcq_scoring.py` unchanged — exact, instant and reproducible on both platforms | ✅ moved, unchanged |
| 11.5 | Keep completeness enforced at **use**, not at save | ✅ `app/mcq_authoring.py` |
| 11.6 | Remove the 9.2 gate | ✅ |
| 11.7 | `RoundKind.mcq` on Flutter — a recruiter can ASSIGN an assessment from the phone, not only author one | ✅ |

See [MCQ_CROSS_PLATFORM_PLAN.md](MCQ_CROSS_PLATFORM_PLAN.md) for how each of those was built and
what is deliberately left.

**Sub-decision, still open:** `mcq_sets` is recruiter-scoped deliberately — the set *contains the
answer key*, and `db.py` argues shared storage would let every recruiter read every assessment's
key. Company scoping weakens that, though colleagues sharing a question bank is normal.
**Recommendation: keep it recruiter-scoped**, with explicit opt-in sharing later if asked. Do not
fold it into Phase 7 by default.

**Verification (done):** `tests/test_mcq_contract.py` and `test/mcq_contract_test.dart` assert the
same golden `contracts/mcq_paper.fixtures.json` in both languages — the Python side on the
serialised BYTES, the Dart side on whether the reader has anywhere to put a key at all.
`tests/test_mcq_sets_routes.py::test_both_surfaces_clean_a_body_identically` runs one body through
both authoring cleaners, and `test_the_shared_route_and_the_web_route_score_identically` runs one
paper through both scorers.

**Risk:** was medium. The scoring engine was already exact; what actually had to move was the
runtime, because the answer key lived inside `web_sessions`.

## Phase 12 — Consistency hardening

*Adopt each platform's better convention on the other.*

| # | Task |
|---|---|
| 12.1 | Adopt web's four named states on mobile — `EmptyState`, `NoResultsState`, `ErrorState` with retry, `Skeleton`. Mobile has one `AppMessageState` with no retry action, and a bare spinner where a skeleton belongs |
| 12.2 | Adopt mobile's per-document tolerance on web — one malformed record must not break a whole list, as `_parseDocs` already guarantees |
| 12.3 | Give web a shared client-side validation module equivalent to `validators.dart`. Server stays authoritative; this is UX |
| 12.4 | Promote practice results to `practice_sessions/{uid}/…` — they are in `SharedPreferences` today, so a candidate's history dies with a reinstall |
| 12.5 | Promote `web_feedback` → `feedback` and add the prompt to the mobile completion flow. It is the only channel the product has for hearing from candidates |

**Risk:** none.

---

## Accepted asymmetry

One thing this plan deliberately does **not** equalise.

**Report richness differs by the runtime that produced it.** Hume prosody, Rekognition facial
analysis and the ATS scorecard are web-only signals, so a report from a web avatar screening
carries panels a mobile-run interview never had. The alternatives are building vendor
integrations on Flutter nobody asked for, or hiding data the recruiter paid for.

**Accept it, and make it legible rather than invisible:** mobile shows what it has and names what
it is not showing. This never reaches a candidate either way — none of it is on the disclosure
allowlist.

---

## Do not do

- **Do not merge the interview runtimes.** `web_sessions` and the Flutter runner both stay. One
  contract, two engines.
- **Do not rename anything on `/api/*`.** The mobile contract is frozen; every change here is
  additive.
- **Do not show a candidate anything outside the Phase 0.4 allowlist.** Not the score, not the
  recommendation, not strengths or improvements, not per-question detail, not a résumé score.
- **Do not write `resultPublished` from any automated path.** Releasing a result is a recruiter
  action.
- **Do not write `overallScore: 0` for an unscored interview.** Absent means absent.
- **Do not let a credential follow a preference in Phase 8.** The Gemini key stays server-side.
- **Do not write a blank `companyKey`.** Ever.
- **Do not switch Phase 7's reads before its backfill has run and been verified.**
- **Do not act on `Documents/COMMON_BACKEND_MIGRATION_REPORT.md`** — stale, and it contradicts
  the frozen mobile contract.

---

## Sequencing

```
STAGE A — foundation            server only, no client release
  Phase 0   contract + layering                          ← ship first
  Phase 1   the shared record                            ← highest value

STAGE B — parity                close every visible gap
  Phase 2   candidate outcome on web        server + web  ← closes the journey
  Phase 3   recruiter parity on web         server + web
  Phase 4   quick fixes                     server + web
  Phase 5   email templates                 server
  Phase 6   analytics on shared record      server

STAGE C — tenancy and settings
  Phase 7   company tenancy                 both   ⚠ gate ← riskiest
  Phase 8   account settings                both
  Phase 9   mobile release batch            mobile        ← batches 9.1–9.5

STAGE D — convergence
  Phase 10  rounds convergence              both   ⚠ gate ← largest
  Phase 11  MCQ on both                     mobile
  Phase 12  consistency hardening           both
```

Stage A and most of Stage B are server-side. Phases 4, 5 and 6 are mutually independent and can
run in parallel with 2 and 3. Phase 9 batches every Flutter change from 7 and 8. Phases 10 and 11
are the two real projects.

**Do not defer Phase 2 behind Stage C or D.** Those are the expensive architectural phases and
the natural instinct is to do them first, but Phase 2 is the one that changes what a *candidate*
experiences — the difference between "the recruiter's data agrees across platforms" and "the
product behaves the same for everyone who touches it."

### What holds after each phase

| After | A recruiter sees / can do the same… | A candidate sees the same… |
|---|---|---|
| 1 | tests, assignments, scores, reports | — |
| 2 | + publish, outcomes, ranks, notes | **outcome, rank, recruiter's note** |
| 3 | + leaderboard, evaluation retry, retake | + a retryable interview instead of a dead end |
| 4 | | + the track they were actually assigned |
| 5 | + invite and notification templates | |
| 6 | + analytics totals | |
| 7 | + templates and question sets, correctly scoped | |
| 8 | + account settings, on every device | |
| 9 | + tracks honestly labelled from either client | + the right track on either client |
| 10 | + rounds, timelines, résumé screens, transitions | + round progress and stage naming |
| 11 | + MCQ authoring and review | + MCQ assessments |
| 12 | + consistent error, empty and loading behaviour | + practice history that survives a reinstall |

---

*Final plan, 2026-08-21, against `development` @ 756b0106. Decisions: mobile is the reference for
the product model, web for the interview runtime; standardize rather than fall back; company
tenancy is real; web adopts the mobile round model; the candidate disclosure allowlist is
authoritative. One sub-decision remains open — `mcq_sets` scoping in Phase 11.*
