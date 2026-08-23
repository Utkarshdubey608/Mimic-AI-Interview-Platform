---
name: block-ui-design
description: Design or restyle a mobile/web UI in the "block" design language — near-monochrome surfaces carrying one solid pastel block per screen, large figures, generous radii, and a user-selectable accent. Use when building or restyling any screen or shared component in this language, choosing its colours/spacing/radii/typography, or porting the language to a new app section or a new app. Includes the Flutter layout traps that repeatedly break this kind of layout.
---

# Block UI design language

A near-monochrome interface carrying **one solid pastel block per screen**. The
ground is true black (or warm off-white in light mode), surfaces are barely
lifted from it, and exactly one element is painted in a full-strength pastel
with near-black ink on top.

Portable: nothing below depends on a particular app. Section 7 shows how to
instantiate it in a new section or a new app. For how THIS repo happens to be
wired — file names, which side uses it, where the tests live — read
`talbotiq-wiring.md` beside this file.

---

## 1. The generating rule

**One block per screen.** The hero, *or* the primary button, *or* the selected
chip — not several. Everything else is neutral. Two blocks competing for the
same screen is the single most common way to break this language.

Everything else follows: because only one element is coloured, the palette can
be user-selectable without risking contrast anywhere.

---

## 2. Colour

Four roles, and nothing between them:

| Role | Dark | Light |
|---|---|---|
| **Ground** (page) | true black `#000000` | warm off-white `#F6F3EE` |
| **Surface** (card on the ground) | `#101010` | `#FFFFFF` |
| **Surface-high** (chip/input on a card) | `#1C1C1C` | `#EDE8E0` |
| **Stroke** (hairline, separator) | ~12% white | `#E2DCD2` |

Text: **ink** (primary), **ink-muted** (secondary/metadata), **ink-subtle**
(timestamps, footnotes, inactive glyphs).

The hierarchy is strict: a card sits on the ground, a chip sits on a card.
Skipping a level — a surface-high chip directly on the ground — reads as a
mistake, because each contrast step is tuned for one level.

On a pure-black ground, hairlines need **more** presence than instinct suggests
(~12% white). A fainter border leaves cards with no visible edge at all.

### Blocks

A block is a **solid** pastel field, never a translucent tint, always carrying
the same near-black ink. Two slots:

- **Primary** — the featured card, the primary button, the selected chip.
- **Secondary** — supporting marks: chart bars, meters, trend lines, progress.

Keep them distinct or charts recede into the hero.

### Never spell colours out at a call site

Route every colour through one accessor object. Do not write raw `Color(0x…)`,
palette constants, or `isDark ? x : y` inside a screen. Recolouring the system
must be a change to one file, not a sweep across thirty.

### Semantic colours: distinct, not fixed

The instinct is to pin status colours so states stay distinguishable. That is
the right requirement and the wrong fix — pinning them means most of the colour
on screen ignores the user's choice (a green "Results available" chip on a
screen with no other green in it).

States have to differ **from each other**, not be fixed hues. So map them onto
distinct slots:

| State | Slot |
|---|---|
| ready / done / passing | the **primary** accent |
| pending / in progress / scheduled | the **secondary** accent |
| failed / expired / below the bar | a **fixed** danger red |
| inactive / closed / unknown | muted ink |

Primary and secondary are separate settings, so adjacent states always read
apart; warn in the UI when a user sets both the same. Keep failure fixed —
"this failed" must not be paintable in a celebratory colour, and
red-for-failure is the one convention worth protecting from customisation.

**Category tints are not status.** Colours that distinguish *kinds of thing*
(video vs. voice vs. chat; library sections; chart series of four or more) need
N distinguishable hues and cannot come from two accents. Keep a fixed
categorical palette for those, and say so.

### A light ground needs the tone darkened

A pastel reads strongly on black and sits at roughly **1.4:1 on a light
ground** — present in the layout, invisible to read. Do not hand-pick a second
palette: walk the tone toward the ink until it clears 3:1, so any accent added
later is handled. Test the tones as *text on the page*, in both themes, not
just as fills.

---

## 3. Making the accent user-selectable

Offer a small set of hand-picked pastels, not a colour wheel. Every option must
be tuned to roughly the same lightness so the constant near-black ink stays
readable on all of them — that constraint is what makes the setting safe.

Carry the choice on the theme (`colorScheme.primary` / `.secondary`) rather than
passing it down manually, so any widget reads the live value.

Test the claim rather than asserting it: every option should clear **WCAG AA
(4.5:1)** against the ink, changing the accent must not tint the ground, and the
choice must reach buttons/FAB/indicators — not only the scheme. Persisted values
are a **wire format**: unknown or absent values must fall back, not throw, or an
older build's stored preference crashes the app.

---

## 4. Proportion

Derive a component's sizes from **one** number. A bar 62 tall holding 42-tall
items beside a 46 circle reads as "off" even when nothing is broken; the same bar
built from a single item height reads as intentional.

- Every element in a group: the same height.
- Radius of a stadium: exactly half its height.
- Gaps within a group: identical.
- A container with few children should **hug its content and centre**, not
  stretch edge-to-edge — stretching invents dead space.

Spacing steps: `4 8 12 16 20 24 32`. Nothing between them.
Radii: cards 20 · buttons and inputs 18 · pills 12 · badges 8 · sheets 26-28 ·
stadiums half their height.

