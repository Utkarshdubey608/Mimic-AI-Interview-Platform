import type { TrackType } from '@shared/types'

/**
 * What each interview format actually needs from the candidate's machine.
 *
 * ── Why this is a table and not an `if` in a component ───────────────────
 * Two of these decisions are privacy decisions, and a privacy decision should
 * be reviewable in one place rather than inferred from JSX:
 *
 *   1. A written or voice interview must NEVER ask for a camera. Requesting one
 *      "just to be safe" turns a text interview into a surveilled one, and the
 *      candidate has no way to know we are not recording them.
 *   2. The face-framing aid is on-device only and must never block anyone. It
 *      helps someone centre themselves; it is not identity proofing and it is
 *      not the facial analysis used for scoring.
 *
 * Pure data plus pure predicates, so the rules can be asserted directly. See
 * deviceRequirements.test.ts.
 */

export interface DeviceRequirements {
  /** A live microphone test with a visible level meter. */
  microphone: boolean
  /** A live camera preview. */
  camera: boolean
  /** The on-device face-framing aid. Advisory, never blocking. */
  faceFraming: boolean
  /** The interview is a realtime call, so WebRTC and a socket must work. */
  realtime: boolean
  /** Live captions depend on the browser's speech recogniser. Advisory. */
  liveCaptions: boolean
  /**
   * The candidate must positively consent before anything is recorded.
   *
   * This is a legal requirement, not a UX preference, and it is listed here
   * rather than inside one screen because that is exactly how it was nearly
   * lost: it lived only in VideoIntro, so replacing that screen would have
   * silently dropped consent from a recorded interview.
   */
  recordingConsent: boolean
}

/**
 * The requirements for a track.
 *
 * `chat` is typing only: no microphone, no camera, nothing but the browser.
 * `chatbot` is also typing only, despite being conversational.
 * `voice` needs a microphone and nothing else, which is precisely the case the
 * old static checklist got wrong: it asked a voice candidate to confirm they
 * were "ready to focus" and never once checked that their microphone worked.
 */
export function requirementsFor(track: TrackType): DeviceRequirements {
  switch (track) {
    case 'chat':
    // A coding assessment is typing only, exactly like `chat`. Asking a candidate
    // for a camera to write a function would be a permission prompt that buys
    // nothing and costs trust.
    case 'coding':
      return { microphone: false, camera: false, faceFraming: false, realtime: false, liveCaptions: false, recordingConsent: false }
    case 'chatbot':
      return { microphone: false, camera: false, faceFraming: false, realtime: false, liveCaptions: false, recordingConsent: false }
    // A written assessment: nothing is spoken, streamed or recorded, so there is
    // nothing to require or to consent to beyond the browser itself.
    case 'mcq':
      return { microphone: false, camera: false, faceFraming: false, realtime: false, liveCaptions: false, recordingConsent: false }
    case 'voice':
      return { microphone: true, camera: false, faceFraming: false, realtime: true, liveCaptions: true, recordingConsent: true }
    case 'video':
      // Recorded video: camera and mic, no live call. Face framing IS included,
      // and this is the track where it matters most: the candidate records alone
      // with nobody on the other end, so there is no interviewer to tell them
      // they are out of frame or lit from behind. They find out when a recruiter
      // watches it back, which is far too late to fix.
      return { microphone: true, camera: true, faceFraming: true, realtime: false, liveCaptions: false, recordingConsent: true }
    case 'video_avatar':
      return { microphone: true, camera: true, faceFraming: true, realtime: true, liveCaptions: true, recordingConsent: true }
    case 'two_way':
      // A live human is on the other end, so framing matters, but a person can
      // ask the candidate to move. The aid stays advisory.
      return { microphone: true, camera: true, faceFraming: true, realtime: true, liveCaptions: false, recordingConsent: true }
  }
}

/** Does this track need any media permission at all? */
export function needsMedia(track: TrackType): boolean {
  const r = requirementsFor(track)
  return r.microphone || r.camera
}

/** The `getUserMedia` constraints for a track. Never asks for more than needed. */
export function mediaConstraintsFor(track: TrackType): MediaStreamConstraints | null {
  const r = requirementsFor(track)
  if (!r.microphone && !r.camera) return null
  return { audio: r.microphone, video: r.camera }
}

/* ── Browser capability checks ────────────────────────────────────────────
   Run before asking for any permission, because "your browser cannot do this"
   and "you denied permission" are different problems with different fixes, and
   a candidate told the wrong one will spend ten minutes in the wrong settings
   screen while their interview window closes.                              */

