import type { TimeOfDay } from './types'

/**
 * The ONE voice & persona standard — shared by every surface that speaks:
 *
 *   • Voice Interview  (server/services/voice.ts — Gemini Live system instruction)
 *   • Tavus avatar     (server/services/tavusServer.ts — candidate conversations,
 *                       and src/pages/SetupPage.tsx — recruiter-run sessions)
 *   • Mimic Guide      (src/lib/guideSpeech.ts — text prepared for TTS)
 *
 * Two levers live here:
 *   1. stripForSpeech() — nothing markdown/formatted is ever read aloud.
 *   2. The persona standard — warm, polite, contractions, varied phrasing,
 *      greets, thanks after every answer — expressed once and reused, so all
 *      three surfaces sound like the same human product and are tuned in
 *      ONE place.
 *
 * Plain runtime TypeScript (no imports beyond shared types) so both the Vite
 * client and the Express server can import it.
 */

/* ─── Lever 1: never read formatting aloud ──────────────────────────────── */

/**
 * Convert model/authored text into clean, natural SPOKEN sentences:
 * markdown, bullets, headings, code, links, tables, emoji and stray symbols
 * are removed or unwrapped — "asterisk asterisk" is never spoken.
 */
export function stripForSpeech(text: string): string {
  return (
    text
      // fenced code blocks first (keep a spoken hint rather than reading code)
      .replace(/```[\s\S]*?```/g, ' ')
      // HTML tags (incl. <details> wrappers already removed by callers)
      .replace(/<\/?[a-z][^>]*>/gi, ' ')
      // links/images: keep the label, drop the URL
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // bare URLs
      .replace(/https?:\/\/\S+/g, ' ')
      // bold / italic / strikethrough / inline code — unwrap, keep the words
      .replace(/(\*\*\*|\*\*|\*|___|__|_|~~|`)(.*?)\1/g, '$2')
      // headings, blockquotes, list bullets at line starts
      .replace(/^[ \t]*(?:#{1,6}[ \t]*|>+[ \t]*|[-*+][ \t]+|\d+[.)][ \t]+)/gm, '')
      // table pipes / separators
      .replace(/^\|.*\|$/gm, (row) => row.replace(/\|/g, ' ').replace(/-{3,}/g, ' '))
      // emoji & pictographs (TTS engines skip or misread them)
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
      // leftover markdown noise
      .replace(/[*_#`~|]/g, ' ')
      // em/en dashes read poorly on some engines — a comma phrases naturally
      .replace(/\s*[—–]\s*|\s+-\s+/g, ', ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/* ─── Lever 1b: the spoken voice must follow the CONTENT's language ──────── */

/** BCP-47 locale for every guide language (STT `recognition.lang` + TTS). */
export const SPEECH_LOCALES: Record<string, string> = {
  en: 'en-US', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN',
  ml: 'ml-IN', gu: 'gu-IN', pa: 'pa-IN', bn: 'bn-IN', ur: 'ur-PK', zh: 'zh-CN',
  'zh-TW': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA', fa: 'fa-IR',
  tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA', pl: 'pl-PL', cs: 'cs-CZ', sk: 'sk-SK',
  ro: 'ro-RO', hu: 'hu-HU', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR',
  it: 'it-IT', nl: 'nl-NL', sv: 'sv-SE', no: 'nb-NO', da: 'da-DK', fi: 'fi-FI',
  el: 'el-GR', he: 'he-IL', id: 'id-ID', ms: 'ms-MY', th: 'th-TH', vi: 'vi-VN',
  fil: 'fil-PH', sw: 'sw-KE', af: 'af-ZA', am: 'am-ET', az: 'az-AZ', be: 'be-BY',
  bg: 'bg-BG', bs: 'bs-BA', ca: 'ca-ES', hr: 'hr-HR', lt: 'lt-LT', lv: 'lv-LV',
  sr: 'sr-RS', sl: 'sl-SI',
}

/** Languages whose script is non-Latin (a wrong-language voice reading these
 *  skips the glyphs entirely, so they must never fall back to an English voice). */
export const NON_LATIN_LANGS = new Set<string>([
  'hi', 'mr', 'ta', 'te', 'kn', 'ml', 'bn', 'gu', 'pa', 'ur', 'zh', 'zh-TW',
  'ja', 'ko', 'ar', 'fa', 'ru', 'uk', 'be', 'bg', 'sr', 'el', 'he', 'th', 'am',
])

/** Unicode-script → locale rules, checked against the TEXT being spoken. A
 *  shared alphabet resolves via the user's selected language (e.g. Devanagari
 *  is Hindi unless Marathi is selected; Han is Chinese unless kana is present). */
const SCRIPT_RULES: Array<{ re: RegExp; locale: (prefer: string, text: string) => string }> = [
  { re: /[\u0C00-\u0C7F]/g, locale: () => 'te-IN' }, // Telugu
  { re: /[\u0C80-\u0CFF]/g, locale: () => 'kn-IN' }, // Kannada
  { re: /[\u0B80-\u0BFF]/g, locale: () => 'ta-IN' }, // Tamil
  { re: /[\u0D00-\u0D7F]/g, locale: () => 'ml-IN' }, // Malayalam
  { re: /[\u0900-\u097F]/g, locale: (p) => (p === 'mr' ? 'mr-IN' : 'hi-IN') }, // Devanagari
  { re: /[\u0980-\u09FF]/g, locale: () => 'bn-IN' }, // Bengali
  { re: /[\u0A00-\u0A7F]/g, locale: () => 'pa-IN' }, // Gurmukhi
  { re: /[\u0A80-\u0AFF]/g, locale: () => 'gu-IN' }, // Gujarati
  { re: /[\u0600-\u06FF\u0750-\u077F]/g, locale: (p) => (p === 'ur' ? 'ur-PK' : p === 'fa' ? 'fa-IR' : 'ar-SA') }, // Arabic script
  { re: /[\u0590-\u05FF]/g, locale: () => 'he-IL' }, // Hebrew
  { re: /[\u0400-\u04FF]/g, locale: (p) => (['ru', 'uk', 'be', 'bg', 'sr'].includes(p) ? SPEECH_LOCALES[p] : 'ru-RU') }, // Cyrillic
  { re: /[\u0370-\u03FF]/g, locale: () => 'el-GR' }, // Greek
  { re: /[\u0E00-\u0E7F]/g, locale: () => 'th-TH' }, // Thai
  { re: /[\u1200-\u137F]/g, locale: () => 'am-ET' }, // Ethiopic
  { re: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g, locale: () => 'ko-KR' }, // Hangul
  { re: /[\u3040-\u30FF]/g, locale: () => 'ja-JP' }, // Kana
  { re: /[\u4E00-\u9FFF]/g, locale: (p, text) => (/[\u3040-\u30FF]/.test(text) ? 'ja-JP' : p === 'zh-TW' ? 'zh-TW' : 'zh-CN') }, // Han
]

/**
 * Pick the TTS locale from the CONTENT being spoken — never from a hardcoded
 * default. The dominant non-Latin script in the text decides the language
 * (so a Telugu answer speaks Telugu even while the selector shows English);
 * `preferredLang` only breaks ties within a shared script and voices
 * Latin-script text (an English answer speaks English, a French answer with
 * French selected speaks French).
 */
export function detectSpeechLocale(text: string, preferredLang: string): string {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (letters > 0) {
    let bestLocale = ''
    let bestCount = 0
    for (const rule of SCRIPT_RULES) {
      const count = text.match(rule.re)?.length ?? 0
      if (count > bestCount) {
        bestCount = count
        bestLocale = rule.locale(preferredLang, text)
      }
    }
    // Dominant non-Latin script (≥25% of letters — answers often embed English
    // product names) → that script's language wins outright.
    if (bestLocale && bestCount / letters >= 0.25) return bestLocale
  }
  // Latin-script (or empty) content: the selected language if it's Latin-script,
  // otherwise it's an English answer shown while a non-Latin language is selected.
  if (!NON_LATIN_LANGS.has(preferredLang)) return SPEECH_LOCALES[preferredLang] ?? 'en-US'
  return 'en-US'
}

/* ─── Lever 2: the persona standard ─────────────────────────────────────── */

/** Time-appropriate greeting word (candidate's LOCAL part of day). */
export function greetingWord(tod?: TimeOfDay): string {
  return tod === 'morning' ? 'Good morning'
    : tod === 'afternoon' ? 'Good afternoon'
    : tod === 'evening' ? 'Good evening'
    : 'Hello'
}

/** Candidate's local part of day — client-side helper for greeting parity. */
export function localTimeOfDay(date: Date = new Date()): TimeOfDay {
  const h = date.getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

/**
 * HOW to speak — appended to every speaking persona so all surfaces share the
 * same human delivery. (The Voice Interview and the Tavus avatar both consume
 * this verbatim.)
 */
export const SPOKEN_STYLE_RULES =
  'Speak naturally and warmly, like a real person on a friendly call: use contractions, keep sentences short, one idea at a time, and vary your phrasing so you never sound templated or repetitive. ' +
  'Never read out markdown, bullet points, asterisks, code, URLs, or question numbers. Speak in plain sentences with natural pauses; do not use em dashes.'

/**
 * The varied-acknowledgment rule — a brief, warm, DIFFERENT thank-you after
 * every answer, exactly like the Voice Interview.
 */
export const VARIED_THANKS_RULE =
  'After each answer, give a brief, warm, VARIED acknowledgment before moving on — for example "Thanks, that\'s really helpful.", "Great, thank you.", "That makes sense.", "Lovely, thanks for walking me through that." — and never reuse the same phrase twice in a row.'

/** The default interviewer character used when a recruiter hasn't written one.
 *  The interviewer's NAME comes from the recruiter's avatar setup (aiName). */
export function defaultInterviewerPersona(candidateName?: string, aiName?: string): string {
  const who = candidateName?.trim() || 'the candidate'
  const me = aiName?.trim() || 'Alex'
  return `You are ${me}, a Senior Talent Specialist at TalbotIQ conducting a screening interview with ${who}. You are warm, personable and encouraging — you put people at ease and sound genuinely interested in their answers.`
}

/**
 * Build the full Tavus `conversational_context` for an interview conversation —
 * the recruiter's persona (or the default), the shared spoken style, and the
 * greet → ready-check → questions (with varied thanks) → warm wrap-up flow,
 * with the exact question script enforced. Questions are stripped for speech.
 */
export function avatarInterviewContext(opts: {
  personaText?: string
  candidateName?: string
  aiName?: string
  questions: string[]
  timeOfDay?: TimeOfDay
  /** Raw résumé text (or an excerpt) — lets the avatar sound informed about the
   *  candidate's background WITHOUT adding unscripted questions. */
  resumeText?: string
}): string {
  const who = opts.candidateName?.trim() || 'the candidate'
  const persona = opts.personaText?.trim() || defaultInterviewerPersona(opts.candidateName, opts.aiName)
  const numbered = opts.questions.map((q, i) => `${i + 1}. ${stripForSpeech(q)}`).join('\n')
  const background = opts.resumeText?.trim()
    ? `CANDIDATE BACKGROUND — from ${who}'s résumé. Use it to sound informed and to personalise your brief acknowledgments naturally (e.g. referencing their experience), but NEVER to add, change, or skip scripted questions:\n${opts.resumeText.trim().slice(0, 1500)}`
    : ''

  return [
    persona,
    ...(background ? [background] : []),
    SPOKEN_STYLE_RULES,
    `FLOW:
1. Open with a brief "${greetingWord(opts.timeOfDay)}" greeting and warmly welcome ${who}${opts.candidateName?.trim() ? ' by name' : ''}. Add one short reassuring line about how this will go, then ask if they're ready to begin, and wait.
2. If they clearly say yes, begin. If they're unsure or nervous, reassure them in one short line and ask again; only start on a clear yes.
3. Ask the questions below IN ORDER, one at a time, phrased exactly as written. Wait for ${who} to completely finish each answer — never interrupt. ${VARIED_THANKS_RULE}
4. Only AFTER the final question is answered, close warmly: thank them sincerely, tell them that's everything and they're all done, that the team will be in touch about next steps, and wish them a great rest of their day.`,
    `THE QUESTIONS, IN ORDER — ask every one, exactly as written; never say their numbers aloud:\n${numbered}`,
    `STRICT RULES: Ask ONLY these questions. Do NOT invent, add, skip, reorder, or rephrase any question, and never ask follow-ups that are not in the list. No small talk beyond the opening. If ${who} goes off-topic or asks you questions, politely acknowledge in one short line and steer straight back to the next planned question. Cover ALL the questions, then close — never finish early and never add questions of your own.`,
  ].join('\n\n')
}

/**
 * The avatar's first words. A recruiter-written greeting wins; otherwise a
 * warm, time-appropriate default that welcomes the candidate by name.
 */
export function avatarGreetingText(opts: {
  custom?: string
  candidateName?: string
  aiName?: string
  timeOfDay?: TimeOfDay
}): string {
  const custom = opts.custom?.trim()
  if (custom) return stripForSpeech(custom)
  const hi = greetingWord(opts.timeOfDay)
  const name = opts.candidateName?.trim()
  const me = opts.aiName?.trim()
  const intro = me ? `I'm ${me}, and I'm really looking forward to our chat` : `I'm really looking forward to our chat`
  return name
    ? `${hi} ${name}, welcome, and thanks so much for making the time today. ${intro}, so just relax and answer naturally. Are you ready to begin?`
    : `${hi}, welcome, and thanks so much for making the time today. ${intro}, so just relax and answer naturally. Are you ready to begin?`
}
