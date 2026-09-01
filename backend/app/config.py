"""Runtime configuration, loaded from environment variables / a local .env file.

Everything the service needs is declared here so the rest of the code never
reads os.environ directly. See .env.example for the full list.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    app_name: str = "Mimic Mailer"
    # Comma-separated list of allowed CORS origins. "*" allows any (dev only).
    cors_origins: str = "*"

    # --- Auth ---
    # Shared secret the Flutter app sends as the `X-API-Key` header. When empty,
    # auth is DISABLED (handy for local dev; set it in any real deploy).
    api_key: str = ""

    # --- Delivery ---
    # When true, emails are NOT actually sent — they're logged instead, and the
    # endpoint still returns per-recipient results. No credentials needed.
    dry_run: bool = True

    # Display name used on the "From" header.
    from_name: str = "Mimic"
    # The Gmail address mail is sent from. Needed by both modes below.
    email_user: str = ""

    # Mode A (simplest): Gmail SMTP with a 16-character App Password.
    email_app_password: str = ""
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587

    # Generic SMTP — required for any relay where the LOGIN differs from the SENDER.
    # Brevo is the case that forces this: you authenticate as
    # "…@smtp-brevo.com" but must send From your own verified domain, which Gmail's
    # one-address model cannot express.
    #
    # All three fall back to the Gmail values above when blank, so an existing
    # EMAIL_USER + EMAIL_APP_PASSWORD deployment keeps working with no change:
    #   smtp_user -> email_user
    #   smtp_pass -> email_app_password
    #   mail_from -> "<from_name> <email_user>"
    smtp_user: str = ""
    smtp_pass: str = ""
    # A VERIFIED sender, e.g. "TalbotIQ <talent@yourco.com>". With a relay that is not
    # your own domain's, an unverified From is silently dropped or spam-foldered.
    mail_from: str = ""

    # Mode B: Gmail API with an OAuth refresh token — used when all three are
    # set. Handy where outbound SMTP is blocked (some PaaS hosts).
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gmail_refresh_token: str = ""

    # How many recipients of one /send call are delivered in parallel.
    send_concurrency: int = 5

    # --- Code execution (Coding interview mode) ---
    # The sandboxed Judge0 instance that runs candidate code. BLANK BY DESIGN:
    # unset means the coding mode reports "execution not configured" and runs
    # nothing, which is the only safe default — the alternative fallback would be
    # executing untrusted code in this process, which is the vulnerability itself.
    #
    # This CANNOT be Cloud Run. Judge0 needs a privileged container on a host
    # booted into cgroup v1, and Cloud Run supports neither privileged containers
    # nor the setuid binaries `isolate` is built on. It belongs on a dedicated,
    # disposable Compute Engine VM on a private IP, reached over VPC egress.
    # Documents/CODING_INTERVIEW_MODE_PLAN.md has the reasoning and the costs.
    judge0_url: str = ""
    # Judge0 ships with API authentication DISABLED, so anyone who can reach its
    # port can execute arbitrary code on it. Set this on the judge and here.
    judge0_token: str = ""

    # Who hears about a demo request from the marketing site.
    #
    # A DEFAULT rather than a required setting, because the alternative is worse:
    # an unset variable would mean submissions are captured and silently notify
    # nobody, which is the state this was added to fix. Set LEAD_NOTIFY_TO to
    # redirect it; set it to an empty string to turn the notification off
    # deliberately, which is logged as a choice rather than warned about.
    #
    # Delivery still depends on the mailer being configured (SMTP_USER / SMTP_PASS
    # / MAIL_FROM, or the Gmail API triple). Unconfigured, app/mailer.py runs in
    # dry-run and logs the message it would have sent — the lead is stored either
    # way, so nothing is lost while credentials are pending.
    lead_notify_to: str = "thoshith.a@talbotiq.com"

    # --- Third-party AI providers ---
    # These are the ONLY place these credentials exist. The app never sees them:
    # it either calls a proxy route here, or receives a short-lived Gemini Live
    # token minted from gemini_api_key. Blank = that feature reports 503 rather
    # than failing with a confusing vendor 401.
    gemini_api_key: str = ""
    tavus_api_key: str = ""
    deepgram_api_key: str = ""
    # Daily — the live recruiter↔candidate call (two-way interview track). Blank
    # makes that track report 503; every other track is unaffected.
    daily_api_key: str = ""
    # Cal.com — the availability authority for demo bookings, used by BOTH the
    # marketing embed and the outbound voice agent, so the two cannot double-book
    # the same half hour. Blank makes scheduling raise rather than invent a slot.
    calcom_api_key: str = ""
    calcom_event_type_id: int = 0
    # Exotel — the outbound demo-confirmation call. Blank makes the call queue
    # raise rather than silently skip: a call that never happened and a call that
    # succeeded look identical from the outside otherwise.
    #
    # NOTE the app id. This account answers "API Version v2 not supported", so the
    # v2 AgentStream parameters are unavailable to it and the Voicebot applet's
    # WebSocket is configured on the ExoML FLOW in the dashboard instead. A call is
    # therefore aimed at a flow id, not handed a stream url per call.
    exotel_sid: str = ""
    exotel_api_key: str = ""
    exotel_api_token: str = ""
    exotel_caller_id: str = ""
    exotel_app_id: int = 0
    exotel_subdomain: str = "api.exotel.com"

    # Hume AI — voice prosody for the web AI-Avatar-Screening track. Hume has
    # discontinued its batch Expression-Measurement API, so this is tried first and
    # a Gemini audio analysis stands in when it fails; blank simply skips straight
    # to the fallback. Web surface only.
    hume_api_key: str = ""

    # AWS Rekognition — facial analysis for the web screening track. Web surface
    # only. Blank makes that one feature report 503; nothing else is affected.
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-2"
    # Your Daily subdomain, e.g. "talbotiq" for talbotiq.daily.co. Needed only to
    # build a room URL for the candidate; the recruiter's URL comes back from the
    # room-creation call itself.
    daily_domain: str = ""

    # --- LiveKit — the ALTERNATIVE two-way engine (self-hosted, records the call) ---
    # Selected by twoway_engine="livekit"; "daily" (default) leaves the Daily path
    # in charge and nothing here matters. LiveKit egress records the call, which is
    # what lets a two-way round get a transcript and an automatic scorecard.
    twoway_engine: str = "daily"  # daily | livekit
    livekit_url: str = ""  # ws(s):// URL the client connects to (same for both roles)
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    # Recording storage — any S3-compatible endpoint (GCS / S3 / MinIO).
    lk_s3_endpoint: str = ""  # endpoint the egress workers WRITE to (in-cluster)
    lk_s3_public_endpoint: str = ""  # endpoint the backend FETCHES finished files from
    lk_s3_bucket: str = ""
    lk_s3_key: str = ""
    lk_s3_secret: str = ""
    lk_s3_region: str = "us-east-1"

    # Model used for scoring / question generation (REST generateContent).
    gemini_model: str = "gemini-2.5-flash"
    # Models a caller may request instead of the default. Comma-separated, and an
    # ALLOWLIST rather than free choice: a client must not be able to redirect
    # spend onto an arbitrarily expensive model, but recruiters do legitimately
    # choose between flash and pro.
    gemini_allowed_models: str = "gemini-2.5-flash,gemini-2.5-pro"
    # Native-audio model used for the live voice interview.
    gemini_live_model: str = "models/gemini-2.5-flash-native-audio-preview-09-2025"
    # The WEB voice track's model, which may run ahead of the mobile one.
    #
    # Kept separate deliberately. The mobile app is released on its own cycle and is
    # verified against the model above; changing that value would change the Flutter
    # track's behaviour without a mobile release to verify it. Blank falls back to
    # `gemini_live_model`, so this is additive — unset, nothing changes anywhere.
    #
    # The default here is the newer model because the one above is measurably slower to
    # first audio (2.56s vs 0.86s on the real interview setup, measured against
    # generativelanguage.googleapis.com), and dead air is what a candidate experiences.
    # The Express relay this track was ported from explicitly refused the older model
    # for the same reason (server/services/voice.ts:97, LEGACY_LIVE_MODELS).
    gemini_live_model_web: str = "models/gemini-3.1-flash-live-preview"

    # --- Gemini Live ephemeral tokens ---
    # Minted per interview launch; the client connects straight to Google with one.
    # Grace added to the interview's own duration before the session is cut off.
    gemini_token_expiry_buffer_minutes: int = 10
    # Window the client has to OPEN the session after minting. Google's own
    # default is 60s; the client mints on launch-tap so this is ample.
    gemini_token_connect_window_seconds: int = 120
    # A voice preview is one short spoken line — it needs no interview-length
    # session, and a tight cap limits what a misused preview token can cost.
    gemini_preview_session_minutes: int = 2
    # Reading one Mimic Guide answer aloud (web surface). Generation runs at roughly
    # real time and a max-length answer measures around two minutes, so this leaves
    # headroom without letting a misused token fund an open-ended session.
    gemini_speech_session_minutes: int = 4

    # --- Tavus conversation defaults ---
    # Org infrastructure, applied when the backend creates a conversation. These
    # were text fields in the app's Settings — an AWS assume-role ARN typed on a
    # phone — and are server-side for the same reason the API keys are.
    tavus_enable_recording: bool = False
    tavus_recording_s3_bucket: str = ""
    tavus_recording_s3_region: str = ""
    tavus_aws_assume_role_arn: str = ""
    # Session properties the app used to expose globally. Sensible defaults; the
    # per-interview values (duration, language) still come from the interview.
    tavus_participant_left_timeout: int = 60
    tavus_participant_absent_timeout: int = 300
    tavus_enable_transcription: bool = True

    # --- Rate limiting (per user, per worker) ---
    # Auth proves a caller is a real user; these bound how much one user can
    # spend. In-process counters — see app/ratelimit.py for the caveats.
    rate_limit_enabled: bool = True
    rate_limit_window_seconds: int = 60
    # Minting a Live token hands out a credential. One interview launch needs
    # exactly one, so a low ceiling still leaves room for retries.
    rate_limit_live_token: int = 10
    # Scoring an interview makes a handful of calls; regeneration adds more.
    rate_limit_generate: int = 30
    # Audio uploads: transcription, and starting an avatar conversation.
    rate_limit_media: int = 20
    # Facial-analysis frames (web surface). The browser captures one every 8
    # seconds, so ~7.5/min per candidate — this is 8x that, high enough never to
    # interrupt an interview and low enough to stop a hot loop.
    rate_limit_face: int = 60
    # Mimic Guide chat + its text-to-speech (web surface). A person typing cannot
    # approach this; a retry loop can.
    rate_limit_chat: int = 30
    # NOTE: the three limits above `rate_limit_face` are still counted in-process
    # (see app/ratelimit.py), so N workers allow roughly N x the number shown.
    # When `_LIMITER` is replaced with a shared store the counts become exact —
    # raise live_token/generate/media to 20/90/60 in the SAME change, or callers
    # that pass today will start being throttled.

    # --- Brevo (web surface invite flow) ---
    # REST key, used ONLY to list verified senders for the recruiter's sender picker.
    # Sending itself goes over SMTP (see SMTP_USER/SMTP_PASS above) — this is a
    # different credential from the SMTP key. Blank leaves the picker on manual entry.
    brevo_api_key: str = ""
    # Shared secret guarding the PUBLIC delivery webhook. Brevo sends no bearer token,
    # so this is the only thing authenticating it: configure the same value in
    # Brevo → Transactional → Settings → Webhook, pointing at
    #   https://<host>/api/web/invites/brevo-webhook?token=<this-secret>
    # Blank means the webhook REJECTS everything — it fails closed, because an open
    # endpoint would let anyone rewrite an invite's delivery status.
    brevo_webhook_secret: str = ""
    # Bucket for invite-email logo uploads. Blank falls back to the project's default
    # bucket ("<project>.firebasestorage.app").
    firebase_storage_bucket: str = ""

    # --- Replica-preview cache (web surface) ---
    # Cached previews live in Firebase Storage under "web_face_cache/", never on the
    # server's filesystem — a container's disk is ephemeral and per-worker, so a disk
    # cache would be lost on every deploy and duplicated across workers.
    #
    # EXTRA hostnames the cache may fetch from, on top of the built-in Tavus/CDN
    # list. Comma- or space-separated. This is a security boundary — without the
    # allowlist the endpoint would be an open proxy for any authenticated caller.
    face_cache_hosts: str = ""

    # --- Admin overlay (web surface) ---
    # OPTIONAL, server-only, and NEVER taken from a client: a recruiter whose
    # verified email is listed here is reported as an admin by /api/web/auth/me.
    # Comma- or space-separated. Blank disables it. This is not a role and does
    # not promote a candidate — see app/web/services/users.py.
    admin_emails: str = ""

    # --- Firebase (saved templates only — same project as the mobile app) ---
    firebase_project_id: str = "talbotiq-9cc4e"
    # Path to a service-account JSON file...
    firebase_credentials_file: str = ""
    # ...or that JSON inline (convenient as a single PaaS env var). If both are
    # empty, Application Default Credentials are used.
    firebase_credentials_json: str = ""
    # Firestore collection holding recruiter-saved templates.
    # Must match `templates_store.TEMPLATES_COLLECTION`, which the WEB store reaches
    # directly (it is handed a Firestore client, not a Settings). Not imported from
    # there because `templates_store` imports this module — the constant is asserted
    # equal instead, in tests/test_app.py.
    templates_collection: str = "email_templates"

    # Company scoping for the SHARED recruiter collections (`web_templates`,
    # `web_question_sets`). On by default.
    #
    # A kill switch, not a feature flag. Before this, both were read with `.all()`, so
    # every recruiter on the deployment saw every other recruiter's interview templates
    # and question sets — and turning that off is a VISIBLE change: people see a
    # shorter list than they did yesterday. If the backfill turns out to have missed
    # documents in a way that matters, setting this false restores the old behaviour
    # without deploying reverted code, which is the difference between a config change
    # and an incident.
    #
    # Remove it once the scoping has been live long enough to trust.
    company_scoping_enabled: bool = True

    # Whether the legacy `web_pipelines` model still accepts WRITES.
    #
    # Rounds (`tests/{id}/rounds`) replaced it — see app/rounds.py — and the two ran in
    # parallel while the new timeline was proven. Turning this off is how the old model
    # is RETIRED: existing boards keep rendering, nothing new accumulates, and no data
    # is touched. Reads are deliberately unaffected, because a recruiter mid-hire should
    # not lose sight of a pipeline they are running.
    #
    # Deleting the collections is a separate, later, explicit act —
    # `scripts/delete_web_pipelines.py`. Retiring and deleting are not the same step,
    # and conflating them makes the reversible one irreversible.
    pipelines_writable: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw == "*" or not raw:
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    @property
    def allowed_gemini_models(self) -> set[str]:
        """The requestable models, always including the default."""
        names = {
            m.strip().removeprefix("models/")
            for m in self.gemini_allowed_models.split(",")
            if m.strip()
        }
        names.add(self.gemini_model.strip().removeprefix("models/"))
        return names

    @property
    def live_model_name(self) -> str:
        """The Live model, always in Google's `models/…` resource form."""
        m = self.gemini_live_model.strip()
        return m if m.startswith("models/") else f"models/{m}"

    @property
    def web_live_model_name(self) -> str:
        """The Live model for the WEB voice track, falling back to the shared one."""
        m = self.gemini_live_model_web.strip()
        if not m:
            return self.live_model_name
        return m if m.startswith("models/") else f"models/{m}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
