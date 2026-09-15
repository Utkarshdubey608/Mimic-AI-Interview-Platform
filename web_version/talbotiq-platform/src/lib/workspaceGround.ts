/**
 * The workspace ground preference — ROOM (dark, the default) or RECORD (light).
 *
 * Both palettes are contrast-gated by scripts/contrast-audit.mjs, which is what
 * makes this toggle cheap: it swaps `data-ground` and every semantic token
 * re-resolves. The preference is a recruiter's reading choice, not a theme
 * system — candidate surfaces and the marketing site keep choosing their own
 * ground per subtree and never read this.
 *
 * Deliberately not in useAppStore: the app store persists product state and is
 * partialized; a display preference that must resolve before first paint has no
 * business waiting on zustand hydration.
 */
import { useEffect, useSyncExternalStore } from 'react'

export type WorkspaceGround = 'room' | 'record'

/* ── TEMP: the dark ground is switched off platform-wide ─────────────────────
   Recruiter AND candidate. Nothing is deleted and no palette is edited — `room`
   simply stops being reachable, so every surface resolves to `record`.

   It is done HERE rather than by editing tokens.css because the dark palette is
   contrast-gated by scripts/contrast-audit.mjs and asserted by schemes.test.ts;
   removing the tokens would break both, and re-adding them later would mean
   re-deriving a palette that already exists and already passes. Collapsing the
   CHOICE instead leaves the dark world intact and unreachable.

   To bring dark back: set this to true. Every site that honours it routes
   through `resolveGround` or reads this constant directly, and each one is
   marked DARK-OFF. */
export const DARK_GROUND_ENABLED = false

/** Collapses any ground to the one that is currently switched on. */
export function resolveGround(ground: WorkspaceGround): WorkspaceGround {
  return DARK_GROUND_ENABLED ? ground : 'record'
}

/**
 * Pin the document's ground while the calling surface is mounted.
 *
 * html/body paint var(--ground), so a full-screen surface that only sets
 * `data-ground` on its own root leaves the page edge on the other ground — an
 * over-scroll bounce or a route transition flashes the wrong world. Full-screen
 * surfaces (entry, candidate lobby, interview rooms) call this; the previous
 * value is restored on unmount so nested surfaces unwind correctly.
 */
export function useDocumentGround(ground: WorkspaceGround): void {
  // DARK-OFF: resolved here as well as at the call sites, so a surface that
  // pins a literal ground cannot reopen the dark world on the document root.
  const resolved = resolveGround(ground)
  useEffect(() => {
    const el = document.documentElement
    const prev = el.dataset.ground
    el.dataset.ground = resolved
    return () => {
      if (prev === undefined) delete el.dataset.ground
      else el.dataset.ground = prev
    }
  }, [resolved])
}

const KEY = 'mimic-workspace-ground'

/**
 * Whether a person has ever actually PICKED, as opposed to being defaulted.
 *
 * `readStored` cannot answer this and must not try: it falls back to `room`, so
 * an untouched browser and a deliberate choice of the dark ground are the same
 * value. The first-run picker needs to tell those apart — offering someone a
 * choice they already made is as wrong as never offering it — so the fact of
 * having chosen is stored separately from what was chosen.
 *
 * Cleared on sign-out, which is what makes the picker come back for the next
 * person at this browser rather than quietly handing them the last one's
 * preference.
 */
const CHOSEN = 'mimic-workspace-ground-chosen'

function readStored(): WorkspaceGround {
  // DARK-OFF: a stored `room` is kept in localStorage but not honoured, so a
  // recruiter who was on dark before this went out finds their choice waiting
  // rather than overwritten when it is switched back on.
  try {
    return resolveGround(localStorage.getItem(KEY) === 'record' ? 'record' : 'room')
  } catch {
    return resolveGround('room')
  }
}

export function hasGroundChoice(): boolean {
  // DARK-OFF: there is nothing to choose between, so the first-run picker is
  // answered before it is asked.
  if (!DARK_GROUND_ENABLED) return true
  try {
    return localStorage.getItem(CHOSEN) === '1'
  } catch {
    // Private mode: no memory, so every visit is a first run. Better to ask
    // again than to assume a preference nobody can store.
    return false
  }
}

/** Record that the choice was made deliberately. `setWorkspaceGround` does this. */
function markChosen(): void {
  try { localStorage.setItem(CHOSEN, '1') } catch { /* nothing to remember it with */ }
}

/** Forget only the FACT of choosing, never the value — so "Go to workspace"
 *  still has a previous mode to go with. Called on sign-out. */
export function clearGroundChoice(): void {
  try { localStorage.removeItem(CHOSEN) } catch { /* nothing stored it anyway */ }
}

let current: WorkspaceGround = readStored()
const listeners = new Set<() => void>()

export function setWorkspaceGround(ground: WorkspaceGround): void {
  /* Marked BEFORE the early return. Picking the ground you are already on is a
     real choice and the commonest one on first run — the default is `room` and
     dark is what most people keep — so returning early without recording it
     would show the picker again on the next visit. */
  markChosen()
  /* DARK-OFF: the REQUEST is what gets stored, so a preference outlives the
     switch-off and comes back intact; only the APPLIED value is collapsed. The
     write moved above the early return for that reason — a request that does not
     change the applied ground still changes the stored preference. */
  try {
    localStorage.setItem(KEY, ground)
  } catch {
    /* private mode — the choice still applies for this session */
  }
  const next = resolveGround(ground)
  if (next === current) return
  current = next
  listeners.forEach((fn) => fn())
}

export function getWorkspaceGround(): WorkspaceGround {
  return current
}

export function useWorkspaceGround(): WorkspaceGround {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
