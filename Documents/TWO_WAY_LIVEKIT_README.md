# Two-Way Interview — LiveKit Engine: README & Integration Guide

**Owner:** Vaishnavi · **Branch:** `vaishnavi/2_way_interview_update` · **PR:** #1 → `development`

This is the practical guide: **what was built, how it works, how to run and verify it,
and exactly what's left to finish the integration.** For the design rationale see
`TWO_WAY_LIVEKIT_INTEGRATION.md` in this folder.

---

## 1. Why this exists

The shared backend already had a two-way (recruiter ↔ candidate) live interview over
**Daily** (`app/providers/daily.py` + `app/web/routes/sessions_twoway.py`). By design it
has **no recording, no transcript, and no model score** — a two-way round is graded **by
hand** (the `review` endpoint, stars → 0-100). Daily's own cloud recording is a paid
feature, so there was never a transcript to score.

This work adds a **second engine, LiveKit**, which records the call **server-side for free**
(self-hosted egress). That unlocks, for the two-way track:

- a **recording** (composite MP4) the recruiter can watch back;
- a **per-participant transcript** with correct interviewer/candidate roles;
- an **automatic Gemini scorecard**, alongside the existing manual review.

## 2. The one rule: additive, Daily untouched

The Daily path is **never modified**. LiveKit lives in **new files**, selected by a single
config flag. Both engines coexist; Daily is the default.

```
TWOWAY_ENGINE=daily     # (default) their existing Daily two-way — unchanged
TWOWAY_ENGINE=livekit   # this engine: records + transcribes + auto-scores
```

The switch is one place — `app/web/__init__.py` picks the LiveKit route module instead of
the Daily one when the flag is set, and mounts the egress webhook. Nothing else changes.

## 3. How it works (data flow)

```
recruiter clicks "host"
  → LiveKitClient.ensure_room()           create the room on the LiveKit server
  → mint OWNER token (identity=recruiter)  roomAdmin=true
  → start_review_egress()                  composite MP4 recording begins

candidate joins (identity=candidate, non-owner token)

each mic track is published
  → track_published webhook
  → start_participant_audio_egress()       ONE audio file per person:
                                           spk-interviewer-*.ogg / spk-candidate-*.ogg

recruiter clicks "complete"
  → stop_all_egress()                      egress finishes → files land in S3/MinIO
  → egress_ended webhook (one per file):
       .mp4          → session.recordingUrl (review video)
       spk-{role}.ogg→ Deepgram transcribe → tag every turn with {role}
                     → build transcript, interleave by time
                     → scoring.score_session()  (existing two_way scorer + Gemini)
                     → store the report
```

**Why per-participant recording matters:** speaker attribution is by *who published the
track*, not by acoustic diarization of a mixed file. So interviewer vs candidate is correct
**even with similar voices or one person testing both sides** — the bug that broke
mixed-audio diarization is gone by construction.

## 4. Files

**New (all additive):**

| File | What it is |
|---|---|
| `app/providers/livekit.py` | LiveKit engine: rooms, tokens, egress (record), webhook verify. Mirrors `providers/daily.py`. |
| `app/web/routes/sessions_twoway_livekit.py` | `host`/`join`/`complete`/`review` over LiveKit. Mirrors `sessions_twoway.py`. |
| `app/web/routes/twoway_webhook.py` | Egress webhook → Deepgram → role split → Gemini score. |
| `Documents/TWO_WAY_LIVEKIT_INTEGRATION.md` | Design/plan doc. |

**Edited (additive only, +55 lines):** `config.py` (settings), `.env.example`,
`requirements.txt` (`livekit-api`), `app/web/__init__.py` (the engine switch).

**Untouched:** `providers/daily.py`, `web/routes/sessions_twoway.py`, mobile
`routers/twoway.py`, and every other track.

## 5. Configuration

```
TWOWAY_ENGINE=livekit
LIVEKIT_URL=wss://livekit.yourhost           # ws(s) URL the client connects to
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
# Recording storage (S3-compatible: GCS / S3 / MinIO)
LK_S3_ENDPOINT=...            # what the egress workers WRITE to (in-cluster)
LK_S3_PUBLIC_ENDPOINT=...     # what the backend FETCHES finished files from
LK_S3_BUCKET=...  LK_S3_KEY=...  LK_S3_SECRET=...  LK_S3_REGION=us-east-1
```

