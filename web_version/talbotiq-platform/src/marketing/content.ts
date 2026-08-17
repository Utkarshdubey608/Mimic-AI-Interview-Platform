/**
 * Mimic marketing site — information architecture + page content.
 *
 * Single source of truth for the nav mega-menu, the footer, the route table and
 * every page's copy + SEO. Templates render from this, so every nav link resolves
 * to a real, populated, indexable page (zero dead ends) and the nav/footer are
 * generated once. Content is written to be honest and specific; anything we cannot
 * truthfully assert (certifications, customers, metrics we don't have) is a
 * [PLACEHOLDER] string, surfaced to the team, never fabricated.
 */

/* Explicit .ts extension, not extensionless.
 *
 * scripts/sweep-marketing.mjs and scripts/prerender-marketing-seo.ts load this
 * file with a bare `await import()` under Node's type-stripping, which does no
 * extension guessing — an extensionless relative import resolves fine in Vite
 * and tsc and then fails both of those gates at runtime. `allowImportingTsExtensions`
 * is on in tsconfig for exactly this. */
import { DEMO_COPY, hasDemo, type DemoTrack } from './demoAssets.ts'

export interface NavLink { label: string; to: string }
export interface NavColumn { title: string; links: NavLink[] }
export interface NavGroup { key: string; label: string; to: string; columns: NavColumn[] }

/* Rich content blocks. `body` + `bullets` remain the simple case; `blocks` is
 * what carries enterprise-depth pages — numbered how-it-works sequences, real
 * settings tables, inline flow diagrams and honest limit/placeholder callouts.
 * Additive: every page written before this still renders unchanged. */
