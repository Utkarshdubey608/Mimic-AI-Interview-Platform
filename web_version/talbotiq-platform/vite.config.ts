import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the big third-party dependencies into their own chunks.
         *
         * This is a bundling change only — no application code moves. The point
         * is cacheability and visibility: React and Firebase change far less
         * often than product code, so isolating them means a normal deploy no
         * longer invalidates them in every visitor's cache, and the build output
         * shows what each dependency actually costs.
         *
         * Note this does NOT remove Firebase from the marketing page's critical
         * path — AuthProvider still imports it eagerly, so it is still fetched.
         * Doing that requires changing where AuthProvider mounts, which is auth
         * code and needs sign-off.
         */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    port: 3001,
    strictPort: true,
    // Keys never reach the client — /api calls are proxied to the common
    // FastAPI backend (run it with: uvicorn app.main:app --reload --port 8787),
    // which holds every vendor credential server-side. The Deepgram caption
    // relays are WebSockets, proxied with ws:true. The old /api/voice relay is
    // gone: the Voice Track connects the browser straight to Gemini Live with a
    // short-lived token minted by the backend.
    proxy: {
      // WS paths (must precede the generic /api http proxy).
      '/api/web/avatar/deepgram': { target: 'ws://localhost:8787', ws: true },
      '/api/web/interview/deepgram': { target: 'ws://localhost:8787', ws: true }, // Video Interview live transcription
      '/api': 'http://localhost:8787',
    },
  },
})
