"""Restricting an interview to particular clients.

A recruiter can say a screen has to be taken in a browser (a coding-heavy one that
needs a keyboard) or on the phone (a field role). The field is additive and absent
means unrestricted, so nothing written before it existed has to be migrated.

**These tests are also where the limits of the feature are written down.** Web is
enforced structurally — reaching `/api/web/*` IS being the browser. Mobile and desktop
are self-reported in a header by the same Flutter binary, so the check stops an honest
mistake and not a determined one. Nothing that actually matters is gated on it.
"""

from __future__ import annotations

import pytest

from app import interviews


# ── normalising what a recruiter chose ────────────────────────────────────────


@pytest.mark.parametrize(
    "value",
    [None, [], "web", 42, ["web", "mobile", "desktop"]],
    ids=["none", "empty", "not-a-list", "number", "all-three"],
)
def test_these_all_mean_unrestricted(value) -> None:
    """Selecting every device and setting no restriction are the SAME policy.

    Storing them as one representation means nothing downstream has to compare lists to
    answer "is this restricted?" — it checks whether the tuple is empty.
    """
    assert interviews.normalise_devices(value) == ()


def test_case_and_whitespace_do_not_create_a_new_device() -> None:
    assert interviews.normalise_devices(["  MoBiLe ", "DESKTOP"]) == ("mobile", "desktop")


def test_the_order_is_canonical_not_whatever_was_sent() -> None:
    """So two equivalent selections produce byte-identical documents."""
    assert interviews.normalise_devices(["desktop", "web"]) == ("web", "desktop")
    assert interviews.normalise_devices(["web", "desktop"]) == ("web", "desktop")


def test_an_unknown_device_is_dropped_not_refused() -> None:
    """This is read on EVERY launch.

    A typo left in a document by some future client must not lock a candidate out of an
    interview they are entitled to take, so the unknown value is ignored and the ones
    that parse still apply.
    """
    assert interviews.normalise_devices(["web", "fax", ""]) == ("web",)


def test_a_document_restricted_to_nothing_recognisable_is_unrestricted() -> None:
    """Better than locking everyone out of an interview nobody can fix."""
    assert interviews.normalise_devices(["fax", "telegram"]) == ()


# ── the header a Flutter client sends ─────────────────────────────────────────


def test_a_client_that_does_not_say_is_unknown() -> None:
    """And unknown is ALLOWED — see the launch tests below."""
    assert interviews.device_from_header(None) is None
    assert interviews.device_from_header("") is None


def test_an_unrecognised_claim_is_unknown_rather_than_trusted() -> None:
    assert interviews.device_from_header("smart-fridge") is None
    assert interviews.device_from_header("MOBILE") == "mobile"


# ── launching ─────────────────────────────────────────────────────────────────


def _interview(**overrides) -> interviews.Interview:
    return interviews.Interview(
        id="i-1",
        recruiter_id="uid-recruiter",
        candidate_email_lower="ada@example.test",
        candidate_name=None,
        recruiter_name=None,
        title="Backend Engineer",
        prompt="",
        **overrides,
    )


def test_an_unrestricted_interview_launches_anywhere() -> None:
    for device in (*interviews.DEVICES, None):
        _interview().ensure_launchable(device)


def test_an_allowed_device_launches() -> None:
    _interview(allowed_devices=("web",)).ensure_launchable("web")


def test_a_disallowed_device_is_refused_and_says_where_to_go() -> None:
    """The message is read by a candidate mid-flow, so it has to name the way out."""
    with pytest.raises(interviews.InterviewNotLaunchable) as caught:
        _interview(allowed_devices=("mobile", "desktop")).ensure_launchable("web")

    assert "the mobile app or the desktop app" in str(caught.value)


def test_a_client_that_did_not_name_itself_is_allowed_through() -> None:
    """An older release sends no header.

    Refusing it would break every candidate on the current version the moment a
    recruiter first used this feature — a far worse failure than the restriction going
    unenforced for one release.
    """
    _interview(allowed_devices=("mobile",)).ensure_launchable(None)


def test_expiry_is_reported_before_the_wrong_device() -> None:
    """Order matters here.

    An expired interview cannot be taken anywhere, so leading with "open the mobile
    app" would send the candidate to a second dead end to be told the same thing.
    """
    from datetime import datetime, timedelta, timezone

    expired = _interview(
        allowed_devices=("mobile",),
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    with pytest.raises(interviews.InterviewNotLaunchable) as caught:
        expired.ensure_launchable("web")

    assert "expired" in str(caught.value)


def test_the_restriction_survives_the_document_round_trip() -> None:
    document = interviews.build_assignment(
        test_id="t",
        recruiter_id="r",
        recruiter_email="r@t.test",
        recruiter_name=None,
        candidate_email="c@t.test",
        title="T",
        mode="chat",
        allowed_devices=["web"],
    )
    assert document["allowedDevices"] == ["web"]
    assert interviews.from_document("i-1", document).allowed_devices == ("web",)


def test_an_unrestricted_document_carries_no_field_at_all() -> None:
    """Absent rather than an empty list, so the common case adds nothing to write and
    nothing to interpret."""
    document = interviews.build_assignment(
        test_id="t",
        recruiter_id="r",
        recruiter_email="r@t.test",
        recruiter_name=None,
        candidate_email="c@t.test",
        title="T",
        mode="chat",
    )
    assert "allowedDevices" not in document
