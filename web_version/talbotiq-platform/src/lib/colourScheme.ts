/**
 * The workspace's chosen colour scheme — a primary and a secondary.
 *
 * Same shape as workspaceGround.ts, and deliberately so: this is the other half
 * of the same preference. Not in useAppStore for the reason given there — the app
 * store persists product state and is partialized, and a display preference that
 * has to resolve before first paint has no business waiting on zustand hydration.
 *
 * The two roles are stored independently because they are chosen independently:
 * the settings copy asks for a secondary "distinct from the primary", which only
 * means anything if they can differ.
 */
import { useSyncExternalStore } from 'react'

import { SCHEMES, schemeByKey, schemeVars, type SchemeKey } from '@/design/schemes'

const KEY_PRIMARY = 'mimic-scheme-primary'
const KEY_SECONDARY = 'mimic-scheme-secondary'

export type SchemePair = { primary: SchemeKey; secondary: SchemeKey }

function readStored(): SchemePair {
  try {
    return {
      primary: (schemeByKey(localStorage.getItem(KEY_PRIMARY) ?? '').key),
      secondary: (schemeByKey(localStorage.getItem(KEY_SECONDARY) ?? '').key),
    }
  } catch {
    return { primary: SCHEMES[0].key, secondary: SCHEMES[0].key }
  }
}

let current: SchemePair = readStored()
const listeners = new Set<() => void>()

/**
 * Write the pair as a STYLESHEET, not as inline properties on the root.
 *
 * Inline on `documentElement` was the first attempt and it is wrong in a way that
 * is worth recording, because it looks right until it is measured. Several
 * surfaces carry their own `data-ground` — the entry screen, the candidate lobby,
 * the recruiter shell — and `[data-ground='record']` re-declares `--action` and
 * `--on-action`. A declaration on a CLOSER ANCESTOR beats an inline custom
 * property on the root, so the scheme applied to the document and was then
 * overridden inside every surface that mattered. Measured: the primary button came
 * out peach with WHITE text, about 1.7:1, and on the dark ground it ignored the
 * scheme entirely and used the room's default.
 *
 * A rule at the same specificity, appended last, wins on source order instead —
 * and since both grounds' values are written at once, the cascade picks the right
 * one wherever `data-ground` happens to sit. Nothing has to be re-applied when the
 * ground changes, which is a subscription and a class of bug removed.
 */
const STYLE_ID = 'mimic-colour-scheme'

function apply(): void {
  if (typeof document === 'undefined') return
  const primary = schemeByKey(current.primary)
  const secondary = schemeByKey(current.secondary)

  const block = (sel: string, ground: 'record' | 'room') =>
    `${sel}{${Object.entries(schemeVars(primary, secondary, ground))
      .map(([k, v]) => `${k}:${v}`)
      .join(';')}}`

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  /* `:root` as well as the attribute selector, for the case where nothing has
     stamped a ground yet — the very first frame of a cold load. */
  el.textContent = [
    block(":root,[data-ground='record']", 'record'),
    block("[data-ground='room']", 'room'),
  ].join('\n')
}

export function setScheme(role: keyof SchemePair, key: SchemeKey): void {
  if (current[role] === key) return
  current = { ...current, [role]: key }
  try {
    localStorage.setItem(role === 'primary' ? KEY_PRIMARY : KEY_SECONDARY, key)
  } catch {
    /* private mode — the choice still applies for this session */
  }
  apply()
  listeners.forEach((fn) => fn())
}

export function getScheme(): SchemePair {
  return current
}

export function useScheme(): SchemePair {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/* Applied at module load, not from a component effect. A React effect runs after
   first paint, which would show one frame of the default palette before the chosen
   one — the same reason workspaceGround resolves outside the store. Importing this
   module is what installs it; see main.tsx. */
apply()
