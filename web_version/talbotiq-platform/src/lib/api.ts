import type {
  InterviewTemplate,
  QuestionSet,
  McqQuestionSet,
  McqQuestion,
  McqSection,
  McqPaperState,
  CandidateSessionState,
  CreateSessionRequest,
  SubmitAnswerRequest,
  SaveDraftRequest,
  IntegrityEventRequest,
  SessionListItem,
  SessionReportView,
  TrackType,
  AppSettingsStatus,
  GenerateQuestionSetResult,
  ChatbotSessionState,
  SubmitChatAnswerRequest,
  SaveChatDraftRequest,
  BeginChatRequest,
  VoiceCatalog,
  AnalyticsSummary,
  AnalyticsFilters,
  AppUser,
  CandidateAssignedSession,
  InterviewRound,
  RoundCriteria,
  RoundKind,
  RoundState,
  TimelineResponse,
  RetryableEvaluation,
  ExtractCandidatesResult,
  CreateInvitesRequest,
  CreateInvitesResult,
  RoleCategoryOption,
  RoleConfig,
  CreateRoleConfigRequest,
  UpdateRoleConfigRequest,
  CreateInvitesFromRolePipelineRequest,
  CreateInvitesFromRolePipelineResult,
  CandidateBoardResult,
  CandidateBoardParams,
  AvatarInterviewSettings,
  AvatarSettingsStatus,
  AvatarStartResponse,
  TwoWayJoinResponse,
  InviteEmailTemplate,
  InviteSendersResult,
  TestInviteEmailRequest,
  TestInviteEmailResult,
  Pipeline,
  CreatePipelineRequest,
  PipelineInviteRequest,
  PipelineInviteResult,
  PipelineBoard,
  AdvanceRequest,
  NotAdvancingRequest,
  MoveBackRequest,
  AdvanceResult,
  CodingProblem,
  CodingProblemSummary,
  CodingLanguage,
  CodingLanguageSource,
  PublicCodingProblem,
  CodingResult,
  CodingSubmission,
} from '@shared/types'
import type { AgentRequest, AgentDecision } from '@shared/autopilot'
import { httpBase, commonBase } from './apiOrigin'
import { speakViaGeminiLive, bytesToBase64, type LiveGrant } from './geminiLive'

