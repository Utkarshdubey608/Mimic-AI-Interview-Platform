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
