import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'

/**
 * Every route is code-split.
 *
 * Before this, all page components were imported statically, so the whole
 * application shipped as one 3.6 MB chunk (1,030 KB gzipped): Firebase,
 * TanStack Query, Recharts, dnd-kit, jsPDF, tiptap and the video SDKs, on
 * every first paint. Splitting per route means a visitor pays only for the
 * page they asked for.
 *
 * The MIMIC marketing site used to live here at /mimic* — it is now its own
 * standalone app (web_version/mimic-site), so this router serves only the
 * authenticated product.
 *
 * Guards, Nav and HomeRedirect stay static: they are small, and they decide
 * which chunk to fetch, so deferring them would just add a round-trip.
 */
const LoginPage          = lazy(() => import('@/features/auth/LoginPage'))
const AccessDenied       = lazy(() => import('@/features/auth/AccessDenied'))
const CandidateHome      = lazy(() => import('@/features/candidate/CandidateHome'))
const SetupPage          = lazy(() => import('@/pages/SetupPage'))
const AvatarScreeningGate = lazy(() => import('@/features/avatar-screening/AvatarScreeningGate'))
const ResultsPage        = lazy(() => import('@/pages/ResultsPage'))
const ReplicasPage       = lazy(() => import('@/pages/ReplicasPage'))
const PersonasPage       = lazy(() => import('@/pages/PersonasPage'))
const AnalyticsPage      = lazy(() => import('@/pages/AnalyticsPage'))
const SettingsPage       = lazy(() => import('@/pages/SettingsPage'))
const TemplatesPage      = lazy(() => import('@/features/recruiter/TemplatesPage'))
const TemplateEditorPage = lazy(() => import('@/features/recruiter/TemplateEditorPage'))
const QuestionSetsPage   = lazy(() => import('@/features/recruiter/QuestionSetsPage'))
const McqSetsPage        = lazy(() => import('@/features/recruiter/McqSetsPage'))
const CodingProblemsPage = lazy(() => import('@/features/recruiter/CodingProblemsPage'))
const EssayPromptsPage = lazy(() => import('@/features/recruiter/EssayPromptsPage').then(m => ({ default: m.EssayPromptsPage })))
import { CodingStage } from '@/features/interview/screens/CodingStage'
const McqStageHarness    = lazy(() => import('@/features/interview/screens/McqStageHarness'))
const SessionsPage       = lazy(() => import('@/features/recruiter/SessionsPage'))
const PipelinesPage      = lazy(() => import('@/features/recruiter/PipelinesPage'))
const PipelineBoardPage  = lazy(() => import('@/features/recruiter/PipelineBoardPage'))
const RolePipelinesPage      = lazy(() => import('@/features/recruiter/RolePipelinesPage'))
const RolePipelineEditorPage = lazy(() => import('@/features/recruiter/RolePipelineEditorPage'))
const InviteWizard       = lazy(() => import('@/features/recruiter/InviteWizard'))
const ReportPage         = lazy(() => import('@/features/recruiter/ReportPage'))
const LiveInterviewPage  = lazy(() => import('@/features/recruiter/LiveInterviewPage'))
const TakeInterviewPage  = lazy(() => import('@/features/interview/TakeInterviewPage'))
const ResumeRoundPage    = lazy(() => import('@/features/candidate/ResumeRoundPage'))

/**
 * The auth boundary. Everything below reaches Firebase — the guards and Nav via
 * `useAuth`, IntroFaceSync via `getIdTokenOrNull` — so all of it is imported
 * lazily. A static import of any one of them puts the 167 KB SDK back on the
 * public marketing pages, which is exactly what used to happen.
 */
const AuthedApp        = lazy(() => import('@/AuthedApp'))
const RecruiterShell   = lazy(() => import('@/components/layout/RecruiterShell'))
const RequireRecruiter = lazy(() => import('@/features/auth/guards').then((m) => ({ default: m.RequireRecruiter })))
const RequireCandidate = lazy(() => import('@/features/auth/guards').then((m) => ({ default: m.RequireCandidate })))
const HomeRedirect     = lazy(() => import('@/features/auth/guards').then((m) => ({ default: m.HomeRedirect })))

/* The marketing site. Lazy like everything else, so a recruiter going straight
   to /sessions never downloads the public site, and a visitor reading /pricing
   never downloads the recruiter application. */
const MimicSite        = lazy(() => import('@/marketing/MimicSite'))
const MarketingPage    = lazy(() => import('@/marketing/MarketingPage'))

