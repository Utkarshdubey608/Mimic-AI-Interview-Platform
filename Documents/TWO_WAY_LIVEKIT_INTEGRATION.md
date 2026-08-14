# Two-Way Interview — LiveKit Engine (recording + transcript + auto-scoring)

**Owner:** Vaishnavi · **Branch:** `vaishnavi/2_way_interview_update` → PR into `development`
**Status:** design + port plan (implementation in progress)

---

## 1. What this adds — and what it deliberately does *not* touch

The backend already has a working two-way interview (`app/web/routes/sessions_twoway.py` +
`app/providers/daily.py`). It runs over **Daily**, and by design has **no recording, no
transcript, and no model score** — a two-way round is scored **manually** by the recruiter
(the `review` endpoint, stars → `overallScore = stars*20`). That is called out explicitly in
`daily.py`:

> *"Recording is deliberately NOT enabled. Cloud recording is a paid Daily feature, and
> without it there is no transcript — which is why the two-way track is scored [manually]."*

This work adds a **second, self-contained engine** for the two-way track, built on
**self-hosted LiveKit**, which brings the piece Daily can't (without paid recording):

- **Server-side recording** — a composite **MP4** for recruiter review (LiveKit Egress).
- **Per-participant transcription** — each mic is recorded to its own track and transcribed,
  so interviewer vs candidate is separated **deterministically by who published the track**,
  not by acoustic diarization (works even with similar voices).
- **Automatic AI scoring** — the transcript is scored with the existing Gemini pipeline, so a
  two-way round gets a real scorecard, not only a manual star rating.

### Hard rule for this PR: **do not change the Daily path**

The Daily two-way (`sessions_twoway.py`, `daily.py`) stays **byte-for-byte unchanged**. The
LiveKit engine lives entirely in **new files** and is selected by a config flag. Both engines
remain in the codebase and both work after merge. The only shared edit is a one-line
registration switch (glue, not logic — see §4).

---

## 2. The contract already matches (so the API is stable)

Their `host` / `join` / `complete` / `review` already return the same shapes this work was
built against:

| Endpoint | Request | Response |
|---|---|---|
| `POST /sessions/{id}/twoway/host` | — | `{ roomUrl, token, isOwner: true }` |
| `POST /sessions/{id}/twoway/join` | — | `{ roomUrl, token, isOwner: false }` (409 until host opens) |
| `POST /sessions/{id}/twoway/complete` | — | `{ ok: true }` |
| `POST /sessions/{id}/twoway/review` | `{ rating, notes }` | `{ ok: true }` |
| `POST /sessions/twoway/livekit-webhook` **(new)** | LiveKit signed event | `200` |

Because the contract is identical, **the web/mobile clients call the same routes** — only the
engine underneath changes. (Caveat: the *client media SDK* differs — see §7.)

---

## 3. New files (all additive)

Under `backend/app/`:

| File | Purpose | Mirrors / reuses |
|---|---|---|
| `providers/livekit.py` **(new)** | `LiveKitClient(ProviderClient)`: `ensure_room`, `room_exists`, `mint_token(room_name, is_owner, user_name, …)`, `delete_room`; egress: `start_review_egress` (MP4), `start_participant_audio_egress`, `stop_all_egress`; `verify_webhook`, `role_from_identity`. Uses the **`livekit-api`** Python SDK. | mirrors `providers/daily.py` |
| `web/routes/sessions_twoway_livekit.py` **(new)** | The LiveKit `host`/`join`/`complete` (`review` stays shared). `host` also starts the review egress; `complete` stops all egress. | mirrors `sessions_twoway.py` shape |
| `web/routes/twoway_webhook.py` **(new)** | **Unauthenticated, signature-verified** LiveKit webhook. `track_published`→start that participant's audio egress; `egress_ended`→ MP4 sets `recordingUrl`, `spk-{role}-*.ogg`→ transcribe→ role-from-filename→ build transcript→ score→ `reports.put`. | new |
| `web/services/twoway_scoring.py` **(new)** | Adapt the role-tagged transcript into the `responses` shape and call the existing scorer. | reuses `evaluation.py` + `providers/gemini.py` |

