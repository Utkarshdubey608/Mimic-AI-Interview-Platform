"""Rate conversion and frame alignment for the telephony audio bridge.

A phone call and a realtime model do not agree on anything about audio. Exotel's
Voicebot Applet speaks 16-bit 8 kHz mono PCM and requires every chunk it receives
to be a multiple of 320 bytes; Gemini Live wants 16 kHz in and emits 24 kHz out.
Something has to sit between them and convert, on every frame, for the length of
the call.

That something is this module, and it is deliberately pure: bytes in, bytes out,
no socket, no session, no clock. The rate maths and the frame alignment are where
this bridge will actually go wrong, and a phone call is the worst place to find
out. Everything here is testable on a laptop.

WHY NOT `audioop`. The standard library would do the resampling in a single call,
and `audioop.ratecv` is better at it than this file is. It was removed in Python
3.13. The image pins 3.12, so importing it would buy a one-line implementation and
plant a landmine under the next interpreter upgrade — for a job that, at these
rates, is exact integer arithmetic.

WHY THE RATIOS ARE EASY. 8k -> 16k doubles, 24k -> 8k thirds. Both are integers, so
downsampling can box-average whole groups rather than decimate (which aliases
speech audibly), and upsampling can interpolate linearly between real samples.
Neither is a substitute for a proper polyphase filter, and if the audio sounds
harsh on a real call this is the first place to look — but it is honest arithmetic
rather than a resampler that quietly drifts.
"""

from __future__ import annotations

import struct

# Exotel's required frame size. Chunks it receives must be a multiple of this;
# ~3200 bytes is the 100 ms it recommends, so ten of these is a comfortable write.
CHUNK_BYTES = 320

_INT16_MIN = -32_768
_INT16_MAX = 32_767


def _clamp(value: int) -> int:
    """Averaging and interpolation can land a fraction outside int16. Clamp rather
    than let `struct.pack` raise mid-call."""
    return _INT16_MAX if value > _INT16_MAX else _INT16_MIN if value < _INT16_MIN else value


def resample_pcm16(data: bytes, *, src_hz: int, dst_hz: int) -> bytes:
    """Signed 16-bit little-endian mono PCM, converted between sample rates.

    An odd byte count is REFUSED rather than truncated: half a sample means the
    stream is misframed, and silently dropping the stray byte hides that while the
    audio desynchronises for the rest of the call.
    """
    if len(data) % 2:
        raise ValueError("PCM16 needs an even byte count; got a half sample")
    if src_hz <= 0 or dst_hz <= 0:
        raise ValueError("sample rates must be positive")
    if src_hz == dst_hz or not data:
        return data

    src = struct.unpack(f"<{len(data) // 2}h", data)
    count = round(len(src) * dst_hz / src_hz)
    if count <= 0:
        return b""

    if src_hz % dst_hz == 0:
        # Whole-number decimation. Averaging each group low-passes crudely; taking
        # every Nth sample instead would alias, which on speech is plainly audible.
        factor = src_hz // dst_hz
        out = [
            _clamp(sum(group) // len(group))
            for index in range(count)
            for group in (src[index * factor : (index + 1) * factor] or (0,),)
        ]
    else:
        # Linear interpolation. Exact for a constant signal, which is the property
        # the DC test pins.
        step = (len(src) - 1) / (count - 1) if count > 1 else 0.0
        out = []
        for index in range(count):
            position = index * step
            low = int(position)
            high = min(low + 1, len(src) - 1)
            weight = position - low
            out.append(_clamp(round(src[low] + (src[high] - src[low]) * weight)))

    return struct.pack(f"<{len(out)}h", *out)


class ChunkBuffer:
    """Accumulates audio and releases it only in whole frames.

    The telephony side rejects a short chunk, so a partial frame must be HELD
    rather than sent. `pending` is public because the tests assert nothing is lost
    across pushes, and because during a call it is the one number worth logging
    when audio goes missing.
    """

    __slots__ = ("pending",)

    def __init__(self) -> None:
        self.pending = b""

    def push(self, data: bytes) -> list[bytes]:
        """Add audio; return every whole frame now available, in order."""
        self.pending += data
        out: list[bytes] = []
        while len(self.pending) >= CHUNK_BYTES:
            out.append(self.pending[:CHUNK_BYTES])
            self.pending = self.pending[CHUNK_BYTES:]
        return out

    def clear(self) -> None:
        """Drop everything queued. This is barge-in.

        When the prospect starts talking over the agent, Gemini Live's server-side
        VAD reports the interruption and every byte of the agent's queued speech
        must die immediately. Draining it instead means the agent keeps talking
        over a human for as long as the buffer is deep, which is the single most
        obvious way a voice agent feels broken.
        """
        self.pending = b""

    def flush(self) -> bytes:
        """The remainder, zero-padded to a whole frame. For end-of-utterance only.

        Padding mid-stream would insert silence into continuous speech; at the end
        of a turn it costs at most 20 ms of quiet and lets the last syllable out.
        """
        if not self.pending:
            return b""
        tail = self.pending + b"\x00" * (-len(self.pending) % CHUNK_BYTES)
        self.pending = b""
        return tail
