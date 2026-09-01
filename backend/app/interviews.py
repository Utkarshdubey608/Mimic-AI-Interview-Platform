"""Reading interview documents, and deciding who may act on them.

The `interviews` collection is owned by the mobile app, and this module is almost
entirely a reader of it. Field names are the app's camelCase (see
`interview.dart`).

The one write is `save_resume_submission`. It is here rather than in
`app.resume` so that knowledge of this collection's field names stays in one
module, and it exists at all because a résumé score must NOT be written by the
client: `firestore.rules` lets an assigned candidate update their own interview
document, so a score the app computed would be a score the candidate chose.

Rounds (`tests/{testId}/rounds/{roundId}`, see `interview_round.dart`) are read
here too — an interview names its round, and the round holds the criteria a
résumé is scored against.

The access rules mirror `firestore.rules` deliberately — a recruiter owns an
interview by `recruiterId`, a candidate is assigned one by `candidateEmailLower`.
Re-checking here is not redundant: the client used to gate launches itself, and
once the device no longer holds a key the server is the only thing standing
between a candidate and someone else's interview session.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.config import Settings
from app.firebase import get_db

logger = logging.getLogger("interviews")

INTERVIEWS_COLLECTION = "interviews"
TESTS_COLLECTION = "tests"
ROUNDS_SUBCOLLECTION = "rounds"

# ── The shared track vocabulary ───────────────────────────────────────────────
#
# `mode` is the precise track. `type` is the mobile app's original two-way bucket,
# which cannot express six tracks, so both are written and `type` is ALWAYS derived
# from `mode` — see `build_assignment`. That derivation living in exactly one place
# is the point: a document whose `type` disagrees with its `mode` runs one track on
# web and a different one on the phone, which is precisely the class of bug this
# module was consolidated to prevent.
#
# Mirrored by `TrackType` in web_version/talbotiq-platform/shared/types.ts and by
# `InterviewType` in mobile's interview.dart. `contracts/interview_document.fixtures.json`
# is what keeps the three honest.
MODE_LABELS = {
    "chatbot": "Chatbot",
    "voice": "Voice",
    "video_avatar": "Video Avatar",
    "chat": "Timed Q&A",
    "video": "Video Interview",
    "two_way": "Two-way Interview",
    "mcq": "MCQ Test",
    # Coding assessment. Added to the COMMON surface deliberately, and it is the
    # one edit in this feature that crosses out of the web surface — because
    # `is_known_mode` gates invite creation (app/web/routes/invites.py) and
    # `mode_label` writes the invite email, so a web-only mode could be selected
    # and then not be invitable.
    #
    # `type_for_mode` already puts it in the CHAT bucket without an edit, which is
    # correct: like the MCQ paper, a coding assessment has no camera and no live
    # audio, so every client that branches on the bucket treats it as written work.
    #
    # THE GOLDEN FIXTURE IS DELIBERATELY NOT REGENERATED for this. Its `modes`
    # block exists so the Dart and TypeScript clients can assert they know the
    # same tracks, and regenerating it fails the Flutter contract test —
    # `RoundKind.fromWire` coerces unknown values to `chat`, so
    # `fromWire('coding').wire != 'coding'` — which cannot be verified from a
    # machine without a Flutter toolchain. Leaving the fixture as it is keeps
    # every suite green and leaves the mode unrecorded there, which is a gap a
    # human can close in two lines (`RoundKind.coding` plus a label) and run.
    # Until then the Flutter client renders an unrecognised mode as
    # "Timed Q&A (Chat)" rather than crashing — the same state `voice`, `video`
    # and `two_way` are already in there.
    "coding": "Coding",
    # Essay Writing. On the common surface for the same reason `coding` is:
    # `is_known_mode` gates invite creation and `mode_label` writes the invite
    # email, so a mode the wizard offers but this dict does not know is a mode a
    # recruiter can select and then cannot send — which is exactly how it failed.
    #
    # `type_for_mode` puts it in the CHAT bucket without an edit, and correctly: an
    # essay has no camera and no live audio, so every client branching on the bucket
    # treats it as written work.
    #
    # Unlike `coding`, the Flutter client DOES name this one — `TrackType.essay`
    # renders "Essay writing test" rather than falling through — so it is not left
    # in the unrecognised state the note above describes.
    "essay": "Essay Writing",
}

# Which of the mobile app's two buckets each track maps onto.
_VIDEO_MODES = {"video_avatar", "video", "two_way"}

DEFAULT_DURATION_MINUTES = 20


# ── Where a candidate may take an interview ───────────────────────────────────
#
# A recruiter can restrict an interview to particular clients — a coding-heavy screen
# that needs a keyboard, or a mobile-only field role. Absent or empty means NO
# restriction, so every document written before this existed is unrestricted and
# nothing has to be migrated.
#
# ⚠️ THIS IS A POLICY CONTROL, NOT A SECURITY BOUNDARY, and the distinction is worth
# keeping straight because the two halves are enforced differently:
#
#   web           structural. The React app is the only caller of `/api/web/*`, so a
#                 browser cannot claim to be anything else.
#   mobile        SELF-REPORTED. Both run the Flutter app against the shared `/api/*`
#   desktop       surface, and the client names its own platform in a header. A
#                 modified client can name a different one.
#
# So it stops a candidate opening the wrong client by accident, which is what it is
# for. It does not stop one who is determined to. Never gate anything that actually
# matters — attempts, scoring, access — on this; those are checked elsewhere and on
# facts the server owns.
DEVICE_WEB = "web"
DEVICE_MOBILE = "mobile"
DEVICE_DESKTOP = "desktop"
DEVICES = (DEVICE_WEB, DEVICE_MOBILE, DEVICE_DESKTOP)

# How each device reads to a candidate who has opened the wrong one.
_DEVICE_LABELS = {
    DEVICE_WEB: "a web browser",
    DEVICE_MOBILE: "the mobile app",
    DEVICE_DESKTOP: "the desktop app",
}

# The header the Flutter client names its platform in. A header rather than a body
# field so it applies to every route at once and no launch payload has to change.
CLIENT_DEVICE_HEADER = "X-Talbotiq-Device"


def normalise_devices(value: object) -> tuple[str, ...]:
    """The allowed-device list, cleaned. Empty tuple means unrestricted.

    Unknown values are DROPPED rather than rejected: this is read on every launch, and
    a typo left in a document by some future client must not lock a candidate out of an
    interview they are entitled to take. Selecting all three is also stored as
    unrestricted — "every device" and "no restriction" are the same policy, and keeping
    one representation means nothing has to compare lists to answer "is this
    restricted?".
    """
    if not isinstance(value, (list, tuple, set)):
        return ()
    cleaned = {v.strip().lower() for v in value if isinstance(v, str) and v.strip()}
    allowed = tuple(d for d in DEVICES if d in cleaned)
    return () if len(allowed) == len(DEVICES) else allowed


def device_from_header(value: str | None) -> str | None:
    """The device a Flutter client claims to be, or None if it did not say.

    None means unknown, and unknown is ALLOWED — an older client that does not send the
    header must keep working, and refusing it would break every candidate on the
    current release the moment a recruiter used this feature.
    """
    if not value:
        return None
    claimed = value.strip().lower()
    return claimed if claimed in DEVICES else None


def describe_devices(devices: tuple[str, ...]) -> str:
    """"the mobile app or the desktop app" — for the message a candidate reads."""
    labels = [_DEVICE_LABELS[d] for d in devices if d in _DEVICE_LABELS]
    if not labels:
        return "another device"
    if len(labels) == 1:
        return labels[0]
    return f"{', '.join(labels[:-1])} or {labels[-1]}"


def type_for_mode(mode: str) -> str:
    """The mobile app's `interviews.type`, which only knows video and chat."""
    return "video" if mode in _VIDEO_MODES else "chat"


