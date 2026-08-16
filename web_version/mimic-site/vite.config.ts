import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // "Sign in" points at the web APPLICATION, which is a different host — there
  // is no same-origin /login on this site, so a production build without the
  // app origin would dead-end both header links on the site's own 404 page.
  // Fail loudly at build time instead of silently on deploy.
  if (mode === 'production' && !(env.VITE_APP_ORIGIN ?? '').trim()) {
    throw new Error(
      'mimic-site: VITE_APP_ORIGIN is required for production builds — the "Sign in" links target the web application (e.g. VITE_APP_ORIGIN=https://app.talbotiq.com).',
    )
  }
  return {
    plugins: [react()],
    server: {
      port: 3002,
      strictPort: true,
      // Dev only: the demo-request form posts to the common backend
      // (POST /api/web/leads). Run it with:
      //   uvicorn app.main:app --reload --port 8787
      // In production the site sets VITE_API_BASE to the API host instead.
      proxy: {
        '/api': 'http://localhost:8787',
      },
    },
  }
})
