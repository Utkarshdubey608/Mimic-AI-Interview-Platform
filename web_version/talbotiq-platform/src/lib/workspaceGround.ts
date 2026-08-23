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
  useEffect(() => {
    const el = document.documentElement
    const prev = el.dataset.ground
    el.dataset.ground = ground
    return () => {
      if (prev === undefined) delete el.dataset.ground
      else el.dataset.ground = prev
    }
  }, [ground])
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
  try {
    return localStorage.getItem(KEY) === 'record' ? 'record' : 'room'
  } catch {
    return 'room'
  }
}

export function hasGroundChoice(): boolean {
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
  if (ground === current) return
  current = ground
  try {
    localStorage.setItem(KEY, ground)
  } catch {
    /* private mode — the choice still applies for this session */
  }
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
