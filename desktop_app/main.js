// Talbotiq desktop shell.
//
// This process does not implement any product feature. It does exactly two
// things: (1) serve the existing web app's own production build
// (web_version/talbotiq-platform/dist) through a custom, standard scheme so
// the SPA's client-side routing works offline exactly like it does behind
// the Vercel/Firebase Hosting rewrite rules the website already ships with,
// and (2) block the two candidate-only routes so this desktop build is
// recruiter-only, per the desktop app's own requirement — without touching
// the website's source, which still supports both roles.
'use strict'

const { app, BrowserWindow, protocol, net, session, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const SCHEME = 'app'
const APP_ORIGIN = `${SCHEME}://desktop`

// The real, externally reachable web origin. Candidate invite emails and
// "copy link" build their URL from this app's own origin, which is normally
// correct (see src/lib/candidateOrigin.ts) — but this app's own origin is
// the synthetic APP_ORIGIN above, which no candidate can open. This is the
// production website's real, public, non-secret origin — not a credential —
// so a packaged build works correctly with zero setup. TALBOTIQ_PUBLIC_WEB_ORIGIN
// remains available to override it (e.g. pointing a dev/staging build at a
// different deployment) without rebuilding.
const PUBLIC_WEB_ORIGIN = (process.env.TALBOTIQ_PUBLIC_WEB_ORIGIN || 'https://app.talbotiq.com').trim().replace(/\/+$/, '')

const RENDERER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'renderer')
  : path.join(__dirname, '..', 'web_version', 'talbotiq-platform', 'dist')

// Routes that only ever render candidate content (see
// web_version/talbotiq-platform/src/App.tsx and src/features/auth/guards.tsx).
// This desktop build is recruiter-only: a signed-in candidate must never see
// their workspace or an interview screen here, even though the website they
// share a backend with fully supports both roles.
function isCandidateOnlyPath(pathname) {
  return pathname === '/candidate' || pathname.startsWith('/take/')
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

function resolveAssetPath(pathname) {
  const decoded = decodeURIComponent(pathname === '/' || pathname === '' ? '/index.html' : pathname)
  const candidate = path.normalize(path.join(RENDERER_DIR, decoded))
  // Path-traversal guard, then fall back to index.html for every client-side
  // route (e.g. /sessions, /access-denied) exactly the way the website's own
  // Vercel/Firebase Hosting SPA rewrite already does for the browser.
  if (candidate.startsWith(RENDERER_DIR) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate
  }
  return path.join(RENDERER_DIR, 'index.html')
}

function registerAppProtocol() {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    return net.fetch(pathToFileURL(resolveAssetPath(pathname)).toString())
  })
}

// The website resolves role asynchronously (a live Firestore read, not a
// token claim — see src/features/auth/AuthProvider.tsx), so a recruiter's
// own sign-in can transit through /candidate for a moment before
// HomeRedirect/RequireRecruiter correct it to /sessions. Redirecting
// immediately on that first navigation event would strand a recruiter at
// /access-denied over a race that was never really a candidate reaching
// their workspace. A short settle-and-recheck fixes this without weakening
// the guarantee: a genuine candidate's path never self-corrects away from
// /candidate, so it's still caught the moment the debounce elapses.
const GUARD_SETTLE_MS = 500

function enforceRecruiterOnly(win) {
  const guard = (_event, navigatedUrl) => {
    let pathname
    try {
      pathname = new URL(navigatedUrl).pathname
    } catch {
      return
    }
    if (!isCandidateOnlyPath(pathname)) return
    setTimeout(() => {
      if (win.isDestroyed()) return
      let currentPathname
      try {
        currentPathname = new URL(win.webContents.getURL()).pathname
      } catch {
        return
      }
      if (isCandidateOnlyPath(currentPathname)) {
        win.webContents.loadURL(`${APP_ORIGIN}/access-denied`)
      }
    }, GUARD_SETTLE_MS)
  }
  win.webContents.on('did-navigate-in-page', guard)
  win.webContents.on('did-navigate', guard)
}

function keepNavigationInApp(win) {
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (!targetUrl.startsWith(`${SCHEME}://`)) {
      shell.openExternal(targetUrl)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(`${SCHEME}://`)) {
      event.preventDefault()
      shell.openExternal(targetUrl)
    }
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0B0F18', // matches the app's own dark "Room" ground — avoids a white flash on first paint
    title: 'Talbotiq',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--talbotiq-public-web-origin=${PUBLIC_WEB_ORIGIN}`],
    },
  })

  enforceRecruiterOnly(win)
  keepNavigationInApp(win)
  // The website already has a purpose-built entry route for exactly this:
  // /workspace resolves to /sessions, /candidate, or /login depending on
  // auth/role state (src/features/auth/guards.tsx, HomeRedirect). Loading
  // "/" instead — the public marketing page — was an Electron-shell choice
  // in Phase 00 that bypassed it; this app has no reason to show marketing
  // content to an already-signed-in recruiter on every launch.
  win.loadURL(`${APP_ORIGIN}/workspace`)
  return win
}

// The website calls one backend endpoint from a real <video>/fetch element
// that a browser would only ever reach from the website's own origin:
// /api/web/avatar/face-cache (replica-preview thumbnails, see
// src/lib/faceCache.ts). From our synthetic app://desktop origin, the
// backend's CORS allow-list — built for the website's real origin — never
// matches, so Chromium blocks the response before the page ever sees it.
// This is exactly an Electron-boundary problem, not a website or backend
// bug: the fix is to add a permissive CORS header on the way back to the
// renderer, scoped to just this one already-authenticated, read-only,
// best-effort preview endpoint (see faceCache.ts's own "best-effort" framing).
const FACE_CACHE_PATH = '/api/web/avatar/face-cache'

function allowFaceCacheCors(ses) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (new URL(details.url).pathname !== FACE_CACHE_PATH) {
      callback({})
      return
    }
    // The backend may or may not already send its own Access-Control-Allow-Origin
    // (case varies by response path). Strip whatever's there first so we set
    // exactly one — two same-name headers is itself a CORS error in Chromium.
    const headers = { ...details.responseHeaders }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'access-control-allow-origin') delete headers[key]
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    callback({ responseHeaders: headers })
  })
}

app.whenReady().then(() => {
  // The interview device-check screen calls getUserMedia, and "copy link"
  // buttons across the recruiter UI (Sessions, InviteWizard) call
  // navigator.clipboard.writeText — Electron denies both by default unless a
  // handler explicitly allows them for this app.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'clipboard-sanitized-write')
  })

  allowFaceCacheCors(session.defaultSession)
  registerAppProtocol()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
