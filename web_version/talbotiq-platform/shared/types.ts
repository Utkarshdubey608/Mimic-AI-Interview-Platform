/**
 * Shared domain + API contract — imported by BOTH the Vite client and the
 * Express server. Keep this the single source of truth so the two sides
 * cannot drift. Everything here is type-only (erased at runtime).
 */

/* ─── Core config ───────────────────────────────────────────────────────── */

/**
 * The interview modes.
 *
 * `mcq` is the one CLOSED-ended mode: the correct answer is known in advance, so
 * it is scored by comparison rather than by a model. That difference is why it
 * carries its own question shape and its own scorer (see
 * `backend/app/web/services/mcq_scoring.py`) instead of routing through the
 * Gemini evaluation path the other six share.
 *
 * Adding to this union is an interop event, not a local change: the same list
 * exists in `backend/app/web/routes/sessions.py` (`TRACKS`, server-side
 * validation) and in `mobile_desktop_app_version/.../recruiter_models.dart`
 * (`TrackType`). The Flutter client stores these as plain string constants with a
 * `default:` fallback in `label()`, so an unrecognised value does NOT crash it —
 * it renders as "Timed Q&A (Chat)". `voice`, `video` and `two_way` are already
 * mislabelled there for exactly this reason; `mcq` joins them until that client
 * is updated.
 */
export type TrackType =
  | 'chat' | 'chatbot' | 'video_avatar' | 'voice' | 'video' | 'two_way' | 'mcq'
export type QuestionSource = 'adaptive' | 'fixed'

/* ─── Identity & access control (IAM) ───────────────────────────────────────
 * Auth is handled by Firebase Authentication (Email/Password). The role lives on
 * the Firestore document `users/{uid}.role` — chosen by the user at sign-up, read
 * live by the client, and read per-request by the server (Admin SDK). This mirrors
 * the Flutter app exactly so both clients interoperate on the same documents.
 * There are NO custom claims. `admin` is an optional, server-only overlay (a
 * recruiter with elevated visibility of unclaimed legacy sessions, from the
 * ADMIN_EMAILS allowlist) — it is NOT a role and is never taken from the client. */

export type UserRole = 'recruiter' | 'candidate'

export interface AppUser {
  uid: string
  email: string
  role: UserRole
  admin?: boolean               // recruiter with elevated visibility (server overlay)
  displayName?: string
  emailVerified: boolean
  status: 'active' | 'pending' | 'disabled'
  createdAt: string
  updatedAt: string
}

/** The verified identity attached to every authenticated server request. */
export interface AuthContext {
  uid: string
  email: string
  emailVerified: boolean
  role: UserRole
  admin: boolean
}

export interface TimingConfig {
  prepSeconds: number             // default 30
  answerSeconds: number           // default 120
  allowSkipPrep: boolean          // default true
  allowEarlySubmit: boolean       // default true
  warningThresholdSeconds: number // default 15
  numberOfQuestions?: number      // adaptive only; fixed derives from the set
  totalTimeCapSeconds?: number    // optional overall cap
}

export interface KpiDefinition {
  id: string
  label: string
  description: string
  weight: number   // relative weight; auto-normalized at scoring time
  enabled: boolean
}
export interface KpiRubric {
  kpis: KpiDefinition[]
  scoreScale: 100
}

export interface FixedQuestion {
  id: string
  text: string
  category?: string
  idealAnswerNotes?: string
}
export interface QuestionSet {
  id: string
  name: string
  questions: FixedQuestion[]
  /**
   * Who authored it. RECORDED, not enforced — question sets are still listed to
   * every recruiter on the deployment, exactly as before. Optional because
   * documents created before this field existed have no author and must not be
   * given one retroactively. See the ⚠️ in backend routes/templates.py for the
   * isolation decision this exists to keep open.
   */
  recruiterId?: string
  createdAt: string
  updatedAt: string
}

/* ─── MCQ (multiple choice) ─────────────────────────────────────────────────
 * The closed-ended mode. Everything here is additive: an existing question set
 * has no `kind` and keeps behaving exactly as it did.
 *
 * THE ONE RULE THAT MATTERS: `McqQuestion` — the stored, authored question —
 * carries the answer key and NEVER crosses to a candidate's browser.
 * `McqQuestionPublic` is what a candidate receives, and it is built by an
 * allow-list on the server (`mcq_public_question`), not by deleting fields from
 * the stored one. A field added to `McqQuestion` later is therefore invisible to
 * the client until someone adds it to the public shape on purpose. */

export interface McqOption {
  id: string
  text: string
}

/** Single-answer or multi-select. Multi is inferred from a key of >1 either way. */
export type McqAnswerType = 'single' | 'multi'

/** The AUTHORED question. Recruiter-side and server-side only. */
export interface McqQuestion {
  id: string
  text: string
  options: McqOption[]
  /** The answer key. Never sent to a candidate. */
  correctOptionIds: string[]
  type: McqAnswerType
  /** Defaults to 1. Lets a paper be weighted; percentages are over points. */
  points?: number
  topic?: string
  difficulty?: 'easy' | 'medium' | 'hard'
  /** Shown in the recruiter's report, and to the candidate only after scoring. */
  explanation?: string
}

