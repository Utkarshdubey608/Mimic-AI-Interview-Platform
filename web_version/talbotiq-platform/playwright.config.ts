import { defineConfig, devices } from '@playwright/test'

/**
 * Browser-level verification for the System Check.
 *
 * Chromium's fake-media flags are the only way to stage the case that matters:
 * permission granted, device present, and no signal arriving. A real camera and
 * microphone cannot be made to fail on demand in CI.
 *
 * The repo's other tests are standalone tsx scripts run by scripts/verify-deploy.mjs;
 * this runs alongside them (`npm run test:e2e`), it does not replace them.
 */
const FAKE_MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [['list']],
  webServer: {
    command: 'npm run dev:client',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:3001', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      testIgnore: /no-signal\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } },
    },
    {
      name: 'mobile',
      testIgnore: /no-signal\.spec\.ts/,
      use: { ...devices['Pixel 7'], launchOptions: { args: FAKE_MEDIA } },
    },
    {
      // A silent WAV as the fake microphone: granted, present, and inaudible.
      // Its own project because these flags cannot be set per-describe.
      name: 'no-signal',
      testMatch: /no-signal\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [...FAKE_MEDIA, '--use-file-for-fake-audio-capture=e2e/fixtures/silence.wav'],
        },
      },
    },
  ],
})
