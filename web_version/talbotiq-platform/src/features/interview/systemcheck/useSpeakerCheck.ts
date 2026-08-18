/**
 * Output verification — the honest exception.
 *
 * There is no reliable way to detect that a human heard a sound. Every other
 * check here passes on measurement; this one passes on the candidate saying so,
 * and the UI states that plainly rather than implying we tested it.
 */
import { useCallback, useRef, useState } from 'react'
import type { CheckState } from './guidance'

export interface SpeakerCheck {
  state: CheckState
  playing: boolean
  playTone: () => void
  confirm: () => void
  deny: () => void
}

const TONE_HZ = 440
const TONE_MS = 1200

export function useSpeakerCheck(): SpeakerCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const [playing, setPlaying] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)

  const play = useCallback(async () => {
    const Ctor: typeof AudioContext =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? AudioContext
    const ctx = ctxRef.current ?? new Ctor()
    ctxRef.current = ctx
    await ctx.resume().catch(() => {})

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = TONE_HZ
    // Ramped, not switched: an abrupt start clicks, and a click through
    // headphones at volume is unpleasant on a surface meant to calm people.
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05)
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + TONE_MS / 1000)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + TONE_MS / 1000)

    setPlaying(true)
    setState('requesting')
    window.setTimeout(() => setPlaying(false), TONE_MS)
  }, [])

  const confirm = useCallback(() => setState('passed'), [])
  const deny = useCallback(() => setState('granted-no-signal'), [])

  return { state, playing, playTone: () => void play(), confirm, deny }
}