/** What a candidate actually receives. No key, by construction. */
export interface McqQuestionPublic {
  id: string
  text: string
  type: McqAnswerType
  options: McqOption[]
  points: number
}

/** How a multi-select question is credited. See the scorer for why all-or-nothing
 *  is the default: under a naive partial rule, selecting every option scores full
 *  marks on every multi-select question in the paper. */
export type McqMultiRule = 'all_or_nothing' | 'partial'

export interface McqConfig {
  multiRule: McqMultiRule
  /** Per-question seconds, or absent for an untimed paper. */
  perQuestionSeconds?: number
  /** Whole-paper seconds, or absent. Independent of the per-question timer. */
  totalSeconds?: number
  /** Percentage a candidate must reach. Absent means no pass/fail verdict is made. */
  passThreshold?: number
  /** Shuffle option order per candidate, so a leaked "it's the third one" is worthless. */
  shuffleOptions?: boolean
  shuffleQuestions?: boolean
}

/** An MCQ question set. Same per-recruiter ownership and isolation as the others. */
export interface McqQuestionSet {
  id: string
  kind: 'mcq'
  name: string
  questions: McqQuestion[]
  createdAt: string
  updatedAt: string
}

/* ── Results ──────────────────────────────────────────────────────────────── */

export interface McqQuestionResult {
  questionId: string
  selectedOptionIds: string[]
  /** Recruiter-facing: it is what makes a result reviewable. */
  correctOptionIds: string[]
  correct: boolean
  /** A question with no key cannot be scored; it counts for neither side. */
  unscored?: boolean
  points: number
  pointsAvailable: number
}

export interface McqTopicResult {
  topic: string
  correct: number
  count: number
  points: number
  pointsAvailable: number
}

export interface McqResult {
  kind: 'mcq'
  multiRule: McqMultiRule
  questions: McqQuestionResult[]
  correctCount: number
  questionCount: number
  points: number
  pointsAvailable: number
  /** null when nothing in the paper was scoreable — NOT 0, which would read as
   *  a candidate who got everything wrong. */
  percent: number | null
  passThreshold?: number
  passed?: boolean
  topics?: McqTopicResult[]
}

/* ── Invite-email templates (owned per recruiter; Express/JSON store) ──────────
 * Configures the Brevo invite email a recruiter can preview/test before sending.
 * `recruiterId` is stamped server-side from the auth token (never client-supplied),
 * mirroring the Sessions ownership pattern. The per-candidate interview link and the
 * "use this exact email" note are injected + locked server-side at send time. */
/** Discriminates configurable emails by transition purpose. Absent === 'invite'. */
export type EmailKind = 'invite' | 'advance' | 'selected' | 'rejection'

export interface InviteEmailSender {
  verifiedSenderEmail: string
  fromName: string
  replyTo?: string
}
export interface InviteEmailTemplate {
  id: string
  recruiterId: string // OWNER (Firebase uid) — server-stamped, scopes all reads
  name: string
  isDefault: boolean
  kind?: EmailKind // absent === 'invite' (backward-compatible; see kindOf())
  sender: InviteEmailSender
  subject: string // supports {{merge_vars}}
  bodyHtml: string // sanitized WYSIWYG output (editable body region only)
  cta: { text: string; color: string }
  branding: BrandingConfig & { footer?: string }
  deadlineText?: string
  createdAt: string
  updatedAt: string
}
export type InviteSendStatusValue =
  | 'accepted' | 'delivered' | 'bounced' | 'spam' | 'failed' | 'opened' | 'clicked'
/** Additive, Flutter-ignored status block written onto each interviews/{id} doc. */
export interface InviteSendStatus {
  messageId?: string
  status: InviteSendStatusValue
  error?: string
  sentAt?: string
  attempts: number
  lastEventAt?: string
}

/* ── Multi-round interview pipelines (additive; local Express/JSON store) ──────
 * A Pipeline groups ordered rounds for a role. Each round a candidate enters is a
 * real interviews/{id} invite doc (reuses the /take/:id + claim + scoring path).
 * Per-candidate progression is tracked in PipelineCandidate. Owned per recruiter
 * (recruiterId server-stamped), mirroring Sessions. */
export type AdvanceRule =
  | { kind: 'threshold'; value: number }  // overall score >= value
  | { kind: 'topN'; value: number }       // top N by score

export interface RoundDef {
  index: number                 // 0-based, contiguous
  name: string
  mode: TrackType               // async auto-scored subset in v1
  source?: 'tailor' | 'set'
  config?: {
    style: QuestionStyle
    techCount: number
    nonTechCount: number
    difficulty: DifficultyChoice
    domains: string[]
    model: GeminiModel
  }
  questionSetId?: string
  advanceRule?: AdvanceRule
}

