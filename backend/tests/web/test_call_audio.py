"""The telephony <-> model audio bridge, as pure arithmetic.

Exotel's Voicebot Applet speaks 16-bit 8 kHz mono PCM in chunks that must be a
multiple of 320 bytes. Gemini Live wants 16 kHz in and emits 24 kHz out. Nothing
here touches a socket: if the rate conversion or the chunk alignment is wrong,
that is a bug you can catch on a laptop, and the phone call is the worst possible
place to discover it.

`audioop` would do the resampling in one call. It is deliberately not used: it was
removed in Python 3.13 and this image pins 3.12, so it is an upgrade landmine for
a job that is exact integer arithmetic.
"""

from __future__ import annotations

import struct

import pytest

from app.web.services.call_audio import (
    CHUNK_BYTES,
    ChunkBuffer,
    resample_pcm16,
)


def _pcm(samples: list[int]) -> bytes:
    return struct.pack(f"<{len(samples)}h", *samples)


def _samples(data: bytes) -> list[int]:
    return list(struct.unpack(f"<{len(data) // 2}h", data))


# ── rate conversion ───────────────────────────────────────────────────────────


def test_upsampling_8k_to_16k_doubles_the_sample_count() -> None:
    out = resample_pcm16(_pcm([100, 200, 300]), src_hz=8_000, dst_hz=16_000)
    assert len(_samples(out)) == 6


def test_downsampling_24k_to_8k_thirds_the_sample_count() -> None:
    out = resample_pcm16(_pcm([1, 2, 3, 4, 5, 6]), src_hz=24_000, dst_hz=8_000)
    assert len(_samples(out)) == 2


def test_a_constant_signal_survives_resampling_unchanged() -> None:
    """A DC signal has no frequency content to lose, so any correct resampler
    returns it untouched. Catches interpolation that rings or drifts."""
    out = resample_pcm16(_pcm([1000] * 8), src_hz=8_000, dst_hz=16_000)
    assert set(_samples(out)) == {1000}


def test_duration_is_preserved_across_conversion() -> None:
    src = _pcm([0] * 800)  # 100 ms at 8 kHz
    out = resample_pcm16(src, src_hz=8_000, dst_hz=16_000)
    assert len(_samples(out)) / 16_000 == pytest.approx(len(_samples(src)) / 8_000)


def test_the_same_rate_is_returned_untouched() -> None:
    src = _pcm([5, 6, 7])
    assert resample_pcm16(src, src_hz=8_000, dst_hz=8_000) == src


def test_a_round_trip_returns_to_the_original_length() -> None:
    src = _pcm(list(range(160)))
    up = resample_pcm16(src, src_hz=8_000, dst_hz=16_000)
    down = resample_pcm16(up, src_hz=16_000, dst_hz=8_000)
    assert len(down) == len(src)


def test_an_odd_byte_count_is_refused_rather_than_silently_truncated() -> None:
    """Half a sample means the stream is misframed. Truncating hides it and the
    audio quietly desynchronises for the rest of the call."""
    with pytest.raises(ValueError):
        resample_pcm16(b"\x01\x02\x03", src_hz=8_000, dst_hz=16_000)


# ── chunk alignment ───────────────────────────────────────────────────────────


def test_chunks_are_always_a_multiple_of_the_frame_size() -> None:
    buf = ChunkBuffer()
    out = buf.push(b"\x00" * (CHUNK_BYTES * 2 + 17))
    assert out and all(len(c) % CHUNK_BYTES == 0 for c in out)


def test_a_partial_frame_is_held_until_it_completes() -> None:
    buf = ChunkBuffer()
    assert buf.push(b"\x00" * (CHUNK_BYTES - 1)) == []
    assert buf.push(b"\x00") == [b"\x00" * CHUNK_BYTES]


def test_nothing_is_lost_across_pushes() -> None:
    buf = ChunkBuffer()
    emitted = b"".join(b"".join(buf.push(bytes([i % 256]) * 100)) for i in range(40))
    assert len(emitted) + len(buf.pending) == 4_000


def test_clear_drops_pending_audio_for_barge_in() -> None:
    """When the prospect speaks over the agent, queued speech must die at once —
    otherwise the agent talks over a human and the call feels broken."""
    buf = ChunkBuffer()
    buf.push(b"\x00" * (CHUNK_BYTES - 4))
    buf.clear()
    assert buf.pending == b""
    assert buf.push(b"\x00" * CHUNK_BYTES) == [b"\x00" * CHUNK_BYTES]


def test_flush_pads_the_remainder_to_a_whole_frame() -> None:
    buf = ChunkBuffer()
    buf.push(b"\x11" * 4)
    tail = buf.flush()
    assert len(tail) == CHUNK_BYTES
    assert tail.startswith(b"\x11" * 4)
    assert buf.pending == b""


def test_flush_with_nothing_pending_emits_nothing() -> None:
    assert ChunkBuffer().flush() == b""
