# TalbotIQ

AI-run screening interviews. A recruiter defines a role and a set of questions; a
candidate takes the interview by chat, voice, video avatar or a live two-way call; the
system transcribes it, scores it against a rubric, and produces a report.

There are three codebases and **one backend**.

```
talbotiq_app/
├── backend/                      FastAPI. The single backend for every client.
├── mobile_desktop_app_version/   Flutter — mobile + desktop.
├── web_version/talbotiq-platform/  React SPA (+ a legacy Express server, superseded).
├── contracts/                    Shared fixtures both languages assert against.
└── Documents/                    Design notes, migration plans, test reports.
```

---

## The one thing to understand first

`backend/` serves **two API surfaces from one app**:

| Surface | Who calls it | Status |
|---|---|---|
| `/api/*` | the Flutter app | **Frozen.** Nothing here may be renamed — the mobile contract is fixed |
| `/api/web/*` | the React app | The Express server ported across, prefix-isolated |

The prefix exists for a concrete reason: `/api/templates` already means *email* templates
on the common surface, and the web app uses that same path for *interview* templates. The
prefix lets both live in one app with neither renamed and no Flutter release.

Web code is deliberately quarantined under `backend/app/web/` so it can be merged into the
common surface later on purpose rather than by accident. A test enforces this
(`tests/test_layering.py`) — web code may import the kernel, but the kernel may never
import web code.

**`web_version/talbotiq-platform/server/` (Express) is superseded.** It still runs, but
all new work goes to the FastAPI port. See
[Documents/WEB_FRONTEND_MIGRATION_TASKS.md](Documents/WEB_FRONTEND_MIGRATION_TASKS.md)
for what the React app has to change to point at it.

---

## backend/

```
app/
├── main.py            builds the app, mounts both surfaces
├── config.py          every setting, from .env
├── security.py        Firebase ID-token verification → AuthedUser
├── firebase.py        Firestore client
├── mailer.py          SMTP (generic — Office 365 in deployment)
├── ratelimit.py
├── providers/         one module per vendor: gemini, tavus, daily, deepgram,
│                      hume, rekognition, brevo
├── routers/           the MOBILE surface (/api/*)
├── interviews.py      the shared `interviews` collection — both clients read it
├── voice.py           Gemini Live setup for the Flutter voice track
└── web/               the WEB surface (/api/web/*), self-contained
    ├── __init__.py    install(app) — the single mount point
    ├── routes/        one module per resource
    ├── services/      the logic: scoring, timing, conversation, question-gen…
    └── store/         Firestore access; 10 `web_`-prefixed collections
tests/                 ~1,125 tests, no network
scripts/               live_smoke.py, live_e2e.py, check_frontend_paths.py
```

Run it:

```bash
cd backend
.venv/bin/python -m uvicorn app.main:app --reload --port 8787
.venv/bin/python -m pytest -q
```

`/docs` for the browsable API, `/openapi.json` for the full route list.

---

## The interview flow

The same shape for every client. A **template** defines the role, track, timing and
rubric; a **session** (web) or **interview** (mobile) is one candidate taking it once.

```
recruiter                                   candidate
────────────────────────────────────────────────────────────────────────
create template ──┐
  (role, track,   │
   rubric, timing)│
                  ▼
        question set ─── fixed, generated from a résumé, or adaptive
                  │
                  ▼
        create session ──► invite email ──►  opens the link, signs in
                                                    │
                                                    ▼
                                            system check (mic/camera)
                                                    │
                                                    ▼
                                     ┌──── the interview runs ────┐
                                     │  one of six tracks, below  │
                                     └────────────┬───────────────┘
                                                  │  transcript accumulates
                                                  ▼
                                            complete
                                                  │
        report ◄────── scored against the rubric ─┘
        (per-question + an overall score computed
         arithmetically, never taken from the model)
```

**The tracks** (`TrackType` in `web_version/talbotiq-platform/shared/types.ts:9`):

| Track | How it runs | Timing |
|---|---|---|
| `chat` | typed answers | fixed-slot |
| `video` | recorded video answers | fixed-slot |
| `chatbot` | a back-and-forth text conversation | conversational |
| `voice` | the browser talks to Gemini Live directly, using a short-lived token | conversational |
| `video_avatar` | a Tavus video persona in a Daily room | conversational |
| `two_way` | a live call with a real interviewer | conversational |

The split matters. **Fixed-slot** tracks (`web/services/timing.py`) give each question a
prep phase and an answer phase, and stamp transitions at the *deadline* rather than
whenever the server noticed — so a slow request cannot shorten a candidate's time.
**Conversational** tracks have no per-question clock; the model leads, and the transcript
is matched back to the planned questions afterwards
(`web/services/avatar_transcript.py`).

---

## Credentials never reach the browser

This is the rule the architecture is built around, and it is why the web version needed
porting at all: it used to let a recruiter paste vendor API keys into the UI.

The server holds every key. Where a client genuinely must talk to a vendor directly —
Gemini Live, because relaying audio through the backend adds latency — the server mints an
**ephemeral token** with the entire session setup locked into it and no `fieldMask`, so
Google ignores whatever setup the client sends. A tampered browser cannot change the
interviewer's instructions, the question script, the voice or the model.

Deepgram is the exception and relays through the backend, because that account's key
cannot mint browser tokens.

Nothing is written to the server filesystem — Firestore or Firebase Storage only, enforced
by `tests/test_no_local_storage.py`.

---

## Data

Firestore, one project. Two groups of collections:

- **Shared** — `interviews`, `users`, `email_templates`. Both clients read these.
- **Web-only** — ten `web_`-prefixed collections (`web_sessions`, `web_templates`,
  `web_reports`, `web_pipelines`, …). Isolated so the port could not disturb the mobile
  app's data.

`contracts/invite_email.fixtures.json` is a golden file that **both** the Python and the
TypeScript invite-email renderers assert against, so the two cannot drift.

---

## Where to look next

| | |
|---|---|
| Backend layout and layering rules | [Documents/BACKEND_CODE_STRUCTURE.md](Documents/BACKEND_CODE_STRUCTURE.md) |
| What the React app must change | [Documents/WEB_FRONTEND_MIGRATION_TASKS.md](Documents/WEB_FRONTEND_MIGRATION_TASKS.md) |
| Live vendor test results + open issues | [Documents/LIVE_TEST_RESULTS.md](Documents/LIVE_TEST_RESULTS.md) |
| Per-project detail | each subproject's own `README.md` |

One open item at the time of writing, in the live-test report: **Firebase Storage has
never been enabled** on the project, which blocks logo upload and the face cache.

Mail for both surfaces goes through the shared TalbotIQ Office 365 mailbox
(`team@talbotiq.com`), replacing the old split of Gmail for mobile and a Brevo relay for
web.

`Documents/COMMON_BACKEND_MIGRATION_REPORT.md` is stale and contradicts the frozen mobile
contract. Don't act on it.
