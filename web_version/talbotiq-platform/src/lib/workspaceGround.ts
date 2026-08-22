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
import { useSyncExternalStore } from 'react'

export type WorkspaceGround = 'room' | 'record'

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