/* The WebGL splash that used to cover /login has been removed.
 *
 * It was mounted over the sign-in form with its own null-fallback Suspense
 * boundary so the form painted first and the splash faded in on top — careful
 * engineering in service of the wrong goal. The most frequent action in the
 * product is a recruiter arriving at work, and it was gated behind an animation
 * they had already seen, plus a 356 KB IntroCanvas chunk and three.js on the
 * entry route.
 *
 * The atmosphere now lives in the page itself: `AmbientField variant="entry"`,
 * two slow CSS light fields on near-black, present from the first frame and
 * costing nothing.
 *
 * `/login` was the only importer of MimicIntro, so removing it took the whole
 * WebGL scene graph out of the build with it — three.js (668 KB), the
 * IntroCanvas chunk (356 KB), @react-three/fiber, drei and postprocessing are no
 * longer emitted at all. `features/intro/` is left on disk rather than deleted:
 * `IntroFaceSync` still ships (RecruiterShell mounts it to warm the replica
 * thumbnail cache), and the scene files are worth keeping as a starting point
 * if a hero moment is ever wanted somewhere it earns its cost. Nothing in the
 * application imports MimicIntro any more, so it is dead code, deliberately
 * parked rather than removed in a UI pass.
 */

/** Route-transition fallback. Deliberately quiet — a spinner that appears for
 *  120ms reads as jank, so this is just the page ground. */
function RouteFallback() {
  return <div className="min-h-screen bg-background" aria-busy="true" aria-live="polite" />
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } })

