/**
 * Marketing claim audit.
 *
 * Walks every user-visible string on all 72 marketing pages and flags any that
 * asserts a capability the product does not have. Written after four separate
 * false claims shipped on the site — the most serious being "selection rates
 * reported per rubric dimension", which a buyer could have relied on for NYC
 * Local Law 144 compliance. Mimic holds no demographic data, so that claim was
 * arithmetically impossible.
 *
 * The lesson this encodes: a claim corrected in one place has to be swept for
 * across the whole file. Fixing only where it was first noticed left the same
 * assertion live on four other pages, including in the intro of the very page
 * whose body had just been corrected.
 *
 *   npx tsx scripts/audit-marketing-claims.ts
 *
 * Exits non-zero when a string needs review, so it can gate a release.
 */
import { PAGE_BY_SLUG } from '../src/site/content'

const pages = Object.values(PAGE_BY_SLUG) as Record<string, unknown>[]

/**
 * Prose only. Routing keys, slugs and short labels are not claims — scanning
 * them buries the real findings, which is how the first sweep missed one.
 */
const SKIP_KEYS = new Set(['slug', 'to', 'sectionTo', 'section', 'tier', 'kicker', 'metaTitle', 'label', 'h1', 'h2'])
function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    // No length floor. An early version skipped strings under 40 characters and
    // sailed straight past the bullet "Adverse-impact reporting" — the shortest
    // strings are exactly where the boldest claims hide.
    if (!node.startsWith('/')) out.push(node)
  } else if (Array.isArray(node)) node.forEach((n) => strings(n, out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (!SKIP_KEYS.has(k)) strings(v, out)
  }
  return out
}

/** Claims that are false, or true only with a qualifier. */
const RISKS = [
  { name: 'adverse-impact / selection rates', re: /(selection[ -]?rates?|adverse[ -]?impact|impact ratios?)/i },
  { name: 'demographic data',                 re: /(demographic|protected characteristics?|ethnicit(y|ies)|by group)/i },
  { name: 'certification',                    re: /(SOC ?2|ISO ?270\d\d|ISO ?420\d\d|FedRAMP|HIPAA[- ]compliant|GDPR[- ]ready|WCAG ?2\.2)/i },
  { name: 'residency / availability',         re: /(required region|residency options?|multi[- ]region|high[- ]availability|choose .{0,25}region)/i },
  { name: 'unverified metric',                re: /(\b\d{1,3}\s?%|\b\d[\d,]{2,}\s*(candidates|interviews|hires|customers|applicants))/i },
  { name: 'code execution',                   re: /(run(s|ning)? (the )?code|execute[sd]? code|grade[sd]? code|coding test)/i },
  // The site once advertised ATS connectors and "enterprise plans". Neither
  // exists anywhere in the codebase — no connector, no plan tier.
  // "lever" and "workday" are ordinary English words too, so vendor names are
  // matched case-sensitively — "a useful lever" must not trip the check.
  { name: 'ATS connector',                    re: /(direct connectors?|sync(s|ed)? back|push(es)? (statuses|scores))/i },
  { name: 'ATS vendor name',                  re: /(Greenhouse|Lever|Workday|SmartRecruiters|iCIMS|Bullhorn|Taleo|Ashby)/ },
  { name: 'pricing tier',                     re: /(enterprise plan|paid plan|on (our )?(pro|business|enterprise) tier|upgrade to)/i },
  // The product has SIX interview formats (timed Q&A, conversational chat,
  // voice, video avatar, recorded video, live two-way). Pages drifted to "five"
  // because the nav only surfaces five of them. Any other count is wrong.
  { name: 'wrong format count',               re: /\b(three|four|five|seven|eight)\s+(interview\s+)?(tracks?|formats?|ways to interview)\b/i },
  /**
   * The most dangerous claim on the site. The voice and video pipelines score
   * NAMED EMOTIONS with confidence values (server/routes/avatar.ts) — that is
   * emotion recognition, and EU AI Act Art 5(1)(f) prohibits it for candidates.
   * An earlier version of signal-analysis described it as "delivery
   * characteristics" and said it "does not infer emotional state", and framed
   * consent plus human review as sufficient. All three were false, and a
   * prohibition cannot be cured by consent, notice, review, an audit or a DPIA.
   * See docs/EU_AI_ACT_COMPLIANCE.md.
   */
  { name: 'emotion inference downplayed',     re: /(does not infer emotional|not an emotion[- ]recognition|merely delivery|only delivery characteristics|pace,? pitch and energy)/i },
  { name: 'consent cures prohibition',        re: /(consent (makes|make) it lawful|with consent it is|consented,? so it is (fine|lawful|permitted))/i },
]

