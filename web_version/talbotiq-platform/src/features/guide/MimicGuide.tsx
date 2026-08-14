import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Sparkles,
  Mic,
  Send,
  ChevronDown,
  Languages,
  Volume2,
  VolumeX,
  Square,
  RotateCw,
  X,
} from 'lucide-react'
import { cn } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { GuideMarkdown } from '@/features/guide/guide-markdown'
import { LANGUAGES, findLanguage, type Language } from '@/lib/languages'
import { httpBase } from '@/lib/apiOrigin'
import {
  isSpeechRecognitionSupported,
  startSpeechRecognition,
} from '@/lib/speechRecognition'
import { cancelSpeech } from '@/lib/speechSynthesis'
import { SPEECH_LOCALES, plainTextForSpeech, prewarmSpeech, speakSmart } from '@/lib/guideSpeech'
import { isLikelyEcho } from '@/lib/voiceEcho'
import { useAutopilotRunner } from './autopilot/useAutopilotRunner'
import { useAutopilotActions, useAutopilotRegistry, snapshotState } from './autopilot/registry'

// ── Endpoint contract: POST /api/help/chat → { reply } ─────────────────────
// The global fetch interceptor (AuthProvider) attaches the bearer token, so a
// raw fetch here is authenticated automatically.
type Role = 'user' | 'assistant'
type ChatMessage = { role: Role; content: string; error?: boolean }

const HISTORY_KEY = 'mimic-guide-history'
const VOICE_LANG_KEY = 'mimic-guide-voice-lang'
const AUTOSPEAK_KEY = 'mimic-guide-autospeak'
const MAX_HISTORY = 20

// Suggested prompts, localized for the 6 most common Indian languages; every
// other voice language falls back to English (no API call for this).
const SUGGESTED_PROMPTS: Record<string, string[]> = {
  en: [
    'How do I create an interview session?',
    'What interview tracks are there?',
    'How does AI Avatar Screening work?',
    "Where do I see a candidate's score?",
  ],
  hi: [
    'इंटरव्यू सेशन कैसे बनाएं?',
    'कौन-कौन से इंटरव्यू ट्रैक हैं?',
    'AI Avatar Screening कैसे काम करती है?',
    'उम्मीदवार का स्कोर कहाँ देखें?',
  ],
  mr: [
    'मुलाखत सेशन कसे तयार करायचे?',
    'कोणते इंटरव्यू ट्रॅक आहेत?',
    'AI Avatar Screening कशी काम करते?',
    'उमेदवाराचा स्कोअर कुठे पाहायचा?',
  ],
  ta: [
    'நேர்காணல் அமர்வை எப்படி உருவாக்குவது?',
    'என்னென்ன நேர்காணல் டிராக்குகள் உள்ளன?',
    'AI Avatar Screening எப்படி வேலை செய்கிறது?',
    'வேட்பாளரின் மதிப்பெண்ணை எங்கே பார்ப்பது?',
  ],
  te: [
    'ఇంటర్వ్యూ సెషన్‌ను ఎలా సృష్టించాలి?',
    'ఏ ఏ ఇంటర్వ్యూ ట్రాక్‌లు ఉన్నాయి?',
    'AI Avatar Screening ఎలా పనిచేస్తుంది?',
    'అభ్యర్థి స్కోర్ ఎక్కడ చూడాలి?',
  ],
  kn: [
    'ಸಂದರ್ಶನ ಸೆಷನ್ ಅನ್ನು ಹೇಗೆ ರಚಿಸುವುದು?',
    'ಯಾವ ಸಂದರ್ಶನ ಟ್ರ್ಯಾಕ್‌ಗಳಿವೆ?',
    'AI Avatar Screening ಹೇಗೆ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತದೆ?',
    'ಅಭ್ಯರ್ಥಿಯ ಸ್ಕೋರ್ ಅನ್ನು ಎಲ್ಲಿ ನೋಡುವುದು?',
  ],
  ml: [
    'ഇന്റർവ്യൂ സെഷൻ എങ്ങനെ സൃഷ്ടിക്കാം?',
    'ഏതൊക്കെ ഇന്റർവ്യൂ ട്രാക്കുകൾ ഉണ്ട്?',
    'AI Avatar Screening എങ്ങനെ പ്രവർത്തിക്കുന്നു?',
    'ഉദ്യോഗാർത്ഥിയുടെ സ്കോർ എവിടെ കാണാം?',
  ],
}

// Locale mapping, markdown→plain-text stripping, and the browser/server TTS
// routing all live in src/lib/guideSpeech.ts (imported above): TTS uses a real
// browser voice when one is installed for the language and falls back to
// server-side Gemini synthesis otherwise, so every language is actually spoken
// in that language.

/** Rare dead-end: no browser voice AND server synthesis failed. Tell the user
 *  instead of failing silently. */
function notifyVoiceUnavailable() {
  toast.error("Couldn't play the voice for this language right now — please try again.")
}

/** Default the voice language to the browser's language if we support it. */
function detectDefaultLang(): string {
  if (typeof navigator === 'undefined') return 'en'
  const base = (navigator.language || 'en').split('-')[0].toLowerCase()
  return findLanguage(base) ? base : 'en'
}

/**
 * Client-only chat persistence. The last 20 turns are mirrored to localStorage
 * so the conversation survives reloads and navigation. The history is only ever
 * sent to the same /api/help/chat the user is already talking to.
 */
function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isChatMessage).slice(-MAX_HISTORY)
  } catch {
    return []
  }
}