export interface Pipeline {
  id: string
  recruiterId: string           // OWNER — server-stamped
  role: string
  type: 'multi'                 // single-interview setups create no pipeline
  name?: string
  rounds: RoundDef[]            // ordered; length >= 1
  createdAt: string
  updatedAt: string
}

export interface CreatePipelineRequest {
  role: string
  name?: string
  rounds: RoundDef[]
}

export type PipelineCandidateStatus = 'in_round' | 'advanced' | 'selected' | 'not_advancing'

export interface RoundProgress {
  roundIndex: number
  interviewId: string           // interviews/{id} doc + local session id for this round
  invitedAt: string
}

export interface AuditEntry {
  at: string
  byUid: string
  action: 'invited' | 'advanced' | 'selected' | 'not_advancing' | 'moved_back'
  fromRound?: number
  toRound?: number
  basis?: string                // "drag" | "threshold>=60" | "topN=5"
  emailResult?: 'accepted' | 'failed' | 'skipped'
}

export interface PipelineCandidate {
  id: string
  pipelineId: string
  recruiterId: string           // OWNER — server-stamped
  candidateEmail: string
  candidateEmailLower: string
  candidateName?: string
  role: string
  currentRoundIndex: number
  status: PipelineCandidateStatus
  perRound: RoundProgress[]
  history: AuditEntry[]
  createdAt: string
  updatedAt: string
}

/** Additive, Flutter-ignored ref written onto a round's interviews/{id} doc. */
export interface InterviewPipelineRef {
  pipelineId: string
  roundIndex: number
  pipelineCandidateId: string
}

export interface BoardCard {
  pipelineCandidateId: string
  candidateEmail: string
  candidateName?: string
  currentRoundIndex: number
  status: PipelineCandidateStatus
  roundStatus: 'invited' | 'in_progress' | 'completed' | 'expired' | 'none'
  score: number | null
  advanceable: boolean
  history: AuditEntry[]
}
export interface BoardColumn {
  key: string
  title: string
  roundIndex: number | null
  kind: 'round' | 'selected' | 'not_advancing'
  cards: BoardCard[]
}
export interface PipelineBoard {
  pipeline: Pipeline
  columns: BoardColumn[]
}

export interface PipelineInviteRequest {
  candidates: { email: string; role: string }[]
  emailConfig?: Partial<InviteEmailTemplate>
  emailTemplateId?: string
  origin?: string
  sendEmails?: boolean
}
export interface PipelineInviteResult {
  pipelineId: string
  created: { id: string; email: string; link: string; sent?: boolean; status?: InviteSendStatusValue; error?: string }[]
  emailed: number
  dryRun: boolean
}

export interface AdvanceRequest {
  candidateIds: string[]
  targetRoundIndex: number
  emailTemplateId?: string
  emailConfig?: Partial<InviteEmailTemplate>
  origin?: string
  basis?: string
  sendEmails?: boolean
}
export interface NotAdvancingRequest {
  candidateIds: string[]
  sendRejection?: boolean
  emailTemplateId?: string
  emailConfig?: Partial<InviteEmailTemplate>
}
export interface MoveBackRequest {
  candidateId: string
}
export interface AdvanceResult {
  pipelineId: string
  results: { pipelineCandidateId: string; email: string; toRound: number | 'selected' | 'not_advancing'; sent?: boolean; error?: string }[]
}

export interface BrandingConfig {
  companyName: string
  logoUrl?: string
  accentColor: string
  welcomeMessage?: string
}

export interface IntegrityConfig {
  enforceFullscreen: boolean
  detectTabSwitch: boolean
  disablePasteInAnswers: boolean
  disableCopy: boolean
  maxTabSwitchWarnings: number
  logEvents: boolean
}

/* ─── Chatbot (conversational) track config ─────────────────────────────── */

export type InterviewMode = 'conversational' | 'timed'

/** Adaptive, résumé-grounded conversational settings (chatbot track). */
export interface AdaptiveConfig {
  role: string
  seniority?: string
  difficulty: DifficultyChoice
  style?: QuestionStyle          // 'technical' | 'non_technical' | 'mix'
  numberOfQuestions: number
  technicalCount?: number        // used when style === 'mix'
  nonTechnicalCount?: number     // used when style === 'mix'
  focusTopics?: string[]
  allowFollowUps: boolean
  maxFollowUpsPerQuestion: number
  interviewerTone?: string
  language?: string
}

/** Timing for the chatbot track's TIMED mode — kept separate from TimingConfig. */
export interface ConversationTimingConfig {
  thinkingSeconds: number          // default 30
  perQuestionSeconds: number       // default 120
  totalTimeCapSeconds?: number
  allowSkipThinking: boolean       // default true
  allowEarlySubmit: boolean        // default true
  warningThresholdSeconds: number  // default 15
}

