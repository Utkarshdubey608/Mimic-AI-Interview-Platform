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
const SessionsPage       = lazy(() => import('@/features/recruiter/SessionsPage'))
const PipelinesPage      = lazy(() => import('@/features/recruiter/PipelinesPage'))
const PipelineBoardPage  = lazy(() => import('@/features/recruiter/PipelineBoardPage'))
const InviteWizard       = lazy(() => import('@/features/recruiter/InviteWizard'))
const ReportPage         = lazy(() => import('@/features/recruiter/ReportPage'))
const LiveInterviewPage  = lazy(() => import('@/features/recruiter/LiveInterviewPage'))
const TakeInterviewPage  = lazy(() => import('@/features/interview/TakeInterviewPage'))
// DEV ONLY — see the /__systemcheck route below.
const SystemCheckHarness = lazy(() => import('@/features/interview/systemcheck/SystemCheckHarness'))
const InterviewBitsHarness = lazy(() => import('@/features/interview/systemcheck/InterviewBitsHarness'))

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

/* The cinematic splash, scoped to the sign-in route. Lazy so a visitor who only
   reads the public pages never fetches the WebGL scene or framer-motion, and
   mounted on /login rather than at the root so it plays when someone chooses to
   enter the product instead of in front of everyone who opens the site. */

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
            {/* Everything below needs an identity. */}
            <Route element={<AuthedApp />}>
            {/* No intro splash. It covered the sign-in form with a WebGL scene
                the moment its chunk landed, so the page a returning user sees
                most often was also its slowest, and it pulled Three.js onto the
                login path for an animation nobody asked to watch twice. */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/access-denied" element={<AccessDenied />} />

            {/* DEV ONLY — the System Check with no session behind it, so the
                Playwright suite can drive every mode and failure state without
                minting invites. Stripped from the production bundle. */}
            {import.meta.env.DEV && (
              <>
                <Route path="/__systemcheck" element={<SystemCheckHarness />} />
                <Route path="/__interviewbits" element={<InterviewBitsHarness />} />
              </>
            )}

            {/* Candidate-only — assigned-session list + the interview itself */}
            <Route element={<RequireCandidate />}>
              <Route path="/candidate" element={<CandidateHome />} />
              <Route path="/take/:sessionId" element={<TakeInterviewPage />} />
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
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/sessions/new" element={<InviteWizard />} />
                <Route path="/sessions/:id/report" element={<ReportPage />} />
                <Route path="/pipelines" element={<PipelinesPage />} />
                <Route path="/pipelines/:id" element={<PipelineBoardPage />} />
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

        <Toaster
          position="bottom-right"
          gutter={8}
          toastOptions={{
            duration: 4000,
            style: {
              background: '#fff',
              color: '#0E1420',
              border: '1px solid #E7E7EA',
              borderRadius: '14px',
              padding: '12px 16px',
              fontSize: '13px',
              fontFamily: 'Archivo, system-ui, sans-serif',
              fontWeight: '500',
              boxShadow: '0 6px 18px -4px rgba(14,20,32,0.14)',
              maxWidth: '380px',
            },
            success: { iconTheme: { primary: '#15803D', secondary: '#fff' } },
            error: { iconTheme: { primary: '#B3261E', secondary: '#fff' } },
            loading: { iconTheme: { primary: '#0E1420', secondary: '#fff' } },
          }}
        />
    </QueryClientProvider>
  )
}
