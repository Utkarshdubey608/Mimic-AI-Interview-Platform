/**
 * Where the cinematic intro may play.
 *
 * Extracted from MimicIntro so the decision can be made *before* the component
 * is imported. The component still applies it, but a check inside the component
 * cannot stop its own chunk — and framer-motion with it — from being fetched.
 *
 * Deliberately dependency-free: it is imported at boot, so anything it touched
 * would land in the entry chunk.
 *
 * ─── Why this is now an allow-list ────────────────────────────────────────────
 *
 * This used to suppress `/mimic*` and let every other route play. That rule
 * went stale the moment the marketing site moved from `/mimic` to the root
 * ("serve the marketing site from the application at the root"): the prefix
 * stopped matching anything, so the film began playing in front of the
 * marketing home for every cold visitor — precisely what the old comment said
 * it existed to prevent. A deny-list of public paths would go stale again the
 * next time a marketing route is added, because marketing is the catch-all
 * route: anything the app does not claim is a public page.
 *
 * So the rule is inverted. The film is tied to the SIGN-IN action rather than
 * to opening the site: it plays when someone chooses to enter the product, and
 * never in front of someone still deciding whether to. Adding a marketing page
 * can no longer switch it back on by accident.
 */

/** The only route the intro plays on. Mounted there in App.tsx. */
export const INTRO_ROUTE = '/login'

/**
 * True when the intro must NOT play for this path.
 *
 * Everything except the login route is suppressed, which also covers the two
 * cases that were called out explicitly before and still matter: `/take/:id`
 * (candidate) and `/interview` (recruiter room) run a real-time WebRTC call,
 * and a WebGL film over the join steals exactly the GPU and CPU the video needs
 * and reads to the user as "lag".
 */
export function introSuppressedForPath(path: string): boolean {
  return path !== INTRO_ROUTE
}