// Same-origin '/api' in dev (Vite proxy); the absolute Render URL in a
// VITE_API_BASE build. See src/lib/apiOrigin.ts.
const BASE = httpBase()

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    if (res.status === 429) throw rateLimitError(res, data)
    const message = (data && (data.error as string)) || `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }
  return data as T
}

/**
 * The same request helper, against the SHARED `/api` surface rather than `/api/web`.
 *
 * Used where the capability already lives there and is already tested — résumé
 * scoring, for instance. The Firebase token is attached to both bases by the global
 * fetch interceptor in AuthProvider, so nothing extra is needed here.
 */
async function commonHttp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(commonBase() + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    if (res.status === 429) throw rateLimitError(res, data)
    // The shared surface answers `{detail}`; the web surface answers `{error}`. Read
    // both rather than assuming, or a real message degrades to "Request failed".
    const message =
      (data && ((data.detail as string) || (data.error as string))) ||
      `Request failed (${res.status})`
    throw new ApiError(message, res.status, data)
  }
  return data as T
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public payload?: unknown) {
    super(message)
  }
}

/**
 * What to tell a person when a query failed.
 *
 * An ApiError means the server ANSWERED — its message is the truest thing we
 * have, so show it. The connection story is reserved for errors where no
 * response ever arrived. Before this, every list page rendered "check your
 * connection" over a 503 that said precisely what was wrong ("Authentication
 * is unavailable: Firebase is not configured…"), which sent people debugging
 * their network while the real fault sat in the deployment.
 */
export function describeFetchError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

/** The backend rate-limits per user and answers 429 with Retry-After in seconds. */
function rateLimitError(res: Response, data: unknown): ApiError {
  const wait = Number(res.headers.get('Retry-After') ?? 5)
  return new ApiError(`Too many requests — try again in ${wait}s.`, 429, data)
}

/* ─── Auth ──────────────────────────────────────────────────────────────────
 * The Firebase ID token is attached to every /api request by the global fetch
 * interceptor installed in AuthProvider. The role is NOT decided here — it lives
 * on Firestore users/{uid}.role (read live by the client, and read by the server
 * on each request). This endpoint just returns the current user's mirror view. */
export const authApi = {
  me: () => http<AppUser>('/auth/me'),
}

/* ─── Templates ─────────────────────────────────────────────────────────── */
export const templatesApi = {
  list: () => http<InterviewTemplate[]>('/templates'),
  get: (id: string) => http<InterviewTemplate>(`/templates/${id}`),
  create: (body: Partial<InterviewTemplate>) =>
    http<InterviewTemplate>('/templates', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<InterviewTemplate>) =>
    http<InterviewTemplate>(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) => http<void>(`/templates/${id}`, { method: 'DELETE' }),
}

/* ─── MCQ candidate runtime ──────────────────────────────────────────────── */
/**
 * The paper a candidate sits. Three calls, and none of them can return the answer
 * key: the server builds every response through an allow-list (see
 * backend/app/web/routes/sessions_mcq.py), so `correctOptionIds` has no field to
 * travel in.
 */
export const mcqSessionApi = {
  /** The paper plus whatever has been answered so far. Opening it starts the clock. */
  paper: (id: string) => http<McqPaperState>(`/sessions/${id}/mcq`),
  /** Auto-save. A refresh must not cost a candidate the answers they chose.
   *  A value is a list of option ids, or a promptId to matchId mapping for a
   *  pairing question - the shape follows the question type. */
  save: (id: string, answers: McqPaperState['answers']) =>
    http<{ ok: boolean; saved: number }>(`/sessions/${id}/mcq/answers`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
  /** Score and finish. Answers sent here count even if nothing was auto-saved. */
  submit: (id: string, answers?: McqPaperState['answers']) =>
    http<McqPaperState>(`/sessions/${id}/mcq/submit`, {
      method: 'POST',
      body: JSON.stringify(answers ? { answers } : {}),
    }),
}

/* ─── MCQ sets (closed-ended papers, owner-scoped) ──────────────────────── */
/**
 * MCQ sets — the closed-ended papers.
 *
 * A separate surface from `questionSetsApi`, not a flag on it, because the two
 * have different ownership: question sets are shared across every recruiter on
 * the deployment, while an MCQ set holds the ANSWER KEY and is scoped to the
 * recruiter who wrote it. Another recruiter's set answers 404 here, including on
 * `duplicate` — which would otherwise be a way to read their key.
 */
/* ─── Coding problems ───────────────────────────────────────────────────────
   Owner-scoped for the same reason MCQ sets are: a problem holds every hidden
   test case and its expected output, so another recruiter's problem answers 404
   here — including on `preview`, which would otherwise be a way to read the
   sample set of somebody else's problem.

   `preview` is the projection a CANDIDATE receives, served by the same server
   function that will serve them. A preview rendered through a display-only copy
   is a preview of something else. */
export interface EssayPromptSummary {
  id: string
  title: string
  promptType: string
  language: string
  minWords: number
  maxWords: number
  timeLimitSeconds: number
  faults: string[]
}

/** Essay Writing — the recruiter authoring prompts. */
export const essayPromptsApi = {
  list: () => http<EssayPromptSummary[]>('/essay/prompts'),
  get: (id: string) => http<{ prompt: Record<string, unknown>; faults: string[] }>(`/essay/prompts/${id}`),
  create: (body: Record<string, unknown>) =>
    http<{ prompt: Record<string, unknown>; faults: string[] }>('/essay/prompts', {
      method: 'POST', body: JSON.stringify(body),
    }),
  update: (id: string, body: Record<string, unknown>) =>
    http<{ prompt: Record<string, unknown>; faults: string[] }>(`/essay/prompts/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  remove: (id: string) => http<{ ok: boolean }>(`/essay/prompts/${id}`, { method: 'DELETE' }),
  generate: (body: Record<string, unknown>) =>
    http<{ prompts: Record<string, unknown>[] }>('/essay/prompts/generate', {
      method: 'POST', body: JSON.stringify(body),
    }),
}

/** Essay Writing — the candidate's side.
 *
 * `remainingSeconds` always comes from the SERVER. The countdown on screen is a
 * render of it, never the authority: a browser clock can be changed, and the
 * deadline is the session's own start time plus the configured limit. */
export const essayApi = {
  state: (sessionId: string) =>
    http<EssaySessionState>(`/sessions/${sessionId}/essay`),
  saveDraft: (sessionId: string, text: string, timeline?: EssayTimelineEvent[]) =>
    http<EssayDraftAck>(`/sessions/${sessionId}/essay/draft`, {
      method: 'POST', body: JSON.stringify({ text, timeline }),
    }),
  submit: (sessionId: string, text: string) =>
    http<{ ok: boolean; late: boolean; words: number; chars: number }>(
      `/sessions/${sessionId}/essay/submit`, { method: 'POST', body: JSON.stringify({ text }) },
    ),
}

export interface EssayTimelineEvent { t: number; a: number; d: number }

export interface EssayDraftAck {
  ok: boolean
  words: number
  chars: number
  limitState: 'ok' | 'under' | 'over'
  limitDelta: number
  remainingSeconds: number
}

export interface EssaySessionState {
  prompt: {
    id: string
    title: string
    promptMd: string
    promptType: string
    language: string
    sourcePassageMd: string
    minWords: number
    maxWords: number
    maxChars: number
    timeLimitSeconds: number
  }
  draft: string
  words: number
  chars: number
  limitState: 'ok' | 'under' | 'over'
  limitDelta: number
  remainingSeconds: number
  submitted: boolean
}

