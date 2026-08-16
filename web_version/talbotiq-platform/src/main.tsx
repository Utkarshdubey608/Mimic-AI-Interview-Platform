import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

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