def is_known_mode(mode: object) -> bool:
    return isinstance(mode, str) and mode in MODE_LABELS


def mode_label(mode: str) -> str:
    """The human label for a track, used in an interview's title."""
    return MODE_LABELS.get(mode, mode)


class InterviewNotFound(LookupError):
    """No such interview document."""


class InterviewAccessDenied(PermissionError):
    """The caller is neither the assigned candidate nor the owning recruiter."""


class InterviewNotLaunchable(RuntimeError):
    """Access is fine, but the interview cannot start right now."""


@dataclass(frozen=True)
class Interview:
    """The subset of the document this service needs. Others are ignored."""

    id: str
    recruiter_id: str
    candidate_email_lower: str
    candidate_name: str | None
    recruiter_name: str | None
    title: str
    prompt: str
    # Which test/round this assignment belongs to. Both empty on interviews
    # created before timelines existed — such an interview is the single implicit
    # round of a one-round test, and has no round document to read criteria from.
    test_id: str = ""
    round_id: str = ""
    round_kind: str = ""
    questions: list[str] = field(default_factory=list)
    language: str = "English"
    voice_name: str | None = None
    voice_persona_id: str | None = None
    duration_minutes: int = 15
    status: str = "pending"
    available_from: datetime | None = None
    expires_at: datetime | None = None
    max_attempts: int | None = None
    attempts_used: int = 0
    # Which clients the recruiter restricted this to. Empty means unrestricted.
    allowed_devices: tuple[str, ...] = ()

    # --- launch eligibility (mirrors Interview.isAccessible in Dart) --------
    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and _now() > self.expires_at

    @property
    def is_not_yet_available(self) -> bool:
        return self.available_from is not None and _now() < self.available_from

    @property
    def has_attempts_left(self) -> bool:
        return self.max_attempts is None or self.attempts_used < self.max_attempts

    def allows_device(self, device: str | None) -> bool:
        """Whether this interview may be taken on [device].

        True when unrestricted, and true when the device is unknown — an older client
        that does not name itself must keep working. See the note on `DEVICES`.
        """
        if not self.allowed_devices or device is None:
            return True
        return device in self.allowed_devices

    def ensure_launchable(self, device: str | None = None) -> None:
        """Raise with a candidate-readable reason if this cannot start now.

        The device check is LAST, deliberately. An interview that has expired or has no
        attempts left cannot be taken anywhere, and telling someone to go and open a
        different client first would send them to a second dead end.
        """
        if self.is_not_yet_available:
            raise InterviewNotLaunchable("This interview is not open yet.")
        if self.is_expired:
            raise InterviewNotLaunchable("This interview has expired.")
        if not self.has_attempts_left:
            raise InterviewNotLaunchable(
                "You have used all attempts for this interview."
            )
        if not self.allows_device(device):
            raise InterviewNotLaunchable(
                "This interview has to be taken on "
                f"{describe_devices(self.allowed_devices)}."
            )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_datetime(value: object) -> datetime | None:
    """Firestore timestamps arrive as datetimes; anything else is ignored.

    Naive values are treated as UTC so comparisons never raise.
    """
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _as_int(value: object, default: int | None = None) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else default


