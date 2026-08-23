# Mimic — Premium Enterprise Transformation: Audit & Direction

Date: 2026-08-22 · Branch: `feat/premium-enterprise-ui`
Method: full route sweep at 1440×900 and 390×844 against the running app (Vite :3001 + FastAPI :8787), plus a code audit of the token/motion/component layers.

---

## 1. What the audit found

### What is already genuinely good (and must not be discarded)

- **Token architecture.** `src/design/tokens.css` is a real semantic system: two grounds
  (light "record", dark "room") resolved through custom properties, measured contrast
  (gated by `scripts/contrast-audit.mjs`), a named z-scale, a 4px spatial scale, a
  disciplined radius scale. This is rare and is the single biggest asset for this
  transformation — the look can be transformed at the token layer without touching
  business logic.
- **Motion layer.** `src/design/motion.ts` — durations/easings/springs with a correct,
  nuanced `prefers-reduced-motion` policy (feedback survives, travel is removed).
- **Focus model, grain, brand-wash, page geometry** in `src/index.css`.
- **Marketing copy.** Specific, honest, no AI clichés. FAQ and trust content is strong.
- **Code splitting.** Every route lazy; vendor chunks split.

### Why the product still reads below the enterprise bar

1. **The first viewport is a brochure, not a product.** The `/` hero is static,
   fully centered text on light gray. Nothing signals *AI*, *intelligence*, or
   *presence*. No depth, no motion, no dimension. An executive's 5-second read is
   "editorial site", not "serious AI platform".
2. **Austerity reads as thin, not premium.** Flat white panels + hairlines with zero
   atmosphere. Linear/Stripe-class restraint still uses ambient depth (layered
   surfaces, localized light, texture). Its absence here reads unfinished.
3. **The workspace has no command-center hierarchy.** Every page = one giant
   condensed headline + one flat panel. Sessions (the daily surface) opens with no
   overview, no state-of-the-desk. Templates is a grid of twelve identical cards.
4. **Native form controls.** Analytics uses browser-default `<select>` and
   `type="date"` inputs. This is the fastest single "cheap" signal in the product.
5. **The AI is invisible in the UI.** The differentiator — AI conducts, understands,
   evaluates — has no visual language anywhere: no recognizable AI-insight
   component, no living state (speaking/listening/thinking) beyond a static circle
   and the word "Connecting".
6. **The homepage scroll has a dead zone.** The pinned dark storytelling section
   renders as a viewport-tall void mid-scroll; the light→dark jump has no seam.
7. **Display type shouts in the workspace.** The widened Archivo 800 display voice is
   distinctive at marketing scale, but at 48px+ on every workspace page it reads
   loud where the work is quiet.
8. **Interview rooms are serviceable, not memorable.** Dark ground is right; the AI
   presence is a static avatar circle. Speaking/listening/thinking states barely
   differ. The pre-flight is a plain white card.

Per-page notes (from screenshots `audit-*.png`): Sessions (empty state undesigned,
no overview band), Analytics (native controls, one empty panel, thin), Templates
(identical-card monotony, repeated seeded data amplifies it), Avatar Studio
(two-tone headline splits hierarchy; request-preview panel is dev-tool flavored —
keep, it's honest, but frame it), Invite Wizard (solid bones, plain), Settings
(document style, fine), Login (dark, good bones, weak atmosphere), 404 (designed —
good), Assessments (rendered an error against the stale backend — env issue, not UI).

---

## 2. Direction

**Thesis: one product, two rooms — and the dark room is now the identity.**

Mimic's system already names the truth: interviews happen in a dark *room*; records
are read on a light *record*. The transformation makes the room the product's
default face — near-black indigo, graphite surfaces, localized light — and reserves
the record as an opt-in reading ground. The marketing site tells the same story in
one scroll: a cinematic dark room (hero) opening onto the daylight record (the
evidence sections), closing back in the room (how-it-works, CTA).

### Color

- Keep the two-ground token architecture. Deepen and enrich the **room** palette
  (base near-black indigo, blue-graphite surfaces) and make it the default ground
  for the entire recruiter workspace, login, and marketing bookends.
- Accent identity stays restrained: ink primary action (inverts to light-on-dark),
  registrar blue for links/focus/progress.
- **One new accent: `--ai` (controlled cyan).** Used exclusively for machine
  presence: AI states (speaking/listening/thinking), AI-insight components, the
  intelligence-signal motif. Never a large fill, never decoration. Contrast-gated
  on both grounds like every other pair.
- Exhibit ramp (six format colors) unchanged — functional index-tab coding.

### Type

- Keep Archivo (wdth axis) + Chivo Mono. A swap to Inter/Geist would genericize the
  one distinctive voice the brand owns.
- Recalibrate the scale: workspace H1 drops to 24–28px medium-expanded; the full
  118-width 800 display voice is reserved for marketing heroes and section covers.

### Signature motif: the intelligence signal

An original visual language for "AI is present": concentric signal arcs that
breathe (listening), radiate (speaking), and sweep (thinking). One component
(`AIPresence`) renders all states; the same arcs appear at small scale in
AI-insight cards and loading states. SVG + transform/opacity only; reduced-motion
renders the composed static frame.

### Depth

Layered graphite surfaces + light-catching top hairlines (already in room tokens),
plus two new controlled instruments: a localized radial **key light** behind the
primary object of a screen (AI visualization, login card, hero), and the existing
grain utility on large dark fields. No glass-everything; glass only where an
overlay genuinely floats (command palette, modals on video).

---

## 3. Delivery plan

1. **Foundation** — token refresh (room deepened, `--ai` accent, atmosphere
   tokens), type-scale recalibration, ground flip for the workspace shell,
   kit-level fixes (Select/date controls, PageHeader pattern).
2. **Marketing** — cinematic dark hero with a living interview-intelligence
   visualization; fix the pinned-section void; seam the ground transitions;
   dark CTA/footer polish.
3. **Workspace** — Sessions command-center overview, Templates hierarchy,
   Analytics premium charts + real controls, wizard/forms polish.
4. **Interview rooms** — AIPresence states, pre-flight redesign, stage transitions.
5. **States & QA** — empty/error/loading states, responsive sweep (1440/1024/768/390),
   reduced-motion pass, contrast audit, build gate, then the four review loops
   (CEO, candidate, enterprise buyer, frontend architect).

**Hard constraints:** no API/auth/routing/business-logic changes; every existing
flow keeps working; `npm run build` and the contrast audit stay green.
