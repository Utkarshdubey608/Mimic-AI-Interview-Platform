# MIMIC marketing site

The public marketing website for Mimic (`mimic.talbotiq.com`), standalone.
It used to live inside the web application at `/mimic*`
(`web_version/talbotiq-platform/src/features/marketing`); it is now its own
Vite + React app so the marketing site and the product can change and ship
independently.

## What it is

- The homepage plus 72 data-driven subpages (`src/site/content.ts` is the
  single source of every page's copy and structure).
- No Firebase, no auth, no product code, no secrets. The only network call on
  the whole site is the demo-request form's POST to the backend's public
  `/api/web/leads` route.
- Pages keep their old paths minus the `/mimic` prefix — `/mimic/solutions`
  is `/solutions` here.

## Run it

```bash
npm install
npm run dev          # http://localhost:3002
```

The dev proxy forwards `/api` to `http://localhost:8787` — run the common
backend there if you want the demo form to work locally:

```bash
cd ../../backend && uvicorn app.main:app --reload --port 8787
```

## Build

```bash
npm run build        # tsc + vite build → dist/
```

## Configuration (public, build-time)

| Var | Meaning | Blank ⇒ |
|---|---|---|
| `VITE_API_BASE` | Backend origin for the lead form | same-origin `/api/web` (dev proxy serves it) |
| `VITE_APP_ORIGIN` | Web application origin for the "Sign in" links | dev only — **production builds fail without it** (this site has no `/login` of its own) |

## Guardrails

`npm run audit:claims` sweeps every user-visible string on all 72 pages for
capability claims the product does not have, and exits non-zero when a string
needs review — keep it in any release gate for this site.