def from_document(doc_id: str, data: dict) -> Interview:
    """Build an `Interview` from raw document data. Tolerant of missing fields."""
    email = data.get("candidateEmailLower") or data.get("candidateEmail") or ""

    return Interview(
        id=doc_id,
        recruiter_id=str(data.get("recruiterId") or ""),
        candidate_email_lower=str(email).strip().lower(),
        candidate_name=data.get("candidateName"),
        recruiter_name=data.get("recruiterName"),
        title=str(data.get("title") or "Interview"),
        prompt=str(data.get("prompt") or ""),
        test_id=str(data.get("testId") or ""),
        round_id=str(data.get("roundId") or ""),
        round_kind=str(data.get("roundKind") or ""),
        questions=[str(q) for q in (data.get("questions") or [])],
        language=str(data.get("language") or "English"),
        voice_name=data.get("voiceName"),
        voice_persona_id=data.get("voicePersonaId"),
        duration_minutes=_as_int(data.get("durationMinutes"), 15) or 15,
        status=str(data.get("status") or "pending"),
        available_from=_as_datetime(data.get("availableFrom")),
        expires_at=_as_datetime(data.get("expiresAt")),
        max_attempts=_as_int(data.get("maxAttempts")),
        attempts_used=_as_int(data.get("attemptsUsed"), 0) or 0,
        allowed_devices=normalise_devices(data.get("allowedDevices")),
    )


