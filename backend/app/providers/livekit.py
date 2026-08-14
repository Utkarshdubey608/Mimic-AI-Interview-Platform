"""LiveKit — self-hosted live two-way call WITH server-side recording.

An ALTERNATIVE engine to ``app.providers.daily`` for the two-way interview track,
selected by ``settings.twoway_engine == "livekit"``. The Daily path is left
untouched; this file is entirely additive.

Why a second engine exists: Daily's cloud recording is a paid feature, so the
Daily two-way has no transcript and is scored by hand. LiveKit egress records the
call **server-side for free** (self-hosted), which lets the two-way round get a
transcript and an automatic scorecard — the whole point of this work.

It offers the SAME room/token operations as ``DailyClient`` (``ensure_room``,
``room_exists``, ``mint_token``, ``delete_room``) so ``sessions_twoway_livekit``
mirrors the Daily routes with only the client swapped. On top it adds:

* ``start_review_egress`` — one composite **MP4** for recruiter review;
* ``start_participant_audio_egress`` — ONE audio track per participant, tagged
  with their role in the filename, so speaker attribution is deterministic (who
  published the track), not acoustic diarization of a mixed file;
* ``stop_all_egress`` / ``verify_webhook`` — teardown and signed-webhook checks.

The API key/secret never leave this service: the device receives only a ws URL
and a short-lived, role-scoped token.

NOTE: this uses the ``livekit-api`` Python SDK. Class/method names below target a
current ``livekit-api``; confirm them against the version pinned in
``requirements.txt`` when wiring it up (they mirror the proven TS
``livekit-server-sdk`` implementation 1:1).
"""

from __future__ import annotations

import logging
import re
from datetime import timedelta

from livekit import api

from app.providers.base import ProviderClient

logger = logging.getLogger("providers.livekit")

# The room is created at host time and must survive the gap until the browser
# actually connects, so egress has a room to attach to. Generous, self-closing.
ROOM_EMPTY_TIMEOUT_SECONDS = 5 * 60
TOKEN_TTL_SECONDS = 4 * 60 * 60
MAX_PARTICIPANTS = 2

# Stable, role-based identities minted into the token. Egress files are named by
# the publisher's role, so these must be classifiable by ``role_from_identity``.
RECRUITER_IDENTITY = "recruiter"
CANDIDATE_IDENTITY = "candidate"


def room_name_for(interview_id: str) -> str:
    """The room an interview's call happens in — derived, not stored.

    Identical rule to ``daily.room_name_for`` so a session's room name is the
    same whichever engine is active.
    """
    return f"room-{interview_id}"


def role_from_identity(identity: str | None) -> str:
    """Map a participant identity to an interview role.

    The recruiter joins with the ``recruiter`` identity (owner); anyone else is
    the candidate. Deterministic — no acoustic guessing, works with identical
    voices. Also tolerant of legacy/display identities like "Interviewer".
    """
    return "interviewer" if re.search(r"recruit|interview|host|owner", identity or "", re.I) else "candidate"