/**
 * Optional per-question timer overlay for the CONVERSATIONAL chatbot track.
 * Reuses the timed-track countdown; only 'question' and (optionally) 'follow_up'
 * turns are timed — never greetings, the readiness step, or wrap-up. When
 * `enabled` is false the track behaves as the pure conversational flow.
 */
export interface ChatbotTimerConfig {
  enabled: boolean                 // master on/off (per interview type/template)
  perQuestionSeconds: number       // countdown per question (e.g. 120)
  timeFollowUps: boolean           // do follow-up questions also get a timer? (default true)
  followUpSeconds?: number         // optional distinct amount for follow-ups (else perQuestionSeconds)
  includeThinkingPhase: boolean    // optional short prep sub-timer before answering (default false)
  thinkingSeconds?: number         // used when includeThinkingPhase (e.g. 20)
  warningThresholdSeconds: number  // ring turns amber→red / show warning (e.g. 15)
  allowEarlySubmit: boolean        // candidate can submit before time is up (default true)
  autoSubmitOnExpiry: boolean      // auto-advance at 0 (default true)
  perQuestionOverrides?: Record<string, number> // custom seconds for specific fixed-set question ids
}

/* ─── Voice track config ────────────────────────────────────────────────── */

/** Real-time engine. `gemini_live` = native-audio bidi stream (built). `pipeline`
 *  = Cloud STT→Gemini→TTS (typed flag; not yet implemented — needs GCP creds). */
export type VoiceEngine = 'gemini_live' | 'pipeline'

/** A selectable voice for the catalog/preview UI. */
export interface VoiceOption {
  id: string                       // prebuiltVoiceConfig.voiceName for gemini_live
  label: string
  gender?: 'male' | 'female' | 'neutral'
  language: string
  accent?: string
  engine: VoiceEngine
  description?: string
  sampleUrl?: string               // optional pre-rendered sample; else previewed live
}

/** A selectable interviewer character = style prompt + default voice + delivery. */
export interface InterviewPersona {
  id: string
  name: string
  description: string
  stylePrompt: string              // interviewer character injected into the system instruction
  defaultVoiceId: string
  speakingRate?: number            // pipeline TTS only
  pitch?: number                   // pipeline TTS only
}

/** Per-template voice configuration. */
export interface VoiceConfig {
  engine: VoiceEngine
  personaId: string
  voiceId: string                  // overrides the persona default when set
  allowBargeIn: boolean            // candidate can interrupt the agent
  language: string
  model?: string                   // Live model override (default: native-audio preview)
}

export interface InterviewTemplate {
  id: string
  /**
   * Who authored it. RECORDED, not enforced — templates are still listed to every
   * recruiter on the deployment. Optional because templates created before this
   * field existed have no author, and editing one must not invent one. See the ⚠️
   * in backend routes/templates.py.
   */
  recruiterId?: string
  name: string
  role: string
  seniority?: string
  track: TrackType
  questionSource: QuestionSource
  fixedQuestionSetId?: string
  timing: TimingConfig
  rubric: KpiRubric
  integrity: IntegrityConfig
  branding: BrandingConfig
  // Chatbot track (optional; ignored by the chat / video_avatar tracks)
  mode?: InterviewMode
  adaptive?: AdaptiveConfig
  fixedAllowFollowUps?: boolean
  conversationTiming?: ConversationTimingConfig
  chatbotTimer?: ChatbotTimerConfig   // optional per-question timer overlay (conversational track)
  voice?: VoiceConfig                 // voice track only
  createdAt: string
  updatedAt: string
}

/* ─── Session (server-held; never fully sent to the candidate) ──────────── */

export type InterviewPhase = 'prep' | 'answer'
export type SessionStatus =
  | 'created'       // exists, candidate hasn't begun
  | 'system_check'  // candidate on the system-check screen
  | 'in_progress'   // actively answering
  | 'completed'     // all answers submitted
  | 'expired'

export interface SessionQuestion {
  id: string
  text: string
  category?: string
  idealAnswerNotes?: string // SERVER-ONLY — never leaves the server
  prepStartedAt?: string
  answerStartedAt?: string
  submittedAt?: string
  answerText?: string       // chat track
  videoUrl?: string         // video interview + video avatar tracks
  autoSubmitted: boolean
  draft?: string            // last auto-saved in-progress text
}

export interface IntegrityEvent {
  type:
    | 'tab_switch'
    | 'window_blur'
    | 'paste_blocked'
    | 'copy_blocked'
    | 'fullscreen_exit'
    | string
  at: string
}

/**
 * Classifies each interviewer turn so the client can gate the per-question
 * timer. Only 'question' and 'follow_up' turns are ever timed; everything else
 * (greeting, readiness, acknowledgment, wrap-up) is free time.
 */
export type TurnType = 'greeting' | 'readiness' | 'question' | 'follow_up' | 'acknowledgment' | 'wrap_up'