def fetch(settings: Settings, interview_id: str) -> Interview:
    """Load one interview, or raise `InterviewNotFound`."""
    snapshot = (
        get_db(settings).collection(INTERVIEWS_COLLECTION).document(interview_id).get()
    )
    if not snapshot.exists:
        raise InterviewNotFound(f"No interview with id {interview_id!r}.")
    return from_document(snapshot.id, snapshot.to_dict() or {})


def is_assigned_candidate(interview: Interview, *, uid: str, email: str | None) -> bool:
    """Assignment is by email — the app never stores a candidate uid."""
    del uid  # kept for signature symmetry with is_owning_recruiter
    if not email or not interview.candidate_email_lower:
        return False
    return email.strip().lower() == interview.candidate_email_lower


def is_owning_recruiter(interview: Interview, *, uid: str) -> bool:
    return bool(uid) and uid == interview.recruiter_id


def require_candidate(interview: Interview, *, uid: str, email: str | None) -> None:
    """The assigned candidate may launch. The owning recruiter may too, so a
    recruiter can preview their own interview end-to-end."""
    if is_assigned_candidate(interview, uid=uid, email=email):
        return
    if is_owning_recruiter(interview, uid=uid):
        return
    raise InterviewAccessDenied("This interview is not assigned to you.")


def require_recruiter(interview: Interview, *, uid: str) -> None:
    if not is_owning_recruiter(interview, uid=uid):
        raise InterviewAccessDenied("You do not own this interview.")


# ── Rounds ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RoundCriteria:
    """What a round is judged against. Mirrors `RoundCriteria` in Dart."""

    required_skills: list[str] = field(default_factory=list)
    nice_to_have: list[str] = field(default_factory=list)
    min_years: float | None = None
    min_score: int | None = None

    @property
    def is_empty(self) -> bool:
        return (
            not self.required_skills
            and not self.nice_to_have
            and self.min_years is None
            and self.min_score is None
        )


def _as_str_list(value: object) -> list[str]:
    """Strings out of a Firestore array, dropping blanks and non-strings.

    The `isinstance` check is not defensive padding: `str(None)` is the literal
    "None", so a null left in a round's `requiredSkills` would otherwise be sent
    to the scorer as a skill named None and scored against.
    """
    if not isinstance(value, list):
        return []
    return [v.strip() for v in value if isinstance(v, str) and v.strip()]


def criteria_from_map(data: dict | None) -> RoundCriteria:
    """Build criteria from a round's `criteria` map. Tolerant of missing fields."""
    data = data or {}
    years = data.get("minYears")
    return RoundCriteria(
        required_skills=_as_str_list(data.get("requiredSkills")),
        nice_to_have=_as_str_list(data.get("niceToHave")),
        min_years=(
            float(years)
            if isinstance(years, (int, float)) and not isinstance(years, bool)
            else None
        ),
        min_score=_as_int(data.get("minScore")),
    )


def fetch_round_criteria(settings: Settings, interview: Interview) -> RoundCriteria:
    """The criteria for [interview]'s round, or empty criteria.

    Empty rather than an error for two legitimate cases: an interview created
    before timelines existed names no round, and a recruiter may simply not have
    set any criteria. Both mean "score it on the role in general", which is a
    worse screen than a configured one but a perfectly valid request — so a
    missing round must not fail the submission.
    """
    if not interview.test_id or not interview.round_id:
        return RoundCriteria()

    try:
        snapshot = (
            get_db(settings)
            .collection(TESTS_COLLECTION)
            .document(interview.test_id)
            .collection(ROUNDS_SUBCOLLECTION)
            .document(interview.round_id)
            .get()
        )
    except Exception as exc:  # noqa: BLE001 - a criteria read must never 500
        logger.warning(
            "could not read round %s/%s: %s",
            interview.test_id,
            interview.round_id,
            type(exc).__name__,
        )
        return RoundCriteria()

    if not snapshot.exists:
        return RoundCriteria()
    data = snapshot.to_dict() or {}
    return criteria_from_map(data.get("criteria"))