function saveHistory(messages: ChatMessage[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)))
  } catch {
    // Ignore quota / private-mode failures — persistence is best-effort.
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    (record.role === 'user' || record.role === 'assistant') &&
    typeof record.content === 'string'
  )
}

function promptsForLang(code: string): string[] {
  return SUGGESTED_PROMPTS[code] ?? SUGGESTED_PROMPTS.en
}

/** Compact searchable language dropdown for the voice-input locale. */
function VoiceLangSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const current = findLanguage(value) ?? findLanguage('en')

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [open])

  const results = useMemo<Language[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return LANGUAGES
    return LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.native.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    )
  }, [query])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-[200px] items-center gap-1.5 rounded-full border border-brand-border bg-brand-card px-2.5 py-1.5 text-xs text-neutral-100 transition-colors duration-150 hover:border-brand-gold/50"
      >
        <span className="leading-none">{current?.flag}</span>
        <span className="truncate">{current?.name}</span>
        <ChevronDown className="ml-auto size-3.5 text-brand-gray" aria-hidden />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-brand-border bg-brand-card shadow-xl">
          <div className="p-1.5">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages…"
              className="w-full rounded-lg border border-brand-border bg-brand-black px-2.5 py-1.5 text-xs text-neutral-100 outline-none transition-colors duration-150 placeholder:text-brand-gray/70 focus:border-brand-gold/60"
            />
          </div>
          <div className="max-h-56 overflow-y-auto px-1 pb-1">
            {results.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  onChange(lang.code)
                  setQuery('')
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-brand-gold/10',
                  lang.code === value && 'bg-brand-gold/15',
                )}
              >
                <span className="leading-none">{lang.flag}</span>
                <span className={cn('shrink-0', lang.code === value ? 'font-semibold text-brand-gold-light' : 'text-neutral-100')}>{lang.name}</span>
                <span className="truncate text-brand-gray">{lang.native}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Mimic Guide — the in-app TalbotIQ assistant. A floating launcher (bottom-right,
 * visible to any signed-in user) that opens a chat panel. Free-form markdown
 * answers, localStorage history, suggested prompts, a 55-language voice selector,
 * Web Speech voice input (STT), and spoken answers (TTS).
 */