/** A single conversational turn (chatbot track). Server-held source of truth. */
export interface Turn {
  id: string
  role: 'interviewer' | 'candidate'
  content: string
  turnType?: TurnType          // interviewer turns only; gates the per-question timer
  questionIndex?: number       // 0-based primary-question this belongs to
  isFollowUp?: boolean
  createdAt: string
  // Timed mode (an interviewer turn awaiting the candidate's answer):
  thinkingStartedAt?: string
  answerStartedAt?: string
  submittedAt?: string
  autoAdvanced?: boolean
  draft?: string               // candidate's in-progress answer to THIS interviewer turn
}

export interface InterviewSession {
  id: string
  templateId: string
  recruiterId?: string         // OWNER (Firebase uid). Additive; legacy sessions
                               // created before auth have none → admin-only until claimed.
  track: TrackType
  candidate: { name: string; email: string }  // candidate.email is the ASSIGNMENT key
  status: SessionStatus
  questions: SessionQuestion[] // SERVER-HELD — never sent in full to the client
  currentIndex: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  integrityEvents: IntegrityEvent[]
  tabSwitchCount: number
  resumeText?: string          // SERVER-ONLY
  // Chatbot track (conversational) — server-held; only revealed turns go out.
  mode?: InterviewMode
  transcript?: Turn[]
  plannedQuestionCount?: number
  followUpsThisQuestion?: number
  greetingTimeOfDay?: TimeOfDay   // candidate's local part-of-day, for the opening greeting
  // Bulk-invite bridge: this local session mirrors a Firestore `interviews/{id}`
  // doc (same id). On completion, its result/status are synced back to Firestore
  // so the recruiter (and the Flutter app) see it. Server-only; additive.
  viaInvite?: boolean
  // Video-avatar track: id of the live Tavus conversation created for this
  // session (server-side), so the server can end it on completion.
  tavusConversationId?: string
  // Two-way Interview: name of the live Daily room this session's recruiter↔
  // candidate call takes place in (server-created; joined by both parties).
  liveRoomName?: string
  // Two-way Interview: URL of the call recording (once uploaded), transcribed
  // on /twoway/complete to produce the scoring transcript. Additive.
  recordingUrl?: string
  // Two-way Interview: recruiter's manual rating/notes, set via /twoway/review.
  // The session is the source of truth (never lost, even before a report
  // exists) — mirrored onto ResultReport.manualReview for display. Additive.
  manualReview?: { rating: number; notes: string; by?: string; at: string }
  // Video Interview: AWS Rekognition facial summary captured on the candidate
  // device and uploaded on completion. Opaque JSON (client owns the shape).
  facialSummary?: Record<string, unknown>
}

/** Candidate's local part-of-day, derived client-side and sent at session start. */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening'

/* ─── Scoring / results ─────────────────────────────────────────────────── */

export type Recommendation = 'strong_yes' | 'yes' | 'maybe' | 'no'

export interface PerQuestionResult {
  questionId: string
  kpiScores: Record<string, number> // keyed by KpiDefinition.id, 0–100
  feedback: string
}
/** Transcript-derived delivery metrics (voice / chatbot / avatar tracks). All
 *  computed from stored text + timing — never fabricated acoustic data. */
export interface SpeechMetrics {
  words: number                 // total words the candidate spoke/typed
  answers: number               // non-empty answers given
  avgWordsPerAnswer: number
  fillerCount: number           // "um", "you know", … in the transcript
  fillerPer100: number          // filler words per 100 words
  vocabularyPct: number         // unique words / total words, as a percentage
  avgResponseSeconds?: number   // chatbot only (from per-answer timing)
  spoken: boolean               // true for voice/avatar (heard), false for typed
}

/** Text-based sentiment / communication read (Gemini over the transcript).
 *  Not acoustic prosody — labelled as transcript-derived in the UI. */
export interface SentimentSignals {
  overall: 'positive' | 'neutral' | 'negative' | 'mixed'
  confidence: number            // 0–100
  clarity: number               // 0–100
  positivity: number            // 0–100
  summary: string
}

export interface ResultReport {
  sessionId: string
  perQuestion: PerQuestionResult[]
  kpiAverages: Record<string, number>
  overallScore: number          // weighted, computed server-side (not by the model)
  summary: string
  strengths?: string[]
  improvements?: string[]
  recommendation?: Recommendation
  generatedAt: string
  degraded?: boolean            // true when scoring fell back (no/failed Gemini)
  /** True when NO candidate answers were captured — the interview was not
   *  actually evaluated; the zero scores are placeholders, not judgments. */
  notEvaluated?: boolean
  /** Text-based communication/sentiment read (conversation tracks). */
  sentiment?: SentimentSignals
  /** Recruiter's manual rating/notes (two-way live interviews are recruiter-
   *  scored, not model-scored) — additive overlay on top of any auto report. */
  manualReview?: { rating: number; notes: string; by?: string; at: string }
}

/* ─── Client-safe DTOs (what the candidate browser is allowed to receive) ── */

export interface PublicTimingView {
  prepSeconds: number
  answerSeconds: number
  allowSkipPrep: boolean
  allowEarlySubmit: boolean
  warningThresholdSeconds: number
}

