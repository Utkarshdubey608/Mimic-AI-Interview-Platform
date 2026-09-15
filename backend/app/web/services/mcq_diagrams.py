"""Diagram-based MCQ questions — directions/aptitude, with a real image.

WHY THIS IS NOT A GEMINI CALL. Asking a model to invent a diagram and a matching
answer in one shot has no guarantee the two agree — a model can draw a path that
doesn't match the distance it names, and nothing here could catch that before a
candidate is scored against it. So the direction of construction is reversed: the
ANSWER is computed first, by plain vector arithmetic on a path this module makes
up itself, and the diagram is then drawn FROM that same path. The image and the
key cannot disagree, because they come from the same numbers.

One question type today — a walking-directions problem ("5 km north, then 3 km
east... how far from the start?" / "...in which direction is the finish?") — the
classic aptitude-test diagram. More types can be added the same way: compute the
truth, then render it.
"""

from __future__ import annotations

import base64
import io
import math
import random
import uuid

from PIL import Image, ImageDraw, ImageFont

# (dx, dy) per unit distance, in image space where +y is UP (screen y is flipped
# when drawing).
_DIRECTIONS: dict[str, tuple[int, int]] = {
    "North": (0, 1), "South": (0, -1), "East": (1, 0), "West": (-1, 0),
}
_COMPASS_8 = [
    "North", "North-East", "East", "South-East",
    "South", "South-West", "West", "North-West",
]


def _compass_of(dx: float, dy: float) -> str:
    """The 8-point compass direction of a vector from the origin. `(0, 0)`
    reads as "the same point" and is handled by the caller, never here."""
    angle = (math.degrees(math.atan2(dx, dy)) + 360) % 360  # 0 = North, clockwise
    index = round(angle / 45) % 8
    return _COMPASS_8[index]


def _load_font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)
    except OSError:
        return ImageFont.load_default()


def _render_path(legs: list[tuple[str, float]]) -> bytes:
    """A clean white-background diagram of the walk: an arrow per leg, labelled
    with its direction and distance, plus a marked Start and Finish."""
    width, height = 640, 480
    margin = 100
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    label_font = _load_font(18)
    point_font = _load_font(16)

    points = [(0.0, 0.0)]
    for direction, distance in legs:
        dx, dy = _DIRECTIONS[direction]
        last = points[-1]
        points.append((last[0] + dx * distance, last[1] + dy * distance))

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    span_x = max(max(xs) - min(xs), 1.0)
    span_y = max(max(ys) - min(ys), 1.0)
    scale = min((width - 2 * margin) / span_x, (height - 2 * margin) / span_y)
    min_x, min_y = min(xs), min(ys)

    def to_px(p: tuple[float, float]) -> tuple[float, float]:
        # Screen y grows downward; diagram y (North = up) must be flipped.
        px = margin + (p[0] - min_x) * scale
        py = height - margin - (p[1] - min_y) * scale
        return px, py

    pixel_points = [to_px(p) for p in points]

    for i, (direction, distance) in enumerate(legs):
        start, end = pixel_points[i], pixel_points[i + 1]
        draw.line([start, end], fill=(20, 20, 30), width=3)
        _draw_arrowhead(draw, start, end, fill=(20, 20, 30))
        mid = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        label = f"{distance:g} {direction}"
        box = draw.textbbox((0, 0), label, font=label_font)
        text_w, text_h = box[2] - box[0], box[3] - box[1]
        # Clamped to stay fully inside the canvas — a leg near the right or
        # bottom edge must not push its own label off it.
        tx = min(max(mid[0] + 8, 4), width - text_w - 4)
        ty = min(max(mid[1] - text_h - 6, 4), height - text_h - 4)
        draw.text((tx, ty), label, fill=(20, 20, 30), font=label_font)

    start_px, end_px = pixel_points[0], pixel_points[-1]
    _draw_marker(draw, start_px, "S", (14, 120, 90))
    if end_px != start_px:
        _draw_marker(draw, end_px, "F", (170, 40, 40))

    return _to_png_bytes(img)


def _draw_arrowhead(draw: ImageDraw.ImageDraw, start, end, *, fill, size: float = 10) -> None:
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    for delta in (math.pi / 7, -math.pi / 7):
        wing = (
            end[0] - size * math.cos(angle - delta),
            end[1] - size * math.sin(angle - delta),
        )
        draw.line([end, wing], fill=fill, width=3)


