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

function enforceRecruiterOnly(win) {
  const guard = (_event, navigatedUrl) => {
    let pathname
    try {
      pathname = new URL(navigatedUrl).pathname
    } catch {
      return
    }
    if (isCandidateOnlyPath(pathname)) {
      win.webContents.loadURL(`${APP_ORIGIN}/access-denied`)
    }
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
    },
  })

  enforceRecruiterOnly(win)
  keepNavigationInApp(win)
  win.loadURL(`${APP_ORIGIN}/`)
  return win
}

app.whenReady().then(() => {
  // The interview device-check screen calls getUserMedia; Electron denies
  // media permission requests by default unless a handler explicitly allows
  // them for this app.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  registerAppProtocol()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