export default function MimicGuide() {
  const { isAuthenticated, role } = useAuth()

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [voiceLang, setVoiceLang] = useState('en')
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)
  const [autopilot, setAutopilot] = useState(false)
  const runner = useAutopilotRunner()

  // ── Voice mode (hands-free, JARVIS-style): keeps listening even with the panel
  // CLOSED (a floating mic pill shows state), and AUTO-SUBMITS each spoken command
  // to Autopilot after a short silence — no Enter, no panel needed. A pending
  // side-effect read-back can be answered by voice ("yes" / "no"). ──
  const [voiceMode, setVoiceMode] = useState(false)
  const voiceModeRef = useRef(false)
  useEffect(() => { voiceModeRef.current = voiceMode }, [voiceMode])
  const [voiceHeard, setVoiceHeard] = useState('')
  const voiceBufRef = useRef('')
  const voiceTimerRef = useRef<number | null>(null)
  const voiceSubmitRef = useRef<() => void>(() => {})
  const pendingRef = useRef(false)
  useEffect(() => { pendingRef.current = pending }, [pending])
  const pendingConfirmRef = useRef(runner.pendingConfirm)
  useEffect(() => {
    pendingConfirmRef.current = runner.pendingConfirm
    // A confirm just appeared: throw away anything spoken BEFORE the read-back
    // existed — only speech that starts after it may answer it ("yes"/"no").
    if (runner.pendingConfirm) {
      voiceBufRef.current = ''
      setVoiceHeard('')
      if (voiceTimerRef.current !== null) { window.clearTimeout(voiceTimerRef.current); voiceTimerRef.current = null }
    }
  }, [runner.pendingConfirm])

  // Register navigation as a global Autopilot action while the panel is mounted.
  // The runner special-cases `global.navigate` (it holds `useNavigate`); this
  // descriptor's `run` is a no-op placeholder that only exists so the model is
  // offered the action.
  useAutopilotActions(
    'global',
    useMemo(
      () => ({
        navigate: {
          description:
            'Go to a TalbotIQ page. Valid paths: /sessions (Sessions list), /sessions/new (Set up an interview & invite), ' +
            '/templates (Templates), /question-sets (Question Sets), /interview (Interview), /results (AI Avatar Screening results), ' +
            '/pipelines (multi-round Pipelines list), /analytics (Analytics dashboard), /settings (Settings). ' +
            'Pick the closest path for what the recruiter names.',
          params: [{ name: 'path', type: 'string' as const, required: true }],
          run: () => {},
        },
      }),
      [],
    ),
  )

  // Autopilot step tracker: derived from whatever the mounted wizard/screen
  // exposes via `useAutopilotActions(..., { getState })`. Not live-reactive to
  // every keystroke on the wizard (the registry only changes identity on
  // mount/unmount) — it reads fresh values whenever this panel re-renders,
  // which happens after every Autopilot turn. Hook call kept unconditional
  // (before the recruiter-only early return below) per rules-of-hooks.
  const registrySnapshot = snapshotState(useAutopilotRegistry())

  const controllerRef = useRef<AbortController | null>(null)
  const stopListeningRef = useRef<(() => void) | null>(null)
  const stopSpeakRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // Mirror state into refs so the auto-speak effect (keyed on messages only)
  // reads current values without re-firing on every toggle.
  const autoSpeakRef = useRef(true)
  const voiceLangRef = useRef('en')
  const spokenRef = useRef(0) // index up to which messages have been auto-handled

  // Load persisted state on mount; default voice language to the browser's.
  useEffect(() => {
    const loaded = loadHistory()
    setMessages(loaded)
    spokenRef.current = loaded.length // don't auto-speak restored history
    const stored = (() => {
      try {
        return localStorage.getItem(VOICE_LANG_KEY)
      } catch {
        return null
      }
    })()
    setVoiceLang(stored ?? detectDefaultLang())
    const autoStored = (() => {
      try {
        return localStorage.getItem(AUTOSPEAK_KEY)
      } catch {
        return null
      }
    })()
    setAutoSpeak(autoStored === null ? true : autoStored === 'true')
    setHydrated(true)
  }, [])

  // Keep refs in sync for the auto-speak effect.
  useEffect(() => {
    autoSpeakRef.current = autoSpeak
  }, [autoSpeak])
  useEffect(() => {
    voiceLangRef.current = voiceLang
  }, [voiceLang])
  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem(AUTOSPEAK_KEY, String(autoSpeak))
      } catch {
        // best-effort
      }
    }
  }, [autoSpeak, hydrated])

  // On each newly-arrived assistant answer: pre-synthesize its audio so a later
  // Listen click is instant (even when auto-speak is off), and auto-speak it
  // when enabled.
  useEffect(() => {
    const lastIndex = messages.length - 1
    if (lastIndex < spokenRef.current) return // nothing new
    const last = messages[lastIndex]
    spokenRef.current = messages.length
    if (!last || last.role !== 'assistant' || last.error) return

    if (!autoSpeakRef.current) {
      // Auto-speak is off: pre-synthesize now so a later Listen plays instantly.
      // (When auto-speak is on, playback below already caches the clip.)
      prewarmSpeech(last.content, voiceLangRef.current)
      return
    }
    const text = plainTextForSpeech(last.content)
    if (!text) return
    stopSpeakRef.current?.()
    lastSpokenNormRef.current = text // so voice mode can filter this reply's echo tail
    setSpeakingIndex(lastIndex)
    stopSpeakRef.current = speakSmart(
      text,
      voiceLangRef.current,
      () => setSpeakingIndex((cur) => (cur === lastIndex ? null : cur)),
      notifyVoiceUnavailable,
    )
  }, [messages])

  // Persist after hydration so we don't overwrite stored history with [].
  useEffect(() => {
    if (hydrated) saveHistory(messages)
  }, [messages, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(VOICE_LANG_KEY, voiceLang)
    } catch {
      // best-effort
    }
  }, [voiceLang, hydrated])

  // Auto-scroll to the latest message (and the thinking indicator).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  // Auto-focus the textarea when the panel opens.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [open])

  // Close on Escape while the panel is open.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Abort an in-flight turn / stop recognition + the mic meter on unmount.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      listeningRef.current = false
      stopListeningRef.current?.()
      if (micMeterTimerRef.current !== null) window.clearInterval(micMeterTimerRef.current)
      if (voiceTimerRef.current !== null) window.clearTimeout(voiceTimerRef.current)
      if (speakingWatchdogRef.current !== null) window.clearTimeout(speakingWatchdogRef.current)
      stopSpeakRef.current?.() // server-PCM playback isn't covered by cancelSpeech()
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      void micAudioCtxRef.current?.close().catch(() => {})
      cancelSpeech()
    }
  }, [])

  const toggleSpeak = (index: number, content: string) => {
    if (speakingIndex === index) {
      stopSpeakRef.current?.()
      cancelSpeech()
      setSpeakingIndex(null)
      return
    }
    const text = plainTextForSpeech(content)
    if (!text) return
    stopSpeakRef.current?.()
    lastSpokenNormRef.current = text
    setSpeakingIndex(index)
    stopSpeakRef.current = speakSmart(
      text,
      voiceLangRef.current,
      () => setSpeakingIndex((cur) => (cur === index ? null : cur)),
      notifyVoiceUnavailable,
    )
  }

  const toggleAutoSpeak = () => {
    setAutoSpeak((prev) => {
      const next = !prev
      if (!next) {
        cancelSpeech()
        setSpeakingIndex(null)
      }
      return next
    })
  }

  const resizeTextarea = () => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 72)}px` // ~3 rows
  }

  const send = (raw: string) => {
    const content = raw.trim()
    if (!content || pending) return

    stopSpeakRef.current?.()
    cancelSpeech()
    setSpeakingIndex(null)

    const next: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setDraft('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setPending(true)

    const controller = new AbortController()
    controllerRef.current = controller

    // Slice each message to the server's per-message cap so one very long turn
    // (a pasted wall of text, an unusually long answer) can never make the
    // whole history fail validation.
    const payload = next
      .slice(-MAX_HISTORY)
      .map(({ role, content: text }) => ({ role, content: text.slice(0, 8000) }))

    fetch(`${httpBase()}/help/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: payload }),
      signal: controller.signal,
    })
      .then((res) => res.json() as Promise<{ reply: string }>)
      .then((data) => {
        if (controller.signal.aborted) return
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || error instanceof DOMException) return
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Something went wrong. Please try again.', error: true },
        ])
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false)
      })
  }

  // Composer entry point for BOTH modes: Autopilot OFF branches straight into the
  // existing `send`/`/api/help/chat` path, unchanged. Autopilot ON runs the turn
  // through the Autopilot runner instead (build context → agent → plan → run/confirm/ask).
  const submitComposer = async (raw: string) => {
    const content = raw.trim()
    if (!content || pending) return
    // Sent — reset the dictation seed so ongoing listening starts a fresh sentence
    // (otherwise the already-sent text would resurface in the box on the next word).
    micBaseRef.current = ''
    micFinalRef.current = ''
    if (!autopilot) {
      send(content)
      return
    }

    stopSpeakRef.current?.()
    cancelSpeech()
    setSpeakingIndex(null)

    setMessages((m) => [...m, { role: 'user', content }])
    setDraft('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setPending(true)

    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    const res = await runner.runTurn(content, history)
    setMessages((m) => [...m, { role: 'assistant', content: res.say || 'Done.' }])
    setPending(false)
  }

  // Voice mode: a finished utterance auto-submits as a command; while a read-back
  // confirm is pending, "yes"/"no" answers it by voice instead.
  const handleVoiceSubmit = () => {
    const text = voiceBufRef.current.replace(/\s+/g, ' ').trim()
    if (!text) return
    if (pendingRef.current) {
      // Agent mid-turn — retry shortly instead of dropping the spoken command.
      if (voiceTimerRef.current !== null) window.clearTimeout(voiceTimerRef.current)
      voiceTimerRef.current = window.setTimeout(() => voiceSubmitRef.current(), 900)
      return
    }
    voiceBufRef.current = ''
    setVoiceHeard('')
    if (pendingConfirmRef.current) {
      if (/^(yes|yeah|yep|confirm|go ahead|proceed|do it|send it|ok(ay)?)\b/i.test(text)) { void runner.confirm(); return }
      if (/^(no|nope|cancel|stop|don'?t|abort)\b/i.test(text)) { runner.cancelConfirm(); return }
    }
    void submitComposer(text)
  }
  voiceSubmitRef.current = handleVoiceSubmit

  const enableVoiceMode = () => {
    setAutopilot(true) // voice commands act through Autopilot
    setVoiceMode(true)
    voiceModeRef.current = true // synchronously — the recognizer callbacks read it
    voiceBufRef.current = ''
    setVoiceHeard('')
    // Discard any half-dictated draft VISIBLY at toggle time (voice mode doesn't
    // use the composer box; leaving text there would be silently wiped later).
    setDraft('')
    micBaseRef.current = ''
    micFinalRef.current = ''
    if (!listeningRef.current) startMic()
  }
  const disableVoiceMode = () => {
    setVoiceMode(false)
    voiceModeRef.current = false
    if (voiceTimerRef.current !== null) { window.clearTimeout(voiceTimerRef.current); voiceTimerRef.current = null }
    voiceBufRef.current = ''
    setVoiceHeard('')
    // Silence any in-flight speech too — with the panel closed the pill is the
    // ONLY control left; turning voice off must not leave a disembodied voice.
    stopSpeakRef.current?.()
    cancelSpeech()
    setSpeakingIndex(null)
    stopMic()
  }

  const micBaseRef = useRef('')
  const micFinalRef = useRef('')
  // Live mic diagnostics: measure the ACTUAL audio level reaching the browser so a
  // muted / OS-blocked / wrong-device mic is diagnosed definitively (the recognizer
  // alone can't tell "you were quiet" apart from "Windows delivered silence").
  const listeningRef = useRef(false)
  const micStreamRef = useRef<MediaStream | null>(null)
  const micAudioCtxRef = useRef<AudioContext | null>(null)
  const micMeterTimerRef = useRef<number | null>(null)
  const [micLevel, setMicLevel] = useState(0)
  const [micDevice, setMicDevice] = useState('')
  // Generation token: quick off→on creates a NEW session; stale recognition chains
  // and in-flight getUserMedia meters must see the mismatch and stand down (else two
  // chains abort/restart each other forever and orphaned streams leak).
  const micSessionRef = useRef(0)
  const micRestartsRef = useRef({ count: 0, windowStart: 0 })
  // Never transcribe the assistant's own TTS coming out of the speakers. The
  // recognizer FINALIZES its buffered audio ~0.5-1.5s AFTER playback stops, so we
  // also record WHEN speech ended — voice mode drops results inside that tail too
  // (otherwise the spoken read-back could answer its own confirm).
  const speakingRef = useRef(false)
  const ttsEndedAtRef = useRef(0)
  const lastSpokenNormRef = useRef('') // text the assistant last spoke — for content-based echo suppression
  const speakingWatchdogRef = useRef<number | null>(null)
  useEffect(() => {
    if (speakingIndex === null && speakingRef.current) ttsEndedAtRef.current = Date.now()
    speakingRef.current = speakingIndex !== null
    // Defense-in-depth: a MISSED TTS onEnd (playback path that never fires its
    // callback) would strand speakingRef=true and make voice mode permanently
    // deaf. Bound it — force-clear after a hard ceiling longer than any real reply.
    if (speakingWatchdogRef.current !== null) { window.clearTimeout(speakingWatchdogRef.current); speakingWatchdogRef.current = null }
    if (speakingIndex !== null) {
      speakingWatchdogRef.current = window.setTimeout(() => {
        speakingRef.current = false
        ttsEndedAtRef.current = Date.now()
        setSpeakingIndex(null)
      }, 45000)
    }
  }, [speakingIndex])

  const stopMicMeter = () => {
    if (micMeterTimerRef.current !== null) {
      window.clearInterval(micMeterTimerRef.current)
      micMeterTimerRef.current = null
    }
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    void micAudioCtxRef.current?.close().catch(() => {})
    micAudioCtxRef.current = null
    setMicLevel(0)
    setMicDevice('')
  }

  const stopMic = () => {
    micSessionRef.current++ // invalidate any in-flight chain/meter for this session
    listeningRef.current = false
    stopListeningRef.current?.()
    stopMicMeter()
    setListening(false)
  }

  const startMicMeter = async (session: number) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!listeningRef.current || micSessionRef.current !== session) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      micStreamRef.current = stream
      const label = stream.getAudioTracks()[0]?.label ?? ''
      setMicDevice(label)
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      micAudioCtxRef.current = ctx
      // Autoplay policy can create the context suspended (esp. after the await) —
      // a suspended context reads flat silence and would false-alarm the diagnosis.
      if (ctx.state !== 'running') void ctx.resume().catch(() => {})
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      let peak = 0
      let warned = false
      const startedAt = Date.now()
      micMeterTimerRef.current = window.setInterval(() => {
        if (micSessionRef.current !== session) return // stale meter — stand down
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
        const rms = Math.sqrt(sum / data.length)
        peak = Math.max(peak, rms)
        setMicLevel(Math.round(rms * 50) / 50) // quantized — damp re-render churn
        // Sustained DIGITAL silence (exact zeros, context running) = Windows is
        // handing the browser nothing. Warn but KEEP LISTENING (never kill a
        // possibly-working session on a heuristic); clear if audio appears.
        if (!warned && Date.now() - startedAt > 4000 && peak < 0.001 && ctx.state === 'running') {
          warned = true
          setVoiceError(
            `Your mic${label ? ` ("${label}")` : ''} is on but only SILENCE is reaching the browser. Check: a physical/keyboard mic-mute, Windows Settings → Privacy & security → Microphone, and the default input device (Settings → System → Sound → Input). You can type meanwhile.`,
          )
        } else if (warned && peak >= 0.001) {
          warned = false
          setVoiceError(null)
        }
      }, 150)
    } catch {
      // getUserMedia refused — the recognizer's own error handler surfaces permissions.
    }
  }

  // Hard-restart the recognizer: tear down the current session (even if it still
  // SAYS "listening") + its buffers, and start a fresh one. Chrome's speech
  // service can silently stall after a network blip and stop emitting transcripts
  // while appearing live — this is the one-tap recovery so the next words are
  // definitely captured, without reloading the page.
  const restartMic = () => {
    setVoiceError(null)
    if (voiceTimerRef.current !== null) { window.clearTimeout(voiceTimerRef.current); voiceTimerRef.current = null }
    voiceBufRef.current = ''
    setVoiceHeard('')
    stopMic() // increments the session token → any in-flight chain stands down
    // Start fresh on the next tick so the old recognition fully tears down first.
    window.setTimeout(() => startMic(), 200)
  }

  const toggleMic = () => {
    if (listening) {
      stopMic()
      return
    }
    startMic()
  }

  const startMic = () => {
    if (listeningRef.current) return
    if (!isSpeechRecognitionSupported()) {
      setVoiceError("Voice input isn't supported in this browser.")
      return
    }
    setVoiceError(null)
    setListening(true)
    listeningRef.current = true
    const session = ++micSessionRef.current // this toggle-on owns the chain + meter
    micRestartsRef.current = { count: 0, windowStart: Date.now() }
    // Seed with whatever is already typed so dictation appends rather than replaces.
    micBaseRef.current = draft.trim() ? `${draft.trim()} ` : ''
    micFinalRef.current = ''
    void startMicMeter(session)
    // Chrome recycles recognition sessions (and ends them on silence with
    // "no-speech") — while the mic toggle is ON we transparently restart, so
    // listening keeps going until the recruiter clicks the mic off.
    const startRec = () => {
      stopListeningRef.current = startSpeechRecognition(
      SPEECH_LOCALES[voiceLang] ?? voiceLang,
      (result) => {
        if (speakingRef.current) return // never transcribe the assistant's own TTS
        if (voiceModeRef.current) {
          const sinceTts = Date.now() - ttsEndedAtRef.current
          // Tiny jitter guard only — skip the recognizer's instantaneous flush at
          // the moment playback stops. (The old 1500ms deaf window dropped the
          // user's real next command; that was the reliability bug.)
          if (sinceTts < 250) return
          // Hands-free: buffer what's heard and AUTO-SUBMIT after a short silence —
          // no Enter needed; works with the panel closed (the floating pill shows it).
          if (result.isFinal) {
            // Suppress the assistant's own read-back tail by CONTENT (not by going
            // deaf): only within a few seconds of playback ending, and only when the
            // phrase substantially echoes what was just spoken. A genuine command or
            // a short "yes"/"no" is never suppressed — so capture stays responsive.
            if (sinceTts < 3500 && isLikelyEcho(result.transcript, lastSpokenNormRef.current)) return
            voiceBufRef.current = `${voiceBufRef.current}${result.transcript} `.replace(/\s+/g, ' ')
          }
          // ANY activity (interims too) re-arms the silence timer — the user is
          // still talking; submitting mid-utterance would split the command.
          if (voiceTimerRef.current !== null) window.clearTimeout(voiceTimerRef.current)
          voiceTimerRef.current = window.setTimeout(() => voiceSubmitRef.current(), 1400)
          setVoiceHeard((voiceBufRef.current + (result.isFinal ? '' : result.transcript)).trim())
          return
        }
        // Dictation: stream the transcript into the box (guide + Autopilot) — commit
        // finalized chunks, show the live interim; Enter / send submits it.
        if (result.isFinal) micFinalRef.current += `${result.transcript} `
        const interim = result.isFinal ? '' : result.transcript
        setDraft((micBaseRef.current + micFinalRef.current + interim).replace(/\s+/g, ' ').trimStart())
        window.setTimeout(resizeTextarea, 0)
      },
      (error) => {
        // Benign/transient: 'no-speech' (a silent stretch) and 'aborted' just end
        // this session — onend below auto-restarts while the mic is still on.
        if (error === 'no-speech' || error === 'aborted') return
        if (micSessionRef.current !== session) return // stale chain — don't touch the live one
        const msg =
          error === 'not-allowed' || error === 'service-not-allowed'
            ? 'Microphone access is blocked. Allow the mic for localhost in your browser, and check Windows mic privacy (Settings → Privacy → Microphone).'
            : error === 'audio-capture'
              ? 'No microphone available — check it’s connected and enabled. You can type instead.'
              : error === 'network'
                ? 'Voice needs internet the browser’s speech service can reach. You can type instead.'
                : "Couldn't capture audio — please try again, or type your answer."
        setVoiceError(msg)
        listeningRef.current = false
        stopMicMeter()
        setListening(false)
      },
      () => {
        // Session ended (silence timeout / service recycle): restart while this
        // toggle-on still owns the mic. Stale chains (superseded session) do nothing.
        if (micSessionRef.current !== session) return
        if (listeningRef.current) {
          const now = Date.now()
          const w = micRestartsRef.current
          if (now - w.windowStart > 10000) { w.count = 0; w.windowStart = now }
          if (++w.count <= 12) {
            try { startRec(); return } catch { /* fall through to stop */ }
          } else {
            setVoiceError('Voice input keeps disconnecting — please try again, or type your answer.')
          }
        }
        listeningRef.current = false
        stopMicMeter()
        setListening(false)
      },
    )
    }
    try {
      startRec()
    } catch {
      stopMic()
      setVoiceError("Couldn't start voice input — please try again, or type your answer.")
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      controllerRef.current?.abort()
      if (!voiceModeRef.current) {
        // Voice mode keeps listening (and speaking) with the panel closed —
        // the floating mic pill takes over. Otherwise stop everything as before.
        listeningRef.current = false
        stopListeningRef.current?.()
        stopMicMeter()
        cancelSpeech()
        setSpeakingIndex(null)
        setListening(false)
        // Only reset pending when we actually stopped everything — in voice mode a
        // runner turn may still be in flight; clearing pending here would let a new
        // spoken command start a SECOND concurrent turn.
        setPending(false)
      }
    }
    setOpen(nextOpen)
  }

  const clearChat = () => {
    cancelSpeech()
    setSpeakingIndex(null)
    spokenRef.current = 0
    setMessages([])
    try {
      localStorage.removeItem(HISTORY_KEY)
    } catch {
      // best-effort
    }
  }

  // Recruiter-only: candidates never see the guide (keeps the interview surface
  // clean and distraction-free). The endpoint requires auth regardless.
  if (!isAuthenticated || role !== 'recruiter') return null

  const prompts = promptsForLang(voiceLang)
  const stepText =
    typeof registrySnapshot.stepName === 'string' && registrySnapshot.stepName
      ? `Set up an interview · Step ${registrySnapshot.step}/5 — ${registrySnapshot.stepName}`
      : 'Autopilot ready — tell me what to do'

  return (
    <>
      {/* Floating launcher — bottom-right, visible on every authenticated screen. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Mimic Guide — your TalbotIQ assistant"
        aria-label="Open Mimic Guide"
        className={cn(
          'fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-brand-field px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-150 hover:-translate-y-px hover:shadow-xl',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <Sparkles className="size-4" aria-hidden />
        Mimic Guide
        <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-brand-green-light ring-2 ring-white" aria-hidden />
      </button>

      {/* Hands-free voice pill — visible while Voice mode is on and the panel is
          CLOSED. Shows listening state + what was heard; speech auto-submits, so
          the recruiter can drive Autopilot without ever opening the panel. */}
      {voiceMode && !open ? (
        <div className="fixed bottom-6 left-6 z-[70] flex w-[min(360px,calc(100vw-3rem))] items-center gap-2.5 rounded-2xl border border-brand-gold/40 bg-brand-card/95 px-3 py-2.5 text-neutral-100 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={() => { if (!listening) { setVoiceError(null); startMic() } }}
            title={listening ? 'Listening' : 'Tap to resume listening'}
            aria-label={listening ? 'Listening' : 'Resume listening'}
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
              listening
                ? 'animate-pulse border-red-400/50 bg-red-500/20 text-red-300'
                : 'border-brand-border bg-brand-black text-brand-gray hover:border-brand-gold/50 hover:text-white',
            )}
          >
            <Mic className="size-4" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">
              {pending
                ? 'Working on it…'
                : runner.pendingConfirm
                  ? 'Awaiting confirmation — say “yes” or “no”'
                  : listening
                    ? 'Listening — speak a command'
                    : voiceError
                      ? 'Voice stopped — tap the mic to resume'
                      : 'Voice paused'}
            </div>
            <div className={cn('truncate text-[11px]', voiceError && !listening ? 'text-red-300' : 'text-brand-gray')}>
              {(!listening && voiceError)
                || voiceHeard
                || (runner.pendingConfirm
                  ? runner.pendingConfirm.summary
                  : 'e.g. “set up a video interview for Senior Backend Engineer”')}
            </div>
            <span className="mt-1.5 inline-flex h-1 w-24 overflow-hidden rounded-full bg-brand-border" aria-hidden>
              <span
                className="h-full rounded-full bg-brand-green-light transition-[width] duration-150"
                style={{ width: `${Math.min(100, Math.round(micLevel * 400))}%` }}
              />
            </span>
          </div>
          <button
            type="button"
            onClick={restartMic}
            title="Restart listening (use if it stops taking your voice)"
            aria-label="Restart listening"
            className="shrink-0 rounded-full border border-brand-border p-1.5 text-neutral-200 transition-colors duration-150 hover:bg-white/5 hover:text-white"
          >
            <RotateCw className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-full border border-brand-border px-2.5 py-1 text-[11px] font-semibold text-neutral-200 transition-colors duration-150 hover:border-brand-gold/50 hover:text-white"
          >
            Open
          </button>
          <button
            type="button"
            onClick={disableVoiceMode}
            title="Turn voice mode off"
            aria-label="Turn voice mode off"
            className="shrink-0 rounded-full border border-brand-border p-1.5 text-brand-gray transition-colors duration-150 hover:border-red-400/50 hover:text-red-300"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* Overlay + slide-in panel. */}
      <div
        className={cn(
          'fixed inset-0 z-[60]',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => handleOpenChange(false)}
          className={cn(
            'absolute inset-0 bg-neutral-900/50 backdrop-blur-[2px] transition-opacity duration-300',
            open ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          role="dialog"
          aria-label="Mimic Guide"
          className={cn(
            'absolute right-0 top-0 flex h-full w-full flex-col border-l border-brand-border bg-brand-black shadow-xl transition-transform duration-300 sm:max-w-md',
            open ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          {/* Header */}
          <div className="flex flex-col gap-2 border-b border-brand-border bg-brand-card/50 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 font-semibold text-white">
                <span className="flex size-7 items-center justify-center rounded-lg bg-brand-field" aria-hidden>
                  <Sparkles className="size-3.5 text-white" />
                </span>
                Mimic Guide
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAutopilot((prev) => !prev)}
                  title={autopilot ? 'Autopilot: on' : 'Autopilot: off'}
                  aria-label="Toggle Autopilot"
                  aria-pressed={autopilot}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150',
                    autopilot
                      ? 'border-brand-gold/50 bg-brand-gold/15 text-brand-gold-light'
                      : 'border-brand-border text-brand-gray hover:border-brand-gold/40 hover:text-white',
                  )}
                >
                  Autopilot
                </button>
                <button
                  type="button"
                  onClick={() => (voiceMode ? disableVoiceMode() : enableVoiceMode())}
                  title={voiceMode ? 'Voice mode: on — hands-free, auto-submits what you say (works with the panel closed)' : 'Voice mode: hands-free commands — speak and it acts, even with the panel closed'}
                  aria-label="Toggle hands-free voice mode"
                  aria-pressed={voiceMode}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150',
                    voiceMode
                      ? 'border-red-400/50 bg-red-500/15 text-red-300'
                      : 'border-brand-border text-brand-gray hover:border-brand-gold/40 hover:text-white',
                  )}
                >
                  <Mic className="size-3" aria-hidden />
                  Voice
                </button>
                <button
                  type="button"
                  onClick={toggleAutoSpeak}
                  title={autoSpeak ? 'Auto-speak answers: on' : 'Auto-speak answers: off'}
                  aria-label="Toggle auto-speak"
                  aria-pressed={autoSpeak}
                  className="transition-colors duration-150 hover:text-white"
                >
                  {autoSpeak ? (
                    <Volume2 className="size-4 text-brand-gold" aria-hidden />
                  ) : (
                    <VolumeX className="size-4 text-brand-gray" aria-hidden />
                  )}
                </button>
                {messages.length > 0 ? (
                  <button
                    type="button"
                    onClick={clearChat}
                    className="text-xs font-medium text-brand-gray transition-colors duration-150 hover:text-white"
                  >
                    Clear chat
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  className="text-brand-gray transition-colors duration-150 hover:text-white"
                  aria-label="Close Mimic Guide"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </div>
            <p className="text-xs text-brand-gray">Your TalbotIQ AI assistant</p>
            <div className="flex items-center gap-2 pt-1 text-xs text-brand-gray">
              <Languages className="size-3.5 shrink-0" aria-hidden />
              <span>Voice language</span>
              <VoiceLangSelect value={voiceLang} onChange={setVoiceLang} />
            </div>
            {autopilot ? (
              <p className="pt-1 text-[11px] leading-relaxed text-brand-gray">
                Type what you want — e.g. &quot;set up a video interview for Senior Backend
                Engineer&quot;
              </p>
            ) : null}
          </div>

          {/* Autopilot: step tracker, action log, read-back confirm card. */}
          {autopilot ? (
            <div className="flex flex-col gap-2.5 border-b border-brand-border bg-brand-card px-4 py-3">
              <p className="flex items-center gap-2 text-xs text-brand-gray">
                <span className="size-1.5 shrink-0 rounded-full bg-brand-green-light" aria-hidden />
                <span className="truncate">{stepText}</span>
              </p>
              {runner.log.length > 0 ? (
                <div className="max-h-24 overflow-y-auto rounded-lg border border-brand-border bg-brand-black p-2.5 font-mono text-[10px] leading-relaxed text-brand-gray">
                  {runner.log.map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
                </div>
              ) : null}
              {runner.pendingConfirm ? (
                <div className="rounded-xl border border-brand-gold/45 bg-brand-gold/10 p-3">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-gold-light">
                    Confirm before I run this
                  </p>
                  <p className="mb-2.5 text-xs leading-relaxed text-neutral-100">{runner.pendingConfirm.summary}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void runner.confirm()}
                      className="rounded-full bg-brand-gold px-3.5 py-1 text-[11px] font-semibold text-brand-black transition-colors duration-150 hover:bg-brand-gold-light"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={runner.cancelConfirm}
                      className="rounded-full border border-brand-border px-3.5 py-1 text-[11px] font-semibold text-neutral-200 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-5">
                <p className="text-sm leading-relaxed text-neutral-200">
                  Hi! I&apos;m <span className="font-semibold text-white">Mimic Guide</span>. Ask me
                  anything about TalbotIQ — interviews, templates, question sets, sessions, AI
                  Avatar Screening, or results.
                </p>
                <div className="flex flex-col gap-2">
                  <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-gray">Try asking</p>
                  {prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setDraft(prompt)}
                      className="rounded-full border border-brand-border bg-brand-card/60 px-3.5 py-2 text-left text-xs text-neutral-100 transition-colors duration-150 hover:border-brand-gold/50 hover:bg-brand-gold/10 hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((message, index) => (
                  <MessageBubble
                    key={index}
                    message={message}
                    speaking={speakingIndex === index}
                    onToggleSpeak={() => toggleSpeak(index, message.content)}
                    onNavigate={() => handleOpenChange(false)}
                  />
                ))}
                {pending ? <ThinkingDots /> : null}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-brand-border bg-brand-card p-3">
            {voiceError ? (
              <p className="mb-2 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
                {voiceError}
              </p>
            ) : null}
            {listening ? (
              <div className="mb-2 flex items-center gap-2 px-0.5 text-[11px] text-brand-gray">
                <span className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />
                <span className="truncate">
                  Listening{micDevice ? ` — ${micDevice}` : ''}
                  {voiceMode
                    ? (voiceHeard ? ` — “${voiceHeard}”` : ' — hands-free: it sends automatically when you pause')
                    : '… speak, then click the mic to stop'}
                </span>
                <span className="ml-auto inline-flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-brand-border" aria-hidden>
                  <span
                    className={cn('h-full rounded-full transition-[width] duration-150', micLevel > 0.02 ? 'bg-brand-green-light' : 'bg-brand-gray')}
                    style={{ width: `${Math.min(100, Math.round(micLevel * 400))}%` }}
                  />
                </span>
                <button
                  type="button"
                  onClick={restartMic}
                  title="Restart listening (use if it stops taking your voice)"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-border px-2 py-0.5 text-[10px] font-semibold text-neutral-200 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                >
                  <RotateCw className="size-3" aria-hidden /> Restart
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={toggleMic}
                title={listening ? 'Listening… speak now' : 'Voice input'}
                aria-label="Voice input"
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
                  listening
                    ? 'animate-pulse border-red-400/50 bg-red-500/15 text-red-300'
                    : 'border-brand-border text-brand-gray hover:border-brand-gold/50 hover:text-white',
                )}
              >
                <Mic className="size-4" aria-hidden />
              </button>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  resizeTextarea()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submitComposer(draft)
                  }
                }}
                rows={1}
                placeholder="Ask anything about TalbotIQ…"
                className="max-h-[72px] min-h-9 flex-1 resize-none rounded-xl border border-brand-border bg-brand-black px-3.5 py-2 text-sm text-neutral-100 outline-none transition-colors duration-150 placeholder:text-brand-gray/70 focus-visible:border-brand-gold/60"
              />
              <button
                type="button"
                onClick={() => void submitComposer(draft)}
                disabled={pending || draft.trim().length === 0}
                title="Send"
                aria-label="Send message"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-gold text-brand-black transition-colors duration-150 hover:bg-brand-gold-light disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function MessageBubble({
  message,
  speaking,
  onToggleSpeak,
  onNavigate,
}: {
  message: ChatMessage
  speaking: boolean
  onToggleSpeak: () => void
  onNavigate: () => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-md border border-brand-gold/30 bg-brand-gold/15 px-3.5 py-2 text-sm leading-relaxed text-neutral-100">
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <div
        className={cn(
          'max-w-[90%] rounded-2xl rounded-tl-md border px-3.5 py-2.5',
          message.error
            ? 'border-red-400/30 bg-red-500/10 text-red-300'
            : 'border-brand-border bg-brand-card text-neutral-100',
        )}
      >
        {message.error ? (
          <p className="text-sm leading-relaxed">{message.content}</p>
        ) : (
          <GuideMarkdown text={message.content} onNavigate={onNavigate} />
        )}
      </div>
      {message.error ? null : (
        <button
          type="button"
          onClick={onToggleSpeak}
          title={speaking ? 'Stop' : 'Listen'}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-150',
            speaking ? 'text-brand-gold' : 'text-brand-gray hover:bg-white/5 hover:text-white',
          )}
        >
          {speaking ? <Square className="size-3" aria-hidden /> : <Volume2 className="size-3" aria-hidden />}
          {speaking ? 'Stop' : 'Listen'}
        </button>
      )}
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-brand-border bg-brand-card px-3.5 py-3">
        <span className="sr-only">Thinking…</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-typing-dot rounded-full bg-brand-gold"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