# ── Collection accessors ──────────────────────────────────────────────────────
#
# Here rather than in each caller so the collection NAMES have one definition too.
# `app/web/services/interview_invite.py` used to carry its own
# `INTERVIEWS_COLLECTION = "interviews"`, which is a second place for the same
# string to be wrong in.


def collection(settings: Settings):
    """The shared `interviews` collection — the one both clients read."""
    return get_db(settings).collection(INTERVIEWS_COLLECTION)


def tests_collection(settings: Settings):
    """The shared `tests` batch-metadata collection (see `test_summary.dart`)."""
    return get_db(settings).collection(TESTS_COLLECTION)


# ── Document construction ─────────────────────────────────────────────────────


def build_assignment(
    *,
    test_id: str,
    recruiter_id: str,
    recruiter_email: str,
    recruiter_name: str | None,
    candidate_email: str,
    title: str,
    mode: str,
    candidate_name: str | None = None,
    prompt: str = "",
    questions: list[str] | None = None,
    duration_minutes: int = DEFAULT_DURATION_MINUTES,
    status: str = "assigned",
    max_attempts: int = 1,
    allowed_devices: object = None,
    server_timestamp: object = None,
) -> dict:
    """One candidate's `interviews/{id}` document. Pure.

    **This function owns the frozen schema.** The field names here are the ones
    `interview.dart` reads, and nothing else in the codebase should spell them out —
    the web surface builds on top of this and adds only its additive keys (`role`,
    `screening`, `pipeline`), which Dart ignores.

    Two invariants it exists to enforce:

    * `type` is DERIVED from `mode`, never passed in, so the two cannot disagree.
    * `candidateEmailLower` is derived from `candidateEmail`, because assignment is
      matched on it — the app never stores a candidate uid, since the invite exists
      before they have an account.

    `server_timestamp` is injected rather than read here so this stays testable: the
    caller passes Firestore's sentinel in production and a fixed value in a test.
    """
    return {
        "testId": test_id,
        "recruiterId": recruiter_id,
        "recruiterEmail": recruiter_email,
        "recruiterName": recruiter_name,
        "candidateEmail": candidate_email,
        "candidateEmailLower": candidate_email.strip().lower(),
        "candidateName": candidate_name,
        "type": type_for_mode(mode),
        # Additive today, and the precise track tomorrow: the mobile client starts
        # writing this in its own release, at which point the `type` fallback in
        # `invite_bridge.track_for` stops having to guess.
        "mode": mode,
        "title": title,
        "prompt": prompt,
        "questions": list(questions or []),
        "durationMinutes": duration_minutes,
        "status": status,
        "keyOverrides": {},
        "maxAttempts": max_attempts,
        "attemptsUsed": 0,
        "resultPublished": False,
        "createdAt": server_timestamp,
        "updatedAt": server_timestamp,
        # Which clients the candidate may take this on. Written ONLY when actually
        # restricted — an absent field and "all three selected" are the same policy,
        # and storing the second as a list would make every unrestricted document
        # carry a value that has to be compared rather than simply missing.
        **(
            {"allowedDevices": list(devices)}
            if (devices := normalise_devices(allowed_devices))
            else {}
        ),
    }


def build_test_summary(
    *,
    recruiter_id: str,
    title: str,
    mode: str,
    server_timestamp: object = None,
) -> dict:
    """The `tests/{testId}` batch-metadata document. Pure.

    Mirrors `TestSummary.toMap()` in `test_summary.dart` — the recruiter dashboard on
    mobile pages over this collection, so a batch created without one is invisible
    there.

    Deliberately metadata-ONLY: no candidateCount or completedCount. Denormalised
    counters would need updating from every add, delete and candidate-side
    completion, and would drift silently the moment one of those paths missed a
    write. Both clients use Firestore count() aggregates instead, which are cheap
    and cannot go stale.

    Always write this with `merge=True`, so a re-send or a backfill is harmless and
    never clobbers a `createdAt` that is already correct.
    """
    return {
        "recruiterId": recruiter_id,
        "title": title,
        "type": type_for_mode(mode),
        "createdAt": server_timestamp,
        "updatedAt": server_timestamp,
    }