export type CapabilityId = 'secureContext' | 'getUserMedia' | 'websocket' | 'webrtc' | 'speech'

export interface Capability {
  id: CapabilityId
  label: string
  /** False means this format will not work at all. Advisory checks are true. */
  required: boolean
  ok: boolean
  /** What the candidate can actually do about it. */
  remedy: string
}

/** The environment as the checks see it. Injected so the logic is testable. */
export interface BrowserEnv {
  isSecureContext: boolean
  hasGetUserMedia: boolean
  hasWebSocket: boolean
  hasWebRTC: boolean
  hasSpeechRecognition: boolean
}

/** Read the real browser. Kept separate from the pure evaluation below. */
export function readBrowserEnv(): BrowserEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return {
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    hasGetUserMedia: !!nav?.mediaDevices?.getUserMedia,
    hasWebSocket: typeof WebSocket !== 'undefined',
    hasWebRTC: typeof RTCPeerConnection !== 'undefined',
    hasSpeechRecognition:
      typeof window !== 'undefined' &&
      !!((window as unknown as Record<string, unknown>).SpeechRecognition ??
         (window as unknown as Record<string, unknown>).webkitSpeechRecognition),
  }
}

/**
 * Evaluate the browser against what this track needs.
 *
 * A capability the track does not use is not reported at all: telling a written
 * interview's candidate that their browser lacks WebRTC is noise that makes the
 * one real failure harder to find.
 */
export function evaluateCapabilities(track: TrackType, env: BrowserEnv): Capability[] {
  const r = requirementsFor(track)
  const out: Capability[] = []

  if (needsMedia(track)) {
    out.push({
      id: 'secureContext',
      label: 'Secure connection',
      required: true,
      ok: env.isSecureContext,
      remedy: 'Open this interview over https. Your browser blocks camera and microphone access on an insecure page.',
    })
    out.push({
      id: 'getUserMedia',
      label: r.camera ? 'Camera and microphone support' : 'Microphone support',
      required: true,
      ok: env.hasGetUserMedia,
      remedy: 'This browser cannot reach your devices. Try the latest Chrome, Edge or Safari.',
    })
  }

  if (r.realtime) {
    out.push({
      id: 'websocket',
      label: 'Live connection',
      required: true,
      ok: env.hasWebSocket,
      remedy: 'Your network or browser is blocking live connections. Try another network, or turn off a VPN or strict firewall.',
    })
    out.push({
      id: 'webrtc',
      label: 'Real time media',
      required: true,
      ok: env.hasWebRTC,
      remedy: 'This browser cannot run a live call. Try the latest Chrome, Edge or Safari.',
    })
  }

  if (r.liveCaptions) {
    out.push({
      id: 'speech',
      label: 'Live captions',
      required: false, // advisory: the interview works without them
      ok: env.hasSpeechRecognition,
      remedy: 'Live captions are not available in this browser. The interview still works, and a full transcript is still recorded.',
    })
  }

  return out
}

/** True when nothing REQUIRED is failing. Advisory failures never block. */
export function canProceed(caps: Capability[]): boolean {
  return caps.every((c) => !c.required || c.ok)
}

/* ── The order the checks are performed in ────────────────────────────────
   One device per screen. A single card listing browser, microphone, camera and
   consent together forces the candidate to work out which of four things is
   blocking them; a sequence asks one question at a time and cannot be
   misread. It also matches how the failures actually arrive: a browser problem
   makes the microphone question moot, so there is no point asking it yet. */

export type CheckStage = 'browser' | 'microphone' | 'camera' | 'face' | 'consent'

/** The stages this track actually performs, in order. */
export function stagesFor(track: TrackType): CheckStage[] {
  const r = requirementsFor(track)
  const out: CheckStage[] = []
  // Browser is skipped only when there is genuinely nothing to test, which is
  // the written tracks: they need no permission and no realtime transport.
  if (evaluateCapabilities(track, {
    isSecureContext: true, hasGetUserMedia: true, hasWebSocket: true,
    hasWebRTC: true, hasSpeechRecognition: true,
  }).length > 0) out.push('browser')
  if (r.microphone) out.push('microphone')
  if (r.camera) out.push('camera')
  if (r.faceFraming) out.push('face')
  if (r.recordingConsent) out.push('consent')
  return out
}

/** Human label for a stage, used by the step rail inside the check. */
export const STAGE_LABEL: Record<CheckStage, string> = {
  browser: 'Browser',
  microphone: 'Microphone',
  camera: 'Camera',
  face: 'Framing',
  consent: 'Consent',
}