/**
 * A hit is fine when the sentence negates, scopes or defers the claim — that is
 * exactly the shape the corrected pages take ("Mimic holds no demographic
 * data…", "…is marked for the team to confirm"). Questions are fine too: a FAQ
 * has to be able to ask "Are you SOC 2 certified?" in order to answer no.
 */
const SCOPED =
  /(cannot|can ?not|does not|do not|did not|no |not |never|holds no|impossible|your own|you supply|the employer|an auditor|a join|marked for|placeholder|to be confirmed|rather than|instead of|we would rather|only attestations|^no\b)/i
const IS_QUESTION = (s: string) => s.trim().endsWith('?')

/**
 * Strings a human has already reviewed and accepted. These are definitions,
 * editorial topics and nav labels — they name a concept rather than claim the
 * product measures it. Keep this list short and justified; if you find yourself
 * adding a capability sentence here, fix the sentence instead.
 */
const REVIEWED: { match: string; why: string }[] = [
  { match: 'Adverse impact describes a selection procedure', why: 'defines the legal concept; the page states plainly that Mimic cannot measure it' },
  { match: 'so a selection rate reflects the criteria', why: 'describes why consistency matters to an analysis performed elsewhere' },
  { match: 'which is what selection-rate and impact-ratio calculations are built from', why: 'describes the input Mimic supplies to an external analysis' },
  { match: 'EEOC adverse impact — each mapped requirement', why: 'nav description naming a compliance page' },
  { match: 'EEOC & adverse impact', why: 'nav label' },
  { match: 'adverse-impact monitoring', why: 'editorial topic for a future guide, not a product capability' },
  { match: 'monitoring adverse impact', why: 'editorial topic for a future guide, not a product capability' },
  { match: 'adverse impact, rubric, adaptive interview', why: 'glossary term list' },
  { match: 'Adverse impact', why: 'glossary entry heading' },
  { match: 'How scoring works, what we deliberately do not collect', why: 'nav description' },
  { match: 'Mimic does not execute or grade code', why: 'explicit negation of a code-execution claim' },
  { match: 'Keep your coding assessment', why: 'tells the reader to retain their own code test' },
  { match: 'to 100%', why: 'weight normalisation arithmetic, not a performance metric' },
  { match: 'a dozen criteria at 8% each', why: 'advice about weighting, not a product metric' },
  { match: 'a dozen at 8% each', why: 'advice about weighting, not a product metric' },
  { match: 'Selection rates', why: 'flow-diagram node naming the output of the external analysis' },
  { match: 'If direct connectors are on the roadmap', why: 'placeholder instructing the team what would be required to claim connectors' },
  { match: 'does not currently ship named connectors', why: 'explicit denial of ATS connectors, naming the systems it does not integrate with' },
  { match: 'Selection rates and impact ratios are computed per stage', why: 'describes what the external auditor does at step 3, not what Mimic does' },
  { match: 'Conducted by an independent auditor, calculating selection rates', why: 'states what NYC LL144 requires of an auditor' },
  { match: 'US employers are expected to monitor selection procedures', why: 'states the employer obligation under EEOC guidance' },
  { match: 'introducing protected characteristics into the scoring pipeline', why: 'explains why the data is deliberately not collected' },
  { match: 'you say you cut deployment time by 25%', why: 'quotes an example candidate CV claim, not a product metric' },
]
const isReviewed = (s: string) => REVIEWED.some((r) => s.includes(r.match))

let flagged = 0
for (const page of pages) {
  const slug = String(page.slug)
  for (const s of strings(page)) {
    if (IS_QUESTION(s) || SCOPED.test(s) || isReviewed(s)) continue
    for (const risk of RISKS) {
      if (risk.re.test(s)) {
        flagged++
        console.log(`\n[${risk.name}]  ${slug}`)
        console.log(`  ${s.slice(0, 180)}${s.length > 180 ? '…' : ''}`)
        break
      }
    }
  }
}

if (flagged) {
  console.log(`\n${flagged} string(s) need review.`)
  console.log('Either scope the claim, or delete it. Do not soften it and leave it asserting.')
  process.exit(1)
}
console.log('No unscoped risk claims found across', pages.length, 'marketing pages.')
