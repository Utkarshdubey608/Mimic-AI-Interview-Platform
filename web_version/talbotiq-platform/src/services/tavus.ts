import type {
  TavusReplica, CreateReplicaInput,
  TavusPersona, CreatePersonaInput,
  TavusConversation, CreateConversationInput, ConversationFilters,
  TavusVideo, GenerateVideoInput,
  TavusListResponse,
} from '@/types/tavus.types'
import { commonBase } from '@/lib/apiOrigin'

/**
 * Tavus access goes through the backend proxy at {commonBase()}/tavus — the
 * COMMON surface shared with the mobile app. The Tavus credential never
 * reaches the browser: the proxy attaches it server-side. (Previously this
 * file held a recruiter-pasted key in memory and called tavusapi.com
 * directly, which is exactly what the common-backend migration removes.)
 *
 * Only the routes the candidate flow uses are proxied: list replicas/personas,
 * create/read/end conversations, and the verbose conversation view. Replica,
 * persona and video MANAGEMENT (create/update/delete) is not proxied yet —
 * those methods reject with a clear message so the vendor-console pages
 * degrade visibly instead of firing keyless 401s at Tavus. The backend adds
 * proxies for them on request (see WEB_FRONTEND_MIGRATION_TASKS.md §3.5).
 */
class TavusAPI {
  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${commonBase()}/tavus${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      // The FastAPI proxy emits { detail }; older shapes kept as fallbacks.
      const msg = err?.detail ?? err?.message ?? err?.error ?? `HTTP ${res.status}`
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
    if (res.status === 204) return undefined as T
    return res.json()
  }

  private notProxied(what: string): Promise<never> {
    return Promise.reject(new Error(
      `${what} is not available from this app — the backend does not proxy this Tavus route yet. Manage it at platform.tavus.io.`,
    ))
  }

  // ── Replicas ──────────────────────────────────────────────────────────────
  // One call now: the backend merges custom + stock replicas server-side.
  listReplicas = (): Promise<TavusReplica[]> =>
    this.req<TavusListResponse<TavusReplica>>('GET', '/replicas').then(r => r.data ?? [])

  getReplica = (_id: string): Promise<TavusReplica> => this.notProxied('Replica detail')

  createReplica = (_data: CreateReplicaInput): Promise<TavusReplica> => this.notProxied('Replica creation')

  updateReplica = (_id: string, _data: Partial<TavusReplica>): Promise<TavusReplica> => this.notProxied('Replica editing')

  deleteReplica = (_id: string): Promise<void> => this.notProxied('Replica deletion')

  // ── Personas ──────────────────────────────────────────────────────────────
  listPersonas = (): Promise<TavusPersona[]> =>
    this.req<TavusListResponse<TavusPersona>>('GET', '/personas').then(r => r.data ?? [])

  getPersona = (_id: string): Promise<TavusPersona> => this.notProxied('Persona detail')

  createPersona = (_data: CreatePersonaInput): Promise<TavusPersona> => this.notProxied('Persona creation')

  updatePersona = (_id: string, _data: Partial<CreatePersonaInput>): Promise<TavusPersona> => this.notProxied('Persona editing')

  deletePersona = (_id: string): Promise<void> => this.notProxied('Persona deletion')

  // ── Conversations ─────────────────────────────────────────────────────────
  listConversations = (_filters?: ConversationFilters): Promise<TavusConversation[]> =>
    this.notProxied('Conversation history')

  getConversation = (id: string) =>
    this.req<TavusConversation>('GET', `/conversations/${id}`)

  createConversation = (data: CreateConversationInput) =>
    this.req<TavusConversation>('POST', '/conversations', data)

  updateConversation = (_id: string, _data: Partial<CreateConversationInput>): Promise<TavusConversation> =>
    this.notProxied('Conversation editing')

  endConversation = (id: string) =>
    this.req<void>('POST', `/conversations/${id}/end`)

  // Best-effort: the proxy's verbose view carries whatever transcript Tavus
  // includes; callers already tolerate an absent transcript (retry: false).
  getConversationTranscript = (id: string) =>
    this.req<{ transcript?: Array<{ role: string; content: string; timestamp?: string }> }>(
      'GET', `/conversations/${id}/verbose`,
    )

  // ── Videos ────────────────────────────────────────────────────────────────
  listVideos = (): Promise<TavusVideo[]> => this.notProxied('Video listing')

  getVideo = (_id: string): Promise<TavusVideo> => this.notProxied('Video detail')

  generateVideo = (_data: GenerateVideoInput): Promise<TavusVideo> => this.notProxied('Video generation')
}

export const tavus = new TavusAPI()
export type { TavusAPI }
