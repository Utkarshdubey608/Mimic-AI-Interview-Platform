import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { httpBase } from '@/lib/apiOrigin'
import type { TavusConversation, SupportedLanguage, PipelineMode } from '@/types/tavus.types'
import type { HumeEmotion, BatchJobStatus, HumeSessionResult } from '@/types/hume.types'
import type { TranscriptEntry } from '@/services/deepgram'

export type { TranscriptEntry }

export interface DraftForm {
  replica_id: string; persona_id: string; ai_name: string; conversation_name: string
  conversational_context: string; custom_greeting: string; callback_url: string
  max_call_duration: number; participant_left_timeout: number; participant_absent_timeout: number
  enable_recording: boolean; enable_transcription: boolean; apply_conversation_override: boolean
  apply_greenscreen: boolean; background_url: string; language: SupportedLanguage
  pipeline_mode: PipelineMode; recording_s3_bucket_name: string
  recording_s3_bucket_region: string; aws_assume_role_arn: string
}

export interface Draft {
  id: string
  name: string
  savedAt: string
  form: DraftForm
  questions: string[]
}

interface AppState {
  // NON-SECRET configured-flags, hydrated from the server.
  //
  // Every vendor secret lives in the deployment environment. These fields hold a
  // sentinel ('server' when the backend reports it configured, else '') purely so the
  // ported UI's truthiness gating still works — no secret has ever been in them.
  //
  // Tavus used to be the exception: "a real runtime key entered in Settings". That
  // input is gone, along with every route that accepted a credential from a browser,
  // so it is a flag like the rest — see `tavusConfigured`.
  deepgramKey: string
  humeKey: string
  geminiKey: string
  awsProxyUrl: string
  webhookUrl: string
  /** Whether the SERVER has Tavus configured. Never a key. */
  tavusConfigured: boolean

  // Defaults
  defaultReplicaId: string
  defaultPersonaId: string

  // Active interview session
  currentConversation: TavusConversation | null
  questions: string[]
  currentQuestionIdx: number
  interviewActive: boolean

  // Saved drafts
  drafts: Draft[]

  // Live metrics
  metrics: {
    confidence: number
    anxiety: number
    wpm: number
    fillers: number
    engagement: number
  }

  // Hume AI
  humeJobId: string | null
  humeJobStatus: BatchJobStatus | null
  humeResult: HumeSessionResult | null
  questionTimestamps: number[]
  liveEmotions: HumeEmotion[]
  humeStreamActive: boolean

  // Deepgram transcript
  sessionTranscript: TranscriptEntry[]
  deepgramConnected: boolean

  // Actions
  setDeepgramKey: (k: string) => void
  setHumeKey: (k: string) => void
  setGeminiKey: (k: string) => void
  setAwsProxyUrl: (url: string) => void
  setWebhookUrl: (k: string) => void
  setDefaultReplicaId: (id: string) => void
  setDefaultPersonaId: (id: string) => void
  setCurrentConversation: (c: TavusConversation | null) => void
  setQuestions: (q: string[]) => void
  setCurrentQuestionIdx: (i: number) => void
  setInterviewActive: (v: boolean) => void
  updateMetrics: (m: Partial<AppState['metrics']>) => void
  saveDraft: (name: string, form: DraftForm, questions: string[]) => void
  deleteDraft: (id: string) => void
  setHumeJobId: (id: string | null) => void
  setHumeJobStatus: (s: BatchJobStatus | null) => void
  setHumeResult: (r: HumeSessionResult | null) => void
  pushQuestionTimestamp: (ts: number) => void
  resetQuestionTimestamps: () => void
  setLiveEmotions: (e: HumeEmotion[]) => void
  setHumeStreamActive: (v: boolean) => void
  pushTranscriptEntry: (e: TranscriptEntry) => void
  clearSessionTranscript: () => void
  setDeepgramConnected: (v: boolean) => void
  reset: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      deepgramKey: '',
      humeKey: '',
      geminiKey: '',
      awsProxyUrl: `${httpBase()}/avatar/analyze-face`,
      webhookUrl: '',
      tavusConfigured: false,
      defaultReplicaId: '',
      defaultPersonaId: '',
      currentConversation: null,
      drafts: [],
      questions: [
        'Tell me about yourself and your background.',
        'Describe a challenging problem you solved recently.',
        'How do you handle pressure and tight deadlines?',
        'Where do you see yourself in 3 years?',
        'Do you have any questions for us?',
      ],
      currentQuestionIdx: 0,
      interviewActive: false,
      metrics: { confidence: 0, anxiety: 0, wpm: 0, fillers: 0, engagement: 0 },
      humeJobId: null,
      humeJobStatus: null,
      humeResult: null,
      questionTimestamps: [],
      liveEmotions: [],
      humeStreamActive: false,
      sessionTranscript: [],
      deepgramConnected: false,