def _draw_marker(draw: ImageDraw.ImageDraw, at, label: str, color) -> None:
    r = 9
    draw.ellipse([at[0] - r, at[1] - r, at[0] + r, at[1] + r], fill=color)
    font = _load_font(15)
    draw.text((at[0] + r + 4, at[1] - r - 2), label, fill=color, font=font)


def _to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


_UNITS = ("km", "m")


def _random_legs(rng: random.Random) -> list[tuple[str, float]]:
    n = rng.randint(2, 4)
    directions = list(_DIRECTIONS.keys())
    legs: list[tuple[str, float]] = []
    last_axis: str | None = None
    for _ in range(n):
        # A leg does not repeat the previous one's axis (walking North then North
        # again is one leg, not two, and would draw as a single overlapping line).
        choices = [d for d in directions if (d in ("North", "South")) != (last_axis == "ns")]
        direction = rng.choice(choices or directions)
        last_axis = "ns" if direction in ("North", "South") else "ew"
        legs.append((direction, float(rng.randint(2, 15))))
    return legs


def _net_displacement(legs: list[tuple[str, float]]) -> tuple[float, float]:
    x, y = 0.0, 0.0
    for direction, distance in legs:
        dx, dy = _DIRECTIONS[direction]
        x, y = x + dx * distance, y + dy * distance
    return x, y


def _distance_question(rng: random.Random, unit: str) -> dict:
    legs = _random_legs(rng)
    dx, dy = _net_displacement(legs)
    correct = math.hypot(dx, dy)

    walk = ", then ".join(f"{d:g} {unit} {dir_}" for dir_, d in legs)
    text = f"A person walks {walk}. How far is the person now from the starting point (in {unit}, to the nearest whole number)?"

    correct_r = round(correct)
    # Distractors: a plausible arithmetic slip each — never the same value as
    # the correct answer, and never negative.
    naive_sum = round(sum(d for _, d in legs))
    wrong = {correct_r}
    candidates = [naive_sum, correct_r + rng.choice([-3, 3, 4, -4]), max(1, correct_r - 2)]
    for c in candidates:
        if c not in wrong and c > 0:
            wrong.add(c)
        if len(wrong) == 4:
            break
    while len(wrong) < 4:
        wrong.add(max(1, correct_r + len(wrong) * 2))

    values = sorted(wrong)
    rng.shuffle(values)
    return _build(text, [f"{v} {unit}" for v in values], f"{correct_r} {unit}", legs)


def _direction_question(rng: random.Random, unit: str) -> dict:
    legs = _random_legs(rng)
    dx, dy = _net_displacement(legs)
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        # Ended exactly where they started — not a useful "which direction" question.
        return _distance_question(rng, unit)
    correct = _compass_of(dx, dy)

    walk = ", then ".join(f"{d:g} {unit} {dir_}" for dir_, d in legs)
    text = f"A person walks {walk}. In which direction is the person now from the starting point?"

    others = [d for d in _COMPASS_8 if d != correct]
    rng.shuffle(others)
    options = [correct] + others[:3]
    rng.shuffle(options)
    return _build(text, options, correct, legs)


def _build(text: str, option_texts: list[str], correct_text: str, legs: list[tuple[str, float]]) -> dict:
    options = [{"id": uuid.uuid4().hex[:8], "text": t} for t in option_texts]
    correct_id = next(o["id"] for o in options if o["text"] == correct_text)
    png = _render_path(legs)
    return {
        "id": str(uuid.uuid4()),
        "text": text,
        "type": "single",
        "options": options,
        "correctOptionIds": [correct_id],
        "topic": "Directions & Diagrams",
        "imageDataUrl": _data_url(png),
    }


def generate_diagram_questions(count: int, *, seed: str | None = None) -> list[dict]:
    """`count` directions/aptitude questions, each with its own rendered diagram
    and a correct answer computed independently of it — never Gemini-generated."""
    rng = random.Random(seed)
    questions = []
    for _ in range(max(1, min(count, 20))):
        unit = rng.choice(_UNITS)
        builder = rng.choice([_distance_question, _direction_question])
        questions.append(builder(rng, unit))
    return questions