export default function App() {
  return (
    <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* ── Browser-test harnesses ───────────────────────────────────
                Dev-only, and OUTSIDE the identity gate on purpose: a Playwright
                run has no Firebase session, and the alternative — stubbing auth
                — would put a bypass in the same code path production uses.
                `import.meta.env.DEV` is replaced at build time, so these routes
                are dead code a production bundle never contains (asserted by
                scripts/verify-deploy.mjs).

                They mount a real screen with its API mocked by the spec, which
                is the layer unit tests cannot reach: a disabled button, a
                control that does not toggle, a colour nobody can read. */}
            {import.meta.env.DEV && (
              <Route path="/__mcq" element={<McqSetsPage />} />
            )}
            {/* Coding problem authoring, for the same reason: the sample/hidden
                distinction is the one control on that page with a security
                consequence, and whether it reads clearly is not something a unit
                test can tell you. */}
            {import.meta.env.DEV && (
              <Route path="/__coding" element={<CodingProblemsPage />} />
            )}
            {/* The CANDIDATE side of MCQ. Harnessed separately because it is the
                irreversible path: a recruiter can re-edit a paper, a candidate
                sits the assessment once and is scored on it. */}
            {import.meta.env.DEV && (
              <Route path="/__mcq-take" element={<McqStageHarness />} />
            )}
            {/* The CANDIDATE side of coding, harnessed for the same reason: this is
                the irreversible path, and whether a hidden case's failure reads as
                "you got it wrong" or "we are not telling you why" is a question
                about rendered pixels. */}
            {import.meta.env.DEV && (
              <Route path="/__coding-take" element={<CodingStage sessionId="e2e-session" />} />
            )}
            {/* The RECRUITER's report. Harnessed because a coding report is the
                one report that shows a candidate's own program and every hidden
                test's verdict — what it discloses and to whom is a question about
                what is on the screen, and it sits behind the identity gate where
                no other check can look at it. */}
            {import.meta.env.DEV && (
              <Route path="/__report/:id" element={<ReportPage />} />
            )}
            {/* The aggregate dashboard, for the coding block: whether six ruled stat
                cells inside a padded card read as a strip or as clutter is not a
                question a type checker answers. */}
            {import.meta.env.DEV && (
              <Route path="/__analytics" element={<AnalyticsPage />} />
            )}

            {/* Everything below needs an identity. */}
            <Route element={<AuthedApp />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/access-denied" element={<AccessDenied />} />

            {/* Candidate-only — assigned-session list + the interview itself */}
            <Route element={<RequireCandidate />}>
              <Route path="/candidate" element={<CandidateHome />} />
              <Route path="/take/:sessionId" element={<TakeInterviewPage />} />
              {/* A résumé round is a SUBMISSION, not a session — no questions, no
                  clock, nothing to join. Routed through the interview engine a
                  candidate lands in a chat with zero questions and no way to tell
                  that from a broken page. CandidateHome sends them here instead,
                  keyed on the round's kind. */}
              <Route path="/submit-resume/:sessionId" element={<ResumeRoundPage />} />
            </Route>

            {/* Recruiter-only — the full recruiter app */}
            <Route element={<RequireRecruiter />}>
              {/* Live Two-way Interview host room — full-bleed dark call UI
                  (mirrors the candidate's TwoWayStage), so it deliberately
                  sits OUTSIDE RecruiterShell (no Nav chrome on a live call). */}
              <Route path="/live/:id" element={<LiveInterviewPage />} />
              <Route element={<RecruiterShell />}>
                <Route path="/setup" element={<SetupPage />} />
                {/* Face-fit pre-flight runs first, then hands off to the
                    (unchanged) InterviewPage — see AvatarScreeningGate. */}
                <Route path="/interview" element={<AvatarScreeningGate />} />
                {/* AI Avatar Screening results (Tavus + Deepgram + Hume + Rekognition +
                    Gemini). Distinct from the recruiter per-session report at
                    /sessions/:id/report, which is unchanged. */}
                <Route path="/results" element={<ResultsPage />} />
                <Route path="/replicas" element={<ReplicasPage />} />
                <Route path="/personas" element={<PersonasPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/settings" element={<SettingsPage />} />

                {/* AI Interview module */}
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/templates/:id" element={<TemplateEditorPage />} />
                <Route path="/question-sets" element={<QuestionSetsPage />} />
                <Route path="/mcq-sets" element={<McqSetsPage />} />
                <Route path="/coding-problems" element={<CodingProblemsPage />} />
                <Route path="/essay-prompts" element={<EssayPromptsPage />} />
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/sessions/new" element={<InviteWizard />} />
                <Route path="/sessions/:id/report" element={<ReportPage />} />
                <Route path="/pipelines" element={<PipelinesPage />} />
                <Route path="/pipelines/:id" element={<PipelineBoardPage />} />
                {/* Role pipelines (Feature 1) — reusable per-role templates on the
                    shared `roleConfigs` collection. Deliberately separate from the
                    `web_pipelines` routes above: /new before /:id so "new" is never
                    swallowed as an id. */}
                <Route path="/candidates/role-pipelines" element={<RolePipelinesPage />} />
                <Route path="/candidates/role-pipelines/new" element={<RolePipelineEditorPage />} />
                <Route path="/candidates/role-pipelines/:id" element={<RolePipelineEditorPage />} />
              </Route>
            </Route>

            {/* ── PUBLIC: the marketing site ───────────────────────────────
                The front door. `/` is the marketing home for everyone, signed
                in or not, which is what makes this read as one site rather
                than two that happen to link to each other.

                These sit inside AuthedApp but outside RequireCandidate and
                RequireRecruiter: no identity is needed to read them, and the
                provider is what lets the nav offer a signed-in visitor their
                workspace instead of a sign-in link.

                Ordering matters. Every product path above is matched first, so
                this catch-all only ever sees paths the application does not
                claim. `/workspace` is the one redirect left doing what `/`
                used to do, for anyone who wants to skip straight there. */}
            <Route path="/" element={<MimicSite />} />
            <Route path="/workspace" element={<HomeRedirect />} />
            <Route path="*" element={<MarketingPage />} />
            </Route>
          </Routes>
          </Suspense>
        </BrowserRouter>

        {/* Toasts are an ink chip on BOTH grounds — see --toast-* in
            design/tokens.css for why they deliberately do not follow the ground.
            Everything here reads from tokens: the previous version specified
            Figtree (a font the product no longer loads, so toasts silently fell
            back to system-ui), a 14px radius that exists nowhere in the scale,
            and a violet-tinted shadow left over from the retired brand. */}
        <Toaster
          position="bottom-right"
          gutter={8}
          toastOptions={{
            duration: 4000,
            style: {
              background: 'var(--toast-bg)',
              color: 'var(--toast-ink)',
              border: '1px solid var(--toast-rule)',
              borderRadius: 'var(--radius-lg)',
              padding: '10px 14px',
              fontSize: '13px',
              fontFamily: 'var(--font-sans)',
              fontWeight: '500',
              boxShadow: '0 12px 28px -8px rgb(0 0 0 / 0.55)',
              maxWidth: '380px',
            },
            success: { iconTheme: { primary: 'var(--live-room)', secondary: 'var(--toast-bg)' } },
            error:   { iconTheme: { primary: '#FF8A80', secondary: 'var(--toast-bg)' } },
            loading: { iconTheme: { primary: 'var(--signal-room)', secondary: 'var(--toast-bg)' } },
          }}
        />
    </QueryClientProvider>
  )
}