export const codingApi = {
  /** The languages this deployment can run, resolved from the judge.
   *  Not a constant in the client: Judge0's ids are per-instance, so a
   *  hard-coded list is a dropdown where entries silently fail. */
  languages: () =>
    http<{ languages: CodingLanguage[]; source: CodingLanguageSource }>('/coding/languages'),
  list: () => http<{ problems: CodingProblemSummary[] }>('/coding/problems').then((r) => r.problems),
  get: (id: string) => http<{ problem: CodingProblem; faults: string[] }>(`/coding/problems/${id}`),
  create: (body: Partial<CodingProblem>) =>
    http<{ problem: CodingProblem; faults: string[] }>('/coding/problems', {
      method: 'POST', body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<CodingProblem>) =>
    http<{ problem: CodingProblem; faults: string[] }>(`/coding/problems/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  remove: (id: string) => http<{ ok: boolean }>(`/coding/problems/${id}`, { method: 'DELETE' }),
  preview: (id: string) =>
    http<{ problem: PublicCodingProblem }>(`/coding/problems/${id}/preview`),
  importBundle: (problems: Partial<CodingProblem>[]) =>
    http<{ imported: { id: string; title: string; faults: string[]; ignored: string[]; renamed: string[] }[]; rejected: { index: number; reason: string }[] }>(
      '/coding/problems/import', { method: 'POST', body: JSON.stringify({ problems }) },
    ),
  /** Validate a reference solution against the samples. Recruiter-side. */
  run: (id: string, body: { source: string; languageId: number }) =>
    http<{ result: CodingResult; streams: Record<string, { stdout?: string; stderr?: string; compileOutput?: string }> }>(
      `/coding/problems/${id}/run`, { method: 'POST', body: JSON.stringify(body) },
    ),
  submit: (id: string, body: { source: string; languageId: number; language?: string }) =>
    http<{ submissionId: string; status: string }>(`/coding/problems/${id}/submit`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  submission: (id: string) => http<CodingSubmission>(`/coding/submissions/${id}`),
}

/* ─── The candidate's coding runtime ────────────────────────────────────────
   Reached through the SESSION, never by problem id: a candidate has no business
   naming a problem, and routing through the session is what makes the hidden
   tests unreachable — they live on the session document, which no client can
   read, and the projection happens server-side. */
export const codingRuntimeApi = {
  state: (sessionId: string) =>
    http<{
      sessionId: string
      status?: string
      problems: PublicCodingProblem[]
      drafts: Record<string, string>
      language: string
      submittedAt?: string
      branding: Record<string, unknown>
    }>(`/sessions/${sessionId}/coding`),
  saveDraft: (sessionId: string, body: { problemId: string; source: string; language?: string }) =>
    http<{ ok: boolean }>(`/sessions/${sessionId}/coding/draft`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  /** `stdin` runs the candidate's OWN input instead of the samples. There is no
   *  expected output in that case, so the answer carries `custom` (raw streams and
   *  timings) rather than `result` (per-case pass/fail). */
  run: (sessionId: string, body: { problemId: string; source: string; languageId: number; stdin?: string }) =>
    http<{
      result?: CodingResult
      streams?: Record<string, { stdout?: string; stderr?: string; compileOutput?: string }>
      custom?: { status: string; timeMs: number | null; memoryKb: number | null; stdout?: string; stderr?: string; compileOutput?: string }
    }>(`/sessions/${sessionId}/coding/run`, { method: 'POST', body: JSON.stringify(body) }),
  submit: (sessionId: string, body: { problemId: string; source: string; languageId: number; language?: string }) =>
    http<{ submissionId: string; status: string }>(`/sessions/${sessionId}/coding/submit`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  submission: (sessionId: string, submissionId: string) =>
    http<CodingSubmission>(`/sessions/${sessionId}/coding/submissions/${submissionId}`),
}

export const mcqSetsApi = {
  list: () => http<McqQuestionSet[]>('/mcq-sets'),
  get: (id: string) => http<McqQuestionSet>(`/mcq-sets/${id}`),
  create: (body: { name: string; sections?: McqSection[]; questions: McqQuestion[] }) =>
    http<McqQuestionSet>('/mcq-sets', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { name: string; sections?: McqSection[]; questions: McqQuestion[] }) =>
    http<McqQuestionSet>(`/mcq-sets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  duplicate: (id: string) =>
    http<McqQuestionSet>(`/mcq-sets/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => http<void>(`/mcq-sets/${id}`, { method: 'DELETE' }),

  /* ── Mode A: role → topics → generated paper ──────────────────────────────
     Both are one-time, at authoring. Neither runs per candidate, which is why
     MCQ costs almost nothing to operate next to the open-ended modes. */

  /** Skill areas worth testing for a role, as add/removable suggestions. */
  suggestTopics: (role: string) =>
    http<{ role: string; topics: string[] }>('/mcq-sets/suggest-topics', {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),

  /**
   * Questions for REVIEW — deliberately not saved. A model call costs something,
   * and a recruiter who dislikes the result should not have to delete a set they
   * never wanted. `dropped` reports how many came back unusable and were binned,
   * because asking for 20 and getting 17 deserves an explanation.
   */
  generate: (body: {
    role: string
    topics: string[]
    /** How the paper is divided. `mix` is the only style that uses both counts. */
    style: 'technical' | 'non_technical' | 'mix'
    technicalCount: number
    nonTechnicalCount: number
    difficulty: 'easy' | 'medium' | 'hard' | 'mixed'
    allowMulti: boolean
  }) =>
    http<{
      role: string
      topics: string[]
      questions: McqQuestion[]
      requested: number
      dropped: number
      /** The split asked for, and the one that actually arrived. Reported apart
       *  for the same reason as `dropped`: a model told "6 and 4" can return 7
       *  and 3, and that is the recruiter's business before they save. */
      sections: Record<string, number>
      delivered: Record<string, number>
    }>('/mcq-sets/generate', { method: 'POST', body: JSON.stringify(body) }),
}

/* ─── Question Sets ─────────────────────────────────────────────────────── */
export const questionSetsApi = {
  list: () => http<QuestionSet[]>('/question-sets'),
  get: (id: string) => http<QuestionSet>(`/question-sets/${id}`),
  create: (body: Partial<QuestionSet>) =>
    http<QuestionSet>('/question-sets', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<QuestionSet>) =>
    http<QuestionSet>(`/question-sets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  duplicate: (id: string) =>
    http<QuestionSet>(`/question-sets/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => http<void>(`/question-sets/${id}`, { method: 'DELETE' }),
  generateFromResume: async (fd: FormData): Promise<GenerateQuestionSetResult> => {
    const res = await fetch(`${BASE}/question-sets/generate`, { method: 'POST', body: fd })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (res.status === 429) throw rateLimitError(res, data)
    if (!res.ok) throw new ApiError((data && data.error) || `Generation failed (${res.status})`, res.status, data)
    return data as GenerateQuestionSetResult
  },
}

/* ─── Settings (server-side Gemini key) ─────────────────────────────────── */
export const settingsApi = {
  status: () => http<AppSettingsStatus>('/settings'),
  avatarStatus: () => http<AvatarSettingsStatus>('/settings/avatar'),
  applyAvatar: (body: AvatarInterviewSettings) =>
    http<AvatarSettingsStatus>('/settings/avatar', { method: 'PUT', body: JSON.stringify(body) }),
}

/* ─── Sessions (candidate + recruiter) ──────────────────────────────────── */
export const sessionsApi = {
  create: (body: CreateSessionRequest) =>
    http<{ id: string }>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  // Bulk-invite: resolve a Firestore interview id into a local session (idempotent).
  claimInvite: (id: string) => http<CandidateSessionState>(`/sessions/${id}/claim`, { method: 'POST' }),
  state: (id: string) => http<CandidateSessionState>(`/sessions/${id}/state`),
  setTrack: (id: string, track: TrackType) =>
    http<CandidateSessionState>(`/sessions/${id}/track`, {
      method: 'POST',
      body: JSON.stringify({ track }),
    }),
  systemCheck: (id: string) =>
    http<CandidateSessionState>(`/sessions/${id}/system-check`, { method: 'POST' }),
  uploadResume: async (id: string, file: File, fullName?: string): Promise<CandidateSessionState> => {
    const fd = new FormData()
    fd.append('resume', file)
    // Candidate's full name, asked before upload — the AI interviewer uses it
    // to address them in questions (stored as session.candidate.name).
    if (fullName?.trim()) fd.append('fullName', fullName.trim())
    const res = await fetch(`${BASE}/sessions/${id}/resume`, { method: 'POST', body: fd })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (res.status === 429) throw rateLimitError(res, data)
    if (!res.ok) throw new ApiError((data && data.error) || `Upload failed (${res.status})`, res.status, data)
    return data as CandidateSessionState
  },
  begin: (id: string) =>
    http<CandidateSessionState>(`/sessions/${id}/begin`, { method: 'POST' }),
  skipPrep: (id: string) =>
    http<CandidateSessionState>(`/sessions/${id}/skip-prep`, { method: 'POST' }),
  saveDraft: (id: string, body: SaveDraftRequest) =>
    http<{ ok: boolean }>(`/sessions/${id}/draft`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submitAnswer: (id: string, body: SubmitAnswerRequest) =>
    http<CandidateSessionState>(`/sessions/${id}/answers`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  integrityEvent: (id: string, body: IntegrityEventRequest) =>
    http<{ ok: boolean; tabSwitchWarnings?: number; maxTabSwitchWarnings?: number }>(
      `/sessions/${id}/integrity-event`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  complete: (id: string) =>
    http<CandidateSessionState>(`/sessions/${id}/complete`, { method: 'POST' }),
  /**
   * The CANDIDATE's feedback on the interview experience, left after they finish.
   *
   * Not to be confused with the per-answer `feedback` on a scored report, which runs
   * the other way: that is the recruiter's assessment OF the candidate. This is the
   * candidate's assessment of the process, it reaches no scoring path, and the server
   * ignores an empty submission rather than storing a hollow record.
   */
  candidateFeedback: (
    id: string,
    // `hadTechnicalIssues` rides along because the recruiter's listing counts it
    // separately from the rating: "the interview was fine but the camera kept
    // dropping" is a different problem from "the interview was poor", and
    // collapsing the two loses the one that is actually fixable.
    body: { rating?: number; comment?: string; hadTechnicalIssues?: boolean },
  ) =>
    http<{ ok: boolean; ignored?: boolean }>(`/sessions/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // Video Interview: upload the aggregated AWS Rekognition facial summary
  // (computed client-side from frames captured off the shared camera stream).
  facial: (id: string, summary: unknown) =>
    http<{ ok: boolean }>(`/sessions/${id}/facial`, { method: 'POST', body: JSON.stringify({ summary }) }),
  list: () => http<SessionListItem[]>('/sessions'),
  report: (id: string) => http<SessionReportView>(`/sessions/${id}/report`),
  // Candidate: the interviews assigned to the signed-in candidate's verified email.
  mine: () => http<CandidateAssignedSession[]>('/sessions/mine'),
  // Video Avatar (Tavus): the server creates the conversation from the recruiter's
  // applied Setup config — the client only receives the join URL. timeOfDay makes
  // the avatar's greeting time-appropriate ("Good morning …").
  avatarStart: (id: string, timeOfDay?: 'morning' | 'afternoon' | 'evening') =>
    http<AvatarStartResponse>(`/sessions/${id}/avatar/start`, { method: 'POST', body: JSON.stringify({ timeOfDay }) }),
  avatarTranscript: (id: string, body: { role: 'interviewer' | 'candidate'; text: string }) =>
    http<{ ok: boolean }>(`/sessions/${id}/avatar/transcript`, { method: 'POST', body: JSON.stringify(body) }),
  avatarComplete: (id: string) =>
    http<{ ok: boolean }>(`/sessions/${id}/avatar/complete`, { method: 'POST' }),
  // Two-way Interview (Daily): recruiter hosts (owner token, admits candidates),
  // candidate joins (non-owner, knocks). Both resolve to a room URL + token.
  twowayHost: (id: string) =>
    http<TwoWayJoinResponse>(`/sessions/${id}/twoway/host`, { method: 'POST' }),
  twowayJoin: (id: string) =>
    http<TwoWayJoinResponse>(`/sessions/${id}/twoway/join`, { method: 'POST' }),
  twowayComplete: (id: string, recordingUrl?: string) =>
    http<{ ok: boolean }>(`/sessions/${id}/twoway/complete`, {
      method: 'POST',
      body: JSON.stringify({ recordingUrl }),
    }),
  twowayReview: (id: string, body: { rating: number; notes: string }) =>
    http<{ ok: boolean }>(`/sessions/${id}/twoway/review`, { method: 'POST', body: JSON.stringify(body) }),
  // Voice track: mint a locked Gemini Live grant. Resolves the session,
  // generates questions if the template is adaptive, and locks the whole
  // setup into the token — the browser connects straight to Google with it.
  voiceToken: (id: string) =>
    http<VoiceTokenGrant>(`/sessions/${id}/voice/token`, { method: 'POST' }),
  // Voice track: forward one finalised utterance (BOTH roles, in order, no
  // index). The audio never touches the backend, so this POST is the only way
  // the transcript reaches the record the interview is scored from. The server
  // fuzzy-matches interviewer turns to the planned questions and returns the
  // running coverage count.
  voiceTranscript: (id: string, body: { role: 'interviewer' | 'candidate'; text: string }) =>
    http<{ ok: boolean; asked?: number; total?: number }>(`/sessions/${id}/voice/transcript`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

/** The voice-interview grant: a LiveGrant plus the planned-question count. */
export interface VoiceTokenGrant extends LiveGrant {
  totalQuestions: number
  /**
   * BCP-47 tag for the interview's language, for the browser's own display-only
   * captioner. Not used for anything Google does: the locked setup carries its
   * own language hints. It exists because defaulting the local recogniser to
   * English would caption a Hindi interview in English.
   */
  language?: string
}

/* ─── Chatbot (conversational) track ────────────────────────────────────── */
export const chatbotApi = {
  begin: (id: string, body?: BeginChatRequest) =>
    http<ChatbotSessionState>(`/sessions/${id}/chat/begin`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  state: (id: string) => http<ChatbotSessionState>(`/sessions/${id}/chat/state`),
  answer: (id: string, body: SubmitChatAnswerRequest) =>
    http<ChatbotSessionState>(`/sessions/${id}/chat/answer`, { method: 'POST', body: JSON.stringify(body) }),
  saveDraft: (id: string, body: SaveChatDraftRequest) =>
    http<{ ok: boolean }>(`/sessions/${id}/chat/draft`, { method: 'POST', body: JSON.stringify(body) }),
  skipThinking: (id: string) =>
    http<ChatbotSessionState>(`/sessions/${id}/chat/skip-thinking`, { method: 'POST' }),
  // The question is now presented (composer enabled) → start its clock server-side.
  questionPresented: (id: string) =>
    http<ChatbotSessionState>(`/sessions/${id}/chat/question-presented`, { method: 'POST' }),
}

/* ─── Bulk invite — candidate email/role extraction ─────────────────────── */
export const invitesApi = {
  extract: async (file: File, role: string): Promise<ExtractCandidatesResult> => {
    const fd = new FormData()
    fd.append('file', file)
    if (role) fd.append('role', role)
    const res = await fetch(`${BASE}/invites/extract`, { method: 'POST', body: fd })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (res.status === 429) throw rateLimitError(res, data)
    if (!res.ok) throw new ApiError((data && data.error) || `Extraction failed (${res.status})`, res.status, data)
    return data as ExtractCandidatesResult
  },
  create: (body: CreateInvitesRequest) =>
    http<CreateInvitesResult>('/invites', { method: 'POST', body: JSON.stringify(body) }),
  // Materialise a role pipeline (Feature 1) into a real timeline and invite round 1.
  createFromRolePipeline: (body: CreateInvitesFromRolePipelineRequest) =>
    http<CreateInvitesFromRolePipelineResult>(
      '/invites/from-role-pipeline', { method: 'POST', body: JSON.stringify(body) },
    ),
  // Brevo verified senders for the sender picker (server-side key).
  senders: () => http<InviteSendersResult>('/invites/senders'),
  // Upload an invite-email logo → returns a public, email-safe hosted URL.
  uploadLogo: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/invites/logo`, { method: 'POST', body: fd })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (res.status === 429) throw rateLimitError(res, data)
    if (!res.ok) throw new ApiError((data && data.error) || `Logo upload failed (${res.status})`, res.status, data)
    return data as { url: string }
  },
  // Send one test invite email to the current recruiter, using the given config.
  test: (body: TestInviteEmailRequest) =>
    http<TestInviteEmailResult>('/invites/test', { method: 'POST', body: JSON.stringify(body) }),
  // Retry a single failed recipient.
  retry: (interviewId: string, body: TestInviteEmailRequest) =>
    http<{ id: string; email: string; sent: boolean; status: string; error?: string }>(
      `/invites/${interviewId}/retry`, { method: 'POST', body: JSON.stringify(body) },
    ),
}

/* ─── Invite-email templates (owned per recruiter) ──────────────────────── */
export const inviteEmailTemplatesApi = {
  list: (kind?: string) =>
    http<InviteEmailTemplate[]>(`/invite-email-templates${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
  get: (id: string) => http<InviteEmailTemplate>(`/invite-email-templates/${id}`),
  create: (body: Partial<InviteEmailTemplate>) =>
    http<InviteEmailTemplate>('/invite-email-templates', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<InviteEmailTemplate>) =>
    http<InviteEmailTemplate>(`/invite-email-templates/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  duplicate: (id: string) =>
    http<InviteEmailTemplate>(`/invite-email-templates/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => http<void>(`/invite-email-templates/${id}`, { method: 'DELETE' }),
}

/* ─── Role pipelines (Feature 1) — reusable multi-round templates per role ──
 * Deliberately separate from `pipelinesApi` below: that is the older, still-live
 * `web_pipelines` board (kept exactly as it is), while these read/write the SHARED
 * `roleConfigs` collection the Flutter app also reads directly. */
export const roleConfigsApi = {
  categories: () => http<RoleCategoryOption[]>('/role-configs/categories'),
  list: () => http<RoleConfig[]>('/role-configs'),
  get: (id: string) => http<RoleConfig>(`/role-configs/${id}`),
  create: (body: CreateRoleConfigRequest) =>
    http<RoleConfig>('/role-configs', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: UpdateRoleConfigRequest) =>
    http<RoleConfig>(`/role-configs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  duplicate: (id: string) => http<RoleConfig>(`/role-configs/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => http<void>(`/role-configs/${id}`, { method: 'DELETE' }),
}

/* ─── Candidates Kanban (Feature 2) — read-only board, grouped by candidate ── */
export const candidatesApi = {
  board: (params?: CandidateBoardParams) => {
    const q = new URLSearchParams()
    if (params?.roleCategory) q.set('roleCategory', params.roleCategory)
    if (params?.status) q.set('status', params.status)
    if (params?.search) q.set('search', params.search)
    const qs = q.toString()
    return http<CandidateBoardResult>(`/candidates/board${qs ? `?${qs}` : ''}`)
  },
}

/* ─── Pipelines (multi-round interview flows, owned per recruiter) ──────── */
/**
 * Deciding a round, and releasing it to the candidate.
 *
 * These are the recruiter actions that had no web equivalent at all: this app could
 * write `resultPublished` only as `false`, at creation, and never set it true — so a
 * recruiter working in the browser could score an interview and had no way to tell the
 * candidate anything. The phone was the only client that could release a result.
 *
 * They act on `interviews/{id}` — the record shared with the Flutter app — not on web
 * sessions, which is why the paths are `/interviews/...`. A decision made here is
 * visible on the phone, and one made there is visible here.
 *
 * What the candidate is then shown is NOT decided by any of this: the server projects
 * an allowlist of three fields (`interviews.candidate_result_view`). Sending a score
 * from here would not reach them.
 */
export const outcomesApi = {
  /** Show or hide one candidate's result. The only thing that makes it visible. */
  publish: (interviewId: string, published: boolean) =>
    http<{ id: string; resultPublished: boolean }>(
      `/interviews/${interviewId}/publish`,
      { method: 'POST', body: JSON.stringify({ published }) },
    ),

  /** One candidate's outcome, with an optional rank pair and note. */
  setOutcome: (
    interviewId: string,
    body: {
      outcome: 'selected' | 'not_selected' | 'pending'
      rank?: number | null
      rankOf?: number | null
      note?: string
      publish?: boolean
    },
  ) =>
    http<{ id: string; outcome: string; resultPublished: boolean }>(
      `/interviews/${interviewId}/outcome`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /**
   * The recruiter's recoverable failures — interviews nothing scored, whose answers
   * survive, so the scorer can simply run again.
   *
   * In the browser a failed scoring run used to be TERMINAL: the answers sat on the
   * document, the scorer could have run again, and there was no route to it. The
   * recruiter's only options were a manual evaluation or asking the candidate to sit
   * the whole interview a second time.
   */
  retryable: () =>
    http<RetryableEvaluation[]>('/interviews/retryable'),

  /**
   * Re-run scoring from the answers already stored. No candidate involvement.
   *
   * Runs the same scorer the mobile surface runs. The response reports whether it
   * actually worked — the scorer never throws, it records failures on the document, so
   * "no error" is not the same as "scored".
   */
  retryEvaluation: (interviewId: string) =>
    http<{ id: string; scored: boolean; overallScore?: number; error: string }>(
      `/interviews/${interviewId}/retry-evaluation`,
      { method: 'POST' },
    ),

  /**
   * Drop the result and reopen the interview, KEEPING the assignment — the candidate
   * stays assigned and can take it again.
   *
   * Irreversible: the stored answers and any score go with it. Try `retryEvaluation`
   * first, which is free and keeps everything.
   */
  clearResult: (interviewId: string) =>
    http<{ id: string; status: string }>(
      `/interviews/${interviewId}/clear-result`,
      { method: 'POST' },
    ),

  /**
   * Decide a whole round at once.
   *
   * `ranked` is IN RANK ORDER and the server stamps positions from it — a rank that
   * recomputed itself on read would shift under the candidate every time anybody else
   * was re-scored. Everyone in `selectedIds` moves forward; everyone else does not.
   *
   * All-or-nothing: the server verifies ownership of every id before writing anything,
   * so a bad request changes nothing rather than applying half a decision.
   */
  decideRound: (body: {
    ranked: string[]
    selectedIds: string[]
    noteForSelected?: string
    noteForRejected?: string
    publish?: boolean
    /**
     * Send each candidate the transition email for their outcome. OPT-IN, and separate
     * from `publish`: publishing makes the outcome visible when they next sign in, an
     * email pushes it to them, and an email cannot be unsent.
     */
    sendEmails?: boolean
    roundName?: string
  }) =>
    http<{
      decided: number
      selected: number
      published: boolean
      emailed: number
      /** Per recipient, so a bounced address can be retried without re-sending to all. */
      emailFailures: { id: string; error: string }[]
    }>(
      '/interviews/outcomes',
      { method: 'POST', body: JSON.stringify(body) },
    ),
}

/**
 * A test's timeline, on the shared rounds model.
 *
 * Separate from `pipelinesApi`, which still drives the existing board: the two models
 * run in parallel until the old one is retired, so nothing here reads or writes a
 * pipeline. See `backend/app/web/routes/rounds.py`.
 */
/**
 * A résumé round — the candidate submits a CV instead of sitting an interview.
 *
 * On the SHARED `/api` surface, because the scoring already lives there and is already
 * tested: `app/resume.py` resolves the round's criteria server-side and writes the
 * score with the Admin SDK, precisely so a candidate cannot lower the bar they are
 * measured against. A second implementation on the web surface would be a second
 * scorer for one submission.
 */
export const resumeApi = {
  /** Transcribe a PDF. Useful on its own — the candidate confirms the text first. */
  extract: (pdfBase64: string, fileName?: string) =>
    commonHttp<{ text: string; charCount: number; truncated: boolean }>(
      '/resume/extract',
      { method: 'POST', body: JSON.stringify({ pdfBase64, fileName }) },
    ),

  /**
   * Score it against the round's criteria and store the result.
   *
   * Deliberately sends NO criteria, role or prompt: all are resolved server-side from
   * the interview and its round.
   */
  score: (interviewId: string, resumeText: string, fileName?: string) =>
    commonHttp<{ interviewId: string; charCount: number; model: string }>(
      '/resume/score',
      {
        method: 'POST',
        body: JSON.stringify({ interviewId, resumeText, fileName }),
      },
    ),
}

export const roundsApi = {
  list: (testId: string) =>
    http<TimelineResponse>(`/tests/${testId}/rounds`),

  create: (
    testId: string,
    body: {
      title: string
      kind?: RoundKind
      opensAt?: string | null
      closesAt?: string | null
      criteria?: Partial<RoundCriteria>
    },
  ) =>
    http<InterviewRound>(`/tests/${testId}/rounds`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (testId: string, roundId: string, body: Record<string, unknown>) =>
    http<InterviewRound>(`/tests/${testId}/rounds/${roundId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /**
   * End a round ahead of its deadline. `lockedOut` is how many candidates it actually
   * reached — stamping the round alone closes nothing, because their devices gate on
   * `expiresAt` on their own assignment.
   */
  end: (testId: string, roundId: string) =>
    http<{ id: string; state: RoundState; lockedOut: number }>(
      `/tests/${testId}/rounds/${roundId}/end`,
      { method: 'POST' },
    ),

  /** With no `candidates`, everyone already in the TEST is assigned. */
  assign: (testId: string, roundId: string, candidates?: string[]) =>
    http<{ assigned: number; skipped: number }>(
      `/tests/${testId}/rounds/${roundId}/assign`,
      { method: 'POST', body: JSON.stringify(candidates ? { candidates } : {}) },
    ),

  /**
   * Take candidates OUT of a round — the undo for advancing somebody by mistake.
   *
   * `kept` names anyone who was refused because they had already started: their
   * document holds the transcript and the score computed from it, and deleting it
   * would destroy work the decision was about to be made on.
   */
  unassign: (testId: string, roundId: string, candidates: string[]) =>
    http<{ removed: number; kept: { email: string; reason: string }[] }>(
      `/tests/${testId}/rounds/${roundId}/unassign`,
      { method: 'POST', body: JSON.stringify({ candidates }) },
    ),

  /**
   * End every round still running and stamp the test closed.
   *
   * Decides NOTHING — call `outcomesApi.decideRound` first. That ordering is
   * deliberate: the decision is the durable, meaningful write, so a failure to close
   * afterwards leaves it standing and retryable.
   */
  closeTest: (testId: string) =>
    http<{ closed: boolean; roundsEnded: number }>(`/tests/${testId}/close`, {
      method: 'POST',
    }),

  /**
   * Move assignments that belong to no round into this one.
   *
   * Adopts rather than recreating: those documents may already hold a completed
   * interview, a transcript and a score.
   */
  adopt: (testId: string, roundId: string) =>
    http<{ adopted: number }>(`/tests/${testId}/rounds/${roundId}/adopt`, {
      method: 'POST',
    }),
}

export const pipelinesApi = {
  list: (role?: string) => http<Pipeline[]>(`/pipelines${role ? `?role=${encodeURIComponent(role)}` : ''}`),
  get: (id: string) => http<Pipeline>(`/pipelines/${id}`),
  create: (body: CreatePipelineRequest) => http<Pipeline>('/pipelines', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: CreatePipelineRequest) => http<Pipeline>(`/pipelines/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) => http<void>(`/pipelines/${id}`, { method: 'DELETE' }),
  inviteRound1: (id: string, body: PipelineInviteRequest) =>
    http<PipelineInviteResult>(`/pipelines/${id}/invite`, { method: 'POST', body: JSON.stringify(body) }),
  board: (id: string) => http<PipelineBoard>(`/pipelines/${id}/board`),
  advance: (id: string, body: AdvanceRequest) =>
    http<AdvanceResult>(`/pipelines/${id}/advance`, { method: 'POST', body: JSON.stringify(body) }),
  notAdvancing: (id: string, body: NotAdvancingRequest) =>
    http<AdvanceResult>(`/pipelines/${id}/not-advancing`, { method: 'POST', body: JSON.stringify(body) }),
  moveBack: (id: string, body: MoveBackRequest) =>
    http<{ ok: boolean }>(`/pipelines/${id}/move-back`, { method: 'POST', body: JSON.stringify(body) }),
}

/* ─── Analytics (aggregate dashboard) ───────────────────────────────────── */
export const analyticsApi = {
  summary: (filters: AnalyticsFilters = {}) => {
    const qs = new URLSearchParams()
    if (filters.track) qs.set('track', filters.track)
    if (filters.templateId) qs.set('templateId', filters.templateId)
    if (filters.role) qs.set('role', filters.role)
    if (filters.dateFrom) qs.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) qs.set('dateTo', filters.dateTo)
    const q = qs.toString()
    return http<AnalyticsSummary>(`/analytics${q ? `?${q}` : ''}`)
  },
}

/* ─── Voice track (catalog + preview; the live call uses a WebSocket) ────── */
export const voicesApi = {
  catalog: () => http<VoiceCatalog>('/voices'),
  // Returns base64 PCM (24 kHz) for the preview player. The server no longer
  // renders the audio: the browser mints a preview token and speaks to Google
  // itself — the same path the Flutter app uses. The token route lives on the
  // COMMON surface (shared with mobile), so its request fields are snake_case
  // (the mobile contract) and errors come as FastAPI's default { detail }.
  sample: async (voiceId: string, text?: string): Promise<{ voiceId: string; mimeType: string; audio: string }> => {
    const res = await fetch(`${commonBase()}/rt/gemini-preview-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_name: voiceId, sample_text: text ?? '' }),
    })
    const body = await res.text()
    const data = body ? JSON.parse(body) : undefined
    if (res.status === 429) throw rateLimitError(res, data)
    if (!res.ok) throw new ApiError((data && (data.detail || data.error)) || `Voice preview failed (${res.status})`, res.status, data)
    const pcm = await speakViaGeminiLive(data as LiveGrant)
    return { voiceId, mimeType: 'audio/pcm;rate=24000', audio: bytesToBase64(pcm) }
  },
}

/* ─── Mimic Guide Autopilot ───────────────────────────────────────────────── */
export const helpApi = {
  agent: (body: AgentRequest) => http<AgentDecision>('/help/agent', { method: 'POST', body: JSON.stringify(body) }),
}

/** Build a CSV from rows and trigger a browser download. Values are quote-escaped. */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Feedback across this recruiter's interviews. Tenant-scoped server-side.
 *
 * `rating` is optional because the candidate feedback step accepts a comment
 * without a star rating — a candidate who writes a sentence about what went
 * wrong is the most useful feedback there is, and requiring a number would have
 * thrown it away. The recruiter's average simply skips the rows without one.
 */
export interface FeedbackItem {
  sessionId: string
  track?: string
  role?: string
  candidateName?: string
  rating?: number | null
  comment?: string
  hadTechnicalIssues?: boolean
  createdAt: string
}
export interface FeedbackSummary {
  items: FeedbackItem[]
  count: number
  averageRating: number | null
  technicalIssueCount: number
}
export const feedbackApi = {
  list: () => http<FeedbackSummary>('/feedback'),
}
