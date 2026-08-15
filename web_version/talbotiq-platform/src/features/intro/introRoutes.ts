/**
 * Where the cinematic intro must not play.
 *
 * Extracted from MimicIntro so the decision can be made *before* the component
 * is imported. The component still applies it, but a check inside the component
 * cannot stop its own chunk — and framer-motion with it — from being fetched.
 * Marketing visitors were paying for a film that was already correctly
 * suppressed for them.
 *
 * Deliberately dependency-free: main.tsx imports this at boot, so anything it
 * touched would land in the entry chunk.
 */

/** Routes where the intro is suppressed, and why. */
export function introSuppressedForPath(path: string): boolean {
  return (
    // NEVER compete with a live interview: /take/:id (candidate) and /interview
    // (recruiter room) run a real-time WebRTC call — a WebGL film playing over
    // the join steals exactly the GPU/CPU the video needs and reads as "lag".
    path.startsWith('/take/') ||
    path.startsWith('/interview') ||
    // /mimic* is the PUBLIC marketing site, where a visitor usually arrives cold
    // from a search result or an ad. A title card in front of the page delays
    // their first look at the offer and spends their patience before we have
    // earned any. The film stays for the signed-in app, where the viewer has
    // already chosen to be here.
    path.startsWith('/mimic')
  )
}
