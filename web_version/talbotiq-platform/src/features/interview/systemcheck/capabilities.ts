/**
 * What this browser can do, and what it is.
 *
 * Written against an injected `Environment` rather than reading globals, so every
 * branch is testable from a user-agent string — the alternative is discovering a
 * detection bug from a candidate who could not start their interview.
 */
import { pickVideoMimeType } from '@/lib/recorderCodec'
import type { CheckId } from './requirements'

export type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'unknown'

export interface Environment {
  userAgent: string
  secureContext: boolean
  hasGetUserMedia: boolean
  hasAudioContext: boolean
  hasRTCPeerConnection: boolean
  hasMediaRecorder: boolean
}

export interface Capabilities {
  family: BrowserFamily
  isWebview: boolean
  secureContext: boolean
  canCaptureMedia: boolean
  canAnalyseAudio: boolean
  canUseWebRTC: boolean
  canRecord: boolean
}

/**
 * In-app browser markers. This is the single highest-yield detection here: a large
 * share of "permission denied" reports are candidates opening the invite inside
 * Gmail, Slack, LinkedIn or Instagram, whose embedded browsers block media without
 * a meaningful prompt. Order matters only for readability; any match is enough.
 */
const WEBVIEW_MARKERS: RegExp[] = [
  /FBAN|FBAV|FB_IAB/i,     // Facebook / Messenger
  /Instagram/i,
  /LinkedInApp/i,
  /\bSlack\//i,
  /WhatsApp/i,
  /\bLine\//i,
  /\bTwitter|TwitterAndroid/i,
  /GSA\//i,                // Google Search App
  /;\s*wv[;)]/i,           // Android System WebView
]

function familyOf(ua: string): BrowserFamily {
  if (/SamsungBrowser\//i.test(ua)) return 'samsung'
  if (/\bEdg(?:e|A|iOS)?\//i.test(ua)) return 'edge'
  if (/Firefox\/|FxiOS\//i.test(ua)) return 'firefox'
  if (/Chrome\/|CriOS\//i.test(ua)) return 'chrome'
  // Safari only after Chrome/Edge: every Chromium UA also contains "Safari".
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'safari'
  return 'unknown'
}

export function detect(env: Environment): Capabilities {
  const ua = env.userAgent || ''
  // Media capture needs BOTH the API and a secure context — Chrome hides
  // mediaDevices entirely on plain http, which surfaces as a confusing
  // "unsupported browser" unless the two are reported together.
  const canCaptureMedia = env.hasGetUserMedia && env.secureContext
  return {
    family: familyOf(ua),
    isWebview: WEBVIEW_MARKERS.some((re) => re.test(ua)),
    secureContext: env.secureContext,
    canCaptureMedia,
    canAnalyseAudio: canCaptureMedia && env.hasAudioContext,
    canUseWebRTC: env.hasRTCPeerConnection,
    canRecord: canCaptureMedia && env.hasMediaRecorder,
  }
}

/** Reads the real browser. The only impure function in this module. */
export function readEnvironment(): Environment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const win = typeof window === 'undefined' ? undefined : window
  return {
    userAgent: nav?.userAgent ?? '',
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    hasGetUserMedia: typeof nav?.mediaDevices?.getUserMedia === 'function',
    hasAudioContext: !!(win && ('AudioContext' in win || 'webkitAudioContext' in win)),
    hasRTCPeerConnection: !!(win && 'RTCPeerConnection' in win),
    // Not merely 'is the constructor there'. Safari has MediaRecorder and
    // cannot write WebM, so presence alone told us nothing useful. This asks
    // whether a container it can actually write exists.
    hasMediaRecorder: !!(win && 'MediaRecorder' in win) && pickVideoMimeType() !== undefined,
  }
}

/** Which of the required checks this browser cannot even attempt. */
export function missingFor(caps: Capabilities, ids: CheckId[]): CheckId[] {
  return ids.filter((id) => {
    if (id === 'mic') return !caps.canAnalyseAudio
    if (id === 'camera') return !caps.canCaptureMedia
    if (id === 'speaker') return !caps.canAnalyseAudio
    if (id === 'connectivity') return !caps.canUseWebRTC
    return false // 'browser' is the report, never the casualty
  })
}
