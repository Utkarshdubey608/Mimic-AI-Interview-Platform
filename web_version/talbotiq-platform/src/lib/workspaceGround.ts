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

function readStored(): WorkspaceGround {
  try {
    return localStorage.getItem(KEY) === 'record' ? 'record' : 'room'
  } catch {
    return 'room'
  }
}

let current: WorkspaceGround = readStored()
const listeners = new Set<() => void>()

export function setWorkspaceGround(ground: WorkspaceGround): void {
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