      setDeepgramKey: (k) => set({ deepgramKey: k }),
      setHumeKey: (k) => set({ humeKey: k }),
      setGeminiKey: (k) => set({ geminiKey: k }),
      setAwsProxyUrl: (url) => set({ awsProxyUrl: url }),
      setWebhookUrl: (k) => set({ webhookUrl: k }),
      setDefaultReplicaId: (id) => set({ defaultReplicaId: id }),
      setDefaultPersonaId: (id) => set({ defaultPersonaId: id }),
      setCurrentConversation: (c) => set({ currentConversation: c }),
      setQuestions: (q) => set({ questions: q }),
      setCurrentQuestionIdx: (i) => set({ currentQuestionIdx: i }),
      setInterviewActive: (v) => set({ interviewActive: v }),
      updateMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m } })),
      saveDraft: (name, form, questions) => set((s) => ({
        drafts: [
          { id: `draft-${Date.now()}`, name, savedAt: new Date().toISOString(), form, questions },
          ...s.drafts.filter(d => d.name !== name),
        ],
      })),
      deleteDraft: (id) => set((s) => ({ drafts: s.drafts.filter(d => d.id !== id) })),
      setHumeJobId: (id) => set({ humeJobId: id }),
      setHumeJobStatus: (s) => set({ humeJobStatus: s }),
      setHumeResult: (r) => set({ humeResult: r }),
      pushQuestionTimestamp: (ts) => set((s) => ({ questionTimestamps: [...s.questionTimestamps, ts] })),
      resetQuestionTimestamps: () => set({ questionTimestamps: [] }),
      setLiveEmotions: (e) => set({ liveEmotions: e }),
      setHumeStreamActive: (v) => set({ humeStreamActive: v }),
      pushTranscriptEntry: (e) => set((s) => ({ sessionTranscript: [...s.sessionTranscript, e] })),
      clearSessionTranscript: () => set({ sessionTranscript: [] }),
      setDeepgramConnected: (v) => set({ deepgramConnected: v }),
      reset: () => set({
        currentConversation: null,
        currentQuestionIdx: 0,
        interviewActive: false,
        metrics: { confidence: 0, anxiety: 0, wpm: 0, fillers: 0, engagement: 0 },
        humeJobId: null,
        humeJobStatus: null,
        humeResult: null,
        questionTimestamps: [],
        liveEmotions: [],
        humeStreamActive: false,
        sessionTranscript: [],
        deepgramConnected: false,
      }),
    }),
    {
      name: 'talbotiq-store',
      // Only recruiter preferences persist client-side. The deepgram/hume/gemini
      // "configured" flags come fresh from the server each load.
      //
      // `awsKey`/`anthropicKey` used to be persisted here too. They were dead —
      // nothing outside this file ever read them (AWS Rekognition goes through the
      // server proxy at awsProxyUrl; there is no Anthropic caller at all) — so
      // they were storing secrets in localStorage for no functional reason and
      // have been removed entirely.
      //
      // `tavusKey` is GONE, field and all. It survived the common-backend migration
      // as "UI state for the Settings page's save-to-server input" — which is to say
      // the browser still had a box to type a vendor credential into, and a route to
      // send it to. Credentials come from the deployment environment; there is no
      // input, no field, and no route. See app/web/routes/settings.py.
      partialize: (s) => ({
        webhookUrl: s.webhookUrl,
        defaultReplicaId: s.defaultReplicaId,
        defaultPersonaId: s.defaultPersonaId,
        questions: s.questions,
        drafts: s.drafts,
      }),
    },
  ),
)

/**
 * Hybrid: hydrate the non-secret "configured" flags from the server so the ported
 * UI gating works without any secret ever reaching the browser. The server holds
 * the real Deepgram/Hume/Gemini/AWS keys.
 *
 * Called from the recruiter shell AFTER sign-in — the /api/avatar/status endpoint
 * is recruiter-gated, so it must run authenticated (the ID token is attached by
 * the global fetch interceptor in AuthProvider).
 */
export function refreshServiceStatus() {
  fetch(`${httpBase()}/avatar/status`)
    .then((r) => (r.ok ? r.json() : null))
    .then((s: { deepgram?: boolean; hume?: boolean; gemini?: boolean; rekognition?: boolean; tavus?: boolean } | null) => {
      if (!s) return
      useAppStore.setState({
        deepgramKey: s.deepgram ? 'server' : '',
        humeKey: s.hume ? 'server' : '',
        geminiKey: s.gemini ? 'server' : '',
        awsProxyUrl: s.rekognition ? `${httpBase()}/avatar/analyze-face` : '',
        tavusConfigured: !!s.tavus,
      })
    })
    .catch(() => { /* offline / server down — panels show their own "not configured" states */ })
}
