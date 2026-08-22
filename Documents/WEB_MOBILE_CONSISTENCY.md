# Web & Mobile Consistency

One product, two clients. This document records **what is actually shared today**, the
**verified places where the two clients disagree**, and a **decision for each** — chosen
per feature on merit, not by making one platform the source of truth.

Every claim below was read out of the code. File references are clickable.

---

## 1. The seam that already exists

The two clients are not as separate as the directory layout suggests. There is one
Firebase project, one backend, and one genuinely shared collection.

```
                    Firebase Auth (email/password) ── one project
                                  │
                       users/{uid}.role ── live stream on BOTH clients
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        │                                                   │
   Flutter client                                      React client
        │                                                   │
        │            interviews/{id}  ← SHARED              │
        │      frozen Flutter field names + additive         │
        │      web-only keys (mode, role, screening)         │
        │                    │                               │
        │                    │  first open of /take/:id       │
        │                    ▼                               │
        │            web_sessions/{id}  (id == interview id) │
        │            web_templates/invite:{id}                │
        │                    │                               │
        │                    │  on completion                 │
        │                    ▼                               │
        └──────── interviews/{id}.result ◄──────────────────┘
                   (resultPublished untouched — releasing
                    a result stays a recruiter action)
```

What makes this work:

- **Auth is already aligned by design.** [AuthProvider.tsx](web_version/talbotiq-platform/src/features/auth/AuthProvider.tsx) writes the `users/{uid}` doc in the exact shape [auth_service.dart](mobile_desktop_app_version/lib/features/auth/auth_service.dart#L47) uses, both read the role as a live stream, and both fail safe to `candidate`.
- **The invite document is deliberately bi-lingual.** [interview_invite.py](backend/app/web/services/interview_invite.py#L116) writes the frozen Flutter schema first, then additive web-only keys that Dart ignores.
- **The bridge is idempotent.** [invite_bridge.py](backend/app/web/services/invite_bridge.py#L167) uses the interview id as the session id, so a candidate who reloads, changes device or switches platform lands on the same session.
- **The recruiter's web session list already reads `interviews` directly** ([sessions.py:152](backend/app/web/routes/sessions.py#L152)), so mobile-created assignments *do* appear on web.

So the foundation is sound. What follows is where it stops.

---

## 2. Verified defects

These are the things that break the stated final criteria. Each was traced to a specific
line, and each is ranked by how visible it is to a real user.

### D1 — A web-created test batch is invisible on the mobile dashboard

The mobile recruiter home pages over the `tests` collection, not `interviews`
([recruiter_home.dart:152](mobile_desktop_app_version/lib/features/interviews/recruiter/recruiter_home.dart#L152)).
**Nothing in the backend ever writes `tests`** — [interviews.py:36](backend/app/interviews.py#L36) only reads it,
for round criteria. The web invite flow mints `test_id = uuid4()`
([invites.py:317](backend/app/web/routes/invites.py#L317)) and stamps it on each interview
document, but creates no metadata doc.

There is a backfill that derives `tests` docs from `interviews`, and it is guarded:

```dart
if (allowBackfill && _tests.isEmpty && !_triedBackfill)   // recruiter_home.dart:110
```

So the recruiter this hurts most — one who already uses the mobile app, and therefore has
a non-empty `_tests` — is exactly the one whose backfill never fires. Their web batches are
reachable only by pressing "Rebuild test list" by hand.

**Decision: fix on the server.** Write the `tests/{testId}` document in the same
transaction as the invite batch, from `interview_invite`. Adopting the mobile app's
`TestSummary` shape costs one write per batch and makes both dashboards correct with no
client release. Keep the backfill as the repair tool it already is.

### D2 — A mobile-run interview shows no score on web

Scores on the web sessions list come from `web_reports`, keyed by session id. An interview
the candidate took in the Flutter app has no `web_sessions` row and therefore no report, so
it falls through to the pending-invite path — which hardcodes the score away:

```python
"overallScore": None,      # sessions.py:206
```

The score exists. It is on `interviews/{id}.result.overallScore`, written by
[save_evaluation](backend/app/interviews.py#L313). The web list simply does not look there.

**Decision: read the score off the interview document** in `_recruiter_pending_invites`.
The field is already the shared contract both `build_result` and the mobile scorer write to.

### D3 — A mobile-run interview's report is unreachable on web

`GET /api/web/sessions/{id}/report` calls `session_store.load`, which 404s when there is no
`web_sessions` doc ([session_store.py:51](backend/app/web/services/session_store.py#L51)).
A recruiter who ran a batch on mobile cannot open any of those reports in the browser, even
though the summary, strengths, improvements and score are all on the interview document.

**Decision: fall back to the interview document.** When no web session exists but the
caller owns the `interviews/{id}` doc, render the report from `result` — the flat fields plus
the `detail` block that `build_result` already nests there
([invite_bridge.py:305](backend/app/web/services/invite_bridge.py#L305)). Read-only; no
re-scoring.

### D4 — Two multi-round models on one collection, neither aware of the other

| | Mobile | Web |
|---|---|---|
| Round definition | `tests/{testId}/rounds/{roundId}` | `web_pipelines.rounds[]` |
| Stamp on the interview | `roundId`, `roundOrder`, `roundKind` | `pipeline` block |
| Candidate state | derived from the clock (`InterviewRound.stateAt`) | `web_pipeline_candidates.status` |
| Advancing | `applyRoundOutcomes` + ranked leaderboard | `POST /pipelines/{id}/advance` |

Verified: the web source contains no `roundId` anywhere, and `app/web/` never writes one.
The mobile source has no pipeline feature.

Consequence: a candidate advanced through a web pipeline does not appear in the mobile round
timeline, and a mobile round's outcomes and ranks are invisible to the pipeline board. Both
implementations are genuinely good, and they are the deepest conflict here.

**Decision: keep both for now, converge on the mobile model later — and do not let it drift
further meanwhile.** Reasoning:

- The mobile model is the better one. Round state is *derived from the clock*, so it cannot
  go stale; the window is propagated onto each assignment because the candidate's device
  cannot read round documents ([`_propagateWindow`](mobile_desktop_app_version/lib/features/interviews/services/interview_repository.dart#L836)); ranks are *stamped* rather than recomputed, so a re-score elsewhere does not shift a
  candidate's position under them. The web pipeline stores status as authored state.
- But it is also the larger surface, and it is on the frozen client. Migrating web onto it is
  a project, not a consistency pass.
- The cheap, correct thing to do now: have the web pipeline **also** stamp `roundId` /
  `roundOrder` / `roundKind` when it creates a round's interviews, and write the matching
  `tests/{testId}/rounds/{roundId}` document. Additive, no mobile release, and it makes a
  web pipeline legible to the mobile timeline in read-only form.

Record this as the one open decision that needs a product call — see §5.

### D5 — Track fidelity is lost mobile → web

The mobile client writes no `mode`, so the bridge has to guess:

```python
return "video_avatar" if data.get("type") == "video" else "chat"   # invite_bridge.py:66
```

A mobile-created *video* interview opened in a browser becomes a **Tavus avatar
interview** — a different product experience, with a different vendor and cost, from what
the recruiter configured. Everything that is not video collapses to `chat`.

**Decision: write `mode` from the mobile client.** It is an additive field on a document the
mobile app already owns and writes; nothing in the frozen contract is renamed. Until that
ships, the fallback should map `type: video` to `video`, not `video_avatar` — the honest
degradation is the same track, not a richer one nobody asked for.

### D6 — An MCQ invite is undeliverable to the mobile client

MCQ is web-only. An MCQ invite is written with `type: "chat"` (`mcq` is not in `_VIDEO_MODES`),
`mode: "mcq"`, `screening.mcqSetId`, and — because the paper is referenced rather than
embedded — **`questions: []`** ([invites.py:246](backend/app/web/routes/invites.py#L246)).

The mobile client reads `type` and `questions`. It has no MCQ runtime. So a candidate
assigned an MCQ paper who opens the Flutter app sees a chat interview with zero questions.

**Decision: gate it, then build it.** Short term, the mobile candidate home must recognise
`mode: "mcq"` and show "open this on the web" rather than an empty interview — the failure has
to be legible. Longer term MCQ belongs on both clients; it is closed-ended and exactly
scoreable, which makes it the easiest track to port.

**Closed (Phase 11).** The gate is gone; `candidate_home.dart` opens `McqPaperPage`. Routing is
still keyed on `mode` rather than `type`, and has to be — `type` says "chat".

One correction to the reasoning above: "the easiest track to port" was wrong, and it was wrong
in an instructive way. Every other track was a client task, because its record was already
shared. MCQ's runtime lived *inside* `web_sessions` with the resolved paper and its **answer
key**, so the port was a server rebuild first — see
[MCQ_CROSS_PLATFORM_PLAN.md](MCQ_CROSS_PLATFORM_PLAN.md). Being exactly scoreable made the
scoring free to share and said nothing about where the runtime lived.

### D7 — Invite-email templates do not cross platforms

Two stores, no overlap:

| | Collection | Route |
|---|---|---|
| Mobile | `email_templates` | `/api/templates` ([mailer_service.dart:108](mobile_desktop_app_version/lib/features/mailer/services/mailer_service.dart#L108)) |
| Web | `web_invite_email_templates` | `/api/web/invite-email-templates` |

A recruiter's saved template is invisible on the other platform. Note the irony: the
*rendering* is already unified against a golden fixture
(`contracts/invite_email.fixtures.json`) while the *storage* is not.

**Decision: adopt the web model, unify on `email_templates`.** Web's is the stronger
implementation — owner-scoped, with a verified sender, locked-token validation
([invites.py:301](backend/app/web/routes/invites.py#L301)) and per-recipient send status. Move
web's reads and writes to the shared `email_templates` collection with a `recruiterId` scope,
and keep the mobile route serving the same documents. Templates are recruiter-authored
content with no answer key in them, so there is no reason for two homes.

### D8 — Settings that should follow the account are stored on the device

The Gemini model choice is persisted to `SharedPreferences` on mobile
([recruiter_gemini_service.dart:115](mobile_desktop_app_version/lib/features/recruiter/services/recruiter_gemini_service.dart#L115))
and to the server on web (`web_settings`, via `settingsApi.saveGeminiKey`). The same
recruiter gets Flash on their phone and Pro in the browser, silently.

**Decision: adopt the web model.** A preference that changes how candidates are scored is an
account setting, not a device setting. Mobile should read and write it through the server.

### D9 — Password reset exists on mobile only

`sendPasswordReset` is implemented and wired to "Forgot password?" on mobile
([auth_service.dart:79](mobile_desktop_app_version/lib/features/auth/auth_service.dart#L79)).
The web `LoginPage` has no such affordance. Same Firebase project, so a web user's only
recovery route is to install the app.

**Decision: adopt the mobile approach on web.** One `sendPasswordResetEmail` call.

### D10 — Sign-up records a different account shape per platform

Web collects a company name and writes both `company` and `companyKey`
([AuthProvider.tsx:137](web_version/talbotiq-platform/src/features/auth/AuthProvider.tsx#L137)).
Mobile writes neither ([auth_service.dart:47](mobile_desktop_app_version/lib/features/auth/auth_service.dart#L47)).

There is a second, larger finding underneath: **`companyKey` is consumed by nothing.**
[company.py](backend/app/web/shared/company.py) has no importers anywhere in `app/`, and no
query filters on it. All ownership scoping — mobile and web alike — is per-`recruiterId`.
Meanwhile [templates.py](backend/app/web/routes/templates.py) shares `web_templates` and
`web_question_sets` across *every* recruiter on the deployment, which is the thing company
scoping was presumably meant to bound.

**Decision: resolve the intent before copying the field.** Two coherent end states, and
this is a product call, not an implementation one:

1. **Company is real** — then it scopes the shared `templates` / `question_sets`
   collections, mobile must collect it at sign-up, and existing accounts need a backfill.
2. **Company is not a concept** — then drop the field from web sign-up and delete
   `company.py` / `companyKey.ts` rather than leaving a security-shaped abstraction that
   enforces nothing.

Do not have mobile start writing `companyKey` until this is settled. A key written by two
clients and read by none is worse than one written by one.

### D11 — The candidate's outcome does not exist on web

*Found while reviewing the plan against the final criteria. The rest of this audit traced
recruiter data flow; this is the candidate half, and it is the largest gap of the eleven.*

- The web surface writes `resultPublished` **only ever as `False`**, at creation
  ([invite_bridge.py:355](backend/app/web/services/invite_bridge.py#L355),
  [interview_invite.py:136](backend/app/web/services/interview_invite.py#L136)). It never sets
  it true — **there is no publish action on the web surface at all.** Mobile has
  `setPublished`, `publishTest` and `applyRoundOutcomes(publish: true)`.
- Web's `CandidateHome` renders pending interviews, a "Completed" badge and a Start button.
  Nothing else.
- The web source contains **no** `candidateNote`, `result.rank` or `RoundOutcome` anywhere.
  Mobile has a full results surface: dimension scores, strengths and watchpoints, an ATS card,
  the rank within the round, and the recruiter's note written for the candidate.

So a recruiter working on web cannot release a result, and a candidate signing in on web is
told nothing — not even about a result published from mobile. It is the last thing a candidate
experiences, which makes it the most visible "two different products" moment in the product.

**Decision: build it on web, from the shared record — to mobile's disclosure rules.** Publish and
outcome endpoints mirroring mobile's, and a candidate results view gated on `resultPublished`.

**The disclosure rules are the point, not a detail.** Mobile's candidate result surface is a
deliberate **allowlist of exactly three fields** — `outcome`, optional `rank`/`rankOf`, optional
`candidateNote` — and it refuses the score, the recommendation, the AI summary, and the
strengths/improvements lists, because those are the recruiter's working notes written in hiring
vocabulary. `candidate_result_page.dart` states it directly: *"the fields below are an ALLOWLIST,
not a filter. Anything new that lands in `result` stays invisible here until somebody
deliberately adds it."* There is even a `pending` outcome so a result published before outcomes
existed reads "we'll be in touch" rather than leaking its raw score.

So `/sessions/mine`'s "never includes a score" rule is **correct and stays**. An earlier draft of
the plan proposed widening it for published results; that would have published an AI verdict and
a list of the candidate's weaknesses to the candidate. What web is missing is the outcome
allowlist, not the score. See Phase 2 of the plan.

---

## 3. The standardization table, filled in

| Area | Mobile | Web | Decision |
|---|---|---|---|
| Authentication | Firebase email/password, live role stream, **has password reset** | Same, plus company at sign-up, **no password reset** | Already aligned. Add reset to web (D9); settle company first (D10) |
| User / profile data | `users/{uid}`: email, emailLower, role, name | Same + company, companyKey | Same doc, same shape. Resolve the company question (D10) |
| Core interview tracks | chat, video, voice, avatar, two-way, **MCQ** | Same six | ✅ MCQ ported (Phase 11); the gate is gone |
| Recruiter dashboard | pages `tests` (paginated, count aggregates) | lists `web_sessions` + pending invites | Both good. Server must write `tests` so mobile sees web batches (D1) |
| Multi-round | `tests/{id}/rounds` — clock-derived, ranks stamped | `web_pipelines` — authored status | **Open decision** (D4). Mobile model is better; converge later, stamp `roundId` from web now |
| Scores & reports | reads `interviews.result` | reads `web_reports` | Web must fall back to `interviews.result` (D2, D3) |
| Create / edit / delete | Full CRUD, batched, ownership on every query | Full CRUD, owner-scoped server-side | Equivalent. Mobile's batch chunking + "delete round also deletes its assignments" is the better pattern to copy if web grows a rounds writer |
| Validation | Centralised [validators.dart](mobile_desktop_app_version/lib/core/utils/validators.dart) — email, safe-http-URL, clamped int | Server-side per route; client validation ad hoc | Server is authoritative and stays so. Mobile's shared client-side module is the better UX pattern; web should have an equivalent |
| Error handling | `debugPrint` + skip-bad-doc so one malformed record can't break a list | Typed HTTP errors, toasts, `ErrorState` with retry | Mobile's per-document tolerance and web's retryable error surface are both right — adopt each on the other |
| Loading / empty states | [AppMessageState](mobile_desktop_app_version/lib/shared/widgets/app_message_state.dart) (icon/title/subtitle), spinner | Skeletons, `EmptyState`, `NoResultsState`, `ErrorState` | Adopt the web taxonomy. Four named states beat one message widget; skeletons beat a spinner |
| Notifications (email) | `email_templates` | `web_invite_email_templates` | Unify on `email_templates`, web's implementation (D7) |
| Settings | Deliberately no credentials — appearance, recordings, service status | Server-side keys + Gemini model | Both right about credentials. Move the Gemini model server-side on mobile (D8) |
| Data synchronization | writes `interviews`, `tests`, rounds | writes `interviews`, `web_*` | `interviews` is the seam and works. D1–D4 are the leaks |

---

## 4. Deliberately platform-specific — leave these alone

Not every difference is a defect. These stay:

- **Marketing site, WebGL intro, Mimic pages** — web only, by definition.
- **Practice mode** (`practice_page`, `practice_report`, history) — mobile only. A
  candidate rehearsing on their phone is a mobile-shaped behaviour, and there is no web
  equivalent that needs building. **But the data is a different question:** practice results
  are stored in `SharedPreferences`, so a candidate's history does not survive a reinstall or
  follow them to a second phone. The *feature* is platform-specific; the *record* should not
  be device-local. See the residual-asymmetries section of the plan.
- **My Recordings / appearance / font size** — device-local settings for a device-local
  concern.
- **Hume prosody, Rekognition facial analysis, ATS scorecard** — web only, and they depend
  on browser media APIs plus vendors the mobile client does not carry.
- **Navigation shape** — `AuthGate` → shell on mobile, React Router with lazy guards on
  web. Different mechanics, same logical flow (signed out → login; recruiter → recruiter
  shell; candidate → candidate home). Both already route candidates away from recruiter
  functionality and fail safe to least privilege.
- **Deep links vs. take-links** — same destination, platform-native mechanism.

---

## 5. Open decisions needing a product call

Everything else above has a clear technical answer. These two do not:

| Question | Option A | Option B | Status |
|---|---|---|---|
| **Multi-round model** (D4) | Converge web onto the mobile rounds model — better semantics (clock-derived state, stamped ranks), but a real migration of `web_pipelines` | Keep both, bridge read-only by stamping `roundId` from web | **Undecided.** Recommend B now, A as a scheduled project |
| **Is "company" a concept?** (D10) | Yes — scope shared templates/question sets by it, collect on mobile, backfill existing accounts | No — remove the field and both `companyKey` implementations | **Undecided.** Blocks any mobile change. Note that shared templates are currently deployment-wide, which is the risk this would bound |

---

## 6. Suggested order of work

> **Superseded.** [WEB_MOBILE_CONSISTENCY_PLAN.md](WEB_MOBILE_CONSISTENCY_PLAN.md) is the
> authoritative build order — it reflects the decisions taken on D1–D11 (standardize rather
> than fall back; company tenancy is real; web adopts the mobile round model) and adds the
> phases this list predates. The sketch below is kept only as the reasoning that led to it.

Grouped so each step is independently shippable, cheapest and most visible first. Steps 1–4
are all server-side — no client release needed.

1. **D2 + D3** — web reads scores and reports off `interviews.result`. Pure read path; makes
   every mobile-run interview visible on web immediately.
2. **D1** — write `tests/{testId}` from the invite batch. One write; fixes the mobile
   dashboard.
3. **D5** — stop mapping mobile `video` onto `video_avatar`. One line, removes a wrong-vendor
   interview.
4. **D7** — unify email templates on `email_templates`.
5. **D9** — password reset on web. Client-side, small.
6. **D6** — gate MCQ on the mobile candidate home so the failure is legible. *(Done, then
   superseded: MCQ now runs on both clients.)*
7. **D8** — Gemini model server-side on mobile.
8. **D5 (rest) + D4 bridge** — mobile writes `mode`; web stamps `roundId`. Both need a
   mobile release, so they ship together.
9. **D10, then D4 proper** — once the product calls in §5 are made.

---

*Written 2026-08-21 against `development` @ 756b0106. Every defect above was read out of the
code, not inferred from documentation — `Documents/COMMON_BACKEND_MIGRATION_REPORT.md` in
particular is stale and contradicts the frozen mobile contract.*