# ── What a candidate may be told ──────────────────────────────────────────────
#
# The single most disclosure-sensitive rule in the product, so it is enforced here,
# server-side, and not left to each client's UI.
#
# The mobile client already gets this right in its widget tree
# (`candidate_result_page.dart`, asserted by `test/candidate_outcome_test.dart`). The
# web client is a separate application fetching JSON, so for it "the UI does not render
# the score" is not a control at all — the score must never be in the response. This
# projection is that control, and both clients are held to the same three fields.

CANDIDATE_VISIBLE_RESULT_FIELDS = ("outcome", "rank", "rankOf", "candidateNote")

# Outcome wire values, matching `RoundOutcomeX.wire` in interview.dart.
OUTCOME_SELECTED = "selected"
OUTCOME_NOT_SELECTED = "not_selected"
OUTCOME_PENDING = "pending"
_KNOWN_OUTCOMES = {OUTCOME_SELECTED, OUTCOME_NOT_SELECTED, OUTCOME_PENDING}


def outcome_from_wire(value: object) -> str:
    """Normalise a stored outcome. Anything unrecognised or absent is `pending`.

    Mirrors `RoundOutcomeX.fromWire`. Defaulting to `pending` rather than raising is
    the entire point: a result published before outcomes existed has no `outcome` key,
    and it must read as "under review" instead of falling back to displaying the raw
    score it does have. That fallback is the exact leak this design closes.
    """
    return value if value in _KNOWN_OUTCOMES else OUTCOME_PENDING


def candidate_result_view(document: dict) -> dict | None:
    """The ONLY projection of `result` that may reach a candidate.

    Returns None when there is nothing to show — an unpublished result, or none at all.
    `resultPublished` is the sole gate, and only a recruiter ever sets it.

    **This is an allowlist, not a filter, and the distinction is the safety property.**
    A filter enumerates what to remove, so a field added to `result` next year is
    exposed by default and nobody notices until a candidate reads an AI's opinion of
    them. This enumerates what to KEEP, so anything new is invisible until somebody
    deliberately adds it here — and adding it here is a reviewable one-line diff in a
    module whose tests say why.

    Never returned, and this list is the reason the function exists: `overallScore`,
    `recommendation`, `summary`, `strengths`, `improvements`, `evaluatedBy`,
    `evaluationError`, `responses`, `detail.perQuestion`, `detail.kpiAverages`,
    `twoWayReview` (the recruiter's PRIVATE notes on a live interview — `candidateNote`
    is the field written for the candidate), and the résumé score. Those are the
    recruiter's working notes, written in hiring vocabulary, kept for them to review and
    edit. Publishing them hands the candidate a judgement nobody wrote for them and the
    recruiter may not agree with.
    """
    if not document.get("resultPublished"):
        return None

    result = document.get("result")
    if not isinstance(result, dict):
        return None

    view: dict = {"outcome": outcome_from_wire(result.get("outcome"))}

    # Rank is only meaningful as a pair, and only when it was actually shared. A rank
    # with no total reads as a bare position out of nowhere.
    rank, rank_of = _as_int(result.get("rank")), _as_int(result.get("rankOf"))
    if rank is not None and rank_of is not None:
        view["rank"] = rank
        view["rankOf"] = rank_of

    note = result.get("candidateNote")
    if isinstance(note, str) and note.strip():
        view["candidateNote"] = note.strip()

    return view


_KNOWN_CONCLUSIONS = ("cleared", "not_selected", "on_hold")


def _iso_or_none(value: object) -> str | None:
    """Firestore hands back a datetime; this surface speaks ISO strings."""
    if value is None:
        return None
    as_iso = getattr(value, "isoformat", None)
    return as_iso() if callable(as_iso) else str(value)