/**
 * The ONLY session view the candidate client ever receives. Note: no future
 * questions, no idealAnswerNotes, no categories — just the current question.
 */
export interface CandidateSessionState {
  sessionId: string
  status: SessionStatus
  track: TrackType
  phase: InterviewPhase | null     // null outside an active question
  remainingSeconds: number         // server-computed
  totalPhaseSeconds: number        // prep or answer total, for ring math
  question: { id: string; text: string } | null // CURRENT only
  progress: { current: number; total: number }   // e.g. 3 of 8
  draft: string
  timing: PublicTimingView
  branding: BrandingConfig
  integrity: IntegrityConfig
  tabSwitchWarnings: number
  awaitingResume: boolean          // adaptive track needs a résumé before starting
  hasResume: boolean               // a résumé is already on file (video-avatar intake may still run without one)
}

/* ─── API request bodies ────────────────────────────────────────────────── */

export interface CreateSessionRequest {
  templateId: string
  candidate: { name: string; email: string }
  track?: TrackType
}
export interface SubmitAnswerRequest {
  questionId: string   // must equal the current question (anti-tamper)
  answerText?: string
  videoUrl?: string
}
export interface SaveDraftRequest {
  questionId: string
  draft: string
}
export interface IntegrityEventRequest {
  type: IntegrityEvent['type']
}

/* ─── Recruiter views ───────────────────────────────────────────────────── */

export interface SessionListItem {
  id: string
  candidate: { name: string; email: string }
  templateId: string
  templateName: string
  track: TrackType
  status: SessionStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  overallScore?: number
  /** How many scored answers stand behind `overallScore`.
   *
   *  DERIVED, never authored: it is the length of the report's `perQuestion`,
   *  i.e. the number of answers that actually produced the score. It exists so
   *  the sessions list can show a score WITH the weight of evidence behind it
   *  instead of a bare number — "a score is a recommendation with its evidence
   *  attached" (PRODUCT.md). Undefined until a report exists. */
  citedAnswers?: number
}

/** Candidate-safe view of a session assigned to the signed-in candidate. Never
 *  includes scores, reports, or any other candidate's data. */
export interface CandidateAssignedSession {
  id: string
  templateName: string
  role?: string
  track: TrackType
  status: SessionStatus
  createdAt: string
  completedAt?: string
}

export interface SessionReportQuestion {
  id: string
  text: string
  category?: string
  answerText?: string
  videoUrl?: string
  timeUsedSeconds?: number
  autoSubmitted: boolean
}
/** One transcript turn as shown on the recruiter report (conversation tracks). */
export interface SessionReportTurn {
  role: 'interviewer' | 'candidate'
  content: string
  questionIndex?: number
  createdAt: string
}
export interface SessionReportView {
  session: {
    id: string
    candidate: { name: string; email: string }
    templateName: string
    track: TrackType
    status: SessionStatus
    createdAt: string
    startedAt?: string
    completedAt?: string
    questions: SessionReportQuestion[]
    integrityEvents: IntegrityEvent[]
    tabSwitchCount: number
    /** Full conversation transcript (chatbot / voice / video_avatar tracks). */
    transcript?: SessionReportTurn[]
    /** Two-way Interview: URL of the call recording, for report playback. Additive. */
    recordingUrl?: string
    /** Two-way Interview: recruiter's manual rating/notes (session is the source of
     *  truth — see /twoway/review — so this is present even before a report exists). */
    manualReview?: { rating: number; notes: string; by?: string; at: string }
  }
  rubric: KpiRubric
  report: ResultReport | null
  /** Transcript-derived delivery metrics (conversation tracks). */
  speech?: SpeechMetrics
  /** AWS Rekognition facial analysis summary (video track). */
  facial?: Record<string, unknown>
}

export interface ApiError {
  error: string
}

/* ─── Analytics (aggregate dashboard) ───────────────────────────────────── */

/** Query filters for GET /api/analytics (all optional; omitted = no filter). */
export interface AnalyticsFilters {
  track?: TrackType
  templateId?: string
  role?: string
  dateFrom?: string   // ISO date/time; sessions completed on/after are included
  dateTo?: string     // ISO date/time; sessions completed on/before are included
}

/**
 * Real aggregate metrics computed server-side from stored ResultReports joined
 * with their sessions. Only `scored` sessions contribute to score stats; the
 * funnel counts every session. Empty/no-match filters return zeros + [].
 */