Reuses the existing `DEEPGRAM_API_KEY` and `GEMINI_API_KEY` for transcription/scoring.

## 6. Run it locally (verified recipe)

**Prereqs:** Docker, Python 3.11, `pip install -r backend/requirements.txt`.

1. **Bring up LiveKit + egress + Redis + MinIO** (any LiveKit dev compose works; needs
   `redis` for egress and a bucket for recordings). Point the LiveKit webhook at
   `…/api/web/sessions/twoway/livekit-webhook`.
2. **Configure** the env from §5 (`LIVEKIT_URL=ws://localhost:7880`, dev key/secret, MinIO
   creds). Set `TWOWAY_ENGINE=livekit`.
3. **Run the backend:** `uvicorn app.main:app` (from `backend/`).
4. **Exercise it:** open `/docs`, or `POST /api/web/sessions/{id}/twoway/host` → you get a
   `roomUrl` + token and a real room appears on the LiveKit server; `join` → candidate
   token; `complete` → stops egress and the webhook scores the round.

> Note: `livekit-api`'s `WebhookReceiver` takes a **`TokenVerifier(key, secret)`**, not the
> raw key/secret — already handled in `providers/livekit.py`.

## 7. What was verified (E2E)

Against a live LiveKit server + real Deepgram + real Gemini:
- App boots on both engines; the switch mounts the right routes; Daily default untouched.
- `host`/`join`/`complete` create/join/tear down a real room.
- Egress records; per-participant files produced.
- Webhook → transcript with **both roles separated** → real Gemini scorecard.

---

## 8. What's left to finish the integration

### a. Frontend — `livekit-client` for the two-way (Thoshith / `WEB_FRONTEND_MIGRATION_TASKS`)
The backend returns a **LiveKit** room + token, so the web two-way screens must use
**`livekit-client`**, not `daily-js`. Do it **additively**, mirroring the backend:
- keep `useDailyCall` / `DailyVideoTile` / `@daily-co/daily-js` in place;
- add `useLiveKitCall` / `LiveKitVideoTile` and use them **only** in `TwoWayStage` and
  `LiveInterviewPage`, selected by the same engine flag;
- drop the client-side MediaRecorder (recording is server-side now);
- a working reference implementation exists (the two-way screens already built on
  `livekit-client`). **Until this lands, the two-way won't connect in the web app even with
  this backend merged.**

### b. Deploy the LiveKit infrastructure
- `livekit-server` (self-hosted, Apache-2.0), `livekit/egress` (recording) + **Redis**.
- Object storage for recordings: **GCS** (or S3); set the `LK_S3_*` endpoints.
- Configure the LiveKit **webhook URL** → `…/api/web/sessions/twoway/livekit-webhook`.
- For real cross-network calls, enable TURN over 443 (LiveKit has its own).

### c. Secrets → Secret Manager
Move `LIVEKIT_API_KEY/SECRET`, `LK_S3_*`, `DEEPGRAM_API_KEY`, `GEMINI_API_KEY` into the
platform's secret store; never commit them.

### d. Phase-1 exit test (web + mobile)
- `TWOWAY_ENGINE=daily` → regression: their flow works exactly as before.
- `TWOWAY_ENGINE=livekit` → host → join → talk → complete → report shows the **video**, a
  transcript with **correct roles**, and a **Gemini scorecard**; manual `review` still works.

### e. Rotate the test keys
Rotate any Deepgram / Gemini / Daily / LiveKit keys used during local testing before ship.

---

## 9. Extending later (Phase 2)
- Reconcile the mobile common-surface two-way (`routers/twoway.py`) onto the same engine.
- Optional live controls the provider already supports: mute/remove participant
  (`roomAdmin`), manual record pause/resume, a knock-and-admit lobby.
- Consolidate Daily/LiveKit behind one interface once LiveKit is the chosen engine.
