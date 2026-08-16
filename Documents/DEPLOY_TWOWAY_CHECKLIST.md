# Deploy checklist — LiveKit two-way interview

The code on `development` is ready. To make the two-way work in production, set the
env below and wire LiveKit Cloud. Miss #1 or #4 and the two-way silently breaks.

## 1. Backend env (Secret Manager) — REQUIRED
```
TWOWAY_ENGINE=livekit                 # ← critical: default is "daily"; without this
                                      #   the backend hands out Daily rooms and the
                                      #   livekit-client frontend can't connect.
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=API…                  # from LiveKit Cloud → Project API keys
LIVEKIT_API_SECRET=…

# Recording storage — a PRIVATE S3/GCS bucket (candidate video is PII):
LK_S3_ENDPOINT=                       # blank for real AWS S3; set for GCS/MinIO
LK_S3_PUBLIC_ENDPOINT=                # backend fetch endpoint; blank = same as above/AWS
LK_S3_BUCKET=<your-recordings-bucket>
LK_S3_KEY=…  LK_S3_SECRET=…  LK_S3_REGION=…

# Transcription + scoring + auth (existing):
DEEPGRAM_API_KEY=…
GEMINI_API_KEY=…   GEMINI_MODEL=gemini-2.5-flash
FIREBASE_CREDENTIALS_JSON=<service-account JSON>   # or FIREBASE_CREDENTIALS_FILE=path
FIREBASE_PROJECT_ID=talbotiq-9cc4e
```

## 2. Frontend build env
```
VITE_API_BASE=https://<deployed-backend>          # blank = same-origin
VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID
```
The frontend gets the LiveKit room URL + token from the backend — it needs **no**
LiveKit key itself.

## 3. Storage bucket — REQUIRED, keep it PRIVATE
- Create a bucket for recordings; put its creds in `LK_S3_*`.
- **Do NOT make it public.** The backend now reads recordings with authenticated S3
  and serves playback via **presigned URLs** (fix `dd562ff`), so no public access is
  needed — candidate recordings stay private.
- LiveKit Cloud egress writes here (S3/GCS destination).

## 4. LiveKit Cloud webhook — REQUIRED
LiveKit Cloud → **Settings → Webhooks** → add:
```
https://<deployed-backend>/api/web/sessions/twoway/livekit-webhook
```
The backend must be **publicly reachable** for Cloud to call it. Without this, the
recording never gets transcribed/scored.

## 5. Smoke test after deploy
1. Recruiter hosts a two-way → the call opens (LiveKit Cloud).
2. Candidate joins via their invite link (real 2nd account) → both see each other.
3. End → report shows: **video recording (presigned playback)** + **transcript
   (interviewer/candidate split)** + **Gemini scorecard**.
4. Confirm the recordings bucket is **not** publicly listable.

## 6. Before real candidates
- **Rotate** every key exposed during dev (AWS, Firebase, Deepgram, Gemini, Daily, LiveKit).
- Egress on LiveKit Cloud runs server-side (no CPU issue like local laptops) — the
  full MP4 + audio recording works; no `LK_DISABLE_REVIEW_EGRESS` needed in prod.

## Notes
- Daily two-way still works if `TWOWAY_ENGINE=daily` (unchanged) — LiveKit is additive.
- Presigned playback URLs are time-limited (7 days). For indefinite report access,
  presign on report view instead of storing the URL (follow-up, not a blocker).