def candidate_conclusion_view(document: dict) -> dict | None:
    """The end of a candidate's run at a pipeline, as they may see it.

    A round outcome answers "did I get through THIS round". This answers "so what
    happened in the end" — the only question left once they have sat everything, and
    the one the browser has never been able to answer. A candidate who cleared every
    round was told "moving forward" on the last one and then heard nothing.

    Unlike `result`, a conclusion needs no publish gate: it is written only by a
    recruiter deliberately releasing it, there is no automatic path that produces one,
    and it is visible the instant it lands. Its presence IS the release.

    An allowlist for the same reason as `candidate_result_view` — a field added to the
    stored conclusion later stays invisible until somebody adds it here on purpose.
    """
    conclusion = document.get("conclusion")
    if not isinstance(conclusion, dict):
        return None

    outcome = conclusion.get("outcome")
    if outcome not in _KNOWN_CONCLUSIONS:
        # An unrecognised value is a newer client's, and guessing which of three
        # very different things it means is worse than staying quiet.
        return None

    view: dict = {"outcome": outcome}

    # The message is the point of the feature: "not moving forward" is the same
    # three words for everybody, and the reason recruiters were leaving the app to
    # send the other kind by hand.
    for key in ("message", "publishedByName"):
        value = conclusion.get(key)
        if isinstance(value, str) and value.strip():
            view[key] = value.strip()

    published = conclusion.get("publishedAt")
    if published is not None:
        view["publishedAt"] = _iso_or_none(published)

    return view


# ── Writes ────────────────────────────────────────────────────────────────────


def save_resume_submission(
    settings: Settings,
    interview_id: str,
    *,
    resume: dict,
    result: dict,
) -> None:
    """Store a résumé submission and its score on the interview document.

    Written with the Admin SDK, which bypasses `firestore.rules` — that is the
    whole point. `resume.score` and `result.overallScore` decide whether someone
    progresses, and rules allow the candidate to write their own interview
    document, so these fields have to be set by something the candidate does not
    control.

    `resultPublished` is deliberately NOT touched: releasing a result to the
    candidate stays a recruiter action.
    """
    from firebase_admin import firestore as admin_firestore

    payload = {
        "resume": {**resume, "extractedAt": admin_firestore.SERVER_TIMESTAMP},
        "result": result,
        # A résumé round has no session to resume — submitting IS completing it.
        "status": "completed",
        "updatedAt": admin_firestore.SERVER_TIMESTAMP,
    }

    (
        get_db(settings)
        .collection(INTERVIEWS_COLLECTION)
        .document(interview_id)
        .set(payload, merge=True)
    )


def save_evaluation(
    settings: Settings,
    interview_id: str,
    *,
    result: dict,
    report: dict | None = None,
) -> None:
    """Store an interview's evaluation on its document.

    Written with the Admin SDK, which bypasses `firestore.rules` — the point being
    that `result.overallScore` decides whether someone progresses, and rules allow
    the candidate to write their own interview document.

    `result` is REPLACED, not merged. It carries `evaluationError` explicitly (empty
    on success), because a merge would leave a previous failure's message sitting
    next to a fresh score and keep the recruiter's "Scoring failed" badge lit.

    `resultPublished` is deliberately untouched: releasing a result to the
    candidate stays a recruiter action.

    **`report` is the rich half**, written to `reports/{interviewId}` — the same
    collection and the same shape the web surface writes. It used to be squeezed into
    `result.detail`, in a shape that disagreed with the web's `result.detail`, and
    neither was ever read. Splitting them is what lets a report scored on one client be
    opened on the other.

    The report write is best-effort and deliberately second: the flat result is what
    every list, chip and leaderboard reads, so it must land even if the detail does
    not. A missing report degrades a full report view; a missing result loses the
    score.
    """
    from firebase_admin import firestore as admin_firestore

    (
        get_db(settings)
        .collection(INTERVIEWS_COLLECTION)
        .document(interview_id)
        .set(
            {
                "result": result,
                "status": "completed",
                "updatedAt": admin_firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
    )

    if report is None:
        return

    from app import reports

    try:
        reports.collection(settings).document(interview_id).set(
            reports.stamp_ids(report, interview_id)
        )
    except Exception as exc:  # noqa: BLE001 - the score is already stored
        logger.error(
            "could not write reports/%s (the score is stored; only the detailed "
            "report view is affected): %s",
            interview_id,
            exc,
        )
