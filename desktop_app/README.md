# Talbotiq Desktop

The existing website at [`web_version/talbotiq-platform`](../web_version/talbotiq-platform)
running inside an Electron shell. This directory contains **only** the native
shell, its packaging config, and the one behavior the website itself doesn't
need: blocking candidate accounts at the desktop boundary. It does not
reimplement, redesign, or fork any page, component, route, or workflow — the
built website is loaded and run as-is.

## What's in here, and why it's small

- `main.js` — the entire application. It serves the website's own
  `dist/` build through a custom `app://` scheme (so client-side routing
  works exactly like it does behind the Vercel/Firebase Hosting rewrite
  rules the website already ships with), and watches in-app navigation for
  the two candidate-only routes (`/candidate`, `/take/:id`) to redirect to
  the website's own existing `/access-denied` screen.
- `electron-builder.yml`, `build/entitlements.mac.plist` — packaging config
  for the Windows/macOS installers (Phase 05). Not exercised by Phase 00.
- Nothing else. There is deliberately no renderer code, no UI components,
  and no copy of the website's source in this directory.

## Why the desktop app is recruiter-only

The product requirement is that this desktop build only ever serves
recruiters — a candidate account must never reach their workspace or an
interview screen here, even though the website both roles share fully
supports candidates. Enforcing that inside the website's own code would mean
forking its auth logic for one client; instead `main.js` enforces it at the
shell boundary by watching for navigation into `/candidate` or `/take/*` and
redirecting to the website's own `/access-denied` route before that content
ever renders. The website's candidate functionality is untouched — a
candidate signing in on a browser still gets their full experience; a
candidate signing in inside this desktop app sees the same "access denied"
screen the website already has for a role mismatch.

One known nuance: `/access-denied`'s own "Go to my home" button sends a
candidate back to `/candidate`, which the shell immediately redirects again.
That's the website's existing button behavior (unmodified, per the
requirement not to touch candidate functionality) — the net effect is the
candidate can only ever reach `/access-denied` or sign out, never the
workspace, just with an extra bounce if they click that button.

## Running it (Phase 00)

```bash
# 1. Build the website's production bundle (bakes in VITE_API_BASE from
#    web_version/talbotiq-platform/.env.production — no separate desktop
#    config needed).
npm run build:renderer

# 2. Install the shell's own dependencies (Electron + electron-builder).
npm install

# 3. Launch.
npm start
```

## Packaging (Phase 05, not yet exercised)

```bash
npm run dist
```

Builds the renderer, then runs `electron-builder` per `electron-builder.yml`
— NSIS installer for Windows, signed/notarized `.dmg` for macOS (macOS
notarization needs Apple Developer credentials that are outside this repo).