export interface AnalyticsSummary {
  totals: { created: number; started: number; completed: number; scored: number }
  completionRate: number                 // completed / created, 0–1
  averageOverall: number                 // mean overallScore across scored sessions
  scoreDistribution: { bucket: string; count: number }[]  // 0-20 … 81-100
  kpiAverages: { kpiId: string; label: string; average: number; coverage: number }[]
  byTrack: { track: TrackType; count: number; averageOverall: number; completionRate: number }[]
  byRole: { role: string; count: number; averageOverall: number }[]
  byTemplate: { templateId: string; name: string; count: number; averageOverall: number }[]
  trend: { date: string; count: number; averageOverall: number }[]   // by completion day (UTC)
  timeStats: { avgDurationSeconds: number; avgTimePerQuestionSeconds: number }
  recommendationDistribution: { recommendation: string; count: number }[]
  integrityFlagRate: number              // fraction of scored sessions with ≥1 integrity event
  topCandidates: { sessionId: string; name: string; role?: string; overallScore: number }[]
  generatedAt: string
}

/* ─── Resume → Question Set generation (Gemini) ─────────────────────────── */

export type QuestionStyle = 'technical' | 'non_technical' | 'mix'
export type QuestionDifficulty = 'easy' | 'medium' | 'hard'
export type DifficultyChoice = QuestionDifficulty | 'mixed'
export type GeminiModel = 'gemini-2.5-flash' | 'gemini-2.5-pro'

export interface GeneratedInterviewQuestion {
  text: string
  type: 'technical' | 'non_technical'
  category: string
  difficulty: QuestionDifficulty
  skillTag: string
  rationale: string
}

export interface GenerateQuestionSetResult {
  questions: GeneratedInterviewQuestion[]
  suggestedName: string
}

/** Server settings status — the key value is NEVER returned, only a masked hint. */
export interface AppSettingsStatus {
  geminiKeySet: boolean
  geminiKeyMasked?: string
  source: 'saved' | 'env' | 'none'
  model: string
}

/* ─── Video Avatar (Tavus) — recruiter-applied config for candidate interviews ─
 * The recruiter configures the avatar once on the Setup page and clicks "Apply
 * to Candidate Interviews". The config (and the Tavus key) is stored SERVER-side;
 * every video_avatar candidate session creates its Tavus conversation from it —
 * the candidate's browser never needs (or sees) a Tavus key. */

export interface AvatarInterviewSettings {
  replicaId: string               // Tavus replica that joins the call
  personaId?: string              // optional Tavus persona
  aiName?: string                 // the interviewer's name the avatar uses ("I'm Maya…"), default "Alex"
  conversationName?: string       // base Tavus conversation name; candidate name is appended
  conversationalContext?: string  // interviewer persona/system prompt (strict question script is appended per session)
  customGreeting?: string         // avatar's first words (default greets the candidate by name)
  language?: string               // full language name (Tavus format), default English
  maxCallDuration?: number        // seconds, default 1800
  enableRecording?: boolean       // Tavus session recording
  callbackUrl?: string            // Tavus webhook for conversation events
  fallbackQuestions?: string[]    // used only if a session has no question plan of its own
}

/** Masked status for the recruiter UI — never includes the key. */
export interface AvatarSettingsStatus {
  configured: boolean             // replica + key present → candidate avatar interviews will work
  hasKey: boolean
  replicaId?: string
  personaId?: string
  language?: string
  updatedAt?: string
}

/** POST /sessions/:id/avatar/start response. */
export interface AvatarStartResponse {
  conversationUrl: string
  totalQuestions: number
}

/* ─── Two-way Interview (live recruiter↔candidate, Daily) ───────────────── */

/** POST /sessions/:id/two-way/join response — room + per-caller access token. */
export interface TwoWayJoinResponse {
  roomUrl: string
  token: string
  isOwner: boolean
}

/* ─── Chatbot track — client-safe DTOs & requests ───────────────────────── */

export interface ChatbotPublicTiming {
  mode: InterviewMode
  enabled: boolean          // this interview times question turns (legacy timed mode OR chatbotTimer)
  thinkingSeconds: number   // reflects the CURRENT turn's effective timing
  perQuestionSeconds: number
  allowSkipThinking: boolean
  allowEarlySubmit: boolean
  warningThresholdSeconds: number
}

/** A revealed turn the candidate is allowed to see (no server-only fields). */
export interface ChatbotTurnView {
  id: string
  role: 'interviewer' | 'candidate'
  content: string
  turnType?: TurnType
  questionIndex?: number
  isFollowUp?: boolean
}

/**
 * The ONLY conversational view the candidate receives. Contains the transcript
 * already revealed turn-by-turn — never the plan or any upcoming question.
 */
export interface ChatbotSessionState {
  sessionId: string
  status: SessionStatus
  track: TrackType   // 'chatbot' or 'video_avatar' — both use the conversational engine
  transcript: ChatbotTurnView[]
  awaitingInterviewer: boolean       // server is generating the next turn
  finished: boolean
  phase: 'thinking' | 'answer' | null // set only while a timed question turn is armed
  remainingSeconds: number
  totalPhaseSeconds: number
  currentTurnTimed: boolean           // the awaiting turn is a timed question/follow-up turn
  currentTurnId: string | null        // interviewer turn being answered (anti-tamper)
  progress: { current: number; total: number }
  draft: string
  timing: ChatbotPublicTiming
  branding: BrandingConfig
  integrity: IntegrityConfig
  tabSwitchWarnings: number
  awaitingResume: boolean
}