---

## 5. Typography

| Role | Size / weight |
|---|---|
| Hero figure | 40 w700, tight tracking, with a rule under it |
| Page heading | 24 w700 |
| Section heading | 17 w700 |
| Row title | 15 w600 |
| Body / metadata | 12.5–13.5 |
| Small label | 11 w700 uppercase, wide tracking |
| Metric | 22–24 w700 |

Prefer `w600`/`w700` over `bold`. The hero's **underline is the point** — it is
what makes the figure read as the screen's subject rather than one metric
among several.

---

## 6. Recurring components

Build these once, in one shared file, and extend it rather than
re-implementing per screen. Page-local copies drift immediately.

Hero block (kicker · big underlined figure · caption · circular actions) ·
circular icon action with a label beneath · profile header (avatar tile, name,
muted second line) · card/panel · list row (solid pastel disc, title, muted
metadata, chevron) · thin inset row separator · metric strip (2–4 figures,
hairline-divided) · stat tile · segmented progress (one bar per stage, not a
percentage) · filter pill (selected = solid block) · primary/secondary button ·
input · section heading · small label · status badge · empty state · compact
circular create action.

Icon discs are **solid pastel with near-black glyphs**, not tinted circles with
coloured glyphs.

---

## 7. Applying it to a section or a new app

1. Define the four surface roles + the two block slots in one accessor object.
2. Derive a full theme from them: scaffold, app bar, card, input, buttons,
   dialog, bottom sheet, chip, progress, FAB. Set `primary`/`secondary` from the
   user's chosen blocks.
3. Give the section a scaffold wrapper that installs that theme **above** its
   `Scaffold`, and use it on every screen instead of a bare `Scaffold`.
4. Port the shared components.

**Why per-screen and not once at the app root:** if two sections of one app must
look different, the theme cannot live on `MaterialApp`. A `Theme` installed in a
tab body does **not** reach a route pushed from it — a pushed route builds under
`MaterialApp`. So each screen installs it for itself. Dialogs and bottom sheets
*do* inherit, because Flutter's modal routes capture the ambient theme at the
call site. A screen that renders several `Scaffold`s itself should wrap its whole
build in the theme once instead of converting each one.

---

## 8. Flutter layout traps

Each of these has actually shipped here. **They all pass `flutter analyze`, the
unit suite, and a release build**, because a layout overflow is a runtime
failure and nothing in those checks renders the widget.

1. **`Row` + `CrossAxisAlignment.stretch` inside a scrolling column** throws
   "BoxConstraints forces an infinite height" and **blanks the whole screen**.
   Wrap full-height divider rows in `IntrinsicHeight`.
2. **A bare `Text` in a `Row`** overflows at large system font scale or on a
   300dp phone. Labels want `Flexible` + `TextOverflow.ellipsis`.
3. **Fixed-width children in a `Row`** (icon discs, circular actions) overflow
   once there are enough of them. Use `Wrap`, or make one child `Flexible`.
4. **A `Row` hands non-flex children an unbounded main-axis constraint**, so a
   `Flexible` *inside* such a child never shrinks. The child itself must be
   `Flexible` for its inner ellipsis to engage.
5. **`Flexible` must sit directly inside a `Flex`** — inside a `Center` or
   `Padding` it throws a ParentDataWidget error.
6. **A visible label duplicating a `Semantics` label** merges into
   `"Home\nHome"` for screen readers. Wrap decorative text in
   `ExcludeSemantics`.
7. **Squeezing a chip below its icon + gap** overflows its inner row even though
   the chip itself is `Flexible`. Budget for the fixed parts.
8. **A hardcoded `Colors.white` glyph or label on a caller-supplied fill**
   vanishes the moment the fill becomes a light pastel — which is what every
   accent in this language is. Derive the foreground from the fill's brightness
   instead of assuming, and test it against both a light and a dark fill.

### Test every shared component's layout

Pump it inside a `SingleChildScrollView` (unbounded height) at **300–360dp**, in
**both** themes, and assert `tester.takeException()` is null. Also assert the
proportions you designed — equal heights, uniform gaps, radius = half height —
because those are what "looks odd" actually means, and they are cheap to pin.

For truncation, assert `RenderParagraph.didExceedMaxLines` is false. Asserting
the text is merely *present* passes while it renders "Ho…".

Note the test font renders every glyph at the full font size — roughly 3x wider
than a real UI font — so a long label can ellipsise in a test and be fine on a
device. Pin the case you actually saw break.

---

## 9. Anti-patterns

Several blocks on one screen · translucent tints instead of solid blocks ·
accent-coloured status meaning · raw colours or `isDark ? …` at a call site ·
hardcoded white foregrounds on coloured fills ·
gradients · heavy shadows (cards get a border; only genuinely floating things
get a shadow) · a component's sizes chosen independently of each other ·
full-width containers holding two or three items · page-local copies of a
shared component.

---

## 10. Before finishing

- Static analysis clean
- Full test suite passes
- A real build succeeds — layout bugs hide behind everything else
- Reload the actual screens: composed pages are not covered by component tests

If the repo is not formatter-clean, do **not** run the formatter — match the
surrounding style by hand, or the diff buries the change.