export type Block =
  | { kind: 'p';      text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps';  items: { t: string; d: string }[] }
  | { kind: 'spec';   caption?: string; rows: { k: string; v: string }[] }
  | { kind: 'flow';   steps: string[]; caption?: string }
  | { kind: 'split';  items: { t: string; d: string }[] }
  | { kind: 'note';   tone: 'info' | 'limit' | 'placeholder'; title?: string; text: string }

export interface PageSection { h2: string; body: string; bullets?: string[]; blocks?: Block[] }
export interface FaqItem { q: string; a: string }

/** A recording of the format this page describes, taken from the running
 *  product. Additive: a page without one renders exactly as it did before. */
export interface PageDemo { track: DemoTrack; caption: string; alt: string; disclosure?: string; contentAspect?: string }
export interface MktPage {
  slug: string            // path under /mimic, e.g. "solutions/high-volume-hiring"
  section: string         // "Solutions" | "Trust" | ...
  sectionTo: string       // hub route, e.g. "/solutions"
  tier: 'hub' | 'A' | 'B' | 'C'
  kicker: string
  h1: string
  metaTitle: string       // ~55-60 chars
  metaDesc: string        // ~150-160 chars
  intro: string
  sections: PageSection[]
  demo?: PageDemo         // per-format recording, on the five interview-track pages
  faqs?: FaqItem[]
  cta?: { title: string; sub: string }
  related?: NavLink[]     // cross-links rendered above the closing CTA
}

const DEMO = '/#demo'

/* ─── Nav tree (drives mega-menu + footer + routes) ───────────────────────── */
export const NAV: NavGroup[] = [
  {
    key: 'Platform', label: 'Platform', to: '/platform',
    columns: [
      { title: 'Interview tracks', links: [
        { label: 'Conversational chat', to: '/platform/conversational-chat' },
        { label: 'Voice screening', to: '/platform/voice-screening' },
        { label: 'AI video avatar', to: '/platform/ai-video-avatar' },
        { label: 'Live two-way call', to: '/platform/live-two-way' },
        { label: 'Timed Q&A', to: '/platform/timed-qa' },
      ]},
      { title: 'Workflow', links: [
        { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
        { label: 'Interview templates', to: '/platform/interview-templates' },
        { label: 'Question sets', to: '/platform/question-sets' },
        { label: 'Interview pipelines', to: '/platform/pipelines' },
        { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      ]},
      { title: 'Intelligence', links: [
        { label: 'Candidate reports', to: '/platform/candidate-reports' },
        { label: 'Recruiter analytics', to: '/platform/recruiter-analytics' },
        { label: 'Signal analysis', to: '/platform/signal-analysis' },
        { label: 'Mimic Guide assistant', to: '/platform/mimic-guide' },
      ]},
    ],
  },
  {
    key: 'Solutions', label: 'Solutions', to: '/solutions',
    columns: [
      { title: 'By use case', links: [
        { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
        { label: 'Campus & graduate', to: '/solutions/campus-graduate' },
        { label: 'Technical screening', to: '/solutions/technical-screening' },
        { label: 'Sales & customer facing', to: '/solutions/sales-customer-facing' },
        { label: 'Frontline & hourly', to: '/solutions/frontline-hourly' },
        { label: 'Internal mobility', to: '/solutions/internal-mobility' },
      ]},
      { title: 'By team', links: [
        { label: 'Talent acquisition leaders', to: '/solutions/talent-acquisition-leaders' },
        { label: 'Recruiters', to: '/solutions/recruiters' },
        { label: 'Hiring managers', to: '/solutions/hiring-managers' },
        { label: 'RPO & staffing agencies', to: '/solutions/rpo-staffing' },
        { label: 'People analytics', to: '/solutions/people-analytics' },
      ]},
      { title: 'By industry', links: [
        { label: 'BPO & contact centres', to: '/solutions/bpo-contact-centres' },
        { label: 'IT services', to: '/solutions/it-services' },
        { label: 'Retail & hospitality', to: '/solutions/retail-hospitality' },
        { label: 'Healthcare', to: '/solutions/healthcare' },
        { label: 'Financial services', to: '/solutions/financial-services' },
      ]},
    ],
  },
  {
    key: 'Trust', label: 'Trust', to: '/trust',
    columns: [
      { title: 'Responsible AI', links: [
        { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
        { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
        { label: 'Human in the loop review', to: '/trust/human-in-the-loop' },
        { label: 'Model & data transparency', to: '/trust/model-data-transparency' },
        { label: 'Candidate rights', to: '/trust/candidate-rights' },
      ]},
      { title: 'Compliance', links: [
        { label: 'EU AI Act', to: '/trust/eu-ai-act' },
        { label: 'NYC Local Law 144', to: '/trust/nyc-local-law-144' },
        { label: 'Illinois AI Video Interview Act', to: '/trust/illinois-aivia' },
        { label: 'GDPR & India DPDP', to: '/trust/gdpr-india-dpdp' },
        { label: 'EEOC & adverse impact', to: '/trust/eeoc-adverse-impact' },
      ]},
      { title: 'Security', links: [
        { label: 'Trust Center', to: '/trust/trust-center' },
        { label: 'Certifications', to: '/trust/certifications' },
        { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
        { label: 'Subprocessors', to: '/trust/sub-processors' },
        { label: 'Status page', to: '/trust/status' },
      ]},
    ],
  },
  {
    key: 'Resources', label: 'Resources', to: '/resources',
    columns: [
      { title: 'Learn', links: [
        { label: 'Blog', to: '/resources/blog' },
        { label: 'Guides & playbooks', to: '/resources/guides' },
        { label: 'Webinars', to: '/resources/webinars' },
        { label: 'Interview question library', to: '/resources/question-library' },
        { label: 'Rubric templates', to: '/resources/rubric-templates' },
        { label: 'Glossary', to: '/resources/glossary' },
      ]},
      { title: 'Proof', links: [
        { label: 'Customer stories', to: '/resources/customer-stories' },
        { label: 'ROI calculator', to: '/resources/roi-calculator' },
        { label: 'Benchmark report', to: '/resources/benchmark-report' },
      ]},
      { title: 'Build', links: [
        { label: 'Documentation', to: '/resources/documentation' },
        { label: 'API reference', to: '/resources/api-reference' },
        { label: 'ATS integrations', to: '/resources/ats-integrations' },
        { label: 'Changelog', to: '/resources/changelog' },
        { label: 'Help centre', to: '/resources/help' },
      ]},
    ],
  },
  {
    key: 'Company', label: 'Company', to: '/company',
    columns: [
      { title: 'About', links: [
        { label: 'About TalbotIQ', to: '/company/about' },
        { label: 'Careers', to: '/company/careers' },
        { label: 'Newsroom', to: '/company/newsroom' },
        { label: 'Contact', to: '/company/contact' },
      ]},
      { title: 'Connect', links: [
        { label: 'Partners', to: '/company/partners' },
        { label: 'Become a reseller', to: '/company/reseller' },
        { label: 'Events', to: '/company/events' },
        { label: 'Legal & privacy', to: '/company/legal' },
      ]},
    ],
  },
]

/* ─── Section hubs (real overview pages so every top-level item resolves) ──── */
const HUBS: MktPage[] = [
  {
    slug: 'platform', section: 'Platform', sectionTo: '/platform', tier: 'hub',
    kicker: 'Platform', h1: 'One platform. Every way to interview a candidate.',
    metaTitle: 'Mimic Platform, AI interview tracks & workflow',
    metaDesc: 'Five interview formats, bulk invitations, templates, pipelines and one rubric, plus reports, analytics and the Mimic Guide assistant.',
    intro: 'Mimic interviews candidates five different ways, runs the whole workflow from invite to shortlist, and turns every answer into a score backed by evidence. Explore the pieces.',
    sections: [
      { h2: 'One rubric, five ways to interview', body: 'This is the idea the whole platform rests on. You write down what a good candidate looks like for a role, criteria and weights, and every applicant is measured against exactly that, whether they typed their answers, spoke them, answered on camera, or sat in a live call with one of your interviewers.', blocks: [
        { kind: 'p', text: 'The consequence is that format becomes a logistics decision rather than a scoring one. You can run a text round for volume and a live round for the shortlist, and the two results sit side by side and mean the same thing.' },
      ] },
      { h2: 'How a screen actually runs', body: '', blocks: [
        { kind: 'steps', items: [
          { t: 'Configure once', d: 'A template carries the format, questions, timings, rubric, integrity rules, language and branding. Teams keep one per role type and reuse it.' },
          { t: 'Invite in bulk', d: 'Upload a candidate list, preview the rendered email, run the batch as a dry run, then send. Each link is bound to its recipient\'s email address.' },
          { t: 'Candidates interview unattended', d: 'On their own schedule, in a browser, with drafts saved as they type.' },
          { t: 'Answers are scored with evidence', d: 'Each criterion scored separately, citing the answer it came from, with the full transcript attached.' },
          { t: 'A human decides', d: 'Advance, reject and override are recruiter actions, each written to an audit history per candidate.' },
        ] },
        { kind: 'flow', steps: ['Template', 'Bulk invite', 'Interview', 'Scored + evidenced', 'Human decision'], caption: 'The middle three steps run unattended; the two ends stay yours.' },
      ] },
      { h2: 'What makes it different', body: 'Three things, and they are structural rather than features on a comparison grid.', bullets: ['Comparability across formats, five ways to interview, one rubric, so results are genuinely interchangeable', 'Evidence attached to every number. A score you can trace to the answer that produced it, not a confidence percentage', 'Honest degradation, every dependent feature has a defined behaviour when its key is missing, and the interface says it is running in a reduced mode rather than degrading silently'] },
    ],
    cta: { title: 'See the platform on your roles', sub: 'Book a 30-minute walkthrough, no card required.' },
  },
  {
    slug: 'solutions', section: 'Solutions', sectionTo: '/solutions', tier: 'hub',
    kicker: 'Solutions', h1: 'The right screen for every kind of hire.',
    metaTitle: 'Mimic Solutions, AI screening by use case & team',
    metaDesc: 'See how Mimic screens candidates for high volume, campus, technical and frontline hiring, and what changes for recruiters, hiring managers and RPOs.',
    intro: 'Mimic is one platform, but the job it does looks different depending on who you are hiring and who is doing the hiring. Start with the use case closest to yours.',
    sections: [
      { h2: 'How to choose a format', body: 'The five interview formats are not a quality ladder. They are different trade-offs between depth of signal and how many of your applicants can actually complete the round. Picking well is the single biggest decision here.', blocks: [
        { kind: 'spec', caption: 'Depth against reach', rows: [
          { k: 'Conversational chat', v: 'Widest reach. Finishes on a phone, needs no quiet room or bandwidth. The default for volume.' },
          { k: 'Timed Q&A', v: 'Same reach, plus a fixed clock, for roles where speed of judgement is the skill.' },
          { k: 'Voice', v: 'Adds communication signal. Needs somewhere quiet, so expect lower completion than text.' },
          { k: 'Video avatar', v: 'Richest asynchronous signal, heaviest requirements. Bandwidth and device constraints exclude some applicants.' },
          { k: 'Live two-way', v: 'A human leads. For final and panel rounds, not first screens.' },
        ] },
        { kind: 'note', tone: 'info', title: 'Reach is a fairness decision', text: 'Requiring video does not raise the bar; it filters for candidates with good bandwidth and a private room. Because every format scores against the same rubric, choosing a lighter one costs you nothing in comparability.' },
      ] },
      { h2: 'A common pattern', body: 'Run a light asynchronous format across every applicant, then a richer format, or a live round, for the shortlist that survives. Interview pipelines are built for exactly this, and because one rubric spans all five formats the rounds stack into a single comparable picture rather than three incompatible opinions.' },
      { h2: 'On the industry pages', body: 'They describe how the product is applied in a sector, not a product specific to a sector. Mimic ships six general KPI criteria as a starting point and no industry rubric packs. A rubric for a clinical role or a trading desk is a judgement your team writes down. Where a sector carries its own regulatory obligations, the industry page points at the Trust section rather than implying clearance we do not have.' },
    ],
    cta: { title: 'See Mimic on your roles', sub: 'Book a 30-minute walkthrough on your own open reqs.' },
  },
  {
    slug: 'trust', section: 'Trust', sectionTo: '/trust', tier: 'hub',
    kicker: 'Trust', h1: 'AI hiring your legal team can actually sign off.',
    metaTitle: 'Mimic Trust, responsible AI, compliance & security',
    metaDesc: 'How Mimic scores, how bias is tested, how humans stay in the loop, and how we map to the EU AI Act, NYC Local Law 144, Illinois AIVIA, GDPR and EEOC.',
    intro: 'In AI hiring, the deal blocker is rarely price. It is the security, legal and DEI review. This section answers those questions directly, before they land in your procurement queue.',
    sections: [
      { h2: 'The seven facts that usually decide a review', body: 'If your reviewers read nothing else in this section, these are the ones that matter.', blocks: [
        { kind: 'bullets', items: ['No hiring decision is automated, advance, reject and override are human actions, each written to an audit history per candidate', 'Every score cites the answer it came from, and the full transcript ships with the report', 'One rubric per role, authored by you, applied identically across all five interview formats', 'Candidates are told they are interviewing with AI and consent before starting', 'Mimic holds no demographic data, so it cannot discriminate on it, and equally cannot audit itself for adverse impact', 'Delivery signals on voice and video are reported beside the content score, never folded into it', 'Where a dependency is missing the product degrades visibly and says so'] },
      ] },
      { h2: 'What this section will not do', body: 'It will not tell you that using Mimic makes you compliant. No product can, and a vendor claiming otherwise is telling you something about themselves rather than about the regulation. Each compliance page maps a requirement to the capability that supports it, then states plainly what remains yours, determining what applies, assigning competent people to exercise oversight, issuing notices on your own timeline, and retaining records for the periods your counsel specifies.' },
      { h2: 'The open items, stated up front', body: 'A trust section that only lists strengths is not useful to a reviewer.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'No security certification from a third party or bias audit is published today. Retention periods, deletion request routes and timeframes, subprocessor contracting entities and regions, and model documentation are all still to be confirmed. Mimic runs as a single instance without multi-region replication or failover for high availability, and there are no direct ATS connectors. Each of these is marked on the relevant page rather than left for you to discover.' },
      ] },
    ],
    cta: { title: 'Talk to our security team', sub: 'We will walk your legal and infosec reviewers through the controls.' },
  },
  {
    slug: 'resources', section: 'Resources', sectionTo: '/resources', tier: 'hub',
    kicker: 'Resources', h1: 'Learn how the best teams screen at volume.',
    metaTitle: 'Mimic Resources, guides, docs & customer proof',
    metaDesc: 'Playbooks, an interview question library, rubric templates, docs and an API reference, everything to run structured, fair AI screening well.',
    intro: 'Practical material for the people who run screening day to day, and the developers who wire Mimic into your stack.',
    sections: [
      { h2: 'What is actually here today', body: 'Most of this library is still to be written, and the pages say so rather than showing invented entries.', blocks: [
        { kind: 'split', items: [
          { t: 'Written and useful now', d: 'The glossary of terms that come up in reviews of AI hiring, the ROI calculator, and the guidance about rubrics and question sets on the Platform pages.' },
          { t: 'Structured but empty', d: 'Blog, guides, webinars, customer stories, benchmark report, changelog. Real categories, no filler. An empty shelf rather than one that looks stocked.' },
          { t: 'Best read instead', d: 'The Trust section is the most substantial writing on this site, and the one enterprise reviewers actually need.' },
          { t: 'Not yet published', d: 'No customer stories or benchmark figures exist, because none have been confirmed. When they do, they will carry names and methods.' },
        ] },
      ] },
      { h2: 'On proof', body: 'This site does not publish a statistic, customer name, testimonial or certification unless it is real and cleared. That rule costs us the usual proof section, and it is worth the cost: every figure a vendor shows you should survive the question "who confirmed this, and can I speak to them?" Ours would not yet exist to be asked about, so we do not show any.' },
      { h2: 'For developers', body: 'Documentation, API reference and integration notes are scaffolded rather than complete. The honest summary today: Mimic runs alongside your ATS using exports and imports, with no direct connectors, see ATS integrations for exactly what that means in practice.' },
    ],
    cta: { title: 'Get the screening playbook', sub: 'Book a demo and we will share the material relevant to your team.' },
  },
  {
    slug: 'company', section: 'Company', sectionTo: '/company', tier: 'hub',
    kicker: 'Company', h1: 'Mimic is built by TalbotIQ.',
    metaTitle: 'Company, Mimic by TalbotIQ',
    metaDesc: 'Who builds Mimic, what we believe about fair AI hiring, and how to reach us for partnerships, press, careers and support.',
    intro: 'Mimic is the AI interview product from TalbotIQ. We build screening that measures every candidate the same way and keeps a human on every decision.',
    sections: [
      { h2: 'What Mimic is for', body: 'Mimic conducts the first round of hiring. It invites candidates by email, interviews them asynchronously or live, and scores their answers against a rubric the hiring team defined, returning a ranked shortlist with the evidence attached instead of a queue of applications.', blocks: [
        { kind: 'p', text: 'Success looks like this: the recruiter stops being the bottleneck in the first round, every applicant gets a real structured interview instead of a keyword filter, and every score can be traced back to a specific answer.' },
      ] },
      { h2: 'The principles the product is built on', body: 'These are not marketing lines, each one shows up as a constraint in the software, and several of them cost us features a competitor would happily ship.', blocks: [
        { kind: 'bullets', items: ['Never fabricate proof. No statistic, customer, certification or quotation appears unless it is real and cleared. An empty proof slot is acceptable; an invented one is not', 'A score is a recommendation with its evidence attached. Every number traces to a specific answer, and a human makes every decision that affects a candidate', 'One rubric, applied identically. Comparability across candidates and formats is the core value; anything that breaks it breaks the product', 'Degrade honestly and visibly. When a dependency is missing the product keeps working and says plainly that it is running in a reduced mode', 'The candidate is a user, not a subject. Disclosure is explicit, the experience works on a phone, progress is never lost, and scores are never shown to them'] },
      ] },
      { h2: 'Company details', body: 'Mimic is built by TalbotIQ.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'Company facts that are not derivable from the product (founding date, team size, locations, funding, leadership), are for the team to confirm and add. They are left blank rather than filled with text that sounds plausible, which is the same rule the rest of this site follows.' },
      ] },
    ],
    cta: { title: 'Talk to us', sub: 'Sales, partnerships or press. We will route you to the right person.' },
  },
]

/* ─── Solutions detail pages (Tier A/B) ────────────────────────────────────── */
function solution(slug: string, kicker: string, h1: string, metaTitle: string, metaDesc: string, intro: string, sections: PageSection[], faqs: FaqItem[], related?: NavLink[]): MktPage {
  return { slug: `solutions/${slug}`, section: 'Solutions', sectionTo: '/solutions', tier: 'A', kicker, h1, metaTitle, metaDesc, intro, sections, faqs, related, cta: { title: 'See it on your roles', sub: 'A 30-minute walkthrough on your own open reqs, no card required.' } }
}

/* Outcome framing, used across the Solutions pages. We have no verified
 * customer metrics (see PRODUCT.md → Evidence on Hand), so these pages describe
 * the mechanism that produces an outcome and never assert a number. */
const NO_METRICS_NOTE = { kind: 'note' as const, tone: 'placeholder' as const, title: 'Outcome figures', text: 'We do not publish time to fill, cost per hire or completion figures, because we do not yet have verified customer data to support them. This page describes the mechanism instead. When real figures exist and are cleared, they belong here.' }

const SOLUTION_PAGES: MktPage[] = [
  solution('high-volume-hiring', 'Use case · High volume hiring',
    'Interview 5,000 applicants without adding a single recruiter.',
    'High Volume Hiring Software | Mimic by TalbotIQ',
    'Screen thousands of applicants the day they apply. Mimic interviews and scores every candidate on one rubric so your team reviews a shortlist, not a queue.',
    'When a req draws hundreds of applicants, the first round becomes a staffing problem: someone has to talk to everyone, and nobody has the hours. So resumes get filtered by keyword, good people fall through, and time to fill stretches for weeks.',
    [
      { h2: 'The problem with a queue of phone screens', body: 'Manual first round screening does not scale linearly. It scales with headcount you do not have. Every day a candidate waits is a day a competitor calls them first.', blocks: [
        { kind: 'p', text: 'The usual response is to filter harder on the resume: keyword matching, years of experience cutoffs, school and employer signals. That controls the queue, but it selects for people who write good CVs, which is rarely the thing you are hiring for. Career changers, people with non-linear histories and strong candidates from unfamiliar employers are exactly who these filters remove.' },
        { kind: 'p', text: 'Interviewing everyone is the better answer, and it has been impractical for one reason: a first round conversation costs a recruiter twenty to thirty minutes, plus the scheduling around it.' },
      ] },
      { h2: 'What changes when the first round runs itself', body: 'The constraint on high volume hiring has never been reviewing candidates. It has been talking to them. Remove the scheduling and the recruiter hours from the first round and the whole shape of the funnel changes.', blocks: [
        { kind: 'split', items: [
          { t: 'Everyone gets interviewed', d: 'Not everyone who passed a keyword filter. Every applicant answers the same structured questions on their own schedule.' },
          { t: 'Same day, not same fortnight', d: 'Candidates interview the day they apply, while they are still interested and before a competitor calls.' },
          { t: 'Recruiters review, not screen', d: 'Your team starts at a ranked shortlist with evidence attached instead of a queue of unread applications.' },
          { t: 'The decision stays human', d: 'Volume does not change who decides. Advancing and rejecting remain recruiter actions, each logged.' },
        ] },
      ] },
      { h2: 'How a high volume cycle actually runs', body: '', blocks: [
        { kind: 'steps', items: [
          { t: 'Load the candidate list', d: 'Upload a CSV, Excel export, or even a PDF or DOCX list, up to 10 MB. Mimic parses it, validates each row, and shows you exactly what it found before anything sends.' },
          { t: 'Review and send', d: 'A wizard with five steps: candidates, template, email, review, send. Every invitation is personalised, and a dry run mode lets you check the batch without delivering it.' },
          { t: 'Candidates interview asynchronously', d: 'On their own schedule, on a phone if that is what they have, with no app to install and no slot to book.' },
          { t: 'Everyone is scored on one rubric', d: 'The same criteria and weights for every applicant, with each score citing the answer it came from.' },
          { t: 'Advance in bulk, deliberately', d: 'Set a score threshold or take the top N, see exactly who that captures, and confirm. Nothing moves until you do.' },
        ] },
        { kind: 'flow', steps: ['Upload list', 'Bulk invite', 'Async interviews', 'Scored + ranked', 'Threshold advance', 'Human review'], caption: 'The volume is absorbed between invitation and shortlist, the two ends stay human.' },
      ] },
      { h2: 'Which format to run at volume', body: 'For high volume roles the format choice is mostly a reach decision: the lighter the format, the more of your applicants can actually complete it.', blocks: [
        { kind: 'spec', caption: 'Format fit for volume', rows: [
          { k: 'Conversational chat', v: 'The usual choice. Finishes on a phone in minutes, works on a weak connection, no camera or quiet room required.' },
          { k: 'Timed Q&A', v: 'Where speed under pressure is genuinely part of the role, support triage, dispatch.' },
          { k: 'Voice screening', v: 'Where communication is the job. Needs a quiet space, so expect lower completion than chat.' },
          { k: 'Video avatar', v: 'The heaviest format. Excellent signal, but bandwidth and device constraints will exclude some applicants at the volume end.' },
        ] },
        { kind: 'note', tone: 'info', title: 'A practical pattern', text: 'Run a light async format for round one across everyone, then a richer format, or a live two-way call, for the shortlist that survives. Because all five score against the same rubric, the rounds stack into one comparable picture.' },
      ] },
      { h2: 'Watching the funnel', body: 'Analytics reports interviews created, completion rate, average score and duration, and results broken down by role, template and interview track, plus integrity flags. At volume the completion rate is the number to watch: if it drops for one role, the format or the timings are excluding people, and that is a fixable problem.', blocks: [NO_METRICS_NOTE] },
      { h2: 'What changes for your team', body: 'Recruiters stop being the bottleneck and start working a ranked shortlist with the evidence attached. Hiring managers see the answers behind a score rather than a resume and a recruiter\'s recollection. And because the rubric is written down before anyone is assessed, the standard is explicit, which is worth having whether or not volume was ever the problem.' },
      { h2: 'Where honesty matters at this scale', body: 'Volume amplifies whatever your process does, including its mistakes. Two things are worth stating plainly.', blocks: [
        { kind: 'note', tone: 'limit', text: 'Candidate lists are capped at 10 MB and resumes at 8 MB. Larger intakes are split into batches, which is also the safer way to run a first send, because a dry run on batch one catches a template mistake before it reaches five thousand people.' },
        { kind: 'note', tone: 'info', title: 'Reach is a fairness question', text: 'At volume, the format you choose decides who can participate. A round requiring a quiet room, a good camera and strong bandwidth systematically excludes some applicants. If broad reach matters for the role, a text format is not the cheap option. It is the inclusive one.' },
      ] },
    ],
    [
      { q: 'Does volume slow scoring down?', a: 'No, interviews are scored as they complete, around the clock, so your shortlist keeps filling whether it is 50 applicants or 5,000.' },
      { q: 'What about candidate experience at scale?', a: 'Candidates interview when it suits them and get a consistent, structured experience instead of waiting weeks for a callback. Every applicant gets a real interview rather than a keyword filter, which is a better experience than most high volume processes offer today.' },
      { q: 'Can we upload a list straight from our ATS?', a: 'Yes. A CSV or Excel export works, and Mimic also parses PDF, DOCX and TXT lists. Rows are validated and shown to you before anything sends.' },
      { q: 'Is bulk advancement automated rejection?', a: 'No. You set the threshold or the top-N cut, see exactly which candidates it captures, and confirm. Nothing moves until a person acts, and every action is logged.' },
      { q: 'What if we send to the wrong list?', a: 'Use the dry run mode: it runs the whole batch without delivering, so you can check the recipients and the rendered email first.' },
      { q: 'How do we know the shortlist is any good?', a: 'Every score cites the answer it came from and the full transcript ships with the report. The check is to read the evidence on a few candidates at the top and bottom of the ranking. The working is there precisely so it can be audited.' },
    ],
    [
      { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
      { label: 'Conversational chat', to: '/platform/conversational-chat' },
      { label: 'Interview pipelines', to: '/platform/pipelines' },
      { label: 'Frontline & hourly hiring', to: '/solutions/frontline-hourly' },
    ]),
  solution('campus-graduate', 'Use case · Campus & graduate',
    'Give every graduate applicant a fair first interview.',
    'Campus & Graduate Recruiting Software | Mimic',
    'Interview an entire graduate cohort in days, not months. One rubric and questions that adapt to each resume mean every student gets the same fair shot.',
    'Campus hiring compresses a year of applications into a few frantic weeks. Volume spikes, resumes look identical, and the students you want have three other offers by the time you schedule a call.',
    [
      { h2: 'Why graduate volume breaks manual screening', body: 'Thousands of nearly identical resumes arrive in the same fortnight. Keyword filters cut good people; scheduling cannot keep pace.', blocks: [
        { kind: 'p', text: 'Graduate hiring has a specific problem that other high volume hiring does not: the resumes genuinely do not differentiate. Everyone has the same degree, a similar internship, the same three society positions. So screening falls back on the signals that remain (university name, employer brand, and whoever formatted their CV best), which are precisely the signals most correlated with background rather than potential.' },
        { kind: 'p', text: 'A structured interview is the only thing that actually separates a graduate cohort, and it is the one thing an application window of a fortnight has never had room for.' },
      ] },
      { h2: 'Interviewing a whole cohort', body: 'The entire intake is invited at once and interviews asynchronously, so the constraint becomes your rubric rather than your calendar.', blocks: [
        { kind: 'steps', items: [
          { t: 'Invite the cohort in one batch', d: 'Upload the list from your campus ATS or careers portal export. Every applicant gets a personalised invitation the same day.' },
          { t: 'Each interview reads their own resume', d: 'Questions are written around what that student actually did (the project, the internship, the society role), rather than a generic prompt everyone can rehearse.' },
          { t: 'Everyone answers the same criteria', d: 'One rubric across the cohort, so a student from an unfamiliar university is measured on the same terms as one from a target school.' },
          { t: 'Rank on evidence', d: 'Scores cite the answers behind them, so a shortlist can be defended to a hiring manager or a university partner.' },
        ] },
      ] },
      { h2: 'Why this is the fairest use of the product', body: 'Graduate hiring is where structured screening does the most good, because it is where conventional filters are least defensible.', blocks: [
        { kind: 'split', items: [
          { t: 'Potential over provenance', d: 'A rubric about reasoning and communication does not care which university the candidate attended.' },
          { t: 'Everyone gets a real interview', d: 'Instead of a silent rejection two months later, which is the single most criticised feature of graduate recruitment.' },
          { t: 'Reachable on a phone', d: 'A student without a laptop, a quiet room or good bandwidth is not excluded by a text round.' },
          { t: 'No scheduling against lectures', d: 'They interview at a time that does not cost them a class or a shift.' },
        ] },
        { kind: 'note', tone: 'info', title: 'Choose the format carefully here', text: 'Video rounds carry real bandwidth and privacy costs for students in shared accommodation. For a first cohort round, conversational chat reaches more of your applicants, and every format scores against the same rubric, so nothing is lost in comparability.' },
      ] },
      { h2: 'How Mimic runs a cohort', body: 'Invite the whole cohort at once. Each interview reads the student’s resume and asks about what they actually did, not a generic “tell me about yourself”.', bullets: ['Same day interviews for the whole cohort', 'Questions that adapt to each resume', 'Structured scores career services can defend'] },
      { h2: 'What changes', body: 'You reach strong students before your competitors, and every applicant gets a real, fair interview instead of a silent rejection.' },
    ],
    [{ q: 'Can we share results with a university?', a: 'You can export structured scores backed by evidence, useful for career services partnerships. [PLACEHOLDER: confirm cohort export details]' }]),
  solution('technical-screening', 'Use case · Technical screening',
    'Screen for real skill before an engineer’s calendar gets involved.',
    'Technical Screening Software | Mimic by TalbotIQ',
    'Technical interviews that adapt to the resume and probe depth, not buzzwords, scored on one rubric so your engineers only meet candidates worth their time.',
    'Engineering interview time is your scarcest resource, and most of it is spent on candidates who will not pass. The first technical screen is where that waste starts.',
    [
      { h2: 'The cost of a shallow first screen', body: 'Resumes matched on keywords put unqualified candidates in front of senior engineers, burning the exact hours you are trying to protect.', blocks: [
        { kind: 'p', text: 'Engineering interview time is the scarcest resource in technical hiring, and most of it is spent discovering in the first ten minutes that someone was never a fit. The recruiter screen that was supposed to prevent that usually cannot: a non-specialist asking scripted questions has no way to tell a rehearsed answer from a real one.' },
        { kind: 'p', text: 'The result is a filter that selects for resume fluency and interview practice rather than engineering judgement, and it fails in both directions, wasting engineer hours on weak candidates while screening out strong ones with unfamiliar backgrounds.' },
      ] },
      { h2: 'Screening for reasoning, not recall', body: 'An interview that adapts to the resume asks about the systems the candidate says they built, and follows up when the answer stays at surface level. That is the difference between "do you know Kubernetes" and "you say you cut deployment time by 25%, how did you measure that, and what did you trade away?"', blocks: [
        { kind: 'split', items: [
          { t: 'Questions from their own work', d: 'Generated from the resume, so a candidate is asked about the projects they actually did rather than a generic bank everyone has seen.' },
          { t: 'Follow-ups on thin answers', d: 'A shallow answer gets probed rather than passed over, which is exactly where a scripted recruiter screen gives up.' },
          { t: 'Depth is scored explicitly', d: 'Technical depth and problem solving are rubric criteria you define and weight, not an impression.' },
          { t: 'The same bar for everyone', d: 'One rubric per role, so a candidate is not advantaged by drawing a more forgiving interviewer.' },
        ] },
      ] },
      { h2: 'Where it fits in a technical loop', body: 'This is a replacement for the first round, not a coding assessment and not an onsite. It sits between the application and the engineer\'s calendar.', blocks: [
        { kind: 'flow', steps: ['Application', 'Mimic screen', 'Coding assessment', 'Engineer interview', 'Onsite / panel'], caption: 'The screen protects the two expensive stages on the right.' },
        { kind: 'note', tone: 'limit', text: 'Mimic does not execute or grade code. It conducts a structured technical conversation and scores the reasoning in it. Keep your coding assessment; this replaces the recruiter phone screen in front of it, not the technical bar behind it.' },
      ] },
      { h2: 'Choosing the format for technical roles', body: 'Most teams run conversational chat for depth, because it lets candidates think and write precisely. Timed Q&A suits roles where speed of judgement matters, incident response, on-call triage. A live two-way round is the right shape for the final technical conversation, where Mimic keeps the notes and the rubric consistent while your engineer leads.', blocks: [NO_METRICS_NOTE] },
      { h2: 'How Mimic screens for depth', body: 'Interviews adapt to what the resume claims and follow up when an answer is thin, with a timer per question for skills that need pressure.', bullets: ['Follow-ups that adapt to the resume', 'Timed Q&A for pressure testing', 'Scores per dimension, each citing evidence'] },
      { h2: 'What changes for engineering', body: 'Your engineers meet a short, strong list, and every candidate is measured against the same bar. The downstream effect matters more: when the first round is consistent and evidenced, disagreements in the hiring loop become arguments about the rubric rather than about who remembers the conversation more favourably.' },
    ],
    [{ q: 'Is this a coding test?', a: 'Mimic focuses on structured technical conversation and reasoning; pair it with your existing coding assessment rather than replacing it. [PLACEHOLDER: confirm coding assessment integrations]' }]),
  solution('sales-customer-facing', 'Use case · Sales & customer facing',
    'Hear how a candidate actually sells, before you book the panel.',
    'Sales Hiring & Screening Software | Mimic',
    'Voice and video interviews that surface communication, objection handling and presence, scored consistently so your best closers reach the shortlist.',
    'For sales and customer facing roles, the resume tells you almost nothing that matters. How someone communicates under a little pressure is the job, and you cannot read it off a CV.',
    [
      { h2: 'How Mimic surfaces the signal', body: 'Every candidate takes a spoken round, and the rubric you wrote is applied to all of them identically.', blocks: [
        { kind: 'steps', items: [
          { t: 'Everyone speaks', d: 'A voice round is asynchronous, so hearing every applicant costs no calendar time. The candidates you would never have called are the ones this changes.' },
          { t: 'The answer is transcribed', d: 'What they said becomes text, which is what the rubric is scored against, so a score always traces to words you can read.' },
          { t: 'Delivery is reported separately', d: 'Pace, tonal variation and sentiment appear beside the content score as context for you to weigh. They are not added into it.' },
          { t: 'You listen to the shortlist', d: 'Managers spend their time on candidates who already cleared a consistent bar, with the transcript in front of them.' },
        ] },
        { kind: 'note', tone: 'info', title: 'An important distinction for sales hiring', text: 'It is tempting to want the tool to score charisma. It does not, and it should not: the rubric is scored on the substance of the answer, and delivery signals are presented as separate evidence for a human. Accent and voice quality are never assessed. If communication style matters for the role, you read the signal and the transcript and make that call yourself.' },
      ] },
      { h2: 'What to put in a sales rubric', body: 'The rubric is where sales hiring is actually won or lost, because it forces the team to write down what "good" means before anyone is assessed. Criteria that work well are the ones tied to observable behaviour in the answer, discovery questioning, handling an objection, structuring a value argument, qualifying honestly rather than optimistically.', blocks: [NO_METRICS_NOTE] },
      { h2: 'Why resumes fail sales hiring', body: 'Quota history is noisy and hard to verify; the signal you need is live communication, which manual screening only reaches after weeks of scheduling. A candidate who hit 140% of target may have inherited a strong territory; one who hit 80% may have built one from nothing. The number on the CV does not distinguish them, and the reference call rarely does either.' },
      { h2: 'What changes', body: 'Managers hear real communication early and spend panel time only on candidates who can actually carry a conversation, and the ones who interview badly on paper but well in person are no longer filtered out before anyone hears them.' },
    ],
    [
      { q: 'Can we score for specific competencies?', a: 'Yes, build a rubric around the competencies that matter for the role (discovery, objection handling, clarity) and Mimic scores every candidate against it.' },
      { q: 'Does Mimic score how persuasive someone sounds?', a: 'No. The rubric is scored on the substance of the answer, from the transcript. Delivery signals such as pace and tonal variation are reported separately as context for you to interpret, and accent and voice quality are never assessed.' },
      { q: 'Should we use voice or video for sales roles?', a: 'Voice is usually enough to hear how someone communicates, and it reaches more candidates. Video adds presence at a higher bandwidth and privacy cost, a reasonable choice for a later round rather than a first screen.' },
      { q: 'Can we use this for the final interview too?', a: 'The live two-way format keeps a human leading the conversation while Mimic holds the structure and the notes, scored on the same rubric as the first round.' },
    ],
    [
      { label: 'Voice screening', to: '/platform/voice-screening' },
      { label: 'Signal analysis', to: '/platform/signal-analysis' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Live two-way call', to: '/platform/live-two-way' },
    ]),
  solution('frontline-hourly', 'Use case · Frontline & hourly',
    'Fill frontline roles before the applicant takes another job.',
    'Frontline & Hourly Hiring Software | Mimic',
    'Chat interviews that hourly candidates finish on a phone in minutes, so you screen and shortlist the same day applications arrive.',
    'Frontline hiring is a race. Hourly candidates apply to several employers at once and take the first real offer. A screening process measured in days loses them to one measured in hours.',
    [
      { h2: 'Speed is the whole game', body: 'Every day in the queue is a candidate lost to a faster employer. Manual screening cannot move at frontline speed.', blocks: [
        { kind: 'p', text: 'Frontline applicants are usually applying to several employers in the same week, often from a phone, often between shifts. The employer who responds first wins disproportionately, not because they screened better, but because they screened sooner. A process that takes four days to arrange a phone screen has already lost most of its shortlist.' },
      ] },
      { h2: 'A first round that fits a candidate\'s actual life', body: 'The design constraints here are unforgiving, and they are the reason conventional screening fails at the frontline.', blocks: [
        { kind: 'split', items: [
          { t: 'On a phone, not a laptop', d: 'Runs in a mobile browser with nothing to install. Many frontline applicants have no other device.' },
          { t: 'In minutes, not an hour', d: 'A short question set with a prep and answer window finishes between other commitments.' },
          { t: 'At any hour', d: 'Someone finishing a late shift can interview at 11pm without booking anything.' },
          { t: 'Without a quiet room', d: 'A text round needs no privacy, no headset and no bandwidth, which a voice or video round does.' },
        ] },
        { kind: 'note', tone: 'info', title: 'Why format choice is the whole decision here', text: 'Requiring video for a frontline role does not raise the bar; it filters for candidates with good bandwidth and a private room. Conversational chat reaches far more of your applicants and scores against the same rubric, so nothing is lost in comparability.' },
      ] },
      { h2: 'From application to shortlist the same day', body: '', blocks: [
        { kind: 'flow', steps: ['Applies', 'Invited automatically', 'Interviews on phone', 'Scored', 'Manager contacts'], caption: 'The whole loop closes while the candidate is still interested.' },
        { kind: 'p', text: 'For multi-site hiring, the practical benefit is that location managers stop screening. They open a ranked shortlist with the evidence attached rather than a stack of applications they have no time to read, and the standard is the same across every site, which is difficult to achieve any other way.' },
        NO_METRICS_NOTE,
      ] },
      { h2: 'How Mimic moves the same day an application arrives', body: 'A text interview candidates finish on a phone in minutes, scored instantly so you can reach out while they are still interested.', bullets: ['Built for a phone, no scheduling', 'Finishes in minutes', 'Instant, consistent scoring'] },
      { h2: 'What changes', body: 'You contact strong candidates first, and location managers get a ready shortlist instead of a stack of applications.' },
    ],
    [{ q: 'Do candidates need an app or account?', a: 'No, they open a link and interview in the browser on their phone.' }]),
  solution('internal-mobility', 'Use case · Internal mobility',
    'Give internal candidates the same fair, structured shot.',
    'Internal Mobility & Talent Screening | Mimic',
    'Screen internal applicants against the same rubric as external ones, a defensible, consistent process that helps people grow without favouritism.',
    'Internal mobility often runs on hallway conversations and manager relationships. That is how good internal candidates get overlooked and how bias claims start.',
    [
      { h2: 'The risk of informal internal hiring', body: 'Inconsistent, undocumented internal processes are hard to defend and easy to skew toward whoever is most visible.', blocks: [
        { kind: 'p', text: 'Internal hiring is where structure is weakest and the consequences are most personal. There is usually no formal first round at all: a manager knows someone, or has heard of them, and that reputation carries the decision. The people who lose are the ones doing good work somewhere less visible, on a night shift, in a satellite office, on a team whose manager does not advocate loudly.' },
        { kind: 'p', text: 'When an internal candidate is turned down, they stay. They ask why, and they talk to colleagues about the answer. An undocumented decision is difficult to explain and easy to resent.' },
      ] },
      { h2: 'The same round, applied internally', body: 'Internal applicants take the same structured interview as external ones and are scored on the same rubric, with the evidence recorded.', blocks: [
        { kind: 'split', items: [
          { t: 'Visibility stops deciding', d: 'A rubric about demonstrated capability does not care whose team someone sits on or who mentions their name in meetings.' },
          { t: 'A real answer to "why not me"', d: 'A score for each criterion, with the evidence behind it, gives a manager something specific and developmental to say.' },
          { t: 'Comparable with external candidates', d: 'When a role is open to both, one rubric across all applicants makes the comparison defensible.' },
          { t: 'A record that holds up', d: 'Decisions are attributed and logged, which matters more internally than externally because the person remains an employee.' },
        ] },
        { kind: 'note', tone: 'info', title: 'Use it as development, not just selection', text: 'The most useful output of an internal round is often the feedback conversation it makes possible. A criterion someone scored low on, with the answer attached, is a concrete development target, which is a far better outcome for a declined internal applicant than silence.' },
      ] },
      { h2: 'Handling it with care', body: 'Internal screening has failure modes external screening does not, and they are worth naming.', blocks: [
        { kind: 'bullets', items: ['Tell people the round is structured and why. An internal candidate who feels processed rather than considered is a retention risk', 'Give feedback. Internally, declining without explanation is far more costly than externally', 'Do not use a heavier format than the role warrants; an internal candidate taking a video interview at their desk is an awkward ask', 'Be clear whether the internal round is identical to the external one, and apply whichever answer you give consistently'] },
        NO_METRICS_NOTE,
      ] },
      { h2: 'How Mimic standardises it', body: 'Internal applicants take the same structured interview and are scored on the same rubric, with the evidence recorded.', bullets: ['Same rubric as external candidates', 'Documented, defensible decisions', 'A real shot for quieter high performers'] },
      { h2: 'What changes', body: 'People see a fair path to grow, and HR has a record that stands up to scrutiny.' },
    ],
    [{ q: 'Can managers still weigh in?', a: 'Yes, scores are recommendations with evidence; the hiring manager still decides, now with a consistent baseline.' }]),
]

/* ─── Solutions "by team" + "by industry" (Tier B — real, tighter pages) ───── */
function brief(slug: string, kicker: string, h1: string, metaTitle: string, metaDesc: string, intro: string, sections: PageSection[], faqs?: FaqItem[], related?: NavLink[]): MktPage {
  return { slug: `solutions/${slug}`, section: 'Solutions', sectionTo: '/solutions', tier: 'B', kicker, h1, metaTitle, metaDesc, intro, sections, faqs, related, cta: { title: 'See it on your roles', sub: 'Book a 30-minute walkthrough on your own open reqs.' } }
}
const SOLUTION_BRIEFS: MktPage[] = [
  brief('talent-acquisition-leaders', 'Team · TA leaders', 'Cut time to fill without cutting corners on fairness.', 'For Talent Acquisition Leaders | Mimic', 'Give your TA org capacity and a defensible, consistent screening process, with analytics by role, team and recruiter.', 'You are asked to hire faster, cheaper and more fairly at the same time. Mimic gives your team first round capacity back and gives you the analytics to prove the process is consistent.', [
    { h2: 'The three demands that conflict', body: 'You are asked to hire faster, spend less, and run a process that survives scrutiny, and the usual levers trade one against another. Speed normally comes from filtering harder, which weakens fairness. Consistency normally comes from more process, which costs speed. Structured screening is one of the few changes that moves all three at once, because it removes recruiter hours from the first round rather than removing candidates from it.' },
    { h2: 'What changes at the org level', body: '', blocks: [
      { kind: 'split', items: [
        { t: 'Capacity without headcount', d: 'The first round stops consuming recruiter time, so the team\'s hours move to offers, candidate care and hard to fill roles.' },
        { t: 'One standard across the team', d: 'A rubric per role, applied identically, means a candidate\'s outcome does not depend on which recruiter picked up their application.' },
        { t: 'A process you can defend', d: 'Criteria written in advance, scores citing evidence, decisions attributed and logged. That is a materially better position than interview notes.' },
        { t: 'Visibility into the funnel', d: 'Completion rate, average score and duration, broken down by role, template and interview track.' },
      ] },
    ] },
    { h2: 'What to watch after rollout', body: 'The measures that tell you whether this is working are not the ones usually reported upward.', bullets: ['Completion rate by role. A drop means the format or the timings are excluding people, not that candidates are weak', 'Override frequency, how often recruiters disagree with the recommendation is the sharpest signal that a rubric does not match what the team values', 'Score distribution by template, clustering usually means an inconsistent question set rather than a difference in candidates', 'Which criteria actually separate candidates. A criterion everyone passes is doing no work and should be replaced'] },
    { h2: 'What this does not solve', body: 'Worth being straight about in a business case.', blocks: [
      { kind: 'note', tone: 'limit', text: 'Structured screening improves the first round. It does not fix a weak candidate pipeline, an uncompetitive offer, or a slow decision process downstream. If your bottleneck is hiring manager availability at final stage, this will surface that faster rather than remove it.' },
      NO_METRICS_NOTE,
    ] },
  ],
  [
    { q: 'How do we build the business case without your metrics?', a: 'Model it on your own numbers: recruiter minutes per first round screen, screens per week, and the share of applicants who currently never get one. We do not publish benchmark figures because we do not have verified customer data to support them.' },
    { q: 'Does this replace recruiters?', a: 'It replaces the scheduling and the first round call. Every decision that affects a candidate remains a recruiter action, and the judgement work (calibrating the rubric, reading evidence, handling offers), grows in importance.' },
    { q: 'How do we keep quality consistent across a large team?', a: 'The rubric is defined per role rather than per recruiter, and applied identically across all five interview formats. Override rates then tell you where calibration is drifting.' },
  ],
  [
    { label: 'Recruiter analytics', to: '/platform/recruiter-analytics' },
    { label: 'For recruiters', to: '/solutions/recruiters' },
    { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
    { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
  ]),
  brief('recruiters', 'Team · Recruiters', 'Stop phone screening. Start working a shortlist.', 'For Recruiters | Mimic by TalbotIQ', 'Mimic runs your first round so you spend your day on the candidates most worth your time, with evidence for every score.', 'The first round is the least strategic part of your week and the biggest time sink. Mimic takes it off your plate and hands you a ranked shortlist backed by evidence.', [
    { h2: 'The part of the week you would not miss', body: 'First round screening is the least strategic thing on a recruiter\'s calendar and the biggest consumer of it. Twenty minutes a call, plus the scheduling, the no-shows and the rescheduling, and at the end of it a set of notes nobody else can compare. It is work that has to happen and work that almost nobody wants.' },
    { h2: 'What your day looks like instead', body: '', blocks: [
      { kind: 'split', items: [
        { t: 'No calendar tetris', d: 'Candidates interview on their own schedule. No booking, no chasing, no rearranging around a no-show.' },
        { t: 'You start at a shortlist', d: 'Ranked, with the evidence attached, instead of a queue of applications you have not read.' },
        { t: 'You can defend your shortlist', d: 'Every score cites the answer behind it, so "why this candidate" has a specific answer for a hiring manager.' },
        { t: 'More time where you add value', d: 'Candidate care, offer conversations, hard to fill roles. The parts of recruiting that actually need a person.' },
      ] },
    ] },
    { h2: 'What you still own', body: 'The judgement, and all of it. Advancing, rejecting, overriding and moving a candidate back are your actions, each logged with your name. Bulk tools exist (advance everyone above a score, or the top N), but you set the bar, see exactly who it captures, and confirm. Nothing moves on its own.' },
    { h2: 'Getting a good result out of it', body: 'A few habits separate teams who get value from this from teams who do not.', bullets: ['Read the evidence on a few candidates at the top and bottom of the ranking before trusting a new rubric', 'Treat a criterion everyone passes as a criterion doing no work, replace it', 'Watch the completion rate; if it is low the format or the timings are the problem, not the candidates', 'Use the lightest format the role justifies. It reaches more of your applicants', 'When you override the recommendation, that is signal worth feeding back into the rubric'] },
  ],
  [
    { q: 'Do I lose the feel for candidates I get on a phone screen?', a: 'You get the transcript of a structured conversation instead of your recollection of an unstructured one, and you get it for every applicant rather than the fraction you had time to call. For candidates who reach a later round, the live two-way format keeps a real conversation with a person leading it.' },
    { q: 'What if I disagree with a score?', a: 'Override it. That is a first-class action, it is logged, and a pattern of overrides is useful evidence that the rubric needs changing.' },
    { q: 'How much setup is this?', a: 'Templates and question sets are configured once and reused. The work sits up front, in defining the rubric, which is the part that pays back.' },
  ],
  [
    { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
    { label: 'Candidate reports', to: '/platform/candidate-reports' },
    { label: 'Interview pipelines', to: '/platform/pipelines' },
    { label: 'For hiring managers', to: '/solutions/hiring-managers' },
  ]),
  brief('hiring-managers', 'Team · Hiring managers', 'Meet a short list of people actually worth your time.', 'For Hiring Managers | Mimic', 'See scores backed by evidence, not just resumes, so your interview time goes to candidates who can do the job.', 'You do not have time to interview a long list, and a resume does not tell you who can do the work. Mimic gives you a short list with the evidence behind each score.', [
    { h2: 'Your time is the scarce resource', body: 'A hiring manager\'s interview hours are the most expensive input in the process, and most of them are spent discovering in the first ten minutes that someone was never a fit. The recruiter screen exists to prevent that, but a non-specialist working from a script has limited ability to tell a rehearsed answer from a real one.' },
    { h2: 'What lands on your desk', body: '', blocks: [
      { kind: 'split', items: [
        { t: 'A ranked shortlist', d: 'Not a stack of resumes, candidates ordered by performance against criteria you agreed.' },
        { t: 'The answers, not a summary', d: 'The full transcript, with each score citing the specific answer it came from.' },
        { t: 'A consistent bar', d: 'Every candidate assessed against the same rubric, so the comparison between two people is real.' },
        { t: 'Detail for each criterion', d: 'You can see that a candidate was strong on problem solving and weak on communication, rather than a single number.' },
      ] },
    ] },
    { h2: 'The part that needs you', body: 'The rubric is where a hiring manager makes the difference, and delegating it is the most common way this goes wrong. Recruiters can run the process, but only you can say what "good" looks like for the role, which criteria matter, and how much each one weighs. Fifteen minutes spent on that at the start is worth more than any number of interviews afterwards.', blocks: [
      { kind: 'note', tone: 'info', title: 'A useful calibration habit', text: 'Before trusting a new rubric, read the evidence on two candidates it ranked highly and two it ranked low. If you disagree, the rubric is wrong and it is quick to fix. That check takes ten minutes and is the single most valuable thing a hiring manager can do here.' },
    ] },
    { h2: 'You still decide', body: 'A score is a recommendation with its working attached, never a decision. Advancing and rejecting are human actions, logged with the name of whoever took them, and you can disagree with any recommendation and record that you did.', blocks: [NO_METRICS_NOTE] },
  ],
  [
    { q: 'How do I know the shortlist is right?', a: 'Read the evidence behind two candidates ranked high and two ranked low. The transcript and the citations for each criterion exist precisely so the ranking can be checked rather than trusted.' },
    { q: 'Can I interview candidates myself as well?', a: 'Yes. The live two-way format runs a real conversation you lead, with Mimic keeping the structure, notes and rubric consistent so a final round compares with earlier ones.' },
    { q: 'What if the rubric is wrong for my role?', a: 'Change it. It is yours, and a pattern of overrides is the clearest signal that it needs changing.' },
  ],
  [
    { label: 'Candidate reports', to: '/platform/candidate-reports' },
    { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
    { label: 'Live two-way call', to: '/platform/live-two-way' },
    { label: 'Technical screening', to: '/solutions/technical-screening' },
  ]),
  brief('rpo-staffing', 'Team · RPO & staffing', 'Screen more roles per recruiter, across every client.', 'RPO & Staffing Agency Screening | Mimic', 'Run structured, branded screening at agency scale, more submittals per recruiter, consistent quality across every client account.', 'Your margin is recruiter time. Manual first rounds cap how many roles each recruiter can carry and make quality uneven across clients.', [
    { h2: 'Your margin is recruiter time', body: 'In agency and RPO work the economics are direct: throughput per recruiter is the business. First round screening is the largest fixed cost in that equation and the least differentiated part of the service, no client ever chose an agency because its phone screens were good.' },
    { h2: 'What changes commercially', body: '', blocks: [
      { kind: 'split', items: [
        { t: 'More roles per recruiter', d: 'The first round stops scaling with headcount, so a recruiter can carry more requisitions without the quality falling off.' },
        { t: 'Consistent quality across accounts', d: 'A rubric per role rather than per recruiter means a submittal means the same thing on every account.' },
        { t: 'Submittals backed by evidence', d: 'You send a client a score with the answers behind it, not a summary in your own words that they have to take on trust.' },
        { t: 'Faster to first submittal', d: 'Candidates interview the day they are sourced rather than waiting for a slot in your consultant\'s calendar.' },
      ] },
    ] },
    { h2: 'Configuration per client', body: 'Templates carry their own branding (company name, logo and accent colour on candidate screens and emails), so a candidate\'s experience can carry your client\'s identity rather than yours. Question sets and rubrics are per template too, so each client account gets its own standard while the process underneath stays the same.', blocks: [
      { kind: 'note', tone: 'placeholder', text: 'Multi-client operational details matter for agencies and should be confirmed by the team before this page is published: how workspaces separate client data, whether client stakeholders can be given direct access to their own reports, and how billing works across accounts.' },
    ] },
    { h2: 'Where to be careful', body: 'Agencies run more processes across more clients than anyone, which makes consistency both the opportunity and the risk.', bullets: ['Rubrics that are specific to a client only work if someone owns them, assign that explicitly rather than copying a generic one', 'A format that suits one client\'s candidate population may exclude another\'s; choose per account, not per agency', 'Where a client has their own compliance obligations, the Trust pages are written to be handed to their reviewers directly'], blocks: [NO_METRICS_NOTE] },
  ],
  [
    { q: 'Can each client have their own branding?', a: 'Yes, company name, logo and accent colour are set per template and appear on candidate screens and emails.' },
    { q: 'Can we give a client access to their own results?', a: 'The operational detail of client access is marked for the team to confirm rather than assumed here.' },
    { q: 'How do we keep quality consistent across consultants?', a: 'The rubric belongs to the role, not the consultant, and applies identically across all five interview formats. Override rates then show where calibration is drifting.' },
  ],
  [
    { label: 'Interview templates', to: '/platform/interview-templates' },
    { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
    { label: 'Trust Center', to: '/trust/trust-center' },
    { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
  ]),
  brief('people-analytics', 'Team · People analytics', 'Screening data you can actually analyse.', 'People Analytics for Hiring | Mimic', 'Every candidate scored on one rubric with the evidence recorded, structured hiring data by role, template, track and recruiter.', 'Most screening produces no usable data, just notes in inboxes. Mimic produces structured, comparable scores you can analyse and defend.', [
    { h2: 'Why screening data is usually unusable', body: 'The first round is where hiring data goes to die. Phone screen outcomes exist as free-text notes, a recruiter\'s recollection and an advance/reject flag, no consistent criteria, no scores, nothing comparable across recruiters or roles. Any analysis built on it is really an analysis of how people take notes.' },
    { h2: 'What structured screening produces', body: 'Because every candidate is scored against the same authored rubric, the first round starts generating data with a schema.', blocks: [
      { kind: 'spec', caption: 'Available for analysis', rows: [
        { k: 'Scores per criterion', v: 'Per candidate, per criterion, not just an overall number, so you can see which criterion drives an outcome.' },
        { k: 'Weighted totals', v: 'Reproducible arithmetic over the criterion scores using the weights you set.' },
        { k: 'Evidence', v: 'The answer or transcript span behind each criterion score, plus the full transcript.' },
        { k: 'Funnel measures', v: 'Interviews created, completion rate, average score, average duration and time per question.' },
        { k: 'Breakdowns', v: 'By role, template and interview track.' },
        { k: 'Decision history', v: 'Per candidate: who advanced, rejected, overrode or moved back, and when.' },
        { k: 'Integrity flags', v: 'Recorded per session and reported in aggregate.' },
      ] },
    ] },
    { h2: 'What Mimic cannot give you', body: 'This is the constraint that shapes any analysis you plan, so it is better stated up front than discovered later.', blocks: [
      { kind: 'note', tone: 'limit', text: 'Mimic holds no demographic data. It does not collect or infer protected characteristics, so it cannot produce selection rates by group and cannot report adverse impact. Breakdowns are by role, template and interview track only. Analysis by group is a join you perform in your own environment, against the demographic data candidates have voluntarily disclosed in your ATS or HRIS.' },
      { kind: 'p', text: 'That is the conventional and safer arrangement, demographic data stays out of the scoring pipeline entirely, but it does mean the adverse impact analysis lives in your warehouse, not in this product.' },
    ] },
    { h2: 'Questions this data can actually answer', body: 'Worth being concrete about, because the useful ones are not always the obvious ones.', bullets: ['Which rubric criterion separates candidates most, and which one everyone passes, and therefore is not doing any work', 'Where completion rate drops, by role and by interview format, which usually indicates the format is excluding people rather than the candidates being weak', 'How often recruiters override the recommendation, which is a direct measure of whether the rubric matches what the team actually values', 'Whether score distributions differ by template, which often reveals an inconsistent question set rather than a difference in candidates', 'How long candidates spend per question, which exposes timings that are too tight'] },
    { h2: 'Getting it out', body: 'Reports export as PDF for individual candidates, and pipeline data can be exported for a role.', blocks: [
      { kind: 'note', tone: 'placeholder', text: 'The team should confirm and document the supported export and integration routes for analytics use, file formats, the API surface available for programmatic extraction, and whether a scheduled export exists. A people analytics buyer will ask this in the first call.' },
    ] },
  ],
  [
    { q: 'Can Mimic report adverse impact?', a: 'No. It holds no demographic data, so selection rates by group cannot be computed inside the product. It supplies the outcome data per candidate; the join and the analysis happen in your environment.' },
    { q: 'What breakdowns are available?', a: 'By role, template and interview track, alongside completion rate, average score and duration measures.' },
    { q: 'Is the scoring reproducible?', a: 'Yes. The weighted total is arithmetic over criterion scores using weights you set, and each criterion cites its evidence. You can recompute a total by hand.' },
    { q: 'How do we get the data out?', a: 'Individual reports export as PDF and pipeline data can be exported per role. The full set of programmatic export routes is marked for the team to confirm.' },
  ],
  [
    { label: 'Recruiter analytics', to: '/platform/recruiter-analytics' },
    { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
    { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
    { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
  ]),
  brief('bpo-contact-centres', 'Industry · BPO & contact centres', 'Screen contact centre agents at the speed you lose them.', 'BPO & Contact Centre Hiring | Mimic', 'Mobile screening that puts voice first for contact centre roles with high attrition, assess communication and score consistently, same day.', 'Contact centre hiring is high volume and high attrition: you are always hiring, and speed plus communication signal are everything.', [
    { h2: 'Constant volume, constant attrition', body: 'Contact centre hiring never stops. Attrition runs high enough that recruitment is a permanent operation rather than a periodic project, and the roles are filled from a candidate pool applying to several employers in the same week. Speed to first contact decides a large share of who you actually get.' },
    { h2: 'The signal that matters is communication', body: 'For an agent role, how someone speaks and handles a conversation is close to the whole job, and it is the one thing a CV cannot show. A voice round lets every applicant demonstrate it, scored the same way, without a recruiter having to call each one.', blocks: [
      { kind: 'note', tone: 'info', title: 'What is and is not scored', text: 'The rubric is scored on the substance of the answer, from the transcript. Pace and tonal variation are reported separately as context for a human. Accent and voice quality are never assessed, which matters in a sector that hires across many languages and regions.' },
    ] },
    { h2: 'Running it at BPO scale', body: '', blocks: [
      { kind: 'split', items: [
        { t: 'Same day, mobile first', d: 'Candidates interview on a phone within hours of applying, before a competitor calls.' },
        { t: 'One bar across sites', d: 'The same rubric whether you are hiring in one city or five, which is difficult to achieve with distributed recruiters.' },
        { t: 'Templates per client', d: 'Branding, question sets and rubrics are set per template, so each client account can carry its own standard.' },
        { t: 'Continuous rather than campaign', d: 'A permanently open pipeline absorbs constant req volume without constant recruiter hours.' },
      ] },
      NO_METRICS_NOTE,
    ] },
  ],
  [
    { q: 'Voice or text for agent roles?', a: 'Voice, if communication is the job. That is the signal you are hiring for. Text reaches more candidates, so some teams run text first at volume and voice for the shortlist. Both score against the same rubric.' },
    { q: 'Can we screen in multiple languages?', a: 'Interview language is configured per template.' },
    { q: 'Does it assess accent?', a: 'No. Accent and voice quality are not assessed. Scoring runs against the transcript, what the candidate said.' },
  ],
  [
    { label: 'Voice screening', to: '/platform/voice-screening' },
    { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
    { label: 'Signal analysis', to: '/platform/signal-analysis' },
    { label: 'RPO & staffing', to: '/solutions/rpo-staffing' },
  ]),
  brief('it-services', 'Industry · IT services', 'Technical screening for bench readiness, at project speed.', 'IT Services Hiring & Screening | Mimic', 'Technical interviews that adapt to each resume, so you staff projects fast without burning senior engineers on unqualified first rounds.', 'IT services hiring is bursty and tied to specific skills, you need qualified people bench ready when a project lands, without wasting senior engineers on screening.', [
    { h2: 'Hiring against a project clock', body: 'IT services and consulting hire to a signed statement of work, which makes the deadline external and immovable. A bench that is short by three engineers in four weeks is a commercial problem, not a recruiting one, and the usual response, lowering the technical bar under time pressure, is the expensive kind of mistake.' },
    { h2: 'Depth without the engineer time', body: 'The scarce resource is senior engineer interview hours, and most of them are spent discovering that a candidate was never a fit. A first round that adapts to the resume asks about the systems a candidate says they built and follows up when the answer stays shallow.', blocks: [
      { kind: 'split', items: [
        { t: 'Questions from their own work', d: 'Generated from the resume, so candidates are asked about their actual projects rather than a bank everyone has seen.' },
        { t: 'Follow-ups on thin answers', d: 'Where a scripted recruiter screen accepts a vague answer, the interview probes it.' },
        { t: 'Scales with demand', d: 'A bench ramp does not require proportionally more recruiter or engineer hours.' },
        { t: 'A consistent bar per skill', d: 'One rubric per role, so the standard does not soften as the deadline approaches.' },
      ] },
      { kind: 'note', tone: 'limit', text: 'Mimic does not execute or grade code. It runs a structured technical conversation and scores the reasoning in it. Keep your coding assessment. This replaces the recruiter screen in front of it.' },
      NO_METRICS_NOTE,
    ] },
    { h2: 'Bench and redeployment', body: 'The same structured round is useful internally. When consultants roll off and need matching to a new engagement, an internal round scored on the same rubric gives a comparable read on current capability rather than relying on whichever account manager advocates loudest.' },
  ],
  [
    { q: 'Can we screen for specific technologies?', a: 'Build the rubric criteria around the capabilities the engagement needs, or maintain fixed question sets per skill. Questions that adapt to the resume then probe what each candidate actually claims.' },
    { q: 'Does this replace our technical interview?', a: 'No. It replaces the recruiter phone screen in front of it, so your engineers meet a shorter, stronger list.' },
    { q: 'Can we use it for internal redeployment?', a: 'Yes. An internal round on the same rubric gives a comparable read on current capability. See Internal mobility for how to run that fairly.' },
  ],
  [
    { label: 'Technical screening', to: '/solutions/technical-screening' },
    { label: 'Question sets', to: '/platform/question-sets' },
    { label: 'Internal mobility', to: '/solutions/internal-mobility' },
    { label: 'RPO & staffing', to: '/solutions/rpo-staffing' },
  ]),
  brief('retail-hospitality', 'Industry · Retail & hospitality', 'Staff every location before the season peaks.', 'Retail & Hospitality Hiring | Mimic', 'Screening that puts mobile first and finishes the same day, for seasonal and frontline retail and hospitality roles across every location.', 'Retail and hospitality hiring spikes with the season and spans many locations. Speed and a consistent bar across sites are what you need.', [
    { h2: 'Seasonal peaks and permanent churn', body: 'Retail and hospitality hiring is spiky in a way most sectors are not: a seasonal ramp can require more hires in six weeks than the rest of the year combined, and it lands on store and venue managers who already have a full job. Screening quality collapses precisely when volume is highest.' },
    { h2: 'Taking screening off the manager', body: '', blocks: [
      { kind: 'split', items: [
        { t: 'Managers stop screening', d: 'They open a ranked shortlist with evidence rather than a stack of applications between shifts.' },
        { t: 'One bar across every location', d: 'The same rubric in every store or venue, hard to achieve when each site screens its own candidates.' },
        { t: 'Same day response', d: 'In a market where applicants take the first offer, hours matter more than any other factor.' },
        { t: 'Absorbs the peak', d: 'A seasonal spike does not require seasonal recruiters to screen it.' },
      ] },
      { kind: 'note', tone: 'info', title: 'Format choice decides reach', text: 'This candidate population is mobile first, and often applying between shifts. A text round finishes on a phone in minutes with no quiet room and no bandwidth requirement, which reaches far more of your applicants than a video round would.' },
      NO_METRICS_NOTE,
    ] },
    { h2: 'Multi-site consistency', body: 'The quiet benefit is standardisation. When every location screens its own candidates, the bar drifts. A strong candidate in one store would have been rejected in another. A rubric defined once and applied identically removes that variance, and the evidence behind each score means a district manager can see why a shortlist looks the way it does.' },
  ],
  [
    { q: 'Can each location have its own criteria?', a: 'Rubrics and question sets live on templates, so you can standardise across the estate or vary by format and role, whichever suits your operation.' },
    { q: 'Will seasonal candidates complete it?', a: 'That depends on how heavy a format you choose. A short text round on a phone has the widest reach; watch the completion rate by role, which tells you directly whether the format is excluding people.' },
    { q: 'Do store managers need training?', a: 'They review a ranked shortlist with evidence attached. The configuration work (templates, rubrics, question sets), is done centrally once and reused.' },
  ],
  [
    { label: 'Frontline & hourly hiring', to: '/solutions/frontline-hourly' },
    { label: 'Conversational chat', to: '/platform/conversational-chat' },
    { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
    { label: 'For hiring managers', to: '/solutions/hiring-managers' },
  ]),
  brief('healthcare', 'Industry · Healthcare', 'Screen clinical staff against a defensible rubric.', 'Healthcare Hiring & Screening | Mimic', 'Structured screening for clinical and support roles, consistent, backed by evidence, and built for hiring around shifts under high demand.', 'Healthcare hiring is high stakes and heavily scrutinised: you need a consistent, defensible process that still moves fast enough to fill shifts.', [
    { h2: 'Hiring around shifts', body: 'Clinical and care staff are the hardest population to schedule a screen with: they work rotating shifts, they are frequently applying while employed elsewhere, and the roles are usually urgent. A first round that requires a daytime phone call excludes exactly the candidates who are already working.' },
    { h2: 'What changes', body: '', blocks: [
      { kind: 'split', items: [
        { t: 'Interviews at any hour', d: 'A candidate coming off a night shift can complete the round at 7am without booking anything.' },
        { t: 'On a phone', d: 'No laptop, no app, no quiet consulting room required for a text round.' },
        { t: 'A consistent, documented bar', d: 'The same criteria applied to every applicant, with the evidence retained, which matters when a hiring decision is later questioned.' },
        { t: 'Volume without extra recruiters', d: 'Ward and site openings arrive in bursts; the first round absorbs them.' },
      ] },
    ] },
    { h2: 'Building a rubric for clinical roles', body: 'Mimic ships six general purpose KPI criteria as a starting point. It does not ship clinical rubrics, and it would be wrong to pretend otherwise. A rubric for a paediatric nurse is a clinical judgement your team makes, not a template a vendor supplies. What the product gives you is somewhere to write that judgement down, weight it, and apply it identically.', blocks: [
      { kind: 'note', tone: 'limit', text: 'Mimic is a structured interview and scoring tool. It does not verify registration, licensure, right to work or clinical competence, and it must not be used as a substitute for the pre-employment checks your regulator requires. It replaces the first round conversation, not your compliance process.' },
      NO_METRICS_NOTE,
    ] },
  ],
  [
    { q: 'Does Mimic check registration or licensure?', a: 'No. It conducts and scores a structured interview. Registration, licensure, right to work and any other pre-employment verification remain your process.' },
    { q: 'Do you provide clinical rubrics?', a: 'No. Six general KPI criteria ship as a starting point; the clinical criteria for a role are a judgement your team writes down. The product gives that judgement somewhere to live and applies it consistently.' },
    { q: 'Which format suits clinical hiring?', a: 'Text formats reach the most candidates and need no quiet room, which suits shift workers. Voice adds communication signal for roles that involve direct contact with patients, at the cost of needing somewhere quiet to speak.' },
  ],
  [
    { label: 'Frontline & hourly hiring', to: '/solutions/frontline-hourly' },
    { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
    { label: 'Trust Center', to: '/trust/trust-center' },
    { label: 'Conversational chat', to: '/platform/conversational-chat' },
  ]),
  brief('financial-services', 'Industry · Financial services', 'Screen at scale with an audit trail regulators accept.', 'Financial Services Hiring | Mimic', 'Consistent screening backed by evidence, with the audit trail and controls that compliance teams in financial services expect.', 'Financial services hiring runs under real regulatory and audit scrutiny. Every screening decision needs to be consistent, evidenced and defensible.', [
    { h2: 'Why structure matters more here', body: 'Financial services hiring runs under more scrutiny than most: regulated roles, documented processes, and internal audit functions that expect a decision to be evidenced rather than remembered. An unstructured first round screen is the weakest link in that chain. It produces the least evidence about the largest number of candidates.' },
    { h2: 'What Mimic contributes', body: '', blocks: [
      { kind: 'split', items: [
        { t: 'One documented rubric', d: 'Criteria written before candidates are assessed, applied identically, and retained.' },
        { t: 'Evidence behind every score', d: 'Each criterion cites the answer it came from, with the full transcript attached.' },
        { t: 'Attributed decisions', d: 'A history held per candidate, of who advanced, rejected or overrode, and when.' },
        { t: 'Consistency across volume', d: 'The same standard whether a req draws twenty applicants or two thousand.' },
      ] },
    ] },
    { h2: 'What this page does not claim', body: 'Being exact here matters more in this sector than in any other.', blocks: [
      { kind: 'note', tone: 'limit', text: 'Mimic holds no demographic data and cannot report adverse impact or selection rates by group. That analysis is a join performed in your own environment against data you hold. Mimic also holds no financial services accreditation, and nothing here should be read as regulatory approval for any hiring process. Your compliance function determines what applies to you; the Trust section is written to be handed to them directly.' },
      NO_METRICS_NOTE,
    ] },
  ],
  [
    { q: 'Can Mimic report adverse impact for our regulatory reporting?', a: 'No. It holds no demographic data. It supplies outcomes per candidate against a consistent rubric; the analysis by group happens in your own reporting environment.' },
    { q: 'What can we give internal audit?', a: 'The rubric, scores for each criterion with cited evidence, the full transcripts, and the attributed decision history for each candidate.' },
    { q: 'Do you hold financial services accreditations?', a: 'No. See Certifications, which lists only attestations actually held, currently none, rather than implying any.' },
  ],
  [
    { label: 'Trust Center', to: '/trust/trust-center' },
    { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
    { label: 'EEOC & adverse impact', to: '/trust/eeoc-adverse-impact' },
    { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
  ]),
]

/* ─── Trust pages ──────────────────────────────────────────────────────────
 * Legal is the deal-blocker in AI hiring, so these describe capabilities and
 * controls FACTUALLY and never assert an attestation, certification or legal
 * compliance we cannot prove — those are [PLACEHOLDER] for the team to confirm.
 * Compliance pages explain how Mimic supports a regulation; they are not legal
 * advice. */
function trust(slug: string, tier: 'A' | 'B', kicker: string, h1: string, metaTitle: string, metaDesc: string, intro: string, sections: PageSection[], faqs?: FaqItem[], related?: NavLink[]): MktPage {
  return { slug: `trust/${slug}`, section: 'Trust', sectionTo: '/trust', tier, kicker, h1, metaTitle, metaDesc, intro, sections, faqs, related, cta: { title: 'Talk to our security team', sub: 'We will walk your legal and infosec reviewers through the controls.' } }
}
const TRUST_PAGES: MktPage[] = [
  trust('how-mimic-scores', 'A', 'Responsible AI · Scoring', 'See exactly how every score is reached.',
    'How Mimic Scores Candidates | Responsible AI',
    'A Mimic score is a recommendation with the evidence attached, measured against the rubric you set, dimension by dimension. Here is precisely how it works.',
    'A score you cannot explain is a score your legal team will not accept. Mimic is built so every number traces back to a specific answer and a rubric you defined.',
    [
      { h2: 'A score is a recommendation, not a verdict', body: 'This is the single most important thing to understand about Mimic, and it is structural rather than a policy we could quietly change. Mimic produces a scored recommendation with its evidence attached. Advancing, rejecting and overriding are recruiter actions. Nothing is rejected automatically, and no candidate is removed from a process by a model.', blocks: [
        { kind: 'p', text: 'Every one of those human actions is written to an audit history per candidate, what was decided, and by whom. When a regulator or a candidate asks who made the decision, the answer is a named person, and the record shows it.' },
      ] },
      { h2: 'The five steps between an answer and a number', body: '', blocks: [
        { kind: 'steps', items: [
          { t: 'You define the rubric', d: 'A set of criteria and their weights. Mimic ships six default KPI criteria as a starting point; you can edit them, add your own, or replace them entirely. Weights normalise to 100%, so the arithmetic is always explicit.' },
          { t: 'The candidate answers', d: 'In whichever of the five formats you chose. The format changes how the answer is captured (typed, spoken, on video), not how it is judged.' },
          { t: 'Answers are scored per criterion', d: 'Each criterion is scored separately against what the candidate actually said. There is no single opaque model verdict; there is a set of criterion scores you can inspect one at a time.' },
          { t: 'Criteria are weighted into a total', d: 'The weighted total is simple arithmetic over the criterion scores, using the weights you set. You can reproduce it by hand.' },
          { t: 'A recommendation is attached, and a human decides', d: 'The result is presented as a recommendation with its evidence. A recruiter reads it and makes the call.' },
        ] },
        { kind: 'flow', steps: ['Your rubric', 'Candidate answer', 'Score per criterion', 'Weighted total', 'Recommendation', 'Human decision'], caption: 'Every arrow is inspectable. The last one is always a person.' },
      ] },
      { h2: 'You set the rubric', body: 'The criteria are yours, not ours. This matters more than it sounds: it means the definition of a good candidate for your role is written down, by you, before anyone is assessed against it, which is the thing structured hiring guidance has asked for long before AI was involved.', blocks: [
        { kind: 'spec', caption: 'What you control', rows: [
          { k: 'Criteria', v: 'Six defaults provided; edit, extend or replace them entirely.' },
          { k: 'Weights', v: 'Set per criterion; normalised to 100% so the total is always explicit.' },
          { k: 'Scope', v: 'One rubric per role, applied identically to every candidate for that role.' },
          { k: 'Across formats', v: 'The same rubric applies whether the round was chat, voice, video avatar, timed Q&A or a live call.' },
        ] },
      ] },
      { h2: 'Every criterion cites its evidence', body: 'A score you cannot check is a score you should not use. Each criterion points back to the specific answer or transcript span it was derived from, so a reviewer reads the reasoning rather than trusting the number. The full transcript ships with the report.', blocks: [
        { kind: 'note', tone: 'info', title: 'Why this matters for review', text: 'When counsel or a candidate challenges an outcome, the useful artefact is not a confidence percentage. It is the answer that produced the judgement, next to the criterion it was judged against. That is what the report contains.' },
      ] },
      { h2: 'What Mimic does not do', body: 'Being specific about the boundaries is more useful than a responsible AI slogan.', bullets: ['It does not make hiring decisions. It recommends, and a person decides', 'It does not automatically reject candidates', 'It does not score accent or voice quality; delivery signals are reported as context beside the content score, never folded into it', 'It does not show candidates their scores, another candidate\'s data, or upcoming questions', 'It does not treat integrity flags as disqualifications. They are surfaced for a human to weigh'], blocks: [
        { kind: 'note', tone: 'placeholder', text: 'The exact published policy on model inputs and protected characteristics is for the team to confirm and state here before this page goes live. It should be a precise, checkable statement rather than a reassurance.' },
      ] },
      { h2: 'When scoring degrades, it says so', body: 'Mimic runs without an AI provider key, but it does not pretend the results are the same. In that mode, scoring falls back to a heuristic based on length, and the interface labels that result as approximate wherever it appears.', blocks: [
        { kind: 'note', tone: 'info', title: 'A deliberate design principle', text: 'Every dependent feature in Mimic has a defined behaviour when its dependency is missing, and each one announces the reduced mode rather than degrading silently. A quiet fallback that looks like a real score is worse than no score at all.' },
      ] },
    ],
    [
      { q: 'Can a recruiter override a score?', a: 'Yes. Scores are recommendations. Recruiters advance, reject or override, and every action is written to an audit history per candidate.' },
      { q: 'Is the rubric the same for every candidate?', a: 'Yes, for a given role, one rubric is applied identically. That is what makes scores comparable, and what makes the process defensible when it is questioned.' },
      { q: 'Can I reproduce a total myself?', a: 'Yes. The total is the weighted sum of the criterion scores using the weights you set, and the weights normalise to 100%. There is no hidden term.' },
      { q: 'Do different interview formats score differently?', a: 'No. The format changes how an answer is captured, not how it is judged. A voice round and a chat round for the same role are scored against the same rubric.' },
      { q: 'What evidence does a candidate report contain?', a: 'The scores for each criterion, the weighted total, the recommendation, the evidence each criterion was drawn from, and the full transcript. It can be exported as a PDF.' },
      { q: 'Does an integrity flag lower a score?', a: 'No. Integrity signals are reported separately for a human to interpret. There are innocent explanations for most of them.' },
    ],
    [
      { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Candidate reports', to: '/platform/candidate-reports' },
    ]),
  trust('bias-testing-audits', 'A', 'Responsible AI · Bias', 'Bias testing you can read, not take on faith.',
    'Bias Testing & Audits | Mimic Responsible AI',
    'Adverse impact testing reported per rubric dimension, not summarised, so your DEI and legal teams can see the evidence, not a marketing claim.',
    '“Responsible AI” is on every vendor’s site. What your review actually needs is a straight answer about what this tool can and cannot measure, and who has to do the rest.',
    [
      { h2: 'Start with what Mimic does not hold', body: 'Mimic collects no demographic data about candidates. It does not ask for race, sex, age or any other protected characteristic, and it does not infer them. That is a deliberate design choice with a real trade-off attached, and you should understand both halves of it.', blocks: [
        { kind: 'split', items: [
          { t: 'What it buys you', d: 'The scoring process cannot discriminate on characteristics it never receives. There is no protected attribute in the pipeline to leak into a score.' },
          { t: 'What it costs you', d: 'Mimic cannot compute adverse impact on its own. Selection rates by group require group data, and we do not have it.' },
        ] },
        { kind: 'note', tone: 'info', title: 'Why we say this first', text: 'Some vendors imply their tool audits itself for bias. If a tool holds no demographic data, that claim cannot be true. We would rather be plainly useful about how an audit actually gets done.' },
      ] },
      { h2: 'How an adverse impact analysis actually runs', body: 'The analysis is a join between two datasets that live in different places, and the employer is the only party who holds both.', blocks: [
        { kind: 'steps', items: [
          { t: 'Mimic supplies the outcomes', d: 'Per candidate, per stage: the rubric applied, the criterion scores, the recommendation, and the human decision that followed, with the audit history of who decided what.' },
          { t: 'You supply the categories', d: 'Demographic data from your own systems, typically the EEO categories candidates volunteer in your ATS or HRIS, kept separate from the hiring process itself.' },
          { t: 'An analyst or auditor joins them', d: 'Selection rates and impact ratios are computed per stage across the categories in scope, including intersections where required.' },
          { t: 'You act on what it shows', d: 'A disparity is a signal to examine the rubric, the question set and the stage where it appears, not a number to file away.' },
        ] },
        { kind: 'flow', steps: ['Mimic outcomes', 'Your category data', 'Join', 'Selection rates', 'Review the rubric'], caption: 'Mimic supplies one side of the join, and never sees the other.' },
      ] },
      { h2: 'What makes the analysis worth running', body: 'An audit of an inconsistent process measures noise. The value of a structured tool is that it makes the thing being audited well-defined in the first place.', blocks: [
        { kind: 'bullets', items: ['One rubric per role, applied identically to every candidate, so a selection rate reflects the criteria rather than which recruiter someone drew', 'Scores for each criterion, so a disparity can be traced to a specific criterion instead of an overall average', 'Evidence attached to every score, so a flagged criterion can be read and understood', 'An audit history per candidate, so the human decisions are visible alongside the recommendations', 'The same rubric across all five formats, so format choice is not a hidden variable'] },
      ] },
      { h2: 'Independent review', body: 'Where the law requires an independent audit, NYC Local Law 144 is the clearest example, the audit is conducted on your deployment, by an auditor you engage.', blocks: [
        { kind: 'note', tone: 'placeholder', title: 'No published audit today', text: 'Mimic does not currently publish a completed bias audit by a third party. The team should confirm here whether one is planned, its intended scope and cadence, and whether results will be published. Until then this page states the position rather than implying a review that has not happened.' },
      ] },
      { h2: 'What you can monitor inside Mimic', body: 'Analytics reports the funnel itself, interviews created, completion rate, average score and duration, results by track, template and role, and integrity flags. These are measures of process health, and they are genuinely useful: a completion rate that collapses for one role, or scores that cluster oddly on one template, is worth investigating.', blocks: [
        { kind: 'note', tone: 'limit', text: 'These breakdowns are by role, template and interview track, not by demographic group, because Mimic holds no demographic data. Monitoring by group happens in your own reporting, joined to the outcome data Mimic provides.' },
      ] },
    ],
    [
      { q: 'Does Mimic test itself for bias?', a: 'It cannot, and neither can any tool that holds no demographic data. Mimic collects none. What it provides is a consistently applied rubric and outcome data for each candidate that your analyst or auditor joins to the category data you hold.' },
      { q: 'Do you publish audit results?', a: 'Not today. Mimic does not currently publish a completed bias audit by a third party. Whether one is planned, and its scope, is marked for the team to confirm rather than implied.' },
      { q: 'Why not just collect demographic data so the tool can audit itself?', a: 'Because introducing protected characteristics into the scoring pipeline creates the exact risk the audit exists to detect. Keeping that data in a separate system, gathered voluntarily and used only for aggregate monitoring, is the conventional and safer arrangement.' },
      { q: 'What do we actually hand an auditor?', a: 'The rubric, the criterion scores and outcomes for each candidate at each stage, the evidence behind each score, and the audit history of human decisions. You supply the category data from your own systems.' },
      { q: 'Can Mimic show us selection rates by group?', a: 'No. Its breakdowns are by role, template and interview track. Analysis by group is done in your reporting environment where the demographic data lives.' },
    ],
    [
      { label: 'NYC Local Law 144', to: '/trust/nyc-local-law-144' },
      { label: 'EEOC & adverse impact', to: '/trust/eeoc-adverse-impact' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Recruiter analytics', to: '/platform/recruiter-analytics' },
    ]),
  trust('human-in-the-loop', 'A', 'Responsible AI · Oversight', 'A human makes every hiring decision.',
    'Human in the loop Review | Mimic',
    'Mimic recommends; people decide. Advancing, rejecting and overriding are recruiter actions, and every one is logged for a complete audit trail.',
    'Automated hiring decisions are exactly what regulators and candidates fear. Mimic is designed so the machine never makes the call.',
    [
      { h2: 'Mimic recommends, people decide', body: 'Every outcome that affects a candidate is a human action, taken with the evidence in front of the person taking it. This is not a configuration you could switch off. There is no code path in Mimic that removes a candidate from a process without a person doing it.', blocks: [
        { kind: 'p', text: 'The distinction that matters to a regulator is between a tool that informs a decision and a tool that makes one. Mimic is built as the first: it produces a scored recommendation with its working attached, and then waits.' },
      ] },
      { h2: 'Where the human actually acts', body: 'Oversight is only meaningful if it happens at the points that change a candidate\'s outcome. In Mimic those points are explicit actions in the interface.', blocks: [
        { kind: 'spec', caption: 'Decisions that are always human', rows: [
          { k: 'Advance', v: 'Moving a candidate to the next round, individually, or in bulk above a score threshold or top-N cut that a recruiter sets and confirms.' },
          { k: 'Reject', v: 'Moving a candidate to Not advancing. Never automatic, never triggered by a score.' },
          { k: 'Override', v: 'Disagreeing with the recommendation and recording a different outcome.' },
          { k: 'Move back', v: 'Returning a candidate to an earlier round when a decision was premature.' },
        ] },
        { kind: 'note', tone: 'info', title: 'On bulk advancement', text: 'Quick advance tools exist, advance everyone above a score, or the top N. These are still human decisions: a recruiter chooses the threshold, sees exactly who it captures, and confirms. Nothing moves until they do.' },
      ] },
      { h2: 'Every action is logged', body: 'Each decision is written to an audit history per candidate: what was done, to whom, when, and by which named person.', blocks: [
        { kind: 'bullets', items: ['Advance, reject, override and move back are all recorded', 'Attributed to a specific user, not to "the system"', 'Held per candidate, so a single person\'s journey can be reconstructed end to end', 'Available when a decision is questioned by counsel, an auditor or the candidate'] },
        { kind: 'flow', steps: ['Scored recommendation', 'Recruiter reviews evidence', 'Human action', 'Written to audit history'], caption: 'The third step cannot be skipped.' },
      ] },
      { h2: 'Why this matters beyond compliance', body: 'Meaningful human oversight is an explicit requirement under emerging AI hiring law, and building it in is the point rather than a feature. But it also produces a better process: a recruiter who has to look at the evidence before advancing someone catches the cases where the model was confidently wrong. A strong candidate who answered tersely, or a weak one who wrote fluently.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'If your organisation has a documented review policy (how many recommendations are checked, by whom, and how disagreements are recorded), reference it here. A named internal process is far more persuasive in a review than a vendor claim.' },
      ] },
    ],
    [
      { q: 'Does Mimic ever reject a candidate on its own?', a: 'No. Rejection is always a human action, and it is logged with the name of the person who took it.' },
      { q: 'Isn\'t bulk advancement effectively automated?', a: 'No. A recruiter sets the threshold, sees exactly which candidates it captures, and confirms before anything moves. The judgement, where the bar sits, is theirs.' },
      { q: 'Can a recruiter disagree with the recommendation?', a: 'Yes, and the override is recorded as such. A recommendation that is frequently overridden is useful signal that the rubric needs revisiting.' },
      { q: 'What does the audit history actually contain?', a: 'The action taken, the candidate it affected, when it happened, and which user did it, held per candidate so one person\'s progression can be reconstructed in full.' },
      { q: 'Who is accountable for a hiring decision made with Mimic?', a: 'Your organisation. Mimic supplies structured evidence and a recommendation; the decision, and the accountability for it, stay with the people making it.' },
    ],
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'EU AI Act', to: '/trust/eu-ai-act' },
      { label: 'Interview pipelines', to: '/platform/pipelines' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
    ]),
  trust('model-data-transparency', 'B', 'Responsible AI · Transparency', 'Know what the model sees, and what it doesn’t.',
    'Model & Data Transparency | Mimic', 'What goes into a Mimic score, what is deliberately excluded, and where to find the model documentation your review team needs.',
    'Transparency is not a slogan; it is a list of inputs your reviewers can check.',
    [
      { h2: 'What goes in', body: 'A Mimic score is produced from a small, checkable set of inputs. Being able to enumerate them is the whole point of the page.', blocks: [
        { kind: 'spec', caption: 'Inputs to scoring', rows: [
          { k: 'The candidate\'s answers', v: 'What they typed or said, as captured in the transcript.' },
          { k: 'The rubric', v: 'The criteria and weights you authored for the role.' },
          { k: 'The question asked', v: 'So an answer is judged against what was actually put to the candidate.' },
          { k: 'The resume', v: 'Where the template adapts to the resume, to write questions and follow-ups. Text is truncated at 20,000 characters.' },
        ] },
      ] },
      { h2: 'What is deliberately kept out', body: 'Mimic does not ask for protected characteristics and does not collect demographic data, a fact in the codebase, not a policy statement. It follows that they are not inputs to scoring, because they are not present at all.', blocks: [
        { kind: 'bullets', items: ['Mimic collects no demographic data and does not infer protected characteristics', 'Delivery signals (prosody, sentiment, facial expression), are reported beside the score, never folded into it', 'Integrity flags are reported for a human to weigh, not applied as a scoring penalty', 'Candidates are not scored against each other; the rubric is absolute, not a ranking curve'] },
        { kind: 'note', tone: 'info', title: 'The consequence, stated honestly', text: 'Holding no demographic data means the pipeline cannot discriminate on it, and equally that Mimic cannot measure adverse impact by itself. Both halves are true and the second is on the Bias testing page.' },
      ] },
      { h2: 'How to verify rather than trust', body: 'Every score in a report cites the answer or transcript span it came from, and the weighted total is plain arithmetic over the criterion scores using weights you set. You can reproduce a total by hand. That is a stronger guarantee than a statement about model behaviour, because it does not require you to believe us.' },
      { h2: 'Model documentation', body: '', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'The team must confirm and publish: which model versions are used for question generation, scoring and live voice; whether customer data is used for training by the provider and how that is contractually excluded; the retention applied by the model provider; and a link to system documentation sufficient for a review of technical documentation under the EU AI Act.' },
      ] },
    ],
    [
      { q: 'Is candidate data used to train models?', a: 'That depends on the provider contract and is marked for the team to confirm and state precisely. It is one of the first questions a reviewer asks, and it deserves an exact answer rather than a reassuring one.' },
      { q: 'Does the model see the candidate\'s name or resume?', a: 'The name is stored and used by the interviewer, and the resume is used where the template generates questions from it. Both are inputs the candidate provided knowingly, and both are relevant to the role.' },
      { q: 'Can we see what the model was given for a specific candidate?', a: 'The report contains the questions asked, the full transcript, and the criterion scores with their cited evidence. The material a review of a specific outcome needs.' },
      { q: 'What happens without an AI provider?', a: 'Scoring falls back to a heuristic based on length, and the interface labels the result as approximate wherever it appears rather than presenting it as a real assessment.' },
    ],
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
      { label: 'Signal analysis', to: '/platform/signal-analysis' },
      { label: 'Subprocessors', to: '/trust/sub-processors' },
    ]),
  trust('candidate-rights', 'B', 'Responsible AI · Candidates', 'Candidates know they’re interviewing with AI.',
    'Candidate Rights & AI Disclosure | Mimic', 'Clear disclosure, consent, accommodation and rights of access to data for every candidate Mimic interviews, the basics fair AI hiring requires.',
    'Candidate trust is part of your employer brand. Mimic makes disclosure and rights explicit, not buried.',
    [
      { h2: 'The candidate is a user, not a subject', body: 'This is one of the product principles Mimic is built on, and it has concrete consequences in the interface rather than being a statement of intent. A candidate being screened by software is the person with the least power and the most at stake in the process; the product is designed on that basis.' },
      { h2: 'Disclosure and consent', body: 'Candidates are told they are interviewing with AI before it begins, not in a linked policy they will not read.', blocks: [
        { kind: 'bullets', items: ['A readiness step requires an explicit tick that they understand the rules before any question is asked', 'Video and avatar rounds add a separate consent confirming responses are recorded, analysed by AI, and reviewed by a human recruiter', 'Camera and microphone permissions are requested explicitly, with a clear recovery path if they are blocked', 'Consent is an action the candidate takes, not a pre-ticked default'] },
      ] },
      { h2: 'What candidates are never shown', body: 'Restraint here is a deliberate protection, not an omission.', blocks: [
        { kind: 'split', items: [
          { t: 'Their scores', d: 'Candidates never see rubric scores, totals or recommendations. A score is an internal recommendation for a recruiter, not feedback.' },
          { t: 'Other candidates', d: 'No candidate can see another candidate\'s interview, results or existence.' },
          { t: 'Upcoming questions', d: 'Questions are revealed in sequence, so nobody gains an advantage by reading ahead.' },
          { t: 'A closed answer', d: 'Once submitted, a question closes, and the interface says so before they continue, so it is never a surprise.' },
        ] },
      ] },
      { h2: 'Practical fairness', body: 'The commitments that matter most to candidates are usually mundane ones.', blocks: [
        { kind: 'bullets', items: ['Interviews run in a mobile browser with nothing to install, no candidate is excluded for lacking a laptop', 'Drafts save as they type, so a dropped connection does not cost an answer', 'Interviews are taken on the candidate\'s own schedule, not in a slot that costs them a shift', 'The invite link is bound to their email address, so nobody else can take their interview', 'Integrity flags are surfaced to a human to interpret, never treated as automatic disqualification'] },
        { kind: 'note', tone: 'info', title: 'Why the link is bound to an email', text: 'It protects the candidate as much as the employer: it is what stops an interview invitation being forwarded and completed by someone else in their name.' },
      ] },
      { h2: 'Accommodation, access and deletion', body: 'These are the rights candidates most often need to exercise, and the honest position is that the process is yours to define and run.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'The team must confirm and publish here: how a candidate requests an accommodation and who handles it; how a candidate requests access to or deletion of their data; the timeframe committed to; and the contact route for each. These are the questions candidates and regulators ask first, and an unanswered placeholder is better than an invented promise.' },
        { kind: 'p', text: 'Where an accommodation means changing format (a candidate who cannot use video, for instance), every format scores against the same rubric, so an accommodation does not produce a result that cannot be compared with everyone else\'s.' },
      ] },
    ],
    [
      { q: 'Do candidates know they are being interviewed by AI?', a: 'Yes. They are told before the interview starts and must confirm they understand. Video rounds add a separate, explicit consent to recording and analysis.' },
      { q: 'Do candidates see their scores?', a: 'No. Scores are recommendations for a recruiter, with evidence attached. They are not shown to candidates and are not feedback.' },
      { q: 'What if a candidate cannot take the interview in the format offered?', a: 'Run it in another format. All five score against the same rubric, so an accommodation still produces a comparable result.' },
      { q: 'Can a candidate ask for their data to be deleted?', a: 'Deletion controls exist in the product. The request route and committed timeframe are marked for the team to confirm before publication rather than stated speculatively.' },
      { q: 'Does a flag for switching tabs disqualify a candidate?', a: 'No. Integrity signals are recorded for a human to weigh. There are innocent explanations for most of them, and Mimic never rejects automatically.' },
    ],
    [
      { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
      { label: 'Illinois AIVIA', to: '/trust/illinois-aivia' },
      { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
    ]),
  trust('eu-ai-act', 'B', 'Compliance · EU AI Act', 'Built for the EU AI Act’s high-risk requirements.',
    'Mimic & the EU AI Act | Compliance', 'How Mimic supports EU AI Act obligations for hiring systems, transparency, human oversight, logging and documentation. Not legal advice.',
    'The EU AI Act classifies hiring AI as high risk, which brings transparency, oversight, logging and documentation duties. Mimic is built to support them.',
    [
      { h2: 'Start here: one feature is prohibited, not merely high risk', body: 'Most of this page is about the high-risk regime, where obligations can be met and the system stays lawful. One part of the product is not in that category at all.', blocks: [
        { kind: 'note', tone: 'limit', title: 'Emotion inference is prohibited for EU candidates', text: 'Mimic\'s voice rounds and video avatar rounds score named emotions from a candidate\'s voice and face. Art 5(1)(f) prohibits inferring emotions in a workplace context, and the Commission\'s adopted Guidelines (para 254) say expressly that using emotion recognition during recruitment is prohibited, candidates are within "workplace" for this purpose. This has applied since 2 February 2025 and was not delayed by the 2026 Digital Omnibus, which touched only the high-risk timeline.' },
        { kind: 'bullets', items: ['A prohibition cannot be cured by consent, candidate notice, human review, a bias audit or a DPIA, none of these is a defence under Art 5', 'The two regimes stack: recruitment being high risk under Annex III does not make emotion recognition permissible', 'The compliant responses are removing the feature, or applying a hard geofence that keeps it away from EU candidates', 'Text formats, conversational chat and timed Q&A, produce no audio, video or emotion inference at all, and score against the same rubric'] },
        { kind: 'note', tone: 'placeholder', text: 'Whether Mimic removes these pipelines or geofences them is an open product decision, see docs/EU_AI_ACT_COMPLIANCE.md and Signal analysis. Until it is resolved, do not enable voice rounds or video avatar rounds for EU candidates.' },
      ] },
      { h2: 'Why the rest of it is high risk', body: 'Setting the prohibition aside, the EU AI Act classifies AI used for recruitment and candidate selection as high risk. That classification is not about how sophisticated the system is. It is about the consequences for the person on the other side of it. Being high risk brings duties around transparency, human oversight, record keeping, data governance and technical documentation.', blocks: [
        { kind: 'note', tone: 'info', title: 'Two different roles', text: 'The Act distinguishes providers of a system from deployers of it. Mimic is the product; your organisation deploys it in your own hiring process. Some obligations sit with each, and the split below reflects that.' },
      ] },
      { h2: 'Requirement by requirement', body: 'What the Act asks of a high-risk hiring system, and the specific Mimic capability that supports it.', blocks: [
        { kind: 'spec', caption: 'Obligation → supporting capability', rows: [
          { k: 'Transparency to candidates', v: 'Candidates are told they are interviewing with AI and consent before starting. Video rounds add explicit consent to recording and AI analysis.' },
          { k: 'Meaningful human oversight', v: 'Advance, reject and override are human actions. No candidate is removed from a process automatically.' },
          { k: 'Record keeping', v: 'An audit history per candidate, recording each action, when it happened and who took it.' },
          { k: 'Traceability of outputs', v: 'Every criterion score cites the answer or transcript span it was derived from; the full transcript ships with the report.' },
          { k: 'Consistency of application', v: 'One rubric per role, applied identically to every candidate and across all five interview formats.' },
          { k: 'Technical documentation', v: '[PLACEHOLDER: the team must confirm what model and system documentation is published, and link it here.]' },
        ] },
      ] },
      { h2: 'What stays yours', body: 'A vendor cannot make you compliant, and any that claims to should be treated with suspicion. Mimic supplies the mechanisms; the obligations that depend on how you actually run hiring remain with you.', bullets: ['Determining whether and how the Act applies to your organisation', 'Registering and documenting your use of the system where required', 'Assigning competent people to exercise the human oversight the product enables', 'Informing candidates in line with your own jurisdictional requirements', 'Retaining records for the periods your counsel specifies'] },
      { h2: 'Not legal advice', body: 'This page describes product capabilities and how they map to obligations as we understand them. It is not legal advice, and it is not a certification of compliance. Your own counsel determines what applies to you.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'This mapping should be reviewed by counsel before publication, and dated. A compliance page that is not attributed and not dated ages badly, and reviewers notice.' },
      ] },
    ],
    [
      { q: 'Does using Mimic make us EU AI Act compliant?', a: 'No, and no product can. Mimic provides disclosure, human oversight, traceable scoring and audit records, which are mechanisms the Act asks for. Whether your deployment is compliant depends on how you use them, and that determination is yours and your counsel\'s. Note in particular that enabling voice rounds or video avatar rounds for EU candidates engages a prohibited practice, which no amount of process cures.' },
      { q: 'Which parts of Mimic can we use for EU candidates?', a: 'Conversational chat and timed Q&A produce no audio, video or emotion inference, so they sit outside the Art 5 prohibition entirely, while scoring against the same rubric as every other format. Live two-way calls involve a human interviewer; whether any analysis applied to them engages the prohibition is a question for your counsel.' },
      { q: 'Is Mimic a high-risk AI system?', a: 'AI used for recruitment and candidate selection falls into the Act\'s high-risk category. We have built the product on that assumption rather than arguing our way out of it.' },
      { q: 'What can we show an auditor?', a: 'The rubric that was applied, the scores for each criterion with the evidence each was drawn from, the full transcript, and the audit history showing who decided what and when.' },
      { q: 'Do candidates know they are interviewing with AI?', a: 'Yes. Disclosure and consent happen before the interview begins, not in a terms link.' },
    ],
    [
      { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
      { label: 'Model & data transparency', to: '/trust/model-data-transparency' },
    ]),
  trust('nyc-local-law-144', 'B', 'Compliance · NYC LL144', 'Ready for NYC Local Law 144 bias audits.',
    'Mimic & NYC Local Law 144 | Compliance', 'How Mimic supports NYC Local Law 144: the data behind an annual bias audit and the candidate notice the law requires. Not legal advice.',
    'NYC Local Law 144 requires an annual independent bias audit of automated employment decision tools and advance notice to candidates.',
    [
      { h2: 'What the law requires', body: 'Local Law 144 governs automated employment decision tools used to screen candidates for jobs in New York City. It sets three obligations on the employer using the tool.', blocks: [
        { kind: 'steps', items: [
          { t: 'An annual independent bias audit', d: 'Conducted by an independent auditor, calculating selection rates and impact ratios across sex and race/ethnicity categories, and their intersections.' },
          { t: 'A published summary of results', d: 'Made publicly available, together with the distribution date of the tool.' },
          { t: 'Advance notice to candidates', d: 'Candidates resident in NYC must be notified before the tool is used, along with the job qualifications and characteristics it assesses.' },
        ] },
        { kind: 'note', tone: 'info', title: 'The obligation is the employer\'s', text: 'The law places these duties on the employer or employment agency using the tool, not on the vendor supplying it. What a vendor can do is make the audit practical and the notice accurate.' },
      ] },
      { h2: 'How Mimic supports each one', body: '', blocks: [
        { kind: 'spec', caption: 'Requirement → supporting capability', rows: [
          { k: 'Data for the audit', v: 'Outcomes for each candidate at each stage, against a defined rubric. Mimic holds no demographic data, so an auditor joins these outcomes to the category data you hold separately, see Bias testing & audits for how that works.' },
          { k: 'A defined, consistent tool', v: 'One rubric per role, applied identically to every candidate, which is what makes an audit meaningful rather than an average over inconsistent processes.' },
          { k: 'Candidate notice', v: 'Disclosure that the interview is conducted with AI is built into the candidate flow before the interview begins.' },
          { k: 'Qualifications assessed', v: 'The rubric criteria are explicit and authored by you, so the characteristics being assessed can be stated accurately in your notice.' },
          { k: 'Audit trail', v: 'A history held per candidate, of who advanced or rejected whom, and when.' },
        ] },
      ] },
      { h2: 'What we do not claim', body: 'Being precise here protects you more than a reassuring sentence would.', blocks: [
        { kind: 'note', tone: 'placeholder', title: 'No audit has been published', text: 'Mimic does not currently publish a completed independent bias audit or summary of results. Commissioning the audit for your deployment, publishing the summary, and issuing the candidate notice within the statutory timeframe remain your responsibility. The team should confirm here whether an audit is planned, and by when.' },
        { kind: 'bullets', items: ['We do not certify your compliance with LL144', 'We do not act as the independent auditor', 'We do not issue the candidate notice on your behalf, we supply the disclosure inside the product', 'The requirement to give 10 business days of notice is a process you run, not a product setting'] },
      ] },
      { h2: 'Not legal advice', body: 'This page describes product capabilities and how they relate to the law as we understand it. It is not legal advice and does not establish compliance. Your own counsel determines what applies to you.' },
    ],
    [
      { q: 'Has Mimic been through a bias audit?', a: 'Not one that we publish today. The obligation under LL144 sits with the employer deploying the tool, and the audit is conducted on your deployment. Mimic supplies the outcome data an auditor needs.' },
      { q: 'What data can we give an auditor?', a: 'Outcomes for each candidate against a defined rubric at each stage, which is what calculations of selection rates and impact ratios are built from.' },
      { q: 'Does Mimic send the candidate notice?', a: 'Mimic discloses in the product that the interview is conducted with AI. The statutory advance notice to NYC candidates is a process you run, on your timeline.' },
      { q: 'Does this apply to us if we are not in New York?', a: 'LL144 covers roles located in New York City. Other jurisdictions have their own rules, see the EU AI Act and Illinois AIVIA pages, and your counsel should map the full set.' },
    ],
    [
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
      { label: 'EEOC & adverse impact', to: '/trust/eeoc-adverse-impact' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
    ]),
  trust('illinois-aivia', 'B', 'Compliance · Illinois AIVIA', 'Supports the Illinois AI Video Interview Act.',
    'Mimic & Illinois AIVIA | Compliance', 'How Mimic supports the Illinois AI Video Interview Act: candidate notice, consent, and deletion on request. Not legal advice.',
    'For video interviews of Illinois candidates, AIVIA requires notice, consent, an explanation of how the AI works, and deletion on request.',
    [
      { h2: 'What the Act requires', body: 'AIVIA applies specifically to employers who use AI to analyse video interviews for positions based in Illinois. Its requirements are unusually concrete, which makes them straightforward to map.', blocks: [
        { kind: 'steps', items: [
          { t: 'Notice before the interview', d: 'Tell the applicant that AI may be used to analyse their video interview and consider their fitness for the position.' },
          { t: 'A plain explanation of how it works', d: 'Explain how the AI works and what general types of characteristics it uses to evaluate applicants, in terms an applicant can actually understand.' },
          { t: 'Consent', d: 'Obtain the applicant\'s consent to be evaluated by the AI. Without consent, the video interview cannot be evaluated this way.' },
          { t: 'Limited sharing', d: 'Do not share the video beyond those whose expertise is needed to evaluate the applicant.' },
          { t: 'Deletion on request', d: 'On an applicant\'s request, destroy the video, and instruct anyone who received copies to do the same, within 30 days.' },
        ] },
      ] },
      { h2: 'How Mimic supports each one', body: '', blocks: [
        { kind: 'spec', caption: 'Requirement → supporting capability', rows: [
          { k: 'Notice and consent', v: 'Video rounds require an explicit consent step before anything is recorded: the candidate confirms they understand responses are recorded, analysed by AI, and reviewed by a human recruiter.' },
          { k: 'Explanation of the AI', v: 'The rubric criteria are authored by you and stated plainly, so the characteristics being evaluated can be described accurately rather than generically.' },
          { k: 'Access control', v: 'Candidate data is visible to your recruiting workspace. Candidates never see other candidates\' interviews or results.' },
          { k: 'Deletion', v: 'Deletion controls exist. [PLACEHOLDER: the team must confirm the exact request route and the operational commitment against the 30-day statutory window, and state both here.]' },
        ] },
        { kind: 'note', tone: 'info', title: 'The simplest risk reduction', text: 'AIVIA is triggered by AI analysis of video interviews. If a role does not genuinely need a video round, conversational chat or timed Q&A avoids the category altogether, and both score against the same rubric, so results stay comparable.' },
      ] },
      { h2: 'What stays yours', body: 'Mimic supplies the disclosure inside the product, the consent gate and the deletion mechanism. Issuing notice on your own timeline, deciding who inside your organisation may view an interview, honouring deletion requests within 30 days, and any reporting your counsel identifies remain your responsibility.' },
      { h2: 'Not legal advice', body: 'This page describes product capabilities and how they relate to the Act as we understand it. It is not legal advice and does not establish compliance.' },
    ],
    [
      { q: 'Does this apply if we only run text interviews?', a: 'AIVIA is directed at AI analysis of video interviews. Formats based on text fall outside that trigger, though your counsel should confirm the full picture for your process.' },
      { q: 'How does a candidate consent?', a: 'Video rounds present an explicit consent step before recording begins, stating that responses are recorded, analysed by AI and reviewed by a human recruiter. It is a required action, not a pre-ticked box.' },
      { q: 'How do candidates request deletion?', a: 'Deletion controls exist in the product. The exact request route and the operational commitment against the 30-day window are marked for the team to confirm before this page is published. We would rather leave that visibly open than state a timeframe we have not verified.' },
      { q: 'Can we avoid AIVIA obligations entirely?', a: 'Choosing a text format for Illinois roles avoids AI analysis of video. That is a process decision for you and your counsel, not something the product decides.' },
    ],
    [
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
      { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
      { label: 'AI video avatar', to: '/platform/ai-video-avatar' },
      { label: 'Signal analysis', to: '/platform/signal-analysis' },
    ]),
  trust('gdpr-india-dpdp', 'B', 'Compliance · GDPR & DPDP', 'GDPR and India DPDP data controls, built in.',
    'GDPR & India DPDP | Mimic Compliance', 'Lawful basis, data subject rights for candidates, regional residency and configurable retention for GDPR and India’s DPDP Act. Not legal advice.',
    'Handling candidate data under GDPR and India’s DPDP Act means consent, data subject rights, residency and retention, all first-class in Mimic.',
    [
      { h2: 'What the product does', body: 'Both regimes turn on a small number of practical questions: what data is collected, on what basis, who it goes to, how long it is kept, and how a person exercises their rights over it. Mimic\'s answers are deliberately narrow.', blocks: [
        { kind: 'spec', caption: 'Data handling', rows: [
          { k: 'What is collected', v: 'Name, email, the resume the candidate uploads, their answers, and the resulting transcript and scores. Voice and video rounds also capture audio or video.' },
          { k: 'What is not collected', v: 'No demographic data or protected characteristics, not collected, not inferred.' },
          { k: 'Basis for processing', v: 'The candidate is told they are interviewing with AI and consents before the interview begins; video rounds add explicit consent to recording and AI analysis.' },
          { k: 'Who receives it', v: 'Your recruiting workspace, plus the subprocessors engaged by the formats you enable. Candidates never see each other\'s data.' },
          { k: 'Minimisation lever', v: 'Text formats generate no audio or video at all, and still score against the same rubric.' },
        ] },
      ] },
      { h2: 'Data subject rights', body: 'Access, rectification, erasure and portability requests are the ones that arrive in practice.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'The team must confirm and publish, before this page goes live: the route by which a candidate exercises each right, who inside your organisation and ours handles it, the committed response timeframe, the retention period applied by default, and the DPO or privacy contact. These are the first questions a data protection reviewer asks, and an unanswered placeholder is more useful to them than an invented commitment.' },
      ] },
      { h2: 'Where data is processed', body: 'Mimic runs as a single instance, so data location follows where you deploy it and where your Firebase project was created, a decision made once when you go live rather than a setting for each tenant. There is no region selector in the product, and no multi-region replication.', blocks: [
        { kind: 'note', tone: 'limit', text: 'If your obligations require processing to remain within a specific jurisdiction, that must be designed into the deployment before launch. For a single-tenant deployment this is often a cleaner residency answer than a multi-tenant SaaS, but it is an architecture decision, not a configuration one. See Data residency & retention.' },
      ] },
      { h2: 'Not legal advice', body: 'This page describes product capabilities and how they relate to GDPR and India\'s DPDP Act as we understand them. It is not legal advice and does not establish compliance. Your own counsel and data protection officer determine what applies to you.' },
    ],
    [
      { q: 'Where is candidate data stored?', a: 'Wherever you deploy the instance, plus the region of the Firebase project you create. It is decided when you go live; there is no region selector in the product.' },
      { q: 'How does a candidate request erasure?', a: 'Deletion controls exist in the product. The exact request route and committed timeframe are marked for the team to confirm rather than stated speculatively.' },
      { q: 'Do you process special category data?', a: 'Mimic does not collect or infer demographic data or protected characteristics. Voice and video rounds process material that sits close to biometric data: audio and facial imagery; text formats produce neither.' },
      { q: 'Can we minimise what is processed?', a: 'Yes, choose text formats. They generate no audio or video, and score against the same rubric as every other format.' },
    ],
    [
      { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
      { label: 'Subprocessors', to: '/trust/sub-processors' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
      { label: 'EU AI Act', to: '/trust/eu-ai-act' },
    ]),
  trust('eeoc-adverse-impact', 'B', 'Compliance · EEOC', 'One rubric, applied identically, and measured.',
    'EEOC & Adverse Impact | Mimic Compliance', 'What a consistently applied rubric contributes to an analysis of adverse impact, and why the analysis itself has to happen in your systems, not ours. Not legal advice.',
    'US employers are expected to monitor selection procedures for adverse impact. A consistent, measured process is your best defence.',
    [
      { h2: 'What adverse impact is', body: 'Adverse impact describes a selection procedure that is neutral on its face but produces a substantially lower selection rate for one group than another. US enforcement guidance commonly references the four-fifths rule as a rule of thumb: a rate for one group below about 80% of the highest scoring group\'s rate warrants examination.', blocks: [
        { kind: 'note', tone: 'info', title: 'It applies to the whole procedure', text: 'Adverse impact obligations attach to your selection procedure, not to any one vendor in it. An AI screening round is one stage among resume review, interviews and offers, and the analysis is run on the process as a whole.' },
      ] },
      { h2: 'What Mimic contributes', body: 'Two things, and it is worth being exact about both.', blocks: [
        { kind: 'split', items: [
          { t: 'A consistently applied procedure', d: 'One rubric per role, applied identically to every candidate and across all five formats. A procedure that varies by interviewer cannot be meaningfully validated; one that does not, can.' },
          { t: 'Traceable outcomes for each criterion', d: 'A score for each criterion with the evidence behind it, plus an audit history of the human decisions. If a criterion turns out to drive a disparity, you can find it and read why.' },
        ] },
      ] },
      { h2: 'What Mimic cannot do', body: 'Mimic holds no demographic data. It does not ask for protected characteristics and does not infer them. It therefore cannot compute selection rates by group, and cannot tell you whether your process has adverse impact.', blocks: [
        { kind: 'note', tone: 'limit', text: 'Any vendor claiming their tool monitors adverse impact while holding no demographic data is describing something that is not arithmetically possible. The analysis is a join between Mimic outcome data and the voluntary self identification data held in your own ATS or HRIS, performed in your reporting environment. See Bias testing & audits for the mechanics.' },
      ] },
      { h2: 'Why a structured rubric helps your position', body: 'Where a selection procedure does show impact, the questions that follow are about job relatedness and consistency: what was measured, was it relevant to the role, and was it applied the same way to everyone. A written rubric authored before candidates were assessed, applied identically, with the evidence for each judgement retained, is a materially better answer to those questions than a set of unstructured interview impressions.', bullets: ['Criteria defined in advance and written down', 'Applied identically to every candidate for the role', 'Evidence retained for each criterion score', 'Human decisions recorded with attribution', 'The same standard regardless of interview format'] },
      { h2: 'Not legal advice', body: 'This page describes product capabilities and how they relate to guidance as we understand it. It is not legal advice, and it does not establish that any selection procedure is lawful or validated. Your own counsel and, where appropriate, an industrial and organisational psychologist should advise on validation.' },
    ],
    [
      { q: 'Can Mimic tell us if we have adverse impact?', a: 'No. It holds no demographic data, so it cannot compute selection rates by group. It supplies the outcome data; the analysis happens in your reporting environment where the category data lives.' },
      { q: 'Is a Mimic rubric a validated selection procedure?', a: 'Validation is a study you conduct on your own roles and data, typically with specialist advice. Mimic gives you a consistent, documented procedure to validate. It does not validate itself.' },
      { q: 'Does using one rubric guarantee no adverse impact?', a: 'No. A consistently applied criterion can still produce disparate rates. Consistency makes the effect measurable and traceable to a specific criterion. It does not eliminate it.' },
      { q: 'What should we do if an analysis shows a disparity?', a: 'Trace it to the criterion and stage where it appears, examine whether that criterion is genuinely related to the job, and take advice. The scores for each criterion and the retained evidence exist precisely so that investigation is possible.' },
    ],
    [
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
      { label: 'NYC Local Law 144', to: '/trust/nyc-local-law-144' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
    ]),
  trust('trust-center', 'A', 'Security · Trust Center', 'Everything security and legal need, in one place.',
    'Mimic Trust Center | Security & Compliance', 'Security controls, data handling practices, subprocessors and reports, one place for your infosec and legal reviewers to get answers fast.',
    'A good Trust Center shortens your sales cycle: reviewers self serve the answers instead of waiting on a questionnaire round trip.',
    [
      { h2: 'Start here', body: 'This is the index for a security or legal review. Each page below answers one class of question, and each is written to be read by a reviewer rather than a buyer, including where the answer is "not yet".', blocks: [
        { kind: 'split', items: [
          { t: 'How decisions get made', d: 'How Mimic scores, why a human makes every decision, and what the product deliberately does not do. Start with How Mimic scores.' },
          { t: 'Regulatory mapping', d: 'EU AI Act, NYC Local Law 144, Illinois AIVIA, GDPR and India DPDP, and EEOC adverse impact, each mapped requirement by requirement.' },
          { t: 'Data handling', d: 'Where data lives, how long it is kept, which subprocessors are engaged, and how to reduce the footprint.' },
          { t: 'Candidate protections', d: 'Disclosure, consent, what candidates are never shown, and how accommodation and deletion requests work.' },
        ] },
      ] },
      { h2: 'The short version for a reviewer in a hurry', body: 'If you read nothing else, these are the facts that usually decide the review.', blocks: [
        { kind: 'bullets', items: ['No hiring decision is automated, advance, reject and override are human actions, each written to the audit history for that candidate', 'Every score cites the answer it came from, and the full transcript ships with the report', 'One rubric per role, authored by you, applied identically across all five interview formats', 'Candidates are told they are interviewing with AI and consent before starting', 'Mimic holds no demographic data, which means it cannot discriminate on it, and equally cannot self audit for adverse impact', 'Delivery signals on voice and video are reported beside the content score, never folded into it', 'Where a dependency is missing the product degrades visibly and says so, rather than silently'] },
      ] },
      { h2: 'What is not yet established', body: 'A trust centre that only lists strengths is not useful. These are the open items, and they are marked as such on the pages themselves rather than omitted.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'No external security certification or bias audit is currently published. Retention periods, deletion request routes and timeframes, subprocessor contracting entities and regions, and model documentation are all still to be confirmed by the team. Mimic runs as a single instance without multi-region replication or HA failover. Reviewers should treat each of these as an open question to raise, not as an omission to infer around.' },
      ] },
      { h2: 'Documents and reports', body: 'Reports available to qualified reviewers under NDA.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'Confirm which documents exist and can be shared (security whitepaper, penetration test summary, architecture overview, DPA template), and the route for requesting them.' },
      ] },
      { h2: 'Talk to a person', body: 'For anything the pages here do not answer, a walkthrough with your infosec and legal reviewers is usually faster than a questionnaire round trip. We would rather answer a hard question directly than have you infer an answer from a marketing page.' },
    ],
    [
      { q: 'Do you hold SOC 2 or ISO 27001?', a: 'Not that we publish today. The Certifications page lists only attestations actually held, and marks the rest as open. We would rather lose a box on your checklist than claim something we cannot evidence.' },
      { q: 'What is the fastest way to assess Mimic?', a: 'Read How Mimic scores, then Human in the loop, then Subprocessors and Data residency & retention. Those four cover the questions that decide most reviews.' },
      { q: 'Can you complete our security questionnaire?', a: 'Yes, and the open items above will appear in it as open. Flagging them early is the point of this page.' },
    ],
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Subprocessors', to: '/trust/sub-processors' },
      { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
      { label: 'Certifications', to: '/trust/certifications' },
    ]),
  trust('certifications', 'B', 'Security · Certifications', 'Certifications & attestations.',
    'Certifications & Attestations | Mimic Security', 'The security and compliance attestations Mimic holds, and how to request the underlying reports for your review.',
    'We only list attestations we actually hold. Anything below marked as a placeholder is not yet claimed.',
    [
      { h2: 'What we hold today', body: 'Mimic does not currently publish an external security certification or attestation. That is the accurate position, and stating it plainly is deliberate.', blocks: [
        { kind: 'note', tone: 'placeholder', title: 'Nothing is claimed here yet', text: 'When an attestation is obtained (SOC 2 Type II, ISO 27001, ISO 42001 or another), it will be listed here with its scope, the period covered, the auditor, and how to request the report. Until then this page stays empty rather than displaying badges for work that has not been done.' },
      ] },
      { h2: 'Why an empty page instead of badges', body: 'Compliance badges are the easiest thing on a marketing site to fake and the easiest to disprove. A reviewer who asks for the report behind a badge and is told it does not exist has learned something about the vendor that no amount of later evidence repairs.', blocks: [
        { kind: 'p', text: 'The same rule applies across this site: no statistic, customer, testimonial or certification appears unless it is real and cleared. If you are comparing vendors, it is worth asking each of them for the report behind every badge on their site.' },
      ] },
      { h2: 'What you can assess in the meantime', body: 'An attestation is a useful proxy for diligence, but it is a proxy. These pages describe the actual mechanisms, which you can evaluate directly.', blocks: [
        { kind: 'bullets', items: ['Subprocessors, which third parties are engaged, and by which features', 'Data residency & retention, where data lives and the honest limits of the architecture', 'How Mimic scores, what produces a score and what it cites', 'Human in the loop, why no decision is automated', 'Candidate rights, disclosure, consent and what candidates are never shown'] },
        { kind: 'note', tone: 'info', title: 'A reasonable ask', text: 'If a certification is a hard requirement for your procurement, say so early. It is a better conversation to have at the start of an evaluation than at the end of one.' },
      ] },
      { h2: 'Requesting documents', body: 'Documents that do exist are available to qualified reviewers under NDA.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'Confirm which documents can be shared today (security whitepaper, architecture overview, penetration test summary, DPA template), and the request route.' },
      ] },
    ],
    [
      { q: 'Are you SOC 2 certified?', a: 'No. We do not currently publish an external security attestation. When one exists it will appear here with its scope, period and auditor.' },
      { q: 'The marketing site used to show compliance badges. What happened?', a: 'They were removed because they were not backed by completed attestations. Displaying them was a mistake, and correcting it was the right call even though an empty page is commercially weaker.' },
      { q: 'Is a certification planned?', a: 'That is for the team to confirm. This page will state the intended scope and timeline rather than implying progress that has not been made.' },
      { q: 'What can we review instead?', a: 'The mechanisms themselves (subprocessors, data handling, scoring transparency and human oversight), each documented on its own page in this section, including the open items.' },
    ],
    [
      { label: 'Trust Center', to: '/trust/trust-center' },
      { label: 'Subprocessors', to: '/trust/sub-processors' },
      { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
    ]),
  trust('data-residency-retention', 'B', 'Security · Data', 'Your data stays where you need it, only as long as you need it.',
    'Data Residency & Retention | Mimic Security', 'Choose where candidate data is stored, set how long it is kept, and purge on request. The residency and retention controls enterprise review expects.',
    'Where data lives and how long it is kept are the two questions every security review asks first.',
    [
      { h2: 'Where data actually lives', body: 'Mimic runs as a single instance. Candidate data lives in two places: a durable data directory on the instance you deploy, and a Google Firebase project used for authentication and file storage. There is no region selector for individual customers in the product.', blocks: [
        { kind: 'spec', caption: 'Data location is set at deployment, not per tenant', rows: [
          { k: 'Interview data', v: 'Templates, question sets, sessions, answers and reports persist to a data directory on the deployed instance. Its location is determined by where you deploy.' },
          { k: 'Accounts and files', v: 'Authentication and uploaded files live in a Google Firebase project. A Firebase project\'s region is fixed when the project is created.' },
          { k: 'Model processing', v: 'Where an AI provider is enabled, answer content is sent to it for scoring. Its processing region is that provider\'s, not Mimic\'s.' },
        ] },
        { kind: 'note', tone: 'info', title: 'What this means in practice', text: 'Residency is a deployment decision made once, up front, deploy the instance and create the Firebase project in the region you require. For a single-tenant deployment that is often a stronger residency position than a multi-tenant SaaS offering region "options". But it is a decision to make before you go live, not a setting to change afterwards.' },
      ] },
      { h2: 'An honest note on the data layer', body: 'The interview store is backed by files and designed to be durable across restarts, and the application runs as a single instance rather than a horizontally scaled cluster. That shapes both your residency answer and your capacity planning, and your infrastructure reviewers should know it before they design around it.', blocks: [
        { kind: 'note', tone: 'limit', text: 'Scaling beyond a single instance requires migrating the data layer. If your deployment needs multi-region replication, high availability failover or horizontal scale, raise it early. It is an architecture conversation, not a configuration one.' },
      ] },
      { h2: 'Retention and deletion', body: 'Candidate data is retained so that reports remain reviewable after an interview closes, which is what makes an audit possible months later, and deleted on request.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'The team must confirm and publish: the default retention period for interview data, transcripts and any recorded audio or video; whether retention is configurable and by whom; the route by which a candidate or customer requests deletion; and the committed timeframe for completing it. Illinois AIVIA sets a 30-day statutory window for video deletion on request, so the operational commitment must be at least that fast for video rounds.' },
      ] },
      { h2: 'Reducing what you have to retain', body: 'The cheapest way to satisfy a retention review is to generate less sensitive data in the first place.', bullets: ['Text formats produce no audio or video to retain at all', 'Voice rounds produce audio and a transcript; the transcript carries the evidence, so retention policy can treat the two differently', 'Video rounds produce the largest and most sensitive footprint, and are the ones with an explicit statutory deletion window in some jurisdictions', 'Because every format scores against the same rubric, choosing a lighter format does not cost you comparability'] },
    ],
    [
      { q: 'Can we choose which region our data is stored in?', a: 'Not through a setting in the product. Data location follows where you deploy the instance and where your Firebase project was created, so it is a decision made when you go live, in the region you require.' },
      { q: 'Is Mimic multi-region or highly available?', a: 'No. It runs as a single instance backed by a file store. Multi-region replication or HA failover would require migrating the data layer, which is an architecture discussion to have before deployment.' },
      { q: 'How long is candidate data kept?', a: 'The default retention period and whether it is configurable are marked for the team to confirm. We would rather show that as an open item than publish a number we have not verified.' },
      { q: 'How do we minimise the data footprint?', a: 'Use text formats where the role allows. They produce no audio or video at all, and still score against the same rubric as every other format.' },
    ],
    [
      { label: 'Subprocessors', to: '/trust/sub-processors' },
      { label: 'GDPR & India DPDP', to: '/trust/gdpr-india-dpdp' },
      { label: 'Illinois AIVIA', to: '/trust/illinois-aivia' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
    ]),
  trust('sub-processors', 'B', 'Security · Subprocessors', 'Who we work with to run Mimic.',
    'Subprocessors | Mimic Security', 'The external subprocessors Mimic uses, what each does, and how we notify you of changes, full supply chain transparency for your review.',
    'Your DPA review needs the subprocessor list. Here it is, with change notifications so nothing moves without your knowledge.',
    [
      { h2: 'The services Mimic depends on', body: 'These are the third parties a Mimic deployment integrates with, taken from the product\'s actual configuration surface rather than a marketing summary. Which of them are engaged depends on which features you enable. A deployment running only text touches far fewer than one running video avatars.', blocks: [
        { kind: 'spec', caption: 'Integration → purpose', rows: [
          { k: 'Google Firebase', v: 'Authentication for recruiter and candidate accounts, plus file storage. Required.' },
          { k: 'Google Gemini', v: 'Question generation from resumes, answer scoring, and the live voice interview model. Optional, without it the product runs with heuristic scoring, labelled approximate.' },
          { k: 'Tavus', v: 'The AI video avatar interviewer: replicas and personas. Engaged only by the video avatar format.' },
          { k: 'Daily', v: 'Live two-way video rooms. Engaged only by the live interview format.' },
          { k: 'Deepgram', v: 'Speech transcription. Engaged by spoken formats.' },
          { k: 'Brevo', v: 'Transactional email delivery for invitations and round notifications. An SMTP server can be configured instead.' },
        ] },
      ] },
      { h2: 'What this means for your review', body: 'The practical consequence is that your data processing footprint is a function of which interview formats you choose to run.', blocks: [
        { kind: 'split', items: [
          { t: 'Deployments running only text', d: 'Conversational chat and timed Q&A engage authentication, storage, the AI model and email. No video, transcription or avatar processing occurs at all.' },
          { t: 'Spoken and video deployments', d: 'Add transcription, and, for avatar or live rounds, the corresponding video services. These process candidate audio and video.' },
        ] },
        { kind: 'note', tone: 'info', title: 'A useful lever', text: 'If a subprocessor is unacceptable to your review, the format that depends on it can usually be avoided without losing comparability, because every format scores against the same rubric.' },
      ] },
      { h2: 'What the team must confirm before this page is published', body: '', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'For each service above: the contracting entity, the processing region, the categories of personal data it receives, and the retention applied. Also required: whether Hume is engaged for the emotion signal panels (its components exist in the product but it does not appear in the configuration surface, so this must be verified rather than assumed), the method and notice period for notifying a change of subprocessor, and the DPA under which each is engaged. This list identifies the integrations; it is not yet a complete Article 28 subprocessor disclosure.' },
      ] },
      { h2: 'Change notifications', body: 'We notify customers before adding or changing a subprocessor.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'Confirm the notification method and notice period, and whether customers may object.' },
      ] },
    ],
    [
      { q: 'Can we run Mimic without the AI provider?', a: 'Yes. The product keeps working, with question generation and scoring falling back to a length heuristic that the interface labels as approximate. It is a degraded mode, and it says so.' },
      { q: 'Can we avoid the video subprocessors entirely?', a: 'Yes, by not using the video avatar or live two-way formats. Text and voice rounds do not engage them, and all formats score against the same rubric.' },
      { q: 'Is this list complete for a DPA review?', a: 'It is a complete list of the integrations, but not yet a full Article 28 disclosure. Contracting entities, processing regions, data categories and retention per subprocessor are marked for the team to confirm.' },
      { q: 'How are we told about changes?', a: 'Customers are notified before a subprocessor is added or changed. The method and notice period are still to be confirmed and published.' },
    ],
    [
      { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
      { label: 'GDPR & India DPDP', to: '/trust/gdpr-india-dpdp' },
      { label: 'Trust Center', to: '/trust/trust-center' },
      { label: 'Certifications', to: '/trust/certifications' },
    ]),
  trust('status', 'B', 'Security · Status', 'Mimic system status.',
    'System Status | Mimic', 'Live service status, incident history and a way to subscribe for updates, so your team always knows Mimic is up before a screening window opens.',
    'When you are screening at volume, uptime transparency is not optional.',
    [
      { h2: 'No status page yet', body: '', blocks: [
        { kind: 'note', tone: 'placeholder', title: 'Nothing to link here', text: 'Mimic does not publish a live status page or an incident history. For a tool that sits in the middle of a hiring process this is a genuine gap, and it is listed as an open item in the Trust Center rather than glossed over.' },
      ] },
      { h2: 'What your reviewers should know instead', body: 'Two architectural facts matter more than a status badge, and both are documented properly on Data residency & retention.', blocks: [
        { kind: 'bullets', items: ['Mimic runs as a **single instance**. There is no horizontal scaling, no multi-region replication and no high availability failover today', 'A restart drops in-flight live voice sessions, because that state is held in process memory', 'Asynchronous rounds are more resilient: a candidate reopens their link and continues, with drafts saved as they type', 'Deployment and scaling architecture is worth discussing early if you are planning a high volume campaign against a deadline'] },
        { kind: 'note', tone: 'info', title: 'The practical mitigation', text: 'For a large campaign, batch invitations rather than sending everything at once. It spreads load, and a dry run on the first batch catches configuration mistakes before they reach thousands of candidates.' },
      ] },
      { h2: 'Which dependencies can take a round down', body: 'Uptime here is not one number, because a Mimic interview depends on different third parties depending on the format you chose. That is worth understanding before a high volume window.', blocks: [
        { kind: 'spec', caption: 'Format → what it depends on', rows: [
          { k: 'Conversational chat / timed Q&A', v: 'The API, plus the AI provider for scoring. No video, transcription or avatar dependency. The most resilient formats, and the ones to fall back to.' },
          { k: 'Voice', v: 'Adds live voice and transcription. Session state is held in process memory, so a restart mid-interview ends that session.' },
          { k: 'Video avatar', v: 'Adds the avatar provider. Without a valid key the feature reports itself unavailable rather than dropping a candidate into a broken round.' },
          { k: 'Live two-way', v: 'Adds the WebRTC provider, and needs both parties present, so an outage during a scheduled call cannot be recovered by retrying later.' },
          { k: 'Invitations', v: 'Depend on the email provider. Without a key, sending degrades to a dry run rather than delivering only part of a batch.' },
        ] },
      ] },
      { h2: 'What a status page would need', body: 'For the team: a hosted status page, checks at the component level for the API, the interview surfaces and each provider dependency above, an incident history with postmortems, and a subscription mechanism. Enterprise buyers ask for this, and its absence is currently a real answer rather than an oversight.' },
    ],
    undefined,
    [
      { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
      { label: 'Trust Center', to: '/trust/trust-center' },
      { label: 'Subprocessors', to: '/trust/sub-processors' },
      { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
    ]),
]

/* ─── Resources + Company (Tier C mostly; honest empty states, no fake data) ── */
function page(slug: string, tier: 'A' | 'B' | 'C', kicker: string, h1: string, metaTitle: string, metaDesc: string, intro: string, sections: PageSection[], ctaTitle: string, ctaSub: string, faqs?: FaqItem[], related?: NavLink[]): MktPage {
  const section = slug.startsWith('resources') ? 'Resources' : 'Company'
  return { slug, section, sectionTo: slug.startsWith('resources') ? '/resources' : '/company', tier, kicker, h1, metaTitle, metaDesc, intro, sections, faqs, related, cta: { title: ctaTitle, sub: ctaSub } }
}

/* Tier C pages exist because the nav promises them. Where there is genuinely
 * nothing to publish yet, the page says so and offers a real next step — an
 * honest empty state, never invented listings. Reused so the wording of "not
 * yet" stays consistent across the site. */
const COMING_SOON = (what: string) => ({
  kind: 'note' as const, tone: 'placeholder' as const, title: 'Nothing published here yet',
  text: `${what} We would rather show an empty shelf than fill it with placeholder entries. If you want something specific, ask on a demo call and we will send it directly.`,
})
const RESOURCE_PAGES: MktPage[] = [
  page('resources/blog', 'C', 'Learn · Blog', 'Field notes on screening at volume.', 'Mimic Blog, AI hiring & screening', 'Practical writing on structured interviews, fair AI scoring and hiring at volume from the team building Mimic.', 'Short, useful posts on running structured, fair screening, no thought leadership filler.',     [
      { h2: 'Nothing published yet', body: '', blocks: [
        COMING_SOON('No posts are published. The nav lists this section because it will exist, not because it does.'),
      ] },
      { h2: 'What will be here', body: 'Practical pieces on designing a rubric a hiring manager trusts, running a high volume requisition, how adverse impact analysis actually works when the tool holds no demographic data, and writing questions that score well.' },
      { h2: 'Read this instead', body: 'The substantial writing on this site is in the Trust section, how scoring works, why a human decides, and what the product deliberately does not do. It is written for security and legal reviewers rather than as marketing, and it names the open items as well as the strengths.' },
      { h2: 'What a post here would have to clear', body: 'The reason this page is empty rather than filled with commodity SEO copy is that most AI hiring content fails one of these tests, and publishing it would cost more credibility than the traffic is worth.', bullets: ['It has to say something we actually know, from the product or from working with customers, not a restatement of a category narrative', 'Any figure has to be real and sourced, which rules out most of the genre', 'It has to be useful to someone doing the job, not to a search engine', 'Where the honest answer is unflattering to us, it has to say so. The Trust pages already set that precedent and a blog cannot undercut it'] },
    ], 'Get the first posts', 'Book a demo and we’ll add you to the list.',
    undefined,
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Glossary', to: '/resources/glossary' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Trust Center', to: '/trust/trust-center' },
    ]),
  page('resources/guides', 'C', 'Learn · Guides', 'Playbooks for structured, fair screening.', 'Guides & Playbooks | Mimic', 'Step by step playbooks for designing rubrics, running high volume screening and monitoring adverse impact.', 'Longer playbooks tested in the field, which your team can act on the same day.',     [
      { h2: 'No guides published yet', body: '', blocks: [
        COMING_SOON('No downloadable guides exist. The material that would go in them is currently spread across the Platform and Trust pages instead.'),
      ] },
      { h2: 'The four we would write first', body: 'Each of these is a real gap, and each already has most of its substance somewhere on this site.', blocks: [
        { kind: 'split', items: [
          { t: 'Designing a rubric a hiring manager trusts', d: 'The method, the four failure modes, and why delegating rubric authorship to the recruiter is the most common way this goes wrong. Start with Rubric templates.' },
          { t: 'Running a high volume requisition', d: 'Format choice as a reach decision, batching and dry runs, threshold advancement, and which analytics number actually matters. Start with High volume hiring.' },
          { t: 'Adverse impact analysis when the tool holds no demographic data', d: 'How the join between outcome data and category data actually works, and why a screening tool that audits itself is a contradiction. Start with Bias testing & audits.' },
          { t: 'Writing questions that score well', d: 'Ask for instances not policies, one thing per question, and what notes on the ideal answer change. Start with Question library.' },
        ] },
      ] },
      { h2: 'Read the Trust section instead', body: 'It is the most substantial writing on this site, and it is closer to a guide than to marketing: how scoring works step by step, why a human decides, what the product deliberately does not do, and each regulation mapped requirement by requirement, including the parts where the answer is unflattering.' },
    ], 'Request the playbooks', 'Tell us your use case and we’ll share what fits.',
    undefined,
    [
      { label: 'Rubric templates', to: '/resources/rubric-templates' },
      { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
      { label: 'Question library', to: '/resources/question-library' },
    ]),
  page('resources/webinars', 'C', 'Learn · Webinars', 'Live and on-demand sessions.', 'Webinars | Mimic', 'Live and recorded sessions on fair AI screening, rubric design and hiring at volume.', 'Sessions with our team and practitioners on getting structured screening right.',
    [
      { h2: 'None scheduled', body: '', blocks: [
        COMING_SOON('No webinars have been held or scheduled. There is no back catalogue and no recording library.'),
      ] },
      { h2: 'What a session would cover', body: 'The material exists. It is written across this site rather than presented. The three that would be worth an hour: designing a rubric a hiring manager will actually trust, running a high volume requisition end to end, and what the EU AI Act means for AI interviewing now that the Art 5 prohibitions are in force.' },
      { h2: 'A faster alternative', body: 'A demo on your own open requisitions is a better use of thirty minutes than a webinar, because the questions are yours rather than someone else\'s. If a group session for your team would help, ask. That is easier to arrange than a public one.' },
      { h2: 'The session we think is most needed', body: 'One hour on the EU AI Act as it actually stands, for talent and legal teams together. Most coverage of it is either vendor reassurance or abstraction from general counsel, and both miss the operationally important point: the Art 5 prohibitions have been in force since February 2025 and were not delayed by the 2026 Digital Omnibus, which pushed only the timeline for systems classified as high risk. That means emotion inference in recruitment is prohibited now, and consent, notice, human review, a bias audit and a DPIA are none of them defences. It applies to us as much as to anyone, one of our own features falls squarely inside it, which is documented on Signal analysis.' },
    ], 'Register interest', 'Book a demo and we’ll invite you to the next session.',
    undefined,
    [
      { label: 'Rubric templates', to: '/resources/rubric-templates' },
      { label: 'EU AI Act', to: '/trust/eu-ai-act' },
      { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
      { label: 'Contact', to: '/company/contact' },
    ]),
  page('resources/question-library', 'B', 'Learn · Questions', 'A library of interview questions ready for the role.', 'Interview Question Library | Mimic', 'Structured interview questions specific to the role, which you can attach to any template, or let Mimic adapt them to each resume.', 'Start from proven questions instead of a blank page, then let each interview adapt them to the candidate.',     [
      { h2: 'How questions work in Mimic', body: 'Questions live on reusable sets, which attach to a template. A set is authored once and every requisition running that template asks exactly those questions, which is what makes the results comparable.', blocks: [
        { kind: 'spec', caption: 'What each question carries', rows: [
          { k: 'The question text', v: 'In full, as the interviewer will ask it.' },
          { k: 'Order', v: 'Set by dragging. Sequence matters, open with something answerable before the harder questions.' },
          { k: 'Category', v: 'Groups related questions in reports, so a reviewer can see performance by theme.' },
          { k: 'Notes on the ideal answer', v: 'What a strong answer contains. This is the cheapest way to improve scoring accuracy, because it tells the rubric what good looks like for that specific question.' },
        ] },
        { kind: 'p', text: 'The alternative is adaptive questions, generated from the candidate\'s own CV (1–25 per interview). Teams often generate a draft set from a real resume and then edit it into a fixed bank.' },
      ] },
      { h2: 'Question patterns that score well', body: 'The rubric can only assess what a question invites the candidate to demonstrate, so the shape of the question does most of the work.', blocks: [
        { kind: 'split', items: [
          { t: 'Ask for a specific instance', d: '"Tell me about a time you…" produces evidence. "How do you approach…" produces a policy statement that every candidate can answer well.' },
          { t: 'One thing per question', d: 'A question in two parts produces an answer that scores ambiguously against a single criterion.' },
          { t: 'Anchor on their own work', d: 'The strongest questions reference something the candidate actually did, which is what generating questions from the resume does automatically.' },
          { t: 'Leave room to answer', d: 'Anything answerable in one sentence wastes a slot, unless the round is deliberately timed for speed.' },
        ] },
        { kind: 'note', tone: 'info', title: 'The habit that matters most', text: 'Pilot a set on two or three people who already do the job well. If the rubric does not rank them highly, the questions or the criteria are wrong, and that is far cheaper to discover before candidates see them.' },
      ] },
      { h2: 'Where the library actually lives', body: 'Question sets are authored and stored in the product, per workspace. There is no public question bank on this site to browse.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'If the team wants to publish a starter library, a set of questions ready for the role and visible before sign-up, that is a content project, not a product change. It would need writing and review. Until then this page explains how to build one rather than implying one ships.' },
      ] },
    ], 'See it in the product', 'Book a demo to browse the library on your roles.',
    [
      { q: 'Does Mimic ship a public question library?', a: 'No. Question sets are authored in the product. This page describes how to build a good one; if a published starter library is added it will appear here.' },
      { q: 'How many questions can be generated from a resume?', a: 'Between 1 and 25 per interview.' },
      { q: 'What do notes on the ideal answer change?', a: 'They tell the scoring step what a strong answer to that specific question contains, which measurably sharpens the criterion scores.' },
    ],
    [
      { label: 'Question sets', to: '/platform/question-sets' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Rubric templates', to: '/resources/rubric-templates' },
      { label: 'Interview templates', to: '/platform/interview-templates' },
    ]),
  page('resources/rubric-templates', 'B', 'Learn · Rubrics', 'Rubric templates you can start from.', 'Rubric Templates | Mimic', 'Mimic ships six general purpose KPI criteria as a starting point. Here is how to turn them into a rubric that actually fits your role.', 'A good rubric is the difference between a defensible score and a gut call. This page explains how to build one, not a library of ones already written.',
    [
      { h2: 'What actually ships', body: 'Six general purpose KPI criteria, as a starting point. Mimic does **not** ship rubric packs for specific roles, and it is worth being blunt about why: a rubric for a paediatric nurse, a trading desk hire or a backend engineer encodes a judgement your team holds and a vendor does not. Handing you a seemingly plausible template for a role we have never hired would be worse than handing you a blank one.', blocks: [
        { kind: 'note', tone: 'info', title: 'What the product gives you instead', text: 'Somewhere to write that judgement down, weight it, apply it identically to every candidate across all five interview formats, and attach the evidence to every score. That is the part software can do.' },
      ] },
      { h2: 'Building one that works', body: '', blocks: [
        { kind: 'steps', items: [
          { t: 'Write down what good looks like', d: 'Before anyone is assessed. Four to six criteria is usually right, enough to separate candidates, few enough that each carries real weight.' },
          { t: 'Describe behaviour, not traits', d: '"Structures an answer around a concrete example" is scoreable. "Communication skills" is not. It means something different to every reviewer.' },
          { t: 'Weight by what actually decides the hire', d: 'Weights normalise to 100%, so this is a forced ranking. A criterion at 5% will not change an outcome; if it does not matter, remove it.' },
          { t: 'Pilot on people you know are good', d: 'Run it against two or three people already doing the job well. If the rubric does not rank them highly, it is wrong, and fixing it now is free.' },
          { t: 'Watch your override rate', d: 'How often recruiters disagree with the recommendation is the sharpest available signal that the rubric does not match what the team values.' },
        ] },
      ] },
      { h2: 'The failure modes', body: 'Nearly every bad rubric fails in one of these four ways.', bullets: ['A criterion everyone passes, adds weight, adds no information, should be replaced', 'Too many criteria, a dozen at 8% each dilutes everything and the total stops meaning anything', 'Traits instead of behaviours, unscoreable, and the least defensible if the decision is ever questioned', 'Written by the recruiter alone. The hiring manager is the only person who can say what good looks like for their role, and delegating that is the most common way this goes wrong'] },
      { h2: 'A published starter set', body: '', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'If the team wants to publish example rubrics for common role families, written and reviewed by someone who has hired for them, that is a worthwhile content project and this is where it would live. It has not been done, so this page teaches the method rather than pretending a library exists.' },
      ] },
    ], 'Start from a template', 'Book a demo and we’ll set one up on your role.',
    [
      { q: 'Do you ship rubrics for specific roles?', a: 'No. Six general KPI criteria ship as a starting point. Criteria specific to a role are a judgement your team writes down. The product gives it somewhere to live and applies it consistently.' },
      { q: 'How many criteria should a rubric have?', a: 'Usually four to six. Few enough that each carries meaningful weight, enough to actually separate candidates.' },
      { q: 'Can we change a rubric mid-hire?', a: 'You can, but don\'t, candidates already scored were assessed against the old criteria. Duplicate the template instead, so the standard holds for the duration of the requisition.' },
    ],
    [
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Question library', to: '/resources/question-library' },
      { label: 'For hiring managers', to: '/solutions/hiring-managers' },
    ]),
  page('resources/glossary', 'C', 'Learn · Glossary', 'The AI hiring terms buyers actually ask about.', 'AI Hiring Glossary | Mimic', 'Plain English definitions of the terms that come up in reviews of AI hiring: adverse impact, rubric, adaptive interview, human in the loop.', 'The words that show up in every procurement and legal review, defined plainly.',
    [
      { h2: 'Scoring and assessment', body: '', blocks: [
        { kind: 'spec', caption: 'Terms', rows: [
          { k: 'Rubric', v: 'A fixed set of weighted criteria used to score every candidate for a role the same way. In Mimic you author it; six general KPI criteria ship as a starting point, and weights normalise to 100%.' },
          { k: 'Criterion', v: 'One dimension of a rubric, "structures an answer around a concrete example", say. Scored separately, so a total can be traced to the parts that produced it.' },
          { k: 'Weighted total', v: 'The rubric score. Plain arithmetic over the criterion scores using your weights, reproducible by hand, with no hidden term.' },
          { k: 'Evidence', v: 'The specific answer or transcript span a criterion score was derived from. A score without it is a number you have to take on trust.' },
          { k: 'Recommendation', v: 'A suggested outcome attached to a score. Not a decision, advancing and rejecting are human actions.' },
          { k: 'Heuristic fallback', v: 'What Mimic scores with when no AI provider is configured: an approximation based on length, labelled as approximate in the interface rather than presented as a real assessment.' },
        ] },
      ] },
      { h2: 'Interview formats', body: '', blocks: [
        { kind: 'spec', caption: 'Terms', rows: [
          { k: 'Resume adaptive interview', v: 'An interview that reads the candidate\'s own resume and writes its questions and follow-ups around what that resume claims, rather than asking from a fixed bank.' },
          { k: 'Asynchronous round', v: 'An interview the candidate takes on their own schedule with no interviewer present. Removes scheduling, which is what makes interviewing every applicant feasible.' },
          { k: 'Track / format', v: 'Which of the five interview types a round uses, conversational chat, voice, video avatar, timed Q&A, or live two-way. The format changes how an answer is captured, not how it is judged.' },
          { k: 'Replica / persona', v: 'In a video avatar round, the face that conducts the interview (replica) and how it behaves, brief, tone, what it may ask (persona).' },
          { k: 'Integrity signal', v: 'A recorded event such as a tab switch, fullscreen exit or paste. Reported as a flag for a human to weigh, never a scoring penalty or an automatic rejection.' },
        ] },
      ] },
      { h2: 'Fairness and compliance', body: '', blocks: [
        { kind: 'spec', caption: 'Terms', rows: [
          { k: 'Adverse impact', v: 'When a selection procedure passes one group at a substantially lower rate than another. US guidance commonly references the four-fifths rule as a rule of thumb.' },
          { k: 'Four-fifths rule', v: 'A screening heuristic: a group selection rate below about 80% of the highest group\'s rate warrants examination. A prompt to investigate, not a legal threshold.' },
          { k: 'Human in the loop', v: 'A design where the AI recommends and a person makes every decision affecting a candidate. Under emerging AI hiring law this is an obligation, not a feature.' },
          { k: 'AEDT', v: 'Automated Employment Decision Tool. The category NYC Local Law 144 regulates, and the reason that law requires an annual independent bias audit.' },
          { k: 'Bias audit', v: 'An independent analysis of selection rates across categories. It requires demographic data, which Mimic does not hold, so the analysis is performed on your data, in your environment.' },
          { k: 'Data subject rights', v: 'Access, rectification, erasure and portability. Under GDPR and India\'s DPDP Act these are requests you must be able to service.' },
        ] },
      ] },
      { h2: 'Why these definitions are worth reading', body: 'Two of them do most of the work in a procurement conversation. **Human in the loop** is the difference between a tool that informs a decision and one that makes it, the distinction regulators care about most. And **bias audit** is where vendors most often overclaim: a tool holding no demographic data cannot audit itself for adverse impact, however it is worded. Both are worth asking every vendor about directly.' },
    ], 'See these in practice', 'Book a demo to see how Mimic applies them.',
    [
      { q: 'Does Mimic hold demographic data?', a: 'No. It does not collect or infer protected characteristics, which means it cannot discriminate on them, and equally cannot measure adverse impact on its own.' },
      { q: 'Is a rubric the same as a competency framework?', a: 'Close enough for practical purposes. A rubric is the scoreable form of one: criteria plus weights, applied identically to every candidate for a role.' },
    ],
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'EU AI Act', to: '/trust/eu-ai-act' },
    ]),
  page('resources/customer-stories', 'A', 'Proof · Stories', 'How teams hire with Mimic.', 'Customer Stories | Mimic', 'We publish a customer story only when the customer has confirmed their name and their numbers. None are published yet, and this page says so.', 'The best proof is a team like yours. We publish stories only with the customer’s name and numbers confirmed, which means, today, none.',
    [
      { h2: 'Nothing here yet, and that is deliberate', body: '', blocks: [
        COMING_SOON('No customer stories are published because none have been confirmed by a customer yet.'),
        { kind: 'p', text: 'Invented case studies are the most common form of dishonesty in enterprise software marketing, and the easiest to check: ask a vendor to connect you with the named customer in their case study and watch what happens. We would rather this page be empty than fail that test.' },
      ] },
      { h2: 'What a story will contain when there is one', body: 'So you know what we consider publishable.', bullets: ['The customer\'s real name, used with their written permission', 'The specific hiring problem, described concretely rather than in category language', 'How the team actually rolled it out, including what did not work first time', 'Measured change, with the measurement method stated, and no figure the customer has not confirmed', 'A quotation the named person has approved'] },
      { h2: 'What we can offer instead, today', body: 'Two real client logos appear on this site, Total IT Global and Aisling, because they are cleared for public use. Beyond that, the honest substitutes for a case study are a walkthrough on your own open requisitions, and the Trust section, which documents how the product behaves rather than asserting what it achieved elsewhere.' },
      { h2: 'Be a reference', body: 'Already using Mimic and willing to share results? We would like to tell your story, with your review over every word and number in it.' },
    ], 'See it on your own roles', 'A walkthrough on your open reqs is better evidence than someone else\'s case study.',
    [
      { q: 'Why are there no customer stories?', a: 'Because none have been confirmed by a customer. We do not publish stories, metrics or testimonials that the named customer has not approved.' },
      { q: 'Can we speak to a reference customer?', a: 'Ask on a demo call. A reference conversation is arranged directly rather than implied by a page of unverifiable quotes.' },
      { q: 'What proof can we evaluate now?', a: 'The product itself on your own roles, and the Trust section, which documents scoring, oversight, data handling and the open items, including the ones that are unflattering.' },
    ],
    [
      { label: 'Trust Center', to: '/trust/trust-center' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Certifications', to: '/trust/certifications' },
      { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
    ]),
  page('resources/roi-calculator', 'B', 'Proof · ROI', 'Estimate what the first round is costing you.', 'ROI Calculator | Mimic', 'Estimate the recruiter hours and time to fill you get back by automating the first round with Mimic.', 'The first round has a price, in recruiter hours and in candidates lost to a faster competitor. Put a number on it.',     [
      { h2: 'What the calculator above does', body: 'It multiplies three numbers you provide. That is the whole model, and stating it plainly is deliberate. An ROI tool whose arithmetic you cannot see is a sales prop, not an estimate.', blocks: [
        { kind: 'spec', caption: 'The arithmetic', rows: [
          { k: 'Applicants per month', v: 'Your volume. The slider runs 50 to 5,000.' },
          { k: 'Minutes per manual screen', v: 'How long one first round conversation costs today, including the scheduling around it. 5 to 45 minutes.' },
          { k: 'Loaded recruiter cost per hour', v: 'Salary plus overhead, not base salary. $20 to $120.' },
          { k: 'Hours returned per month', v: '(applicants × minutes) ÷ 60' },
          { k: 'Cost returned per month', v: 'hours × hourly rate' },
          { k: 'Returned per year', v: 'monthly × 12' },
        ] },
      ] },
      { h2: 'What it deliberately does not claim', body: 'This is where most vendor ROI calculators stop being honest, so here are the limits of ours.', blocks: [
        { kind: 'bullets', items: ['It estimates the manual screening time removed, not revenue, not quality of hire, not time to fill', 'It assumes you currently screen every applicant. If today you only screen a filtered shortlist by phone, your real saving in recruiter hours is smaller, though your candidate coverage improves substantially, which this does not price', 'It ignores the configuration effort: writing a rubric and question set is real work, and it comes up front', 'It ignores Mimic\'s own cost, so it is a gross figure, not net ROI', 'The output is arithmetic on your inputs. It contains no benchmark or industry figure from us. We have none that are verified'] },
        NO_METRICS_NOTE,
      ] },
      { h2: 'A more useful version of this exercise', body: 'The number that usually changes a decision is not cost saved but coverage. Take your monthly applicants, subtract the number who actually get a first round conversation today, and that difference is how many people are currently being judged on a CV alone. For most high volume teams it is the large majority, and it is the figure worth putting in front of a hiring manager, because it is about the process rather than the budget.' },
    ], 'Get a tailored estimate', 'Book a demo and we’ll model it on your reqs.',
    [
      { q: 'Where do your default numbers come from?', a: 'They are neutral starting points for the sliders, not benchmarks. We publish no industry figures because we have none that are verified.' },
      { q: 'Is this net of Mimic\'s cost?', a: 'No. It is a gross estimate of the manual screening time removed. Subtract our cost for a net figure.' },
      { q: 'What if we only screen a shortlist today?', a: 'Then the hour saving shown is too high, because it assumes you screen everyone. Your gain shows up as coverage instead: every applicant gets a structured interview rather than a resume filter.' },
    ],
    [
      { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
      { label: 'For TA leaders', to: '/solutions/talent-acquisition-leaders' },
      { label: 'Recruiter analytics', to: '/platform/recruiter-analytics' },
      { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
    ]),
  page('resources/benchmark-report', 'C', 'Proof · Benchmark', 'Screening benchmarks.', 'Screening Benchmark Report | Mimic', 'Where manual first round screening loses good candidates, and what a structured alternative, backed by evidence, changes. Published when the data supports it.', 'We are collecting the data for a screening benchmark. Until it is large enough to say something honest, this page says nothing.',     [
      { h2: 'Not published, and not soon', body: '', blocks: [
        COMING_SOON('No benchmark report exists. We have no aggregate customer dataset large enough to generalise from, so there is nothing to publish.'),
      ] },
      { h2: 'What it would cover', body: 'Three questions worth answering with real data, none of which we can answer yet.', blocks: [
        { kind: 'bullets', items: ['Where good candidates actually fall out of a manual funnel, how many never receive a first round conversation at all', 'How consistently a structured rubric scores compared with unstructured phone screens, measured by agreement between reviewers on the same candidate', 'What candidates report about the experience, separated by interview format, because completion rate and satisfaction are not the same measure', 'How often recruiters override the recommendation, which is the closest available proxy for whether the scoring is any good'] },
      ] },
      { h2: 'How to read anyone\'s benchmark report', body: 'Since you are likely to be handed one by some vendor, these are the questions that separate a real benchmark from a marketing asset.', blocks: [
        { kind: 'split', items: [
          { t: 'What was the sample?', d: 'How many customers, how many candidates, over what period, in which industries. A headline like "based on hundreds of thousands of interviews" means nothing without knowing how many organisations that came from. It could be three.' },
          { t: 'Compared against what?', d: 'A time to fill improvement is meaningless without the baseline process. Faster than what, measured how, at which stage?' },
          { t: 'Who selected the sample?', d: 'If the vendor chose which customers to include, the number describes their best accounts, not their product.' },
          { t: 'Is the methodology published?', d: 'If you cannot reconstruct how the figure was calculated, it is a claim rather than a measurement.' },
        ] },
        { kind: 'note', tone: 'info', title: 'Why we are saying this on our own empty page', text: 'Because the same test applies to us when we do publish one. Stating the standard now is a commitment we can be held to later, and it is more useful to a buyer today than a fabricated figure would be.' },
      ] },
      { h2: 'What to do instead', body: 'Run Mimic on a role you are actually hiring for. Your own completion rate, your own score distribution and your own override rate will tell you more about whether this works for your roles than any aggregate across customers could, including a real one.' },
    ], 'Be told when it publishes', 'Book a demo and we’ll add you to the list.',
    [
      { q: 'When will the benchmark be published?', a: 'No date. It requires an aggregate dataset large enough to generalise from, and we do not have one. We would rather publish late than publish a figure we cannot defend.' },
      { q: 'Do you have any performance figures at all?', a: 'None that are verified, which is why none appear anywhere on this site. The ROI calculator does arithmetic on numbers you supply. It contains no benchmark from us.' },
    ],
    [
      { label: 'ROI calculator', to: '/resources/roi-calculator' },
      { label: 'Customer stories', to: '/resources/customer-stories' },
      { label: 'Recruiter analytics', to: '/platform/recruiter-analytics' },
      { label: 'Certifications', to: '/trust/certifications' },
    ]),
  page('resources/documentation', 'C', 'Build · Docs', 'Documentation.', 'Documentation | Mimic', 'Guides for setting up templates, question sets, pipelines and integrations, plus how scoring and rubrics work.', 'Everything to set Mimic up and run it well, for admins and developers.',     [
      { h2: 'There is no documentation site yet', body: '', blocks: [
        COMING_SOON('No public documentation site exists. This page is a map of what would be in one, and where the answers currently live.'),
      ] },
      { h2: 'What you need to know to run Mimic', body: 'Setting it up is mostly four decisions, and the Platform pages cover each in detail.', blocks: [
        { kind: 'spec', caption: 'Setup, in order', rows: [
          { k: '1. Build a rubric', v: 'Criteria and weights for the role. Six general KPI criteria ship as a starting point. See Rubrics & scoring.' },
          { k: '2. Decide where questions come from', v: 'A fixed set you author, or generated from each candidate\'s resume (1–25). See Question sets.' },
          { k: '3. Choose a format and timings', v: 'One of five interview formats, with prep and answer windows (30s / 120s by default, overridable per question). See Interview templates.' },
          { k: '4. Invite', v: 'Upload a candidate list up to 10 MB, preview the email, do a dry run of the batch, send. See Bulk invitations.' },
        ] },
      ] },
      { h2: 'Operational facts worth knowing up front', body: 'The limits and behaviours that most often surprise a new team.', bullets: ['Resume uploads: PDF, DOCX or TXT, max 8 MB; extracted text truncated at 20,000 characters', 'Candidate lists: max 10 MB, split larger intakes into batches, which is safer anyway', 'Live voice sessions cap at roughly 15 minutes', 'Invite links are bound to the recipient\'s email address; the candidate signs in with that address', 'Without an AI provider key the product still runs, with scoring falling back to a heuristic based on length that the interface labels as approximate', 'Without an email key, sending degrades to a dry run rather than a partial delivery of the batch', 'Mimic runs as a single instance. There is no horizontal scaling today'] },
      { h2: 'Where the real detail is today', body: 'The Platform section documents each capability with its actual settings, and the Trust section documents scoring, oversight, subprocessors and data handling. Between them they are more complete than most vendor doc sites. They are just organised as product pages rather than as documentation.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'For the team: a docs site needs an owner, a home, and a decision about whether it is public or gated. Until then, pointing enterprise buyers at the Trust section is the better answer.' },
      ] },
    ], 'Get set up fast', 'Book a demo and we’ll walk your team through setup.'),
  page('resources/api-reference', 'C', 'Build · API', 'API reference.', 'API Reference | Mimic', 'Programmatically create sessions, invite candidates, and pull scored results into your own systems.', 'Wire Mimic into your stack, create sessions, invite candidates and pull results.',     [
      { h2: 'No published API reference yet', body: '', blocks: [
        COMING_SOON('There is no public API reference. The API exists and the product runs on it, but it has not been documented or committed to as a stable external contract.'),
        { kind: 'p', text: 'That distinction matters. An internal API that a frontend calls is not the same thing as a supported public API with versioning, deprecation policy and a stability guarantee. Publishing a reference implies the second, and we should not imply it before it is true.' },
      ] },
      { h2: 'What integration looks like today', body: 'In practice, export and import, not API calls.', blocks: [
        { kind: 'steps', items: [
          { t: 'Candidates in', d: 'A CSV or Excel export from your ATS, or a PDF, DOCX or TXT list. Up to 10 MB, validated row by row before anything sends.' },
          { t: 'Interviews run', d: 'Asynchronously, on the candidate\'s own schedule.' },
          { t: 'Results out', d: 'Reports for each candidate as PDF; pipeline data exported per role with names, emails and scores by round.' },
        ] },
        { kind: 'note', tone: 'limit', text: 'There are no direct ATS connectors, no Greenhouse, Lever, Workday, SmartRecruiters, iCIMS, Bullhorn, Taleo or Ashby integration, and no automatic write-back of statuses or scores. See ATS integrations for the full picture.' },
      ] },
      { h2: 'Authentication, as it actually works', body: 'Worth stating because it shapes any integration you might plan. The API authenticates with a Firebase ID token passed as a bearer token, and the server verifies it on every request. Roles come from a Firestore user document rather than from token claims. Provider keys for the AI, video and email services are held on the server and never reach the browser, with one exception documented on the Trust pages.' },
      { h2: 'If you need programmatic access', body: 'Raise it early rather than designing around an assumption. What is technically possible and what is supported are different questions, and the second one needs a product decision.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'For the team: decide whether a public API is a committed capability. If it is, it needs a base URL, an auth model for machine clients (ID tokens are scoped to a user and short-lived, service accounts or API keys would be needed), versioning, rate limits and a deprecation policy. Until those exist, this page should keep saying no.' },
      ] },
    ], 'Talk to our team', 'Book a demo to discuss your integration.'),
  page('resources/ats-integrations', 'A', 'Build · Integrations', 'Mimic fits the ATS you already run.', 'ATS Integrations | Mimic', 'Mimic works alongside the ATS you already run, using exports and imports, no rip and replace, and no migration required to start.', 'You are not replacing your ATS. Mimic runs beside it: you export candidates in, and take scored results back out.',
    [
      { h2: 'How it works today', body: 'Mimic sits next to your ATS rather than inside it. Your ATS stays the system of record; Mimic runs the screening round and hands the results back.', blocks: [
        { kind: 'steps', items: [
          { t: 'Export candidates from your ATS', d: 'A CSV or Excel export is the usual route. PDF, DOCX and TXT candidate lists are also parsed, up to 10 MB.' },
          { t: 'Invite them in bulk', d: 'The wizard runs in five steps. It validates every row, lets you preview the rendered email, and offers a dry run before anything sends.' },
          { t: 'Candidates interview and are scored', d: 'Against the rubric on your template, in whichever of the five formats you chose.' },
          { t: 'Take the results back', d: 'Individual reports export as PDF; pipeline data exports per role with names, emails and scores by round.' },
        ] },
        { kind: 'flow', steps: ['ATS export', 'Bulk invite', 'Interview + score', 'Export results', 'Update ATS'], caption: 'Your ATS remains the system of record throughout.' },
      ] },
      { h2: 'What does not exist yet', body: 'Being straight about this matters more than a checkbox on a comparison grid.', blocks: [
        { kind: 'note', tone: 'limit', title: 'No direct ATS connectors today', text: 'Mimic does not currently ship named connectors for Greenhouse, Lever, Workday, SmartRecruiters or any other ATS, and it does not write statuses or scores back automatically. Integration today is export and import. If an earlier version of this page implied otherwise, that was wrong.' },
        { kind: 'note', tone: 'placeholder', text: 'If direct connectors are on the roadmap, the team should state which systems and on what timeline. A dated roadmap is credible; an unnamed "available on enterprise plans" is not.' },
      ] },
      { h2: 'Why exports are a reasonable starting point', body: 'It is genuinely how most teams begin, and it has advantages worth naming: you can run a real requisition this week without an integration project, without IT involvement, and without committing to a tool before you have seen it work on your own roles. If it does not suit you, there is nothing to unwind.' },
    ], 'Check your workflow', 'Book a demo and we will walk through how this fits your current ATS process.',
    [
      { q: 'Do you integrate directly with our ATS?', a: 'Not today. There are no named ATS connectors, and Mimic does not write statuses or scores back automatically. Candidates come in via export and results go back out via export.' },
      { q: 'Do we need to migrate off our ATS?', a: 'No. Your ATS stays the system of record. Mimic runs the screening round beside it.' },
      { q: 'What can we get out of Mimic?', a: 'Reports for each candidate as PDF, and pipeline data exported per role with names, emails and scores by round.' },
      { q: 'Is there an API?', a: 'The programmatic surface available for integration work is marked for the team to confirm rather than described speculatively here.' },
    ],
    [
      { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
      { label: 'Candidate reports', to: '/platform/candidate-reports' },
      { label: 'Interview pipelines', to: '/platform/pipelines' },
      { label: 'People analytics', to: '/solutions/people-analytics' },
    ]),
  page('resources/changelog', 'C', 'Build · Changelog', 'What’s new in Mimic.', 'Changelog | Mimic', 'Product updates, improvements and fixes to Mimic, shipped continuously.', 'What we’ve shipped, in plain language.',
    [
      { h2: 'No release notes published', body: '', blocks: [
        COMING_SOON('No changelog entries exist. We are not going to backfill an invented version history to make this page look established.'),
      ] },
      { h2: 'What will be recorded here', body: 'A changelog is only useful if it says what changed for the person reading it, so this one will note the changes that reach customers, rather than internal refactors.', bullets: ['New interview formats or changes to how an existing one behaves', 'Anything that changes how scoring works. A rubric change alters results, and you should hear about it from us rather than notice it', 'New settings on templates, question sets or pipelines', 'Changes to limits: file sizes, session lengths, batch caps', 'Anything affecting the candidate experience', 'Security and compliance changes, including any movement on the open items in the Trust section'] },
      { h2: 'The one we would flag first', body: 'When the decision is made on the features that infer emotion (voice rounds and video avatar rounds currently score named emotions, which is prohibited for EU candidates under AI Act Art 5(1)(f)), that change will be recorded here and on the Trust pages. It is the most consequential pending change to the product.' },
      { h2: 'Why a scoring change gets its own notice', body: 'Most changelogs treat a model or prompt change as an implementation detail. Here it is not: the rubric score is the product\'s output, and altering how it is produced changes results for candidates assessed before and after. Two candidates scored either side of such a change were not measured identically, which is exactly the comparability the whole product rests on. So any change to scoring gets stated plainly, with a date, and if you are running a live requisition when one lands, you should know about it rather than discover it in a distribution.' },
    ], 'Subscribe to updates', 'Book a demo and we’ll keep you posted.',
    undefined,
    [
      { label: 'Trust Center', to: '/trust/trust-center' },
      { label: 'EU AI Act', to: '/trust/eu-ai-act' },
      { label: 'Signal analysis', to: '/platform/signal-analysis' },
      { label: 'Documentation', to: '/resources/documentation' },
    ]),
  page('resources/help', 'C', 'Build · Help', 'Help centre.', 'Help Centre | Mimic', 'Answers to common setup and usage questions, plus how to reach Mimic support.', 'Quick answers, and a fast path to a human when you need one.',
    [
      { h2: 'No help centre yet, but the answers exist', body: '', blocks: [
        COMING_SOON('There is no searchable help centre. The common questions are answered below and across the Platform pages.'),
      ] },
      { h2: 'The questions that actually come up', body: '', blocks: [
        { kind: 'spec', caption: 'Quick answers', rows: [
          { k: 'A candidate says the link does not work', v: 'The link is bound to the address it was sent to. They must sign in, or create a candidate account, with that exact email. The server returns a message saying so.' },
          { k: 'A candidate lost connection mid-answer', v: 'Drafts save as they type. They reopen the link and continue; the answer in progress is not lost.' },
          { k: 'Scores look wrong', v: 'Read the evidence behind two candidates who ranked high and two who ranked low. If you disagree, the rubric is wrong, and it is quick to change.' },
          { k: 'Scores say "approximate"', v: 'No AI provider key is configured, so scoring has fallen back to a heuristic based on length. Add a key in Settings.' },
          { k: 'Nobody is completing the interview', v: 'Check completion rate by role in Analytics. A low rate almost always means the format or the timings are excluding people, not that candidates are weak.' },
          { k: 'Avatar rounds are unavailable', v: 'Video avatar interviews need a Tavus key. Without one the feature reports itself unavailable rather than dropping a candidate into a broken round.' },
          { k: 'An integrity flag was raised', v: 'It is a signal for you to weigh, never an automatic rejection. Tab switches have innocent explanations.' },
          { k: 'We need to change a rubric mid-hire', v: 'Duplicate the template instead of editing it. Candidates already scored were assessed against the old criteria.' },
        ] },
      ] },
      { h2: 'Reaching a person', body: '', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'The team must add the real support route here, email address or in-app channel, hours, and expected response time. Alongside the contact page, this is the most important placeholder on the site to close: a customer with a live problem should not have to book a sales demo to reach someone.' },
      ] },
    ], 'Need a hand?', 'Book a demo or reach support and we’ll help.',
    undefined,
    [
      { label: 'Documentation', to: '/resources/documentation' },
      { label: 'Interview templates', to: '/platform/interview-templates' },
      { label: 'Recruiter analytics', to: '/platform/recruiter-analytics' },
      { label: 'Contact', to: '/company/contact' },
    ]),
]
const COMPANY_PAGES: MktPage[] = [
  page('company/about', 'A', 'About · Company', 'AI interviews for every candidate, built by TalbotIQ.', 'About TalbotIQ, the team behind Mimic', 'TalbotIQ builds Mimic: AI interviewing that measures every candidate the same way and keeps a human on every decision.', 'We started TalbotIQ because the first round of hiring was broken: good people wait weeks, recruiters drown, and no two candidates get the same interview. Mimic is our answer.',     [
      { h2: 'The problem we started with', body: 'The first round of hiring is where the process breaks. Good candidates wait weeks for a call that may never come, recruiters spend their most valuable hours on screens that take twenty minutes, and because those screens are unstructured no two candidates get the same interview, so the results were never comparable in the first place.', blocks: [
        { kind: 'p', text: 'The industry\'s usual answer is to filter harder on the resume. That controls the queue but selects for people who write good CVs, which is rarely the job. Mimic exists because interviewing everyone is the better answer, and it only became practical once the scheduling and the recruiter hours came out of the first round.' },
      ] },
      { h2: 'What we build', body: 'Mimic interviews and scores candidates across five interview formats (timed Q&A, conversational chat, live voice, AI video avatar and a live two-way call), all against one rubric you author. Fast enough for volume, structured enough to defend when someone asks why a candidate was rejected.' },
      { h2: 'What we believe', body: 'These are the product principles, and each one costs us something a competitor would happily ship.', blocks: [
        { kind: 'bullets', items: ['Never fabricate proof, no statistic, customer, certification or quotation appears unless it is real and cleared. An empty proof slot is acceptable; an invented one is not', 'A score is a recommendation with its evidence attached, and a human makes every decision that affects a candidate', 'One rubric, applied identically, comparability is the core value, and anything that breaks it breaks the product', 'Degrade honestly and visibly, when a dependency is missing the product keeps working and says so', 'The candidate is a user, not a subject, disclosure is explicit, it works on a phone, progress is never lost, and scores are never shown to them'] },
        { kind: 'note', tone: 'info', title: 'Where you can check this', text: 'The Trust section documents the mechanisms and lists the open items, including the unflattering ones. Certifications we do not hold are named as not held; customer stories we cannot verify are absent rather than invented.' },
      ] },
      { h2: 'The company', body: 'Mimic is built by TalbotIQ.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'Founding year, headquarters, team size, funding and leadership are for the team to confirm and add. Left blank rather than filled with text that sounds plausible. The same rule the rest of this site follows.' },
      ] },
    ], 'Work with us', 'Book a demo, or see open roles on the careers page.',
    undefined,
    [
      { label: 'Trust Center', to: '/trust/trust-center' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Contact', to: '/company/contact' },
      { label: 'Careers', to: '/company/careers' },
    ]),
  page('company/careers', 'C', 'About · Careers', 'Build the future of fair hiring.', 'Careers at TalbotIQ | Mimic', 'Join the team building AI interviewing that’s fast, fair and defensible. See open roles at TalbotIQ.', 'We’re a small team with an outsized mission: make the first round fair and fast for everyone.',
    [
      { h2: 'No roles listed', body: '', blocks: [
        COMING_SOON('There are no open roles published. We will not list positions that are not genuinely open, which is a low bar, and one a surprising number of careers pages fail.'),
      ] },
      { h2: 'What working on this actually involves', body: 'Worth knowing before you introduce yourself, because it is unusual and it is not for everyone.', blocks: [
        { kind: 'bullets', items: ['The product makes decisions about people\'s livelihoods, so the constraints are real, "we could ship it faster without the audit trail" is not an argument that wins here', 'The rules are enforced, not aspirational: no invented statistics, no unverified certifications, no customer stories the customer has not approved. This site has an automated check that fails the build on claims we cannot support', 'Compliance is a product concern rather than a legal afterthought, one of our features is currently prohibited in the EU, and that is being addressed as a product decision', 'It is a small team, close to customers and close to the product'] },
      ] },
      { h2: 'Introduce yourself anyway', body: 'If the above sounds like the kind of problem you want, say so, and say what you would want to work on. Speculative introductions that engage with the actual problem are read properly; generic ones are not.' },
    ], 'Introduce yourself', 'Tell us where you’d make an impact.'),
  page('company/newsroom', 'C', 'About · Newsroom', 'News & press.', 'Newsroom | TalbotIQ & Mimic', 'Announcements, press coverage and media resources for TalbotIQ and Mimic.', 'Company and product news, and everything press need in one place.',
    [
      { h2: 'No announcements yet', body: '', blocks: [
        COMING_SOON('There are no press releases, funding announcements or media coverage to share.'),
      ] },
      { h2: 'For journalists writing about AI hiring', body: 'If you are covering this space rather than this company, the useful material here is not a press release.', blocks: [
        { kind: 'bullets', items: ['How Mimic scores, the full mechanism, including what happens when the AI provider is absent', 'Bias testing & audits, why a screening tool holding no demographic data cannot audit itself for adverse impact, which is a claim worth checking against other vendors', 'EU AI Act, including that emotion inference in recruitment has been prohibited since February 2025, not merely regulated', 'Signal analysis, which documents a feature of our own product as prohibited for EU candidates'] },
        { kind: 'note', tone: 'info', title: 'An offer', text: 'We will answer specific questions about how the product works, including unflattering ones. The Trust section already lists what we do not have (no certifications, no published audit, no customer stories), so those are not gotchas.' },
      ] },
      { h2: 'Facts you can safely attribute', body: 'Everything here is verifiable from the product or from this site, and none of it is embargoed.', blocks: [
        { kind: 'bullets', items: ['Mimic is built by TalbotIQ; the product conducts and scores first round interviews across five formats against one rubric a recruiter authors', 'It holds no demographic data on candidates and does not infer protected characteristics', 'It publishes no security certification and no bias audit by a third party, both are listed as open items', 'No customer stories or performance statistics are published, because none have been verified with the named customer', 'Two real client logos appear on the site: Total IT Global and Aisling'] },
        { kind: 'note', tone: 'info', title: 'What we will not do', text: 'Supply a statistic on request that does not already appear on this site. If a figure is not here, it is because it is not verified, and it will not become verified because a deadline is close.' },
      ] },
      { h2: 'Press contact', body: '', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'The team must add a press contact address and, if one exists, a media kit with logos and approved product imagery.' },
      ] },
    ], 'Media enquiries', 'Reach out and we’ll respond quickly.',
    undefined,
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'EU AI Act', to: '/trust/eu-ai-act' },
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
      { label: 'About TalbotIQ', to: '/company/about' },
    ]),
  page('company/contact', 'A', 'About · Contact', 'Talk to us.', 'Contact TalbotIQ | Mimic', 'Reach sales, support, partnerships or press. Book a demo, or send us a note and we’ll route you to the right person.', 'Whatever you need (a demo, a security review, a partnership), start here and we’ll get you to the right person fast.',     [
      { h2: 'Evaluating Mimic', body: 'Book a demo and we will run it on your own open requisitions rather than a canned dataset. That is a more useful half hour than any deck, and it is the only proof we can offer honestly, we publish no customer stories or benchmark figures, because none have been confirmed.', blocks: [
        { kind: 'bullets', items: ['Bring one or two real roles and the criteria you would score them on', 'Ask what happens without an AI key. The answer should be "it degrades and says so"', 'Ask for the report behind any claim on this site; the Trust section lists what we do not have'] },
      ] },
      { h2: 'Security and legal review', body: 'Start with the Trust Center rather than a questionnaire. It documents scoring, human oversight, subprocessors and data handling, and lists the open items, including the ones that will appear as gaps in your review. Flagging those early is deliberate; it is a shorter path than discovering them at the end.', blocks: [
        { kind: 'note', tone: 'info', title: 'What will show as open', text: 'No security certification from a third party or bias audit is published. Retention periods, deletion routes and model documentation are still to be confirmed. Mimic runs as a single instance with no multi-region replication, and there are no direct ATS connectors.' },
      ] },
      { h2: 'Support, partnerships and press', body: '', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'The team must add the real routes here before this page is published: the support channel for existing customers, a partnerships address, a press address, a security disclosure address, and a postal address if one is listed. A contact page with no contact details is the one page where a placeholder is genuinely unhelpful. This should be the first gap closed.' },
      ] },
    ], 'Book a demo', 'The quickest way to a useful conversation.',
    [
      { q: 'What is the fastest way to evaluate this?', a: 'A walkthrough on your own roles. Bring one or two real requisitions and the criteria you would score against.' },
      { q: 'Can you complete our security questionnaire?', a: 'Yes, and the open items listed in the Trust Center will appear in it as open. That is intentional rather than something to discover late.' },
      { q: 'Do you have reference customers?', a: 'Ask on a call. We do not publish stories or testimonials the named customer has not approved, which today means none are published.' },
    ],
    [
      { label: 'Trust Center', to: '/trust/trust-center' },
      { label: 'About TalbotIQ', to: '/company/about' },
      { label: 'Legal & privacy', to: '/company/legal' },
      { label: 'Certifications', to: '/trust/certifications' },
    ]),
  page('company/partners', 'C', 'Connect · Partners', 'Partner with Mimic.', 'Partners | Mimic by TalbotIQ', 'Technology and services partners who help customers screen faster and more fairly with Mimic.', 'We work with ATS platforms, RPOs and services firms to get customers to value faster.',
    [
      { h2: 'No formal partner programme yet', body: '', blocks: [
        COMING_SOON('There is no published partner programme, no tiers, no commercials, no application process.'),
      ] },
      { h2: 'Where a partnership would make sense', body: 'Three shapes, and the honest state of each.', blocks: [
        { kind: 'split', items: [
          { t: 'ATS and HR tech', d: 'The most obvious fit, and currently the least ready: Mimic ships no direct ATS connectors, so any integration would be a build rather than a configuration.' },
          { t: 'RPO and staffing', d: 'The strongest fit today. Branding, question sets and rubrics for each client already work on templates, which is most of what an agency needs.' },
          { t: 'Consultancies and advisors', d: 'Particularly around rubric design and AI hiring compliance, where the product deliberately does not tell customers what good looks like for their roles.' },
        ] },
      ] },
      { h2: 'If you are considering it', body: 'Worth knowing before a conversation: there are no ATS connectors today, no published certifications, and one open compliance decision on the emotion inference features. None of that is hidden, and a partner should hear it from us first.' },
      { h2: 'What a partner would need from us that does not exist yet', body: 'Being specific about the gaps is more useful than a programme page that implies readiness.', bullets: ['Named ATS connectors, or at minimum a documented and supported API, integration today is export and import', 'A published security attestation, which most enterprise procurement will require before a partner can resell', 'Retention periods and deletion SLAs in writing, since a partner inherits those commitments to their clients', 'Resolution of the emotion inference decision, because a partner selling into the EU cannot carry that exposure on our behalf', 'Commercial terms, enablement material and a support escalation path'], blocks: [
        { kind: 'note', tone: 'placeholder', text: 'For the team: a partner programme needs tiers, commercial terms, enablement material and an application route. Until it exists this page should keep saying so rather than inviting applications into a process that is not there.' },
      ] },
    ], 'Explore partnership', 'Tell us how you’d like to work together.'),
  page('company/reseller', 'C', 'Connect · Reseller', 'Become a reseller.', 'Become a Reseller | Mimic', 'Resell Mimic to your clients with margin, enablement and support from the TalbotIQ team.', 'Bring structured AI screening to your clients, with the commercials and support to make it work.',
    [
      { h2: 'No reseller programme yet', body: '', blocks: [
        COMING_SOON('There are no published reseller terms, no margin structure, no enablement material, no application route.'),
        { kind: 'p', text: 'Rather than invite applications into a process that does not exist, here is what a reseller would actually be selling today, stated plainly enough to judge.' },
      ] },
      { h2: 'What the product does well for an agency', body: '', blocks: [
        { kind: 'bullets', items: ['Branding, question sets and rubrics for each client, all set on templates, so each client account carries its own standard and identity', 'Five interview formats scoring against one rubric, so results are comparable across clients and roles', 'Evidence attached to every score, which makes a submittal something a client can check rather than take on trust', 'The first round stops scaling with recruiter headcount, which is where agency margin actually comes from'] },
      ] },
      { h2: 'What you would have to be able to answer', body: 'A reseller inherits the product\'s gaps as well as its strengths, and these will come up in a client\'s procurement review.', bullets: ['No direct ATS connectors, integration is export and import', 'No published security certification or bias audit by a third party', 'Single instance architecture: no multi-region replication or HA failover', 'An open decision on the emotion inference features, which are prohibited for EU candidates under AI Act Art 5(1)(f)', 'Retention periods and deletion SLAs not yet published'] },
      { h2: 'Talk to us anyway', body: 'If reselling Mimic is genuinely interesting, the conversation is more useful than the page, and it would help shape a programme that does not exist yet.' },
    ], 'Talk to our team', 'Let’s discuss a reseller arrangement.'),
  page('company/events', 'C', 'Connect · Events', 'Events.', 'Events | Mimic by TalbotIQ', 'Where to meet the TalbotIQ team, conferences, meetups and webinars.', 'Come say hello in person or online.',
    [
      { h2: 'Nothing scheduled', body: '', blocks: [
        COMING_SOON('No events, conferences or meetups are scheduled, and none have been held.'),
      ] },
      { h2: 'The better use of your time', body: 'Thirty minutes walking through your own open requisitions will tell you more than a stand at a conference. The questions are yours, the roles are yours, and you can ask the awkward ones. That is available now.' },
      { h2: 'If you are hosting something', body: 'If you run an internal talent acquisition session, a training for hiring managers, or a compliance briefing where AI interviewing is on the agenda, ask. A working session for your team is easier to arrange than a public event, and more useful to both sides.' },
      { h2: 'What we would actually be useful on', body: 'Not a product pitch. Three subjects where we have something specific to contribute, because the material is already written and argued on this site.', bullets: ['Why emotion inference in recruitment is prohibited in the EU rather than merely regulated, including that one of our own features falls under it', 'How adverse impact analysis works when the screening tool deliberately holds no demographic data, and why a tool that audits itself is a contradiction', 'Rubric design as the actual determinant of screening quality, and why delegating it away from the hiring manager is the most common failure'] },
    ], 'Meet the team', 'Book a demo and we’ll tell you where we’ll be.',
    [
      { q: 'Are you exhibiting at any conferences?', a: 'No. Nothing is booked, and we would rather say so than list an industry calendar we are not attending.' },
      { q: 'Can you speak at our internal session?', a: 'Ask. A working session for your talent and legal teams together is more useful than a conference stand, and considerably easier to arrange.' },
    ],
    [
      { label: 'Contact', to: '/company/contact' },
      { label: 'Webinars', to: '/resources/webinars' },
      { label: 'About TalbotIQ', to: '/company/about' },
      { label: 'Trust Center', to: '/trust/trust-center' },
    ]),
  page('company/legal', 'C', 'Connect · Legal', 'Legal & privacy.', 'Legal & Privacy | Mimic by TalbotIQ', 'Privacy notice, terms of service, DPA and subprocessor list for Mimic and TalbotIQ.', 'The documents your legal team needs, in one place. This page links documents; it is not legal advice.',     [
      { h2: 'Documents', body: 'This page exists to link the documents your legal team needs. It is not legal advice, and it does not itself constitute any of them.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'To be added by the team: Privacy Notice, Terms of Service, Data Processing Agreement, and the subprocessor list required under Article 28. Until those exist as documents, the Subprocessors page in the Trust section is the most complete statement of which third parties a deployment engages, derived from the product\'s actual configuration surface.' },
      ] },
      { h2: 'Data subject requests', body: 'Access, rectification, erasure and portability requests are the ones that arrive in practice, under GDPR and India\'s DPDP Act. Deletion controls exist in the product; the request route and the committed timeframe are the parts that need publishing.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'Confirm and publish: the route by which a candidate or customer exercises each right, who handles it, the committed response time, the default retention period for interview data and any recorded audio or video, and the privacy or DPO contact. Note that Illinois AIVIA sets a 30-day statutory window for video deletion on request, so any commitment must be at least that fast for video rounds.' },
      ] },
      { h2: 'What can be said accurately today', body: 'Rather than leave this page as nothing but placeholders, these are the facts about data handling that are already established and documented elsewhere in the Trust section.', bullets: ['Mimic collects no demographic data and does not infer protected characteristics', 'Candidates are told they are interviewing with AI and consent before starting; video rounds add explicit consent to recording and AI analysis', 'Data location follows where the instance is deployed and where its Firebase project was created, decided when the instance goes live, not switchable afterwards', 'Interview formats that use only text generate no audio or video at all, which is the simplest way to reduce what has to be retained', 'Candidates never see scores, reports, or any other candidate\'s data'] },
    ], 'Questions for legal?', 'We’ll connect you with the right person.',
    undefined,
    [
      { label: 'Subprocessors', to: '/trust/sub-processors' },
      { label: 'Data residency & retention', to: '/trust/data-residency-retention' },
      { label: 'GDPR & India DPDP', to: '/trust/gdpr-india-dpdp' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
    ]),
]

/* ─── Platform pages ───────────────────────────────────────────────────────
 * The 5 interview tracks are the crown-jewel product/SEO pages (Tier A); the
 * workflow + intelligence items are tighter capability pages (Tier B). */
/* Which platform pages carry a recording, keyed by the bare slug.
 *
 * Looked up inside plat() rather than passed as a tenth positional argument, so
 * the fourteen call sites below need no change: only the five interview tracks
 * have footage, and the workflow and intelligence pages correctly get
 * `undefined`. Copy comes from demoAssets.ts, so a caption cannot drift between
 * the home page's card and the page the card links to. */
const ALL_TRACK_DEMOS: Record<string, PageDemo> = {
  'conversational-chat': { track: 'chatbot',      ...DEMO_COPY.chatbot },
  'voice-screening':     { track: 'voice',        ...DEMO_COPY.voice },
  'ai-video-avatar':     { track: 'video_avatar', ...DEMO_COPY.video_avatar },
  'live-two-way':        { track: 'two_way',      ...DEMO_COPY.two_way },
  'timed-qa':            { track: 'chat',         ...DEMO_COPY.chat },
}

/* Only the formats that have footage. A page whose format has not been recorded
   renders with no demo block at all, exactly as it did before — never an empty
   player with a caption promising something the viewer cannot see. See
   RECORDED_TRACKS in demoAssets.ts for what is missing and why. */
const TRACK_DEMOS: Record<string, PageDemo> = Object.fromEntries(
  Object.entries(ALL_TRACK_DEMOS).filter(([, d]) => hasDemo(d.track)),
)

function plat(slug: string, tier: 'A' | 'B', kicker: string, h1: string, metaTitle: string, metaDesc: string, intro: string, sections: PageSection[], faqs?: FaqItem[], related?: NavLink[]): MktPage {
  return { slug: `platform/${slug}`, section: 'Platform', sectionTo: '/platform', tier, kicker, h1, metaTitle, metaDesc, intro, sections, demo: TRACK_DEMOS[slug], faqs, related, cta: { title: 'See it on your roles', sub: 'Book a 30-minute walkthrough, no card required.' } }
}

/* Shared, factual copy used across the track pages. Written once so the same
 * claim cannot drift between pages. Every value here is the product's real
 * default or documented limit — see docs/manual-inventory.md §4.13, §5.1. */
const INTAKE_STEPS = [
  { t: 'Open the invite link', d: 'The link is bound to the address it was sent to. The candidate signs in, or creates a candidate account, with that same email, which is what stops interviews being forwarded or taken by someone else.' },
  { t: 'Name and resume', d: 'Full name (at least two characters) and a resume as PDF, DOCX or TXT, up to 8 MB. Mimic reads the text and writes the interview around what the resume actually claims.' },
  { t: 'Readiness check and consent', d: 'Connection, a quiet space, and an explicit tick that they understand the rules. Video and avatar rounds add a consent step covering recording and AI analysis before anything starts.' },
]
const RESUME_LIMITS = 'Resume uploads are capped at 8 MB and read as PDF, DOCX or TXT; extracted text is truncated at 20,000 characters. A file Mimic cannot read text from is rejected with a plain message rather than a silent failure.'
const PLATFORM_PAGES: MktPage[] = [
  plat('conversational-chat', 'A', 'Interview tracks · Async', 'A first interview candidates finish on their phone in minutes.',
    'Conversational Chat Interviews | Mimic', 'A text interview candidates finish on a phone in minutes, adapting to each resume, scored on your rubric. Ideal for hourly and high volume roles.',
    'Scheduling is where the first round dies. A chat interview removes it entirely: candidates answer on their phone, whenever they can, and you get a scored result the same day.',
    [
      { h2: 'The problem it solves', body: 'A phone screen in the first round costs a recruiter 20–30 minutes and has to be booked, rescheduled and chased. Multiply that by every applicant on a high volume req and the round simply stops happening: most applicants are filtered on a resume they wrote rather than an answer they gave. The people who lose most are the ones whose experience does not read well on paper.', blocks: [
        { kind: 'p', text: 'A conversational interview removes the calendar from the equation. The candidate answers in text, in a browser, at whatever hour suits them, and because the interview is structured and scored the same way for everyone, you can actually compare the results.' },
      ] },
      { h2: 'What it is', body: 'A typed, back and forth interview with an AI interviewer that has read the candidate\'s resume. It greets them, checks they are ready, asks your questions, and follows up on answers that need probing, then scores the whole conversation against your rubric.', blocks: [
        { kind: 'p', text: 'It is a conversation, not a form. The interviewer reacts to what the candidate actually said, which is what makes the transcript worth reading afterwards.' },
      ] },
      { h2: 'How it works', body: '', blocks: [
        { kind: 'steps', items: [
          ...INTAKE_STEPS,
          { t: 'A greeting, then a readiness check', d: 'The opening turn is a greeting, not a question. It ends by asking whether they are ready. If they are not, they can take a timed break of 30 seconds, 45 seconds or a minute and start when it ends. Nobody is dropped into question one cold.' },
          { t: 'Structured questions, with preparation time', d: 'Each question opens with preparation time before the answer clock starts, and a STAR prompt (Situation, Task, Action, Result), so candidates know what a good answer looks like.' },
          { t: 'Adaptive follow-ups', d: 'When an answer is thin or skips the point, the interviewer probes rather than moving on. Follow-ups are written from the resume and the answer just given.' },
          { t: 'Automatic submission and closing', d: 'At zero, whatever is typed is submitted and the interview advances, progress is never lost. At the end the candidate sees a plain confirmation that their responses went to your team.' },
        ] },
        { kind: 'flow', steps: ['Invite link', 'Resume', 'Consent', 'Greeting', 'Questions + follow-ups', 'Scored report'], caption: 'The same sequence runs for every candidate, which is what makes the scores comparable.' },
      ] },
      { h2: 'What you configure', body: 'Everything that shapes the interview lives on a reusable template, so a team configures it once and every req inherits it.', blocks: [
        { kind: 'spec', caption: 'Set on the interview template', rows: [
          { k: 'Questions', v: 'A fixed question set you maintain, or questions generated from the candidate\'s own resume (1–25).' },
          { k: 'Preparation time', v: 'Default 30 seconds, overridable per question.' },
          { k: 'Answer time', v: 'Default 120 seconds, overridable per question.' },
          { k: 'Skip preparation', v: 'Allow candidates to start answering early, or hold them to the full prep window.' },
          { k: 'Early submission', v: 'Allow submitting before the clock ends, or require the full window.' },
          { k: 'Scoring rubric', v: 'Six default KPI criteria or your own; weights normalise to 100%.' },
          { k: 'Integrity checks', v: 'Tab switch, fullscreen exit and paste/copy detection, with warnings the candidate sees.' },
          { k: 'Branding', v: 'Company name, logo and accent colour on the candidate screens and emails.' },
        ] },
      ] },
      { h2: 'What the recruiter gets', body: 'A scored report per candidate, with the working shown.', blocks: [
        { kind: 'split', items: [
          { t: 'A score per rubric criterion', d: 'Not a single opaque number, each criterion scored separately, then weighted into a total.' },
          { t: 'The evidence behind it', d: 'Every score points back to the part of the transcript it came from, so you can check the machine\'s reasoning.' },
          { t: 'The full transcript', d: 'The whole conversation, including follow-ups, readable end to end.' },
          { t: 'A recommendation, not a decision', d: 'Advancing, rejecting and overriding are recruiter actions, each written to the audit history for that candidate.' },
        ] },
      ] },
      { h2: 'What the candidate experiences', body: 'It is designed to be finishable on a phone during a break, without an app, and without losing work.', bullets: ['Works in a mobile browser, nothing to install', 'Drafts save as they type, so a dropped connection does not cost the answer', 'A timer ring appears only on timed turns, never during the greeting or a break', 'They are told they are interviewing with AI, and consent before starting', 'They never see scores, reports or another candidate\'s data'] },
      { h2: 'Limits and honest degradation', body: '', blocks: [
        { kind: 'note', tone: 'limit', text: RESUME_LIMITS },
        { kind: 'note', tone: 'info', title: 'Without an AI key', text: 'Mimic keeps running, but question generation and scoring fall back to a heuristic based on length. The product labels that result as approximate in the interface rather than presenting it as a real score.' },
      ] },
    ],
    [
      { q: 'Do candidates need an account?', a: 'Yes. The invite link is bound to the email address it was sent to, and the candidate signs in, or creates a candidate account, with that address. This is deliberate: it is what prevents an interview link being forwarded and completed by someone else.' },
      { q: 'How long does it take a candidate?', a: 'It depends on how many questions you set and your prep/answer timings. With the defaults (30 seconds prep, 120 seconds to answer), a short set finishes in minutes rather than the half hour a phone screen costs.' },
      { q: 'Can a candidate go back and change an earlier answer?', a: 'No. Once they continue, that question is closed, and the interface tells them so before they move on. Every candidate works under the same constraint, which is what keeps the comparison fair.' },
      { q: 'What happens if their connection drops mid-answer?', a: 'Drafts are saved as they type, so the answer in progress is not lost. They reopen the link and continue.' },
      { q: 'Is a chat interview really comparable to a voice or video round?', a: 'Yes, because all five interview formats are scored against the same rubric you defined. That is the point of the design: results from different formats sit next to each other and mean the same thing.' },
      { q: 'Does it read the resume, or just ask generic questions?', a: 'It reads the resume first and writes its questions and follow-ups around what that resume claims, unless you have pinned a fixed question set, in which case it asks exactly those.' },
    ],
    [
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Question sets', to: '/platform/question-sets' },
      { label: 'Voice screening', to: '/platform/voice-screening' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
    ]),
  plat('voice-screening', 'A', 'Interview tracks · Async', 'Hear how a candidate communicates, then score it consistently.',
    'AI Voice Screening Software | Mimic', 'Spoken interviews transcribed and scored on tone, pacing and content together, consistent, backed by evidence, no scheduling.',
    'For roles where communication is the job, a resume tells you nothing. Voice screening lets every candidate speak, and scores what they say the same way.',
    [
      { h2: 'The problem it solves', body: 'For customer facing work, how someone speaks is a large part of whether they can do the job, and it is exactly the thing a CV cannot show. The traditional answer is a phone screen, which means a recruiter\'s calendar, which means only a fraction of applicants ever get heard.', blocks: [
        { kind: 'p', text: 'Worse, phone screens are inconsistent by nature. Two recruiters ask different questions, weigh answers differently, and write up whichever details they happened to notice. Voice screening gives every applicant the same spoken interview and applies one rubric to all of them.' },
      ] },
      { h2: 'What it is', body: 'A spoken interview a candidate takes in the browser. Mimic asks the questions aloud, listens, transcribes what was said, and scores the content against your rubric, with delivery signals reported alongside, never instead of, the substance.', blocks: [
        { kind: 'p', text: 'It is a live conversation rather than a series of recordings: the interviewer responds to answers and follows up where an answer is thin.' },
      ] },
      { h2: 'How it works', body: '', blocks: [
        { kind: 'steps', items: [
          ...INTAKE_STEPS,
          { t: 'Microphone check', d: 'The candidate grants microphone access and sees a clear ready state before the interview starts. If permission is blocked, they get a specific instruction to unblock it, not a dead end.' },
          { t: 'A spoken, structured interview', d: 'Questions are asked aloud and answered aloud, in the interview language set on the template. The interviewer follows up when an answer needs probing.' },
          { t: 'Transcription and scoring', d: 'Everything said is transcribed. The transcript, not the audio impression, is what the rubric is scored against, so every score can be traced to words the candidate actually said.' },
        ] },
        { kind: 'flow', steps: ['Invite link', 'Resume', 'Mic check', 'Spoken interview', 'Transcript', 'Scored report'], caption: 'The transcript is the evidence layer: scores cite it, and you can read it.' },
      ] },
      { h2: 'What you configure', body: '', blocks: [
        { kind: 'spec', caption: 'Set on the interview template', rows: [
          { k: 'Questions', v: 'A fixed set you maintain, or generated from the candidate\'s resume (1–25).' },
          { k: 'Interview language', v: 'Configured per template.' },
          { k: 'Preparation / answer time', v: 'Defaults of 30 and 120 seconds, overridable per question.' },
          { k: 'Scoring rubric', v: 'Six default KPI criteria or your own; weights normalise to 100%.' },
          { k: 'Branding', v: 'Company name, logo and accent colour on candidate screens and emails.' },
        ] },
      ] },
      { h2: 'What the recruiter gets', body: '', blocks: [
        { kind: 'split', items: [
          { t: 'A full transcript', d: 'Every answer in text, readable in seconds instead of listened to in real time.' },
          { t: 'Scores with citations', d: 'Each rubric criterion scored, each score pointing at the transcript span behind it.' },
          { t: 'Delivery signals, separately', d: 'Prosody and sentiment are reported as context beside the content score. They are not the score. See Signal analysis for exactly how this is bounded.' },
          { t: 'Comparability', d: 'Because the rubric is the same one your chat, video and live rounds use, a voice result sits directly beside them.' },
        ] },
      ] },
      { h2: 'What the candidate experiences', body: 'A short spoken interview they can take from a quiet room on their own schedule, with no app and no interviewer waiting on them.', bullets: ['Works in a browser, nothing to install', 'They are told they are interviewing with AI, and consent first', 'Microphone permission is requested explicitly, with a recovery path if blocked', 'They never see scores or reports'] },
      { h2: 'Limits and honest degradation', body: '', blocks: [
        { kind: 'note', tone: 'limit', text: 'A live voice session runs to roughly 15 minutes. Design the question set to fit inside that; for longer assessments, split across rounds in a pipeline. ' + RESUME_LIMITS },
        { kind: 'note', tone: 'info', title: 'Without an AI key', text: 'Voice interviews depend on a configured AI provider. Where a key is absent, scoring degrades to a heuristic based on length that the interface labels as approximate rather than presenting as a real assessment.' },
      ] },
    ],
    [
      { q: 'Is the transcript available?', a: 'Yes. The full transcript is part of the report, and every score cites the span it came from. You are never asked to trust a number you cannot check.' },
      { q: 'Do you score accent or voice quality?', a: 'No. The rubric is scored against the transcript, the substance of the answer. Prosody and sentiment are reported alongside as context for a human reader, and are deliberately kept out of the score itself.' },
      { q: 'How long can a voice interview run?', a: 'Roughly 15 minutes for a live session. If you need more, split the assessment into multiple rounds using pipelines rather than stretching one session.' },
      { q: 'What if the candidate has a poor connection or a noisy room?', a: 'The readiness step asks them to confirm a quiet space and a working connection before starting, and microphone status is shown explicitly rather than assumed.' },
      { q: 'Can candidates interview in another language?', a: 'Interview language is configured per template.' },
    ],
    [
      { label: 'Signal analysis', to: '/platform/signal-analysis' },
      { label: 'Conversational chat', to: '/platform/conversational-chat' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Sales & customer facing hiring', to: '/solutions/sales-customer-facing' },
    ]),
  plat('ai-video-avatar', 'A', 'Interview tracks · Async', 'A face to face round that adapts and follows up, on the candidate’s schedule.',
    'AI Video Avatar Interviews | Mimic', 'A configured AI video interviewer that reacts, follows up and probes shallow answers, a real face to face round without the scheduling.',
    'Candidates take a video interview seriously, but scheduling one with a human at scale is impossible. An AI video avatar gives every candidate the face to face round, any time.',
    [
      { h2: 'The problem it solves', body: 'A face to face round is where most hiring signal lives, and it is the round that scales worst. Every conversation costs a calendar slot on both sides, so it gets reserved for a shortlist that was chosen on paper, which means the face to face is confirming a decision rather than informing one.', blocks: [
        { kind: 'p', text: 'One-way video answered scheduling but created a worse experience: a candidate recording answers into a webcam with nothing responding. An avatar round restores the conversation (it reacts, follows up, and probes), while still running at any hour without a recruiter present.' },
      ] },
      { h2: 'What it is', body: 'A video interview conducted by a configured AI interviewer with a face and a voice. It introduces itself, asks your questions, listens, and follows up on answers that need probing, then scores the conversation against the same rubric your other rounds use.', blocks: [
        { kind: 'note', tone: 'info', title: 'Disclosed, always', text: 'Candidates are told they are interviewing with AI and consent before anything is recorded or analysed. This is a product rule, not a setting you can switch off.' },
      ] },
      { h2: 'How it works', body: '', blocks: [
        { kind: 'steps', items: [
          ...INTAKE_STEPS,
          { t: 'Camera and microphone check', d: 'The candidate grants access and confirms framing before the interview begins. Blocked permissions produce a specific instruction to unblock them, not a dead end.' },
          { t: 'A conversation with the avatar', d: 'The configured interviewer greets the candidate, asks your questions, and responds to what it hears, following up where an answer is shallow.' },
          { t: 'Transcription and scoring', d: 'The conversation is transcribed and scored against your rubric, with each score citing the answer it came from.' },
        ] },
        { kind: 'flow', steps: ['Invite link', 'Resume', 'Consent', 'Camera check', 'Avatar interview', 'Scored report'], caption: 'The avatar handles the round; a recruiter still makes every decision that follows it.' },
      ] },
      { h2: 'What you configure', body: 'The interviewer itself is configured once in Avatar studio, then reused across templates.', blocks: [
        { kind: 'spec', caption: 'Avatar studio + interview template', rows: [
          { k: 'Replica', v: 'The face that conducts the interview, a stock replica or one you have created.' },
          { k: 'Persona', v: 'How the interviewer behaves: its brief, tone and what it is allowed to ask.' },
          { k: 'Questions', v: 'A fixed set, or generated from the candidate\'s own resume (1–25).' },
          { k: 'Scoring rubric', v: 'Six default KPI criteria or your own; weights normalise to 100%.' },
          { k: 'Branding', v: 'Company name, logo and accent colour on candidate screens and emails.' },
        ] },
      ] },
      { h2: 'What the recruiter gets', body: '', blocks: [
        { kind: 'split', items: [
          { t: 'A structured video round for everyone', d: 'Not only the shortlist you had time to call, every applicant who reaches this stage.' },
          { t: 'Transcript and scores', d: 'Each rubric criterion scored, each score citing the answer behind it.' },
          { t: 'One rubric across formats', d: 'An avatar result compares directly with a chat, voice or live round.' },
          { t: 'A recommendation, not a decision', d: 'Advance, reject and override remain recruiter actions, each written to an audit history.' },
        ] },
      ] },
      { h2: 'What the candidate experiences', body: 'A real conversation on their own schedule, with the terms made explicit up front.', bullets: ['Told it is AI, and asked to consent, before anything records', 'Camera and microphone requested explicitly, with a recovery path if blocked', 'No app to install. It runs in the browser', 'They never see scores, reports or another candidate\'s data'] },
      { h2: 'Limits and honest degradation', body: '', blocks: [
        { kind: 'note', tone: 'limit', text: 'Video avatar interviews require a configured avatar provider key. Without one the feature reports itself as unavailable rather than silently degrading. A candidate is never dropped into a broken round. ' + RESUME_LIMITS },
        { kind: 'note', tone: 'info', title: 'Bandwidth and devices', text: 'This is the most demanding of the five formats. Where candidates are likely to be on constrained connections or older phones, conversational chat or timed Q&A will reach more of them.' },
      ] },
    ],
    [
      { q: 'Do candidates know it\'s AI?', a: 'Yes. They are told and must consent before starting. See Trust → Candidate rights.' },
      { q: 'Is the interview recorded?', a: 'Video rounds record, and the candidate consents to exactly that. The wording states responses are recorded, analysed by AI and reviewed by a human recruiter.' },
      { q: 'Can we use our own interviewer face?', a: 'Yes, replicas can be created and then selected in Avatar studio, alongside stock faces.' },
      { q: 'Does the avatar decide who is hired?', a: 'No. It conducts a round and produces a scored recommendation with evidence. Every decision that affects a candidate is made by a person and recorded in an audit history.' },
      { q: 'What if a candidate cannot use video?', a: 'Run the round in another format. All five score against the same rubric, so an accommodation does not produce an incomparable result.' },
    ],
    [
      { label: 'Live two-way call', to: '/platform/live-two-way' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
      { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
    ]),
  plat('live-two-way', 'A', 'Interview tracks · Live', 'A real interviewer in the room, with Mimic taking notes and scoring.',
    'Live Two-Way Interviews | Mimic', 'A live video interview where a human leads and Mimic captures notes, scores the rubric and records with consent, structure without the busywork.',
    'Later rounds still need a human. Mimic makes the live interview structured and consistent: your interviewer talks to the candidate while Mimic handles notes, scoring and the record.',
    [
      { h2: 'The problem it solves', body: 'Automation belongs in the first round, not the last one. But live interviews have their own failure: they are wildly inconsistent. Different interviewers ask different questions, take notes of varying quality, and write up whatever they remember an hour later. The final decision then rests on the least structured evidence in the whole process.', blocks: [
        { kind: 'p', text: 'A live two-way round in Mimic keeps the human conversation and fixes the record around it, the same rubric, captured at the time, by the person who was actually in the room.' },
      ] },
      { h2: 'What it is', body: 'A live video call between your interviewer and the candidate, run inside Mimic. Your interviewer leads the conversation. Mimic supplies the structure, captures notes and ratings as it happens, and files the result against the same rubric every earlier round used.', blocks: [
        { kind: 'p', text: 'This is the one format where a human is present throughout. Mimic is the notebook, not the interviewer.' },
      ] },
      { h2: 'How it works', body: '', blocks: [
        { kind: 'steps', items: [
          { t: 'Schedule and invite', d: 'The candidate receives a link bound to their email address, the same as any other round.' },
          { t: 'Candidate lobby', d: 'The candidate joins a waiting room and checks camera and microphone before the interviewer admits them, so the call does not open on a permissions problem.' },
          { t: 'Host room', d: 'Your interviewer runs the conversation with the question set and rubric visible beside the video, structure without reading from a script.' },
          { t: 'Rate and note as you go', d: 'Ratings and notes are captured during the call, while the answer is fresh, rather than reconstructed afterwards.' },
          { t: 'Consented recording', d: 'Where recording is used, the candidate consents to it explicitly beforehand.' },
          { t: 'One comparable result', d: 'The round is filed against the same rubric as the async rounds, so a final interview sits beside a first screen and means the same thing.' },
        ] },
        { kind: 'flow', steps: ['Invite link', 'Candidate lobby', 'Host admits', 'Live interview', 'Ratings + notes', 'Same rubric'], caption: 'A human leads throughout, Mimic captures the record.' },
      ] },
      { h2: 'What the recruiter gets', body: '', blocks: [
        { kind: 'split', items: [
          { t: 'A structured live round', d: 'Every interviewer works from the same questions and the same criteria.' },
          { t: 'Notes captured live', d: 'Written during the conversation, not remembered after it.' },
          { t: 'A comparable score', d: 'The same rubric as every other round, so the final stage is not an unquantified gut call.' },
          { t: 'A defensible record', d: 'The decision, its evidence and who made it, in an audit history per candidate.' },
        ] },
      ] },
      { h2: 'When to use it instead of an async round', body: 'Use live two-way where a human relationship or a negotiation is genuinely part of the round, final stages, senior hires, panels, and any conversation where the candidate should be able to ask as much as they answer. Use the async formats for first rounds, where the volume is and where scheduling is the bottleneck.', bullets: ['Final and panel rounds', 'Senior or specialist hires', 'Roles where the candidate is also deciding about you', 'Any round where a person must be accountable in the moment'] },
      { h2: 'Limits and honest degradation', body: '', blocks: [
        { kind: 'note', tone: 'limit', text: 'This is a live format: it needs both parties available at the same time, and a connection good enough for two-way video on both ends. It does not remove scheduling. It makes the round that still needs scheduling worth the slot.' },
      ] },
    ],
    [
      { q: 'Does Mimic interview the candidate in this format?', a: 'No. Your interviewer leads the entire conversation. Mimic provides the structure, captures ratings and notes, and files the result against the rubric.' },
      { q: 'Is the call recorded?', a: 'Where recording is used the candidate consents to it explicitly before the call. Consent is not buried in a terms link.' },
      { q: 'Can the score be compared with the async rounds?', a: 'Yes. That is the point. Every format scores against one rubric you defined, so a live final round and a chat screen in the first round produce directly comparable results.' },
      { q: 'What if the candidate has trouble joining?', a: 'They land in a lobby and confirm camera and microphone before being admitted, so problems surface before the interviewer\'s time is spent.' },
    ],
    [
      { label: 'AI video avatar', to: '/platform/ai-video-avatar' },
      { label: 'Interview pipelines', to: '/platform/pipelines' },
      { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
      { label: 'Hiring managers', to: '/solutions/hiring-managers' },
    ]),
  plat('timed-qa', 'A', 'Interview tracks · Async', 'Timers on every question for skills that only show up under pressure.',
    'Timed Q&A Interviews | Mimic', 'Timers on every question put pressure on skills like triage and dispatch, with integrity checks and consistent scoring backed by evidence.',
    'Some skills only reveal themselves under a clock. Timed Q&A puts a fair, identical time limit on every candidate and scores how they perform against it.',
    [
      { h2: 'The problem it solves', body: 'For some roles the question is not whether someone can produce a good answer, but whether they can produce it quickly. A support triage decision, a dispatch call, a trading response. These are judged in seconds, and an untimed take-home tells you nothing about them.', blocks: [
        { kind: 'p', text: 'Timing an interview by hand is unfair almost by definition: one candidate gets interrupted, another gets a lenient interviewer. Timed Q&A applies the identical constraint to everyone, automatically, and records how each performed within it.' },
      ] },
      { h2: 'What it is', body: 'A structured written interview where every question carries its own preparation window and answer window. The candidate reads, thinks, and answers inside the same limits as everyone else, then the answers are scored against your rubric.', blocks: [
        { kind: 'p', text: 'It is the most controlled of the five formats, which is what makes it the fairest comparison when speed itself is the skill being assessed.' },
      ] },
      { h2: 'How it works', body: '', blocks: [
        { kind: 'steps', items: [
          ...INTAKE_STEPS,
          { t: 'Preparation phase', d: 'The question appears and a preparation timer runs, 30 seconds by default. A STAR prompt reminds the candidate to structure the answer: Situation, Task, Action, Result.' },
          { t: 'Answer phase', d: 'The answer window opens, 120 seconds by default, with a live word count and a visible warning as the clock runs down.' },
          { t: 'Automatic submission at zero', d: 'Whatever is written is submitted and the interview moves on. Drafts are saved continuously, so a dropped connection never costs the answer.' },
          { t: 'No going back', d: 'Once a question is submitted it is closed, and the interface says so before the candidate continues. Everyone works under the same rule.' },
        ] },
        { kind: 'flow', steps: ['Question shown', 'Preparation', 'Answering', 'Automatic submission', 'Next question', 'Scored report'], caption: 'Identical constraints for every candidate, which is what makes the comparison defensible.' },
      ] },
      { h2: 'What you configure', body: '', blocks: [
        { kind: 'spec', caption: 'Set on the interview template', rows: [
          { k: 'Preparation time', v: 'Default 30 seconds, overridable on any individual question.' },
          { k: 'Answer time', v: 'Default 120 seconds, overridable on any individual question.' },
          { k: 'Skip preparation', v: 'Let candidates start answering early, or hold everyone to the full window.' },
          { k: 'Early submission', v: 'Let candidates submit before the clock ends, or require the full window.' },
          { k: 'Questions', v: 'A fixed set you maintain, or generated from the candidate\'s resume (1–25).' },
          { k: 'Integrity checks', v: 'Tab switch, fullscreen exit and paste/copy detection, with warnings the candidate can see.' },
        ] },
        { kind: 'note', tone: 'info', title: 'On integrity checks', text: 'These are recorded as flags for a human to weigh, not automatic disqualifications. A tab switch might be a dropped connection or a second monitor. Mimic reports the signal; a recruiter decides what it means.' },
      ] },
      { h2: 'What the recruiter gets', body: '', blocks: [
        { kind: 'split', items: [
          { t: 'Performance under a real constraint', d: 'Not what someone can write with an afternoon and a search engine.' },
          { t: 'Identical conditions', d: 'Same questions, same clocks, same rules, the comparison holds up to scrutiny.' },
          { t: 'Scores with evidence', d: 'Each rubric criterion scored and traced to the answer behind it.' },
          { t: 'Integrity flags', d: 'Surfaced for a human to interpret, and reported in aggregate in analytics.' },
        ] },
      ] },
      { h2: 'Designing a fair timed interview', body: 'The timings are the assessment. A window that is too tight measures typing speed; too loose and you have an untimed interview with extra anxiety.', bullets: ['Pilot your timings on people who already do the job well', 'Set overrides on individual questions. A scenario question needs more room than a factual one', 'Consider allowing early submission so fast candidates are not left waiting', 'Tell candidates in the invite that the round is timed, so nobody is ambushed', 'Where speed is not actually part of the role, use conversational chat instead'] },
      { h2: 'Limits and honest degradation', body: '', blocks: [
        { kind: 'note', tone: 'limit', text: RESUME_LIMITS },
        { kind: 'note', tone: 'info', title: 'Without an AI key', text: 'Question generation and scoring fall back to a heuristic based on length, which the interface labels as approximate. Timing and integrity checks are unaffected. They are product behaviour, not model behaviour.' },
      ] },
    ],
    [
      { q: 'What happens if a candidate runs out of time mid-sentence?', a: 'Whatever is written is submitted automatically and the interview continues. Nothing is lost, and no candidate is penalised for a technical failure to press a button.' },
      { q: 'Can candidates go back to an earlier question?', a: 'No. Each question closes when they continue, and the interface tells them so beforehand. This is what keeps every candidate on identical terms.' },
      { q: 'Do integrity flags reject a candidate automatically?', a: 'No. They are recorded for a human to weigh. There are innocent explanations for most of them, and a hiring decision is never automated in Mimic.' },
      { q: 'How do I choose the right time limits?', a: 'Pilot them on people already doing the job well, and use overrides on individual questions. A scenario question needs more room than a recall question.' },
      { q: 'Is this the same as the conversational chat interview?', a: 'No. Conversational chat adapts and follows up like a conversation. Timed Q&A holds every candidate to identical, fixed constraints. You would choose it when speed under pressure is itself the thing being measured.' },
    ],
    [
      { label: 'Interview templates', to: '/platform/interview-templates' },
      { label: 'Conversational chat', to: '/platform/conversational-chat' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
    ]),
  plat('bulk-invitations', 'B', 'Workflow · Invitations', 'From a spreadsheet to interviews in inboxes in minutes.',
    'Bulk Candidate Invitations | Mimic', 'Invite thousands of candidates from a CSV, an ATS export or one shareable link, Mimic parses each resume and personalises every email.',
    'The first bottleneck is just getting the interview to everyone. Mimic sends them all in minutes.',
    [
      { h2: 'Getting the interview to everyone is the first bottleneck', body: 'Before any of the screening benefit arrives, someone has to invite the candidates. Done by hand that is its own afternoon, and it is where mistakes are most expensive. A wrong link or a wrongly merged name goes out to every applicant at once.' },
      { h2: 'The wizard, in five steps', body: '', blocks: [
        { kind: 'steps', items: [
          { t: 'Candidates', d: 'Upload a CSV or Excel export, or a PDF, DOCX or TXT list, up to 10 MB. Every row is parsed and validated, and problems are shown per row before anything sends.' },
          { t: 'Template', d: 'Choose the interview template. Format, questions, timings, rubric and branding all come with it.' },
          { t: 'Email', d: 'Compose the invitation with a rich editor and merge variables. The interview link itself is a locked token you cannot accidentally break.' },
          { t: 'Review', d: 'See the recipient list and the rendered email exactly as it will arrive, with the sender, the reply address and the subject laid out.' },
          { t: 'Send', d: 'Deliver, or run it as a dry run, which processes the whole batch without sending, so you can check before it reaches anyone.' },
        ] },
        { kind: 'flow', steps: ['Candidates', 'Template', 'Email', 'Review', 'Send'], caption: 'A dry run at step five is the cheapest insurance in the product.' },
      ] },
      { h2: 'What each candidate receives', body: 'An invitation addressed to them, carrying your branding and a link bound to their email address. That binding is what stops an interview being forwarded and completed by someone else. The candidate signs in with the address that received it.', blocks: [
        { kind: 'bullets', items: ['Company name, logo and accent colour from the template', 'A locked token for the interview link, which merge editing cannot corrupt', 'A test send available before the batch goes out', 'Four email kinds beyond the invite (advance, selected and rejection), so later rounds are handled the same way'] },
      ] },
      { h2: 'Limits and safe practice', body: '', blocks: [
        { kind: 'note', tone: 'limit', text: 'Candidate lists are capped at 10 MB and each resume at 8 MB. Larger intakes split into batches, which is the safer approach anyway: a dry run on the first batch catches a template mistake before it reaches thousands of people.' },
        { kind: 'note', tone: 'info', title: 'Without an email key', text: 'Sending degrades to a dry run mode rather than failing silently, so a misconfigured deployment cannot deliver only part of a batch.' },
      ] },
    ],
    [
      { q: 'What file formats can we upload?', a: 'CSV and Excel exports, plus PDF, DOCX and TXT lists, up to 10 MB. Rows are validated and shown to you before sending.' },
      { q: 'Can we check a batch before it goes out?', a: 'Yes, use the dry run. It processes the entire batch without delivering, and a test send lets you see the real email first.' },
      { q: 'Can a candidate forward their invitation?', a: 'The link is bound to the address it was sent to, so forwarding it does not let someone else take the interview.' },
      { q: 'Can we edit the invitation email?', a: 'Yes, with a rich editor and merge variables. The interview link is a locked token, so editing cannot break it.' },
    ],
    [
      { label: 'Interview templates', to: '/platform/interview-templates' },
      { label: 'High volume hiring', to: '/solutions/high-volume-hiring' },
      { label: 'Interview pipelines', to: '/platform/pipelines' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
    ]),
  plat('interview-templates', 'B', 'Workflow · Templates', 'Configure an interview once. Reuse it across your whole team.',
    'Interview Templates | Mimic', 'Save track, question source, rubric weights, timing and branding as one reusable template your whole team applies consistently.',
    'Consistency comes from reuse. A template captures how a role is interviewed so every recruiter runs it the same way.',
    [
      { h2: 'Why configuration belongs in one object', body: 'Consistency is the product\'s core value: scores only compare if every candidate met the same interview. That is impossible if each recruiter assembles a round from scratch, so everything that shapes an interview lives on a template, and the template, not the recruiter, is what gets reused.' },
      { h2: 'What a template holds', body: '', blocks: [
        { kind: 'spec', caption: 'One object, every setting', rows: [
          { k: 'Interview format', v: 'Which of the five tracks the candidate takes, conversational chat, voice, video avatar, timed Q&A or live two-way.' },
          { k: 'Question source', v: 'A fixed question set you maintain, or questions generated from the candidate\'s own resume (1–25).' },
          { k: 'Preparation time', v: 'Default 30 seconds, overridable on any individual question.' },
          { k: 'Answer time', v: 'Default 120 seconds, overridable on any individual question.' },
          { k: 'Skip preparation', v: 'Whether candidates may start answering before the prep window ends.' },
          { k: 'Early submission', v: 'Whether candidates may submit before the answer clock runs out.' },
          { k: 'Scoring rubric', v: 'Criteria and weights, six KPI defaults, editable or replaceable. Weights normalise to 100%.' },
          { k: 'Integrity checks', v: 'Tab switch, fullscreen exit and paste/copy detection, with warnings the candidate can see.' },
          { k: 'Interview language', v: 'Set per template.' },
          { k: 'Branding', v: 'Company name, logo and accent colour, applied to candidate screens and the invitation email.' },
        ] },
      ] },
      { h2: 'How teams actually use them', body: 'The useful pattern is one template per role type rather than one per requisition. A "support agent" template carries the questions, timings and rubric that role needs; every support req reuses it, so results across six months of hiring remain comparable.', blocks: [
        { kind: 'bullets', items: ['Duplicate a template to create a variant rather than editing a live one', 'Change the format without changing the rubric. The same criteria apply across all five tracks', 'Timing overrides on individual questions let one scenario question breathe without loosening the whole round', 'Branding is per template, which is what lets an agency run a client\'s identity on the candidate experience'] },
      ] },
      { h2: 'Editing a template mid-hire', body: 'Templates are editable, and that has a consequence worth understanding: changing a rubric changes the standard. Candidates already scored were assessed against the previous criteria.', blocks: [
        { kind: 'note', tone: 'info', title: 'A practical rule', text: 'Once a requisition is live, duplicate rather than edit. Keeping the rubric fixed for the duration of a role is what makes the comparison, and any later audit of it, actually hold.' },
      ] },
    ],
    [
      { q: 'Can different recruiters use different templates for the same role?', a: 'They can, but it defeats the purpose. Comparability depends on one rubric per role applied identically, so the template should belong to the role, not the recruiter.' },
      { q: 'Does changing the format mean rebuilding the rubric?', a: 'No. The same rubric applies across all five interview formats, which is what lets a chat round and a voice round produce comparable results.' },
      { q: 'Can we brand the candidate experience?', a: 'Yes, company name, logo and accent colour are set per template and carry through to candidate screens and the invitation email.' },
      { q: 'What happens to candidates already interviewed if we edit a template?', a: 'They were scored against the criteria in force at the time. For a live requisition, duplicate the template instead of editing it.' },
    ],
    [
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Question sets', to: '/platform/question-sets' },
      { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
    ]),
  plat('question-sets', 'B', 'Workflow · Questions', 'Fixed question banks, or questions generated from a resume.',
    'Question Sets | Mimic', 'Build reusable fixed question banks, attach them to any template, or let Mimic generate questions from a resume, each one specific to the role.',
    'Start from proven questions instead of a blank page, and map every one to a rubric dimension.',
    [
      { h2: 'Two ways to decide what gets asked', body: 'Every interview needs questions, and the right source depends on what you are measuring. Mimic supports both, set per template.', blocks: [
        { kind: 'split', items: [
          { t: 'Fixed question sets', d: 'A bank you author and reuse. Every candidate is asked exactly the same things. The strongest footing when consistency is the priority or the round is being audited.' },
          { t: 'Questions that adapt to the resume', d: 'Generated from the candidate\'s own resume, so they are asked about the projects they actually did. Better for surfacing depth; different questions per candidate by design.' },
        ] },
        { kind: 'note', tone: 'info', title: 'Which to choose', text: 'Fixed sets are easier to defend and easier to compare. Adaptive questions dig further into individual experience. Many teams use fixed sets for regulated or high volume roles, and adaptive for specialist ones where the resume is the interesting part.' },
      ] },
      { h2: 'Authoring a set', body: '', blocks: [
        { kind: 'steps', items: [
          { t: 'Write the questions', d: 'Each one in full, as the interviewer will ask it.' },
          { t: 'Order them by dragging', d: 'Sequence matters, open with something answerable to settle the candidate before the harder questions.' },
          { t: 'Add a category', d: 'Groups related questions in reports, so a reviewer can see performance by theme.' },
          { t: 'Add notes on the ideal answer', d: 'What a strong answer contains. This sharpens scoring by telling the rubric what good looks like for that specific question.' },
          { t: 'Attach the set to a template', d: 'Where it is reused across every requisition running that template.' },
        ] },
      ] },
      { h2: 'Generating from a resume', body: 'Upload a candidate\'s resume and Mimic can generate between 1 and 25 questions from it. Teams commonly use this to draft a starting set for a role and then edit it into a fixed bank. The generated questions become a first draft rather than the final interview.', blocks: [
        { kind: 'note', tone: 'info', title: 'Without an AI key', text: 'Question generation is unavailable and scoring falls back to a heuristic based on length, which the interface labels as approximate. Fixed question sets keep working exactly as configured, which is one practical reason to maintain them.' },
      ] },
      { h2: 'Writing questions that score well', body: 'The rubric can only assess what a question invites the candidate to demonstrate.', bullets: ['Ask for a specific instance, not a general policy, "tell me about a time" beats "how do you approach"', 'One thing per question; a question in two parts produces an answer that scores ambiguously', 'Avoid questions answerable in a sentence unless the round is deliberately timed for speed', 'Use notes on the ideal answer to record what a strong answer contains. It is the cheapest way to improve scoring accuracy', 'Pilot the set on someone already doing the job well'] },
    ],
    [
      { q: 'Fixed or generated from a resume, which is better?', a: 'Neither universally. Fixed sets maximise consistency and are easier to defend; adaptive questions surface more depth on individual experience. It is set per template, so you can use both across different roles.' },
      { q: 'How many questions can be generated from a resume?', a: 'Between 1 and 25.' },
      { q: 'What do notes on the ideal answer do?', a: 'They tell the scoring step what a strong answer to that specific question contains, which sharpens the criterion scores.' },
      { q: 'Can candidates see the questions in advance?', a: 'No. Questions are revealed in sequence, so nobody gains an advantage by reading ahead.' },
    ],
    [
      { label: 'Interview templates', to: '/platform/interview-templates' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Question library', to: '/resources/question-library' },
      { label: 'Technical screening', to: '/solutions/technical-screening' },
    ]),
  plat('pipelines', 'B', 'Workflow · Pipelines', 'Move candidates through rounds, or advance everyone above a bar.',
    'Multi-Round Hiring Pipelines | Mimic', 'Drag candidates through rounds, or automatically advance everyone above a score threshold, then export the board, multi-round progression made simple.',
    'Hiring across several rounds gets messy in spreadsheets. A pipeline board keeps every candidate’s stage and score in one place.',
    [
      { h2: 'Hiring is rarely one round', body: 'A real process has stages (a screen, a technical round, a final conversation), and each one needs its own questions and often its own format. Managing that in a spreadsheet is where candidates get lost, and where the answer to "why was this person rejected" stops existing.' },
      { h2: 'The board', body: 'Each round is a lane. Candidates move left to right, and the two terminal lanes, Selected and Not advancing, are visually distinct so the state of a process is readable at a glance.', blocks: [
        { kind: 'steps', items: [
          { t: 'Define the rounds', d: 'Each round has its own template, so round one can be a text screen and round three a live two-way call, scored against the same rubric.' },
          { t: 'Move candidates deliberately', d: 'Drag a card to the next lane, or use the quick advance on any lane: everyone at or above a score, or the top N.' },
          { t: 'See who a threshold captures', d: 'Before anything moves. The bar is yours to set and yours to confirm.' },
          { t: 'Move back when needed', d: 'A premature decision can be reversed, and the reversal is recorded like any other action.' },
          { t: 'Everything is logged', d: 'Each action written to that candidate\'s audit history with the name of whoever took it.' },
        ] },
        { kind: 'flow', steps: ['Screening', 'Technical', 'Final', 'Selected'], caption: 'Rounds can differ in format; the rubric does not.' },
      ] },
      { h2: 'Advancing in bulk is still a human decision', body: 'Quick advance exists because reviewing five hundred candidates one at a time is not realistic. It does not make the decision for you: you choose the threshold, the board shows exactly who it captures, and nothing moves until you confirm.', blocks: [
        { kind: 'note', tone: 'info', title: 'Where the judgement actually sits', text: 'Setting a threshold is a hiring judgement, and it is the moment worth being deliberate about. Look at the candidates immediately on either side of the line before confirming. That is where a bar that is slightly wrong shows itself.' },
      ] },
      { h2: 'Transitions candidates actually see', body: 'Moving someone forward or closing them out should reach them. Beyond the invitation, three further email kinds (advance, selected and rejection), are configurable on the same footing, so later rounds are communicated as deliberately as the first one.', blocks: [
        { kind: 'note', tone: 'info', title: 'Worth doing properly', text: 'Silent rejection is the most criticised feature of hiring processes, and it is the cheapest thing to fix here. The rejection email is a first-class template, not an afterthought.' },
      ] },
    ],
    [
      { q: 'Can different rounds use different interview formats?', a: 'Yes, each round carries its own template. A text screen, then a technical round, then a live call is a common shape, and all three score against the same rubric.' },
      { q: 'Is quick advance automated rejection?', a: 'No. You set the threshold, see exactly who it captures, and confirm. Nothing moves on its own, and every action is attributed and logged.' },
      { q: 'Can we move a candidate back a round?', a: 'Yes, and the move is recorded in the audit history like any other action.' },
      { q: 'Do candidates get told when they progress?', a: 'Advance, selected and rejection emails are configurable templates alongside the invitation.' },
      { q: 'What can we export?', a: 'The board exports for a role, giving names, emails and scores per round.' },
    ],
    [
      { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
      { label: 'Live two-way call', to: '/platform/live-two-way' },
      { label: 'Bulk invitations', to: '/platform/bulk-invitations' },
      { label: 'For recruiters', to: '/solutions/recruiters' },
    ]),
  plat('rubrics-scoring', 'B', 'Workflow · Scoring', 'One rubric, applied identically, with the evidence attached.',
    'Rubrics & Scoring | Mimic', 'Define weighted rubric dimensions once; Mimic scores every candidate the same way and cites the answer behind each dimension.',
    'A score is only useful if it’s consistent and explainable. The rubric is how Mimic guarantees both.',
    [
      { h2: 'The rubric is the product', body: 'Everything else in Mimic exists to apply a rubric consistently. Get the rubric right and the interviews, the scores and the shortlist follow; get it wrong and you have automated a bad standard at scale. It is worth more of your team\'s time than any other setting.' },
      { h2: 'How scoring works', body: '', blocks: [
        { kind: 'steps', items: [
          { t: 'Define criteria', d: 'Six general KPI criteria ship as a starting point. Edit them, add your own, or replace them entirely. They should describe what good looks like for this specific role.' },
          { t: 'Set weights', d: 'Weight each criterion by how much it matters. Weights normalise to 100%, so the arithmetic behind a total is always explicit.' },
          { t: 'Every answer is scored per criterion', d: 'Separately, against what the candidate actually said, not as one opaque verdict.' },
          { t: 'Criteria combine into a total', d: 'A weighted sum you can reproduce by hand. There is no hidden term.' },
          { t: 'Evidence is attached', d: 'Each criterion cites the answer or transcript span behind it, and the full transcript ships with the report.' },
        ] },
        { kind: 'flow', steps: ['Criteria + weights', 'Scores per criterion', 'Weighted total', 'Recommendation', 'Human decides'], caption: 'The same rubric applies across all five interview formats.' },
      ] },
      { h2: 'Writing criteria that work', body: 'The difference between a rubric that produces useful rankings and one that produces noise is usually specificity.', bullets: ['Describe observable behaviour in an answer, not a personality trait, "structures an answer around a concrete example" beats "communication skills"', 'Avoid criteria every candidate passes; they add weight but no separation, and should be replaced', 'Keep the set small enough that each criterion carries real weight, a dozen criteria at 8% each dilutes everything', 'Pilot on people already doing the job well, and check whether the rubric ranks them highly', 'Revisit it when recruiters override often; that is the clearest signal it does not match what the team values'] },
      { h2: 'What the rubric deliberately excludes', body: '', blocks: [
        { kind: 'note', tone: 'info', title: 'Scored on substance only', text: 'Delivery signals on voice and video rounds (pace, tonal variation, sentiment), are reported beside the score for a human to weigh, never folded into it. Integrity flags are reported separately too, and never applied as a scoring penalty. Accent and voice quality are not assessed.' },
        { kind: 'note', tone: 'info', title: 'Without an AI key', text: 'Scoring falls back to a heuristic based on length, and the interface labels that result as approximate rather than presenting it as a real assessment.' },
      ] },
    ],
    [
      { q: 'Can we use our own competency framework?', a: 'Yes. Replace the defaults with your own criteria and weights. The six that ship are a starting point, not a constraint.' },
      { q: 'Can I reproduce a total by hand?', a: 'Yes. It is the weighted sum of criterion scores using the weights you set, and weights normalise to 100%.' },
      { q: 'Does the rubric change between interview formats?', a: 'No. That is the point. One rubric per role applies whether the round was chat, voice, video avatar, timed Q&A or a live call.' },
      { q: 'How many criteria should we use?', a: 'Few enough that each carries meaningful weight. A criterion at 5% rarely changes an outcome; if it does not separate candidates, remove it.' },
    ],
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Candidate reports', to: '/platform/candidate-reports' },
      { label: 'Interview templates', to: '/platform/interview-templates' },
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
    ]),
  plat('candidate-reports', 'B', 'Intelligence · Reports', 'A report that shows the working behind every score.',
    'Candidate Reports | Mimic', 'A full scored report per candidate, overall score, breakdown for each dimension with evidence, transcript and signal analysis.',
    'Hiring managers don’t want a number; they want to see why. The candidate report shows the evidence behind every dimension.',
    [
      { h2: 'A score nobody can check is worthless', body: 'The point of a candidate report is not the number at the top. It is that a reviewer (a hiring manager, your legal team, an auditor, eventually perhaps the candidate\'s lawyer), can follow the number back to the thing that produced it.' },
      { h2: 'What a report contains', body: '', blocks: [
        { kind: 'spec', caption: 'Every report', rows: [
          { k: 'Overall score', v: 'The weighted total, reproducible from the criterion scores and your weights.' },
          { k: 'Recommendation', v: 'A suggested outcome, never an executed one.' },
          { k: 'Breakdown per criterion', v: 'Each rubric criterion scored separately, so you can see where a candidate was strong and where they were not.' },
          { k: 'Evidence per criterion', v: 'The answer or transcript span the score was drawn from.' },
          { k: 'Full transcript', v: 'The complete interview, including follow-ups, readable end to end.' },
          { k: 'AI summary', v: 'A written summary with strengths and areas to improve.' },
          { k: 'Delivery signals', v: 'On voice and video rounds only, in a clearly separated panel, context beside the score, never inside it.' },
          { k: 'Integrity flags', v: 'Where any were raised, for a human to interpret.' },
          { k: 'PDF export', v: 'The whole report as a file, for sharing with a hiring manager or retaining as a record.' },
        ] },
      ] },
      { h2: 'How to read one properly', body: 'The most common mistake is reading the total and stopping. The total is the least informative number in the document.', bullets: ['Start with the scores per criterion. A candidate at 70 who is excellent on the criterion that matters most is often the better hire than a uniform 78', 'Read the evidence behind any criterion that surprises you; that is what it is there for', 'Skim the transcript for candidates near your threshold, where the decision is actually being made', 'Treat the delivery signal panel as context, and ignore it entirely if delivery is not part of the role', 'Treat an integrity flag as a question to ask, not an answer'] },
      { h2: 'What candidates see', body: 'Nothing. Candidates never see their scores, the report, the recommendation or another candidate\'s data. A score is an internal recommendation for a recruiter. It is not feedback, and presenting it as feedback would be misleading given a human may well decide differently.' },
    ],
    [
      { q: 'Can we share a report with a hiring manager?', a: 'Yes, export it as a PDF, or give them access to the workspace.' },
      { q: 'Do candidates see their report?', a: 'No. Scores are internal recommendations, not candidate feedback.' },
      { q: 'What if we disagree with the recommendation?', a: 'Override it. The override is recorded, and a pattern of them is useful evidence that the rubric needs revisiting.' },
      { q: 'Is the transcript complete?', a: 'Yes, including follow-up questions and answers. It is the evidence layer the scores cite.' },
    ],
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
      { label: 'Signal analysis', to: '/platform/signal-analysis' },
      { label: 'For hiring managers', to: '/solutions/hiring-managers' },
    ]),
  plat('recruiter-analytics', 'B', 'Intelligence · Analytics', 'See your whole funnel, by role, team and track.',
    'Recruiter Analytics | Mimic', 'Aggregate results across every scored interview, completion, average score and duration, broken down by role, template and interview track.',
    'Structured scoring finally makes hiring measurable. Analytics turn thousands of interviews into decisions.',
    [
      { h2: 'What screening usually leaves behind', body: 'A manual first round produces almost no data: some notes, an advance or reject flag, and a recruiter\'s memory. There is nothing to analyse, so the first round, the stage that touches the most candidates, is the one you understand least.' },
      { h2: 'What you can see', body: 'Because every candidate is scored against the same authored rubric, the round produces measurements rather than impressions.', blocks: [
        { kind: 'spec', caption: 'Reported in analytics', rows: [
          { k: 'Interviews created', v: 'With started and completed counts.' },
          { k: 'Completion rate', v: 'The share of invited candidates who finished.' },
          { k: 'Average duration', v: 'Overall, and average time per question.' },
          { k: 'Average score', v: 'Across scored interviews.' },
          { k: 'By interview track', v: 'Sessions, average score and completion for each of the five formats.' },
          { k: 'By role and template', v: 'The same measures sliced per position and per configuration.' },
          { k: 'Recommendations', v: 'The distribution of outcomes across scored interviews.' },
          { k: 'Integrity flags', v: 'The share of scored interviews carrying one.' },
        ] },
        { kind: 'note', tone: 'limit', text: 'Breakdowns are by role, template and interview track. Mimic holds no demographic data, so it cannot report selection rates by group or adverse impact. That analysis is a join you perform in your own environment. See Bias testing & audits.' },
      ] },
      { h2: 'The measures worth acting on', body: 'The default instinct is to watch average score. It is rarely the useful number.', bullets: ['Completion rate by role. A drop means the format or the timings are excluding candidates, not that the candidates are weak', 'Average time per question, consistently hitting the ceiling means your windows are too tight', 'Score distribution by template, clustering usually indicates an inconsistent question set', 'Which criteria separate candidates, one everyone passes is adding weight without adding information', 'Integrity flag rate. A spike is more often a UX or connectivity problem than misconduct'] },
      { h2: 'Detail within one position', body: 'Score distributions, KPI averages and top candidates are only meaningful inside a single position, averaging a support agent against a senior engineer produces a number that describes nothing. The dashboard reflects that: those panels stay hidden until you select a role or template, and it says so rather than showing an empty chart.' },
    ],
    [
      { q: 'Can we see selection rates by demographic group?', a: 'No. Mimic holds no demographic data. Breakdowns are by role, template and interview track; analysis by group happens in your own reporting environment against data you hold.' },
      { q: 'Why are some panels hidden until I pick a role?', a: 'Because score distributions and KPI averages are only meaningful within one position. Rather than show a misleading average across roles, the dashboard explains what to select.' },
      { q: 'What is the single most useful measure?', a: 'Completion rate by role. It is the fastest signal that your interview format or timings are excluding people you wanted to hear from.' },
      { q: 'Can we export the data?', a: 'Individual reports export as PDF and pipeline data can be exported per role. Programmatic export routes are marked for the team to confirm.' },
    ],
    [
      { label: 'Candidate reports', to: '/platform/candidate-reports' },
      { label: 'People analytics', to: '/solutions/people-analytics' },
      { label: 'Bias testing & audits', to: '/trust/bias-testing-audits' },
      { label: 'Rubrics & scoring', to: '/platform/rubrics-scoring' },
    ]),
  plat('signal-analysis', 'B', 'Intelligence · Signals', 'Delivery signals, alongside content, not instead of it.',
    'Signal Analysis | Mimic', 'For voice and video, Mimic assesses delivery signals such as pace and clarity alongside answer content, always as supporting evidence, never a verdict.',
    'How something is said can matter for roles that work directly with customers. Mimic surfaces delivery signals as evidence, never as a standalone judgement.',
    [
      { h2: 'Not available for EU candidates', body: '', blocks: [
        { kind: 'note', tone: 'limit', title: 'This feature is prohibited in the EU, read this first', text: 'These features infer named emotions with confidence scores from a candidate\'s voice and face. Under EU AI Act Art 5(1)(f), inferring emotions in a workplace context is a prohibited practice, and the European Commission\'s adopted Guidelines (para 254) state expressly that "using emotion recognition AI systems during the recruitment process is prohibited". The prohibition has applied since 2 February 2025 and was not delayed by the 2026 Digital Omnibus. If you hire EU candidates, do not enable voice rounds or video avatar rounds for them.' },
        { kind: 'p', text: 'It matters that this is a prohibition rather than one of the obligations that apply to systems classed as high risk. Consent, candidate notice, human review, a bias audit and a DPIA are all irrelevant to it, none of them is a defence under Art 5. The only compliant responses are to leave the feature off, or to place a hard geofence between it and EU candidates. We would rather say that on the product page than let you discover it in a legal review.' },
        { kind: 'note', tone: 'placeholder', text: 'Whether Mimic removes these pipelines or geofences them is an open product decision, see docs/EU_AI_ACT_COMPLIANCE.md. Until it is made and implemented, treat this page as describing a feature you should not switch on for EU candidates.' },
      ] },
      { h2: 'What is actually measured', body: 'Being precise here is the point, vague language is how this feature gets misrepresented.', blocks: [
        { kind: 'bullets', items: ['Vocal prosody scored as named emotions with confidence values, per ~5-second segment, from a fixed emotion vocabulary, how the voice sounds, not what the words mean', 'A sentiment arc across the interview, built from those segment scores', 'For video rounds, facial expression analysis producing a summary for each question on the same terms', 'Each signal tied to the answer it came from'] },
        { kind: 'note', tone: 'info', title: 'Why we no longer call this "delivery characteristics"', text: 'An earlier version of this page described it as pace, pitch and energy, and said it did not infer emotional state. That was inaccurate: the pipeline scores named emotions with probabilities, and a probability score for a named emotion is emotion recognition. Describing it more softly would not change what the software does. It would only make the page less useful to the person who has to sign it off.' },
      ] },
      { h2: 'Where it is reported, and what it does not touch', body: 'Delivery signals are shown beside the content score, never folded into it. They do not move a candidate\'s total and they never trigger an outcome on their own. That remains true. It is simply not a defence to the prohibition above.' },
      { h2: 'What it is not', body: 'Being explicit here is more useful than a reassurance.', bullets: ['Not a personality test, and not a psychometric assessment', 'Not a truthfulness or deception indicator', 'Not an input to the rubric score', 'Not a basis for automatic rejection, nothing in Mimic rejects anyone automatically', 'Not a judgement of accent, dialect or voice quality'] },
      { h2: 'If you are outside the EU', body: 'The prohibition above is EU law. Elsewhere the feature may be lawful, and your own jurisdiction may still regulate it, Illinois AIVIA governs AI analysis of video interviews, and several US states are moving on biometric inference. It is worth asking your counsel specifically about emotion inference rather than about AI hiring generally.', blocks: [
        { kind: 'split', items: [
          { t: 'Where it can mislead', d: 'Nervousness, neurodivergence, a second language, a poor microphone and a noisy room all move these signals without saying anything about capability.' },
          { t: 'What it is not evidence of', d: 'Competence, attitude, honesty or fit. A sentiment chart is not a proxy for any of them, and treating it as one is the most common misuse.' },
          { t: 'The safe default', d: 'Leave it alone. The content score stands on its own, and formats based on text produce no delivery layer at all.' },
          { t: 'If you do use it', d: 'Document why the signal is related to the job for that specific role, and who reviews it. An undocumented use is the hardest to defend later.' },
        ] },
        { kind: 'note', tone: 'limit', text: 'These signals vary with disability, neurodivergence and language background, so they carry real exposure under accessibility law and laws prohibiting discrimination independently of the AI Act. The narrowest safe position, and the one we would recommend, is not to rely on them at all.' },
      ] },
      { h2: 'Where it appears', body: 'Signal analysis is shown in the candidate report for voice and video rounds only, as a clearly separated panel beneath the rubric scores and transcript. Rounds based on text have no delivery layer at all.', blocks: [
        { kind: 'note', tone: 'placeholder', text: 'Before publication, the team should confirm the exact retention period for recorded audio and video that these signals are derived from, and state it here alongside the Data residency & retention page.' },
      ] },
    ],
    [
      { q: 'Does a delivery signal change a candidate\'s score?', a: 'No. The rubric score is derived from the content of the answers. Delivery signals sit beside it as context for a human reader.' },
      { q: 'Do you score accent?', a: 'No. Accent, dialect and voice quality are not assessed. Scoring runs against the transcript, what was said.' },
      { q: 'Is this an emotion recognition system?', a: 'Yes. It scores named emotions with confidence values from a candidate\'s voice, and facial expressions on video rounds. An earlier version of this page said it did not infer emotional state; that was wrong, and it is corrected here. Because it is emotion recognition, it falls under the EU AI Act Art 5(1)(f) prohibition for candidates in the EU.' },
      { q: 'Can consent make it lawful in the EU?', a: 'No. Art 5 prohibitions cannot be cured by consent, notice, human review, a bias audit or a DPIA, none of those is a defence. The only compliant responses are not using the feature, or placing a hard geofence between it and EU candidates.' },
      { q: 'Does scoring based on the transcript fall under the same prohibition?', a: 'Commission guidance (para 251) treats emotion inference from written text as outside the prohibition because it is not based on biometric data. That is the better reading, but it is a contested one, the Article\'s own wording does not mention biometric data, and our transcript is derived from the candidate\'s voice. Your counsel should form their own view rather than rely on ours.' },
      { q: 'How do I avoid this category entirely?', a: 'Use conversational chat or timed Q&A. They produce no audio, no video and no delivery layer, and they score against the same rubric, so avoiding it costs you nothing in comparability.' },
      { q: 'Can we turn it off?', a: 'Choosing a text round, conversational chat or timed Q&A, means no delivery analysis is produced at all.' },
      { q: 'Can a candidate be rejected because of these signals?', a: 'Not by Mimic. Nothing in the product rejects anyone automatically, and these signals are not an input to the score. A human makes every decision.' },
    ],
    [
      { label: 'How Mimic scores', to: '/trust/how-mimic-scores' },
      { label: 'EU AI Act', to: '/trust/eu-ai-act' },
      { label: 'Candidate rights', to: '/trust/candidate-rights' },
      { label: 'Voice screening', to: '/platform/voice-screening' },
    ]),
  plat('mimic-guide', 'B', 'Intelligence · Assistant', 'An assistant that operates Mimic by voice or type.',
    'Mimic Guide Assistant | Mimic', 'A built-in assistant that answers questions and, with Autopilot, operates the product (setting up interviews, filtering analytics, advancing pipelines), with confirmation before anything sends.',
    'The fastest way to run Mimic is to ask it. The Mimic Guide answers questions and can operate the product for you, hands-free.',
    [
      { h2: 'Two things in one assistant', body: 'The Guide answers questions about how Mimic works, and, with Autopilot enabled, operates the product on your behalf. Both work by voice or by typing, in any of 55 languages for both speech input and spoken output.', blocks: [
        { kind: 'split', items: [
          { t: 'Ask mode', d: 'Questions about how something works, answered from what the product actually does. Useful when a recruiter hits a setting they have not used before and does not want to leave the screen.' },
          { t: 'Autopilot mode', d: 'It drives the real interface (creating a session, filtering analytics, advancing candidates), narrating what it is about to do and stopping for confirmation before anything takes effect.' },
        ] },
      ] },
      { h2: 'Why it operates the real UI', body: 'Autopilot does not have a private back door. It uses the same interface a recruiter uses, which has two consequences worth understanding: everything it does is visible on screen as it happens, and it cannot perform an action the interface does not offer.', blocks: [
        { kind: 'note', tone: 'info', title: 'Confirmation before anything with a consequence', text: 'Any action that sends, changes or advances stops and asks first. The assistant can prepare an invitation batch; it cannot deliver one without you confirming. The rule that a human takes the decision governs the assistant just as it governs the rest of the product.' },
      ] },
      { h2: 'Where it genuinely helps', body: 'The honest answer is that it is most valuable for the tasks people do rarely enough to forget.', bullets: ['Setting up a session or a template when you have not done one for weeks', 'Filtering analytics to a specific role or track without hunting through controls', 'Asking what a setting actually changes, mid-configuration', 'Hands-free operation when you are reviewing on a phone or between meetings', 'Working in your own language rather than the interface language'] },
      { h2: 'What it will not do', body: '', blocks: [
        { kind: 'bullets', items: ['Take a decision that affects a candidate without your confirmation', 'Advance or reject anyone on its own judgement', 'Act outside what the interface itself permits for your role', 'Operate on the candidate side, the Guide is a recruiter tool'] },
        { kind: 'note', tone: 'info', title: 'Without an AI key', text: 'The assistant falls back to canned answers rather than failing outright, and says so. The same rule of honest degradation that the rest of the product follows.' },
      ] },
    ],
    [
      { q: 'Can Autopilot send invitations without me?', a: 'No. It can prepare the batch, but sending stops for your confirmation, as does any action that changes or advances something.' },
      { q: 'What languages does it support?', a: '55, for both speech input and spoken output. Interview language is configured separately, on the template.' },
      { q: 'Does it have access I do not have?', a: 'No. It operates the same interface you do, within the permissions of your role, and you can watch it work.' },
      { q: 'Is it available to candidates?', a: 'No. It is a recruiter tool.' },
    ],
    [
      { label: 'Interview templates', to: '/platform/interview-templates' },
      { label: 'Recruiter analytics', to: '/platform/recruiter-analytics' },
      { label: 'Human in the loop', to: '/trust/human-in-the-loop' },
      { label: 'For recruiters', to: '/solutions/recruiters' },
    ]),
]

export const PAGES: MktPage[] = [...HUBS, ...PLATFORM_PAGES, ...SOLUTION_PAGES, ...SOLUTION_BRIEFS, ...TRUST_PAGES, ...RESOURCE_PAGES, ...COMPANY_PAGES]
export const PAGE_BY_SLUG: Record<string, MktPage> = Object.fromEntries(PAGES.map((p) => [p.slug, p]))
export { DEMO }