export interface BeginChatRequest {
  timeOfDay?: TimeOfDay   // candidate's local part-of-day for a time-aware greeting
}
export interface SubmitChatAnswerRequest {
  turnId: string        // must equal currentTurnId (anti-tamper / stale guard)
  answerText: string
}
export interface SaveChatDraftRequest {
  turnId: string
  draft: string
}

/* ─── Voice track — catalog + realtime WS protocol ──────────────────────── */

/** GET /api/voices — browsable catalog for the recruiter picker. */
export interface VoiceCatalog {
  voices: VoiceOption[]
  personas: InterviewPersona[]
}

/* ─── Bulk invite — candidate email/role extraction (POST /api/invites/extract) ── */

/** One candidate parsed out of an uploaded CSV / Excel / PDF / text file. */
export interface ExtractedCandidate {
  email: string
  role: string       // extracted role, or the recruiter's Step-1 role as fallback
  valid: boolean     // email passed format validation
}
export interface ExtractCandidatesResult {
  rows: ExtractedCandidate[]
  warnings: string[] // e.g. "roles defaulted from an unstructured file", "N duplicates removed"
}

/** Recruiter → server: create one interview per candidate + (optionally) email them. */
export interface CreateInvitesRequest {
  mode: TrackType                                   // Chatbot / Voice / Video Avatar / Timed Q&A
  role: string                                      // batch candidate role (Step 1)
  // Omitted only for 'two_way' — a live recruiter-led call has no scripted
  // question source to configure (no résumé-tailored or saved-set questions).
  source?: 'tailor' | 'set'
  config?: {                                        // tailor-per-résumé generation params (§2)
    style: QuestionStyle
    techCount: number
    nonTechCount: number
    difficulty: DifficultyChoice
    domains: string[]
    model: GeminiModel
  }
  questionSetId?: string                            // when source === 'set'
  candidates: { email: string; role: string }[]
  origin?: string                                   // web origin, for the invite link in emails
  // Configurable invite email (additive). When neither is set, the legacy built-in
  // email is used (backwards compatible). `emailConfig` (inline) wins over the id.
  emailTemplateId?: string
  emailConfig?: Partial<InviteEmailTemplate>
  sendEmails?: boolean                              // default true; false = create links only
}
export interface CreateInvitesResult {
  testId: string
  created: {
    id: string
    email: string
    link: string
    sent?: boolean                 // did the invite email go out for this recipient?
    status?: InviteSendStatusValue // send-time status (webhook events update it later)
    error?: string                 // failure reason when !sent
  }[]
  emailed: number     // how many invite emails actually went out (0 while the mailer is in dry-run)
  dryRun: boolean     // true when the mailer isn't fully configured yet
}

/** Recruiter → server: send ONE test invite email to the recruiter's own address. */
export interface TestInviteEmailRequest {
  role?: string
  origin?: string
  emailTemplateId?: string
  emailConfig?: Partial<InviteEmailTemplate>
}
export interface TestInviteEmailResult {
  sent: boolean
  dryRun?: boolean
  to: string
  error?: string
}

/** Server → client: Brevo verified senders for the sender picker. */
export interface InviteVerifiedSender {
  email: string
  name: string
  active: boolean
}
export interface InviteSendersResult {
  senders: InviteVerifiedSender[]
  brevoReady: boolean
}

/** High-level state of the live call, surfaced to the candidate UI. */
export type VoicePhase =
  | 'connecting'   // opening mic + WS
  | 'greeting'     // agent greeting / asking readiness
  | 'listening'    // candidate is speaking / mic open
  | 'thinking'     // agent processing (natural pause, NOT a forced 3s delay)
  | 'speaking'     // agent audio is playing
  | 'ended'        // interview complete
  | 'error'

/** A caption line for the optional on-screen transcript. */
export interface VoiceCaption {
  role: 'interviewer' | 'candidate'
  text: string
  final: boolean
}

/** Messages the SERVER pushes to the client over the WS (JSON, except audio). */
export type VoiceServerMessage =
  | { type: 'state'; phase: VoicePhase }
  | { type: 'audio'; data: string; mimeType: string }   // base64 PCM 24k from the agent
  | { type: 'caption'; role: 'interviewer' | 'candidate'; text: string; final: boolean }
  | { type: 'interrupted' }                              // barge-in: flush playback
  | { type: 'ended'; reason?: string; graceful?: boolean } // graceful=false ⇒ interrupted, not a real finish
  | { type: 'error'; message: string }

/** Messages the CLIENT sends to the server over the WS. */
export type VoiceClientMessage =
  | { type: 'ready'; timeOfDay?: TimeOfDay }             // mic granted; begin the interview
  | { type: 'audio'; data: string }                     // base64 PCM 16k mic chunk
  | { type: 'mute'; muted: boolean }
  | { type: 'end' }
