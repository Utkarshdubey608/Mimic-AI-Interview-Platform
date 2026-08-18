/**
 * The pre-interview gate. Replaces screens/SystemCheck.tsx (three reassurance
 * checkboxes) and screens/VideoSystemCheck.tsx (getUserMedia → 'granted').
 *
 * Start stays disabled until every check the MODE requires reports `passed` —
 * derived from the requirement table, so it cannot drift per mode.
 */
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Check, Loader2, RefreshCw, Volume2, XCircle } from 'lucide-react'
import type { BrandingConfig, TrackType } from '@shared/types'
import { VideoIntro } from '../screens/VideoIntro'
import { DevicePicker } from './DevicePicker'
import { LevelMeter } from './LevelMeter'
import type { CheckId } from './requirements'
import { useSystemCheck } from './useSystemCheck'

interface Props {
  branding: BrandingConfig
  track: TrackType
  busy?: boolean
  onBegin: () => void
}

const LABEL: Record<CheckId, string> = {
  browser: 'Browser',
  mic: 'Microphone',
  camera: 'Camera',
  speaker: 'Sound',
  connectivity: 'Connection',
}

export function SystemCheckScreen({ branding, track, busy, onBegin }: Props) {
  const reduce = useReducedMotion()
  const sc = useSystemCheck(track)
  const accent = branding.accentColor
  // The video track keeps its own intro screen, which owns the start button.
  const videoIntroTakesOver = track === 'video' && sc.canStart

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-border bg-white p-8 shadow-lg sm:p-10"
    >
      <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">
        Quick system check
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">
        We’ll make sure everything works before your first question.
      </p>

      {/* Not a footnote. Closing other tabs measurably helps the realtime modes
          (voice, avatar and two-way all hold a live stream), and it removes the
          commonest cause of an accidental tab-switch flag against a candidate
          who was not doing anything wrong. */}
      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-warning-border bg-warning-bg p-4">
        <span className="mt-0.5 flex-shrink-0 text-warning">
          <XCircle size={18} strokeWidth={1.75} />
        </span>
        <p className="text-sm leading-relaxed text-neutral-700" data-testid="close-tabs-notice">
          <span className="font-semibold text-neutral-900">Close other tabs and apps before you start.</span>{' '}
          It keeps audio and video smooth, and it stops you accidentally switching away, which is recorded during the interview.
        </p>
      </div>

      <ul className="mt-7 space-y-3">
        {sc.checks.map((c) => {
          const failed = c.state === 'denied' || c.state === 'granted-no-signal' || c.state === 'unsupported'
          const passed = c.state === 'passed'
          return (
            <li
              key={c.id}
              data-check={c.id}
              data-state={c.state}
              className="rounded-2xl border border-border bg-neutral-50 p-4"
            >
              <div className="flex items-start gap-3.5">
                <span
                  className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: passed ? accent : failed ? '#fee2e2' : accent + '14',
                    color: passed ? '#ffffff' : failed ? '#b91c1c' : accent,
                  }}
                >
                  {passed ? <Check size={17} strokeWidth={3} />
                    : failed ? <AlertTriangle size={17} strokeWidth={1.75} />
                    : <Loader2 size={17} className="animate-spin" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-900">
                    {LABEL[c.id]}: {c.guidance.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-500">{c.guidance.detail}</p>

                  {c.id === 'mic' && (
                    <div className="mt-3">
                      <LevelMeter level={sc.mic.level} accent={accent} active={!passed} />
                      <DevicePicker
                        label="Microphone"
                        devices={sc.mic.devices}
                        value={sc.mic.deviceId}
                        onChange={sc.mic.selectDevice}
                      />
                    </div>
                  )}

                  {c.id === 'camera' && (
                    <div className="mt-3">
                      <video
                        ref={sc.camera.videoRef}
                        data-testid="camera-preview"
                        className="aspect-video w-full max-w-xs rounded-xl bg-neutral-900 object-cover"
                        muted
                        playsInline
                      />
                      <DevicePicker
                        label="Camera"
                        devices={sc.camera.devices}
                        value={sc.camera.deviceId}
                        onChange={sc.camera.selectDevice}
                      />
                    </div>
                  )}

                  {c.id === 'speaker' && !passed && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={sc.speaker.playTone}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-semibold text-neutral-700"
                      >
                        <Volume2 size={14} /> {sc.speaker.playing ? 'Playing…' : 'Play test sound'}
                      </button>
                      <button
                        data-testid="speaker-confirm"
                        onClick={sc.speaker.confirm}
                        className="inline-flex h-9 items-center rounded-md px-3 text-xs font-semibold text-white"
                        style={{ background: accent }}
                      >
                        I heard it
                      </button>
                      <button
                        onClick={sc.speaker.deny}
                        className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-xs font-semibold text-neutral-700"
                      >
                        I heard nothing
                      </button>
                    </div>
                  )}

                  {c.guidance.steps.length > 0 && (
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-neutral-500">
                      {c.guidance.steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  )}

                  {failed && c.id !== 'speaker' && c.id !== 'browser' && (
                    <button
                      data-testid={`retest-${c.id}`}
                      onClick={() => {
                        if (c.id === 'mic') sc.mic.retest()
                        else if (c.id === 'camera') sc.camera.retest()
                        else if (c.id === 'connectivity') sc.connectivity.retest()
                      }}
                      className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-semibold text-neutral-700"
                    >
                      <RefreshCw size={14} /> Re-test
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {videoIntroTakesOver ? (
        <div className="mt-7">
          <VideoIntro branding={branding} onBegin={onBegin} busy={busy} />
        </div>
      ) : (
        <>
          <button
            data-testid="start-interview"
            onClick={onBegin}
            disabled={!sc.canStart || busy}
            className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: accent }}
          >
            {busy
              ? <><Loader2 size={18} className="animate-spin" /> Starting…</>
              : <>Start the interview <ArrowRight size={18} /></>}
          </button>
          {!sc.canStart && (
            <p className="mt-2.5 text-center text-xs text-neutral-400">
              Still to check: {sc.outstanding.map((id) => LABEL[id]).join(', ')}.
            </p>
          )}
        </>
      )}
    </motion.div>
  )
}