class LiveKitClient(ProviderClient):
    name = "LiveKit"
    env_var = "LIVEKIT_API_KEY"

    @property
    def api_key(self) -> str:
        return self.settings.livekit_api_key

    @property
    def api_secret(self) -> str:
        return self.settings.livekit_api_secret

    @property
    def is_configured(self) -> bool:
        # Needs the URL and BOTH halves of the key pair, not just the key.
        return bool(
            self.api_key.strip()
            and self.api_secret.strip()
            and self.settings.livekit_url.strip()
        )

    def auth_headers(self) -> dict[str, str]:
        # Unused: the livekit-api SDK signs its own requests. ProviderClient
        # requires the override, so satisfy it and never call ``self.request``.
        return {}

    def _http_url(self) -> str:
        """LiveKit server HTTP endpoint, derived from the ws(s) client URL."""
        url = self.settings.livekit_url.strip()
        return url.replace("wss://", "https://").replace("ws://", "http://")

    def _api(self) -> "api.LiveKitAPI":
        return api.LiveKitAPI(self._http_url(), self.api_key, self.api_secret)

    def _s3(self) -> "api.S3Upload":
        """S3-compatible storage for recordings (GCS / S3 / MinIO)."""
        s = self.settings
        return api.S3Upload(
            access_key=s.lk_s3_key,
            secret=s.lk_s3_secret,
            bucket=s.lk_s3_bucket,
            region=s.lk_s3_region or "us-east-1",
            endpoint=s.lk_s3_endpoint,       # in-cluster endpoint egress writes to
            force_path_style=True,           # required for MinIO
        )

    # --- room + token (mirror DailyClient) ----------------------------------
    async def ensure_room(self, room_name: str, *, now_seconds: int) -> dict:
        """Create the room if absent (idempotent).

        Unlike Daily we create it EXPLICITLY (not on first join) so egress has a
        room to attach to the moment the recruiter hosts. Returns ``{url, name}``
        where ``url`` is the ws URL every client connects to.
        """
        self.require_configured()
        lk = self._api()
        try:
            await lk.room.create_room(
                api.CreateRoomRequest(
                    name=room_name,
                    empty_timeout=ROOM_EMPTY_TIMEOUT_SECONDS,
                    max_participants=MAX_PARTICIPANTS,
                )
            )
        except Exception as exc:  # noqa: BLE001 - create is idempotent
            if "exist" not in str(exc).lower():
                logger.warning("LiveKit create_room %s: %s", room_name, exc)
                raise
        finally:
            await lk.aclose()
        return {"url": self.settings.livekit_url.strip(), "name": room_name}

    async def room_exists(self, room_name: str) -> bool:
        """Whether the recruiter has opened the call yet (candidate's poll gate)."""
        self.require_configured()
        lk = self._api()
        try:
            res = await lk.room.list_rooms(api.ListRoomsRequest(names=[room_name]))
            return len(res.rooms) > 0
        finally:
            await lk.aclose()

    async def mint_token(
        self,
        *,
        room_name: str,
        is_owner: bool,
        user_name: str,
        now_seconds: int,
    ) -> str:
        """A short-lived, role-scoped join token.

        ``is_owner`` maps to LiveKit's ``room_admin`` (can mute/remove). The
        identity is role-based (``recruiter`` / ``candidate``) so per-participant
        egress can name files by role deterministically; the display name is the
        human-facing ``user_name``.
        """
        self.require_configured()
        identity = RECRUITER_IDENTITY if is_owner else CANDIDATE_IDENTITY
        token = (
            api.AccessToken(self.api_key, self.api_secret)
            .with_identity(identity)
            .with_name(user_name[:80])
            .with_ttl(timedelta(seconds=TOKEN_TTL_SECONDS))
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=room_name,
                    can_publish=True,
                    can_subscribe=True,
                    can_publish_data=True,
                    room_admin=is_owner,
                )
            )
        )
        logger.info("minted LiveKit token: room=%s owner=%s", room_name, is_owner)
        return token.to_jwt()

    async def delete_room(self, room_name: str) -> None:
        """End the call for everyone in it (best-effort — rooms self-expire)."""
        self.require_configured()
        lk = self._api()
        try:
            await lk.room.delete_room(api.DeleteRoomRequest(room=room_name))
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not delete LiveKit room %s: %s", room_name, exc)
        finally:
            await lk.aclose()

    # --- egress (Daily has no equivalent) -----------------------------------
    async def start_review_egress(self, room_name: str) -> str:
        """One composite MP4 of the whole call — the recruiter-review recording."""
        self.require_configured()
        lk = self._api()
        try:
            req = api.RoomCompositeEgressRequest(
                room_name=room_name,
                file_outputs=[
                    api.EncodedFileOutput(
                        file_type=api.EncodedFileType.MP4,
                        filepath=f"interviews/{room_name}/{{room_name}}-{{time}}.mp4",
                        s3=self._s3(),
                    )
                ],
            )
            info = await lk.egress.start_room_composite_egress(req)
            return info.egress_id
        finally:
            await lk.aclose()

    async def start_participant_audio_egress(
        self, room_name: str, track_sid: str, identity: str | None
    ) -> str:
        """Record ONE participant's mic to its own OGG, named by their role.

        This is what makes speaker attribution deterministic: whatever is in
        ``spk-interviewer-*.ogg`` is scored as the interviewer, etc. Called from
        the track_published webhook, once per audio track.
        """
        self.require_configured()
        role = role_from_identity(identity)
        lk = self._api()
        try:
            req = api.TrackEgressRequest(
                room_name=room_name,
                track_id=track_sid,
                file=api.DirectFileOutput(
                    filepath=f"interviews/{room_name}/spk-{role}-{{time}}.ogg",
                    s3=self._s3(),
                ),
            )
            info = await lk.egress.start_track_egress(req)
            return info.egress_id
        finally:
            await lk.aclose()

    async def stop_all_egress(self, room_name: str) -> None:
        """Stop every active egress for a room (best-effort).

        Each egress then fires an ``egress_ended`` webhook: the MP4 becomes the
        review recording, each ``spk-*.ogg`` is transcribed under its role.
        """
        self.require_configured()
        lk = self._api()
        try:
            active = await lk.egress.list_egress(
                api.ListEgressRequest(room_name=room_name, active=True)
            )
            for item in active.items:
                try:
                    await lk.egress.stop_egress(
                        api.StopEgressRequest(egress_id=item.egress_id)
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("stop_egress %s: %s", item.egress_id, exc)
        finally:
            await lk.aclose()

    # --- webhook -------------------------------------------------------------
    def verify_webhook(self, raw_body: str, auth_header: str | None):
        """Verify + parse a signed LiveKit webhook, or return None if invalid.

        ``WebhookReceiver`` takes a ``TokenVerifier`` (built from the key pair),
        not the raw key/secret. A missing/blank auth header makes ``receive``
        raise, which is caught here and surfaces as an unverified (None) event.
        """
        try:
            verifier = api.TokenVerifier(self.api_key, self.api_secret)
            receiver = api.WebhookReceiver(verifier)
            return receiver.receive(raw_body, auth_header or "")
        except Exception as exc:  # noqa: BLE001
            logger.warning("LiveKit webhook verify failed: %s", exc)
            return None