---

## 4. The single shared touchpoint (registration glue)

`app/web/routes/__init__.py` auto-includes `sessions_twoway`. To pick the engine **without
editing their two-way logic**, include the Daily module **or** the LiveKit module based on the
flag:

```python
# app/web/routes/__init__.py  (registration only — no two-way logic changes)
if get_settings().twoway_engine == "livekit":
    from . import sessions_twoway_livekit as sessions_twoway   # LiveKit host/join/complete
else:
    from . import sessions_twoway                              # their Daily path (unchanged)
```

`review` and the new webhook are always included (the webhook path is new, so it never
conflicts). Default `twoway_engine="daily"` → their behaviour is the out-of-the-box default;
nothing changes for them unless the flag is flipped.

---

## 5. Config additions (`config.py` + `.env.example`)

Additive, mirroring the existing `daily_*` block:

```
TWOWAY_ENGINE=daily            # daily | livekit  (default daily)
LIVEKIT_URL=wss://…            # ws(s) URL the client connects to
LIVEKIT_API_KEY=…
LIVEKIT_API_SECRET=…
# Recording storage (S3-compatible; GCS/S3/MinIO)
LK_S3_ENDPOINT=…               # egress writes here (in-cluster)
LK_S3_PUBLIC_ENDPOINT=…        # backend fetches finished objects here
LK_S3_BUCKET=…  LK_S3_KEY=…  LK_S3_SECRET=…  LK_S3_REGION=us-east-1
```

`requirements.txt`: add `livekit-api` (room/token/egress/webhook — the Python equivalent of
`livekit-server-sdk`).

---

## 6. Deterministic speaker separation (the correctness win)

Do **not** transcribe one mixed audio file + acoustic diarization — it collapses to a single
speaker when voices are similar. Instead:

1. On `track_published` (audio), start a **track egress** of that one participant's mic →
   `interviews/{room}/spk-{role}-{time}.ogg`, where `role = role_from_identity(identity)`
   (recruiter joins as `Interviewer` → interviewer; anyone else → candidate).
2. On `egress_ended`, the filename carries the role → transcribe that file → every turn is
   that speaker. Interleave the two files by utterance start time.

Result: interviewer questions are attributed to the interviewer and candidate answers to the
candidate — **verified even with one physical voice on both sides.**

---

## 7. ⚠️ Frontend coordination (with Thoshith)

The backend contract is unchanged, but the **client media SDK differs**: the Daily path uses
`daily-js`; the LiveKit path needs **`livekit-client`** (the hook + video tile already built on
the web side). So flipping `TWOWAY_ENGINE=livekit` requires the matching **frontend** to be on
`livekit-client`. This overlaps `WEB_FRONTEND_MIGRATION_TASKS.md` — **coordinate with Thoshith**
so the backend engine and the frontend client land together for the same track.

---

## 8. Infra to deploy alongside

- `livekit-server` (self-hosted, Apache-2.0)
- `livekit/egress` (server-side recording) + **Redis** (egress coordination)
- Object storage for recordings (**GCS/S3**; MinIO for local dev)
- LiveKit webhook configured to POST `…/sessions/twoway/livekit-webhook`

---

## 9. Test checklist (Phase-1 exit)

- [ ] `TWOWAY_ENGINE=daily` → their flow works exactly as before (regression check).
- [ ] `TWOWAY_ENGINE=livekit` → host → join → talk → complete.
- [ ] Report shows the **MP4** recording.
- [ ] Transcript separates **interviewer** vs **candidate** correctly (test solo too).
- [ ] Gemini **scorecard** generated; manual `review` still writes its report.
- [ ] Web + mobile/desktop both exercised end-to-end.

---

## 10. Reference implementation

Every piece here is a proven TypeScript reference (LiveKit `livekit-server-sdk`): dual
recording, `track_published`→per-participant egress, role-by-identity, diarized transcription,
Gemini scoring, and the recruiter live screen (lobby, candidate/job/questions/notes panels,
screen-share, theme). The Python `livekit-api` SDK mirrors it almost 1:1 — this port is
mechanical, not exploratory.
