import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
/* Imported for its side effect, and it has to be imported HERE.
 *
 * colourScheme.ts writes the chosen palette onto the document at module load
 * rather than from a React effect, so the first painted frame is already the
 * right colour. That only works if something loads the module — and until this
 * line, the only importer was the settings page, which meant a workspace that had
 * chosen Peach saw it on the one screen where it picked Peach and nowhere else.
 * The marketing site is unaffected: it has its own palette and reads none of
 * these properties. */
import '@/lib/colourScheme'
/* THE MARKETING PALETTE, EAGERLY — and this line is a bug fix, not a tidy-up.
 *
 * mimicSite.css was imported by MarketingLayout, so Vite code-split it into the
 * route chunk. That chunk is fetched by the route's JAVASCRIPT, and the
 * prerendered HTML for all 74 marketing routes links only index-*.css — so every
 * marketing page painted with no marketing stylesheet at all until the JS had
 * booted and injected it.
 *
 * `--mm-ink` is declared in that file and nowhere else. During the window there
 * was no rule AND no token, so `background:var(--mm-ink,#0E1420)` could not even
 * fall back: the declaration did not exist yet. A dark section rendered as the
 * page's white with its light text still light on it — a white hero with an
 * invisible headline, which is exactly what was reported from a phone on mobile
 * data, and from a desktop before that.
 *
 * Imported from the entry instead, so it lands in index-*.css, which every
 * prerendered page already links in its head. The palette is present before the
 * first paint on every route. The app routes carry the CSS too, which is the cost
 * — and the right way round: the marketing site is what an unauthenticated
 * visitor lands on, and the app is behind a sign-in. */
import '@/marketing/mimicSite.css'

/* The cinematic splash is NOT mounted here any more.
 *
 * Mounting it at the root played it on every cold load, including the marketing
 * home — a title card in front of the offer, before the visitor has any reason
 * to sit through one. It is mounted on the /login route instead (see App.tsx),
 * so it plays when someone chooses to sign in, and its chunk (framer-motion and
 * the WebGL scene) is never fetched by a visitor who only reads the public
 * pages. See features/intro/introRoutes.ts. */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
