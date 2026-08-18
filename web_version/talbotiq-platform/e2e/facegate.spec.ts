import { test } from '@playwright/test'

/**
 * Face framing after consent — NOT automatable here, and skipped rather than
 * left red.
 *
 * The gate only appears once the System Check's own face-presence check passes,
 * and that check needs a real face. Chromium's fake camera renders a moving
 * test pattern, so MediaPipe finds nobody, `canStart` never becomes true, and
 * the run cannot even reach the consent button — it fails for want of a face,
 * not for want of a working gate. A test that is permanently red teaches people
 * to ignore the suite, which costs more than the coverage is worth.
 *
 * To make this runnable, one of:
 *   - feed Chromium a video file containing a face via
 *     --use-file-for-fake-video-capture (needs a fixture we do not ship), or
 *   - expose a build-time hook that stubs useFaceCheck, which would mean
 *     shipping a bypass for the exact control this gate exists to enforce.
 *
 * Until then this path is verified by hand: a FRESH Video Interview (a resumed
 * one skips pre-flight by design), consent, then framing.
 */
test.skip('video: consent leads to face framing — needs a real face, see the note above', async () => {})
