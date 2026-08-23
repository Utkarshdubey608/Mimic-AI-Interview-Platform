/**
 * Shared invite-email helpers — the SINGLE source of truth for merge-variable
 * rendering, locked-token validation, AND the final email shell, used by BOTH the
 * client preview and the server send path so what the recruiter previews is exactly
 * what goes out.
 *
 * Pure + dependency-free (safe to import from client bundle and server). The server
 * sanitises the WYSIWYG body BEFORE calling renderInviteEmail(); the client passes
 * the editor's already-constrained HTML.
 */
import type { EmailKind, InviteEmailTemplate } from './types'

/** Merge variables the recruiter can insert. Filled per-candidate at send time. */
export const MERGE_VARS = [
  { token: '{{candidate_name}}', label: 'Candidate name' },
  { token: '{{role}}', label: 'Role' },
  { token: '{{recruiter_name}}', label: 'Recruiter name' },
  { token: '{{company}}', label: 'Company' },
  { token: '{{interview_link}}', label: 'Interview link (locked)' },
  { token: '{{deadline}}', label: 'Deadline' },
] as const

export type MergeVarKey =
  | 'candidate_name' | 'role' | 'recruiter_name' | 'company' | 'interview_link' | 'deadline'

/**
 * Tokens that MUST survive to send time. The interview link is functionally required
 * by the assigned-email auth model — every candidate needs their own unique link.
 */
export const REQUIRED_TOKENS = ['{{interview_link}}'] as const

/**
 * Replace `{{token}}` occurrences with values. Unknown tokens are left untouched
 * (so a typo shows up literally in the preview rather than silently vanishing).
 * Surrounding whitespace inside the braces is tolerated: `{{ role }}` === `{{role}}`.
 */
export function renderTemplate(str: string, vars: Record<string, string>): string {
  if (!str) return ''
  return str.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : m,
  )
}

/** True when a merge token is present anywhere in subject or body. */
export function validateLockedTokens(
  subject: string,
  bodyHtml: string,
  kind: EmailKind = 'invite',
): { ok: boolean; missing: string[] } {
  const hay = `${subject ?? ''}\n${bodyHtml ?? ''}`
  const missing = requiredTokensFor(kind).filter((t) => !hay.includes(t))
  return { ok: missing.length === 0, missing }
}

/** Any `{{tokens}}` in the string that are NOT recognised merge variables. */
export function unknownTokens(str: string): string[] {
  const known = new Set<string>(MERGE_VARS.map((v) => v.token))
  const found = str.match(/\{\{\s*[a-z_]+\s*\}\}/g) ?? []
  return [...new Set(found.map((f) => f.replace(/\s+/g, '')))].filter((t) => !known.has(t))
}

/** HTML-escape a text value so merge/candidate text can't inject markup. */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Resolve a template's kind (absent === 'invite'). */
export function kindOf(tpl: { kind?: EmailKind }): EmailKind {
  return tpl?.kind ?? 'invite'
}

const ADVANCE_VARS = [
  { token: '{{candidate_name}}', label: 'Candidate name' },
  { token: '{{role}}', label: 'Role' },
  { token: '{{round_name}}', label: 'Next round name' },
  { token: '{{interview_link}}', label: 'Interview link (locked)' },
  { token: '{{recruiter_name}}', label: 'Recruiter name' },
  { token: '{{company}}', label: 'Company' },
  { token: '{{previous_round_name}}', label: 'Previous round name' },
  { token: '{{score}}', label: 'Score' },
] as const
const SELECTED_VARS = [
  { token: '{{candidate_name}}', label: 'Candidate name' },
  { token: '{{role}}', label: 'Role' },
  { token: '{{recruiter_name}}', label: 'Recruiter name' },
  { token: '{{company}}', label: 'Company' },
  { token: '{{score}}', label: 'Score' },
] as const
const REJECTION_VARS = [
  { token: '{{candidate_name}}', label: 'Candidate name' },
  { token: '{{role}}', label: 'Role' },
  { token: '{{recruiter_name}}', label: 'Recruiter name' },
  { token: '{{company}}', label: 'Company' },
] as const

/** Merge variables offered for a given email kind. */
export function mergeVarsFor(kind: EmailKind): readonly { token: string; label: string }[] {
  switch (kind) {
    case 'advance': return ADVANCE_VARS
    case 'selected': return SELECTED_VARS
    case 'rejection': return REJECTION_VARS
    default: return MERGE_VARS
  }
}

/** Tokens that MUST survive to send time, by kind. Link is required only where one is sent. */
export function requiredTokensFor(kind: EmailKind): string[] {
  return kind === 'invite' || kind === 'advance' ? ['{{interview_link}}'] : []
}

const HEX = /^#[0-9a-f]{3,8}$/i

export interface InviteRenderVars {
  candidate_name: string
  role: string
  recruiter_name: string
  company: string
  deadline: string
}
export interface InviteRenderOpts {
  interviewLink: string
  candidateEmail: string
}

function ctaButton(tpl: InviteEmailTemplate, link: string): string {
  const color = HEX.test(tpl.cta?.color || '') ? tpl.cta.color : '#6B2BE0'
  const text = escapeHtml(tpl.cta?.text || 'Start your interview')
  return `<a href="${escapeHtml(link)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-family:Inter,Arial,sans-serif">${text}</a>`
}

/** The locked "use this exact email" note — always present, never removable. */
export function exactEmailNote(candidateEmail: string): string {
  return `<p style="background:#F5F0FE;border:1px solid #E0D4FB;border-radius:8px;padding:10px 14px;color:#4A1BA8;font-size:13px;font-family:Inter,Arial,sans-serif">
    <strong>Important:</strong> this invitation is linked to <strong>${escapeHtml(candidateEmail)}</strong>.
    Sign in — or create your candidate account — using this exact email address to open it.
  </p>`
}

export interface EmailShellFlags {
  includeLink: boolean
  includeNote: boolean
}

/**
 * Generalized email shell. `textVars` are ALREADY-ESCAPED values (excluding
 * interview_link, handled here). `flags` toggle the locked link CTA and the
 * "exact email" note so the same shell serves invite/advance (link+note) and
 * selected/rejection (neither). `bodyHtml` on `tpl` is assumed SAFE.
 */
export function renderEmailShell(
  tpl: InviteEmailTemplate,
  textVars: Record<string, string>,
  opts: { interviewLink?: string; candidateEmail?: string },
  flags: EmailShellFlags,
): { subject: string; html: string } {
  const link = opts.interviewLink ?? ''
  const subject = renderTemplate(tpl.subject, { ...textVars, interview_link: link })

  const bodyHasLink = (tpl.bodyHtml || '').includes('{{interview_link}}')
  const bodyRendered = renderTemplate(tpl.bodyHtml || '', {
    ...textVars,
    interview_link: flags.includeLink ? ctaButton(tpl, link) : '',
  })
  const fallbackCta = flags.includeLink && !bodyHasLink
    ? `<p style="margin:16px 0">${ctaButton(tpl, link)}</p>` : ''
  const note = flags.includeNote && opts.candidateEmail ? exactEmailNote(opts.candidateEmail) : ''
  const pasteLink = flags.includeLink
    ? `<p style="color:#645C7B;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(link)}</p>` : ''

  const accent = HEX.test(tpl.branding?.accentColor || '') ? tpl.branding.accentColor : '#6B2BE0'
  const logo = tpl.branding?.logoUrl
    ? `<img src="${escapeHtml(tpl.branding.logoUrl)}" alt="${escapeHtml(tpl.branding.companyName || '')}" style="max-height:40px;margin-bottom:8px" />`
    : `<div style="font-weight:700;color:${accent};font-size:18px">${escapeHtml(tpl.branding?.companyName || 'Mimic')}</div>`
  const footer = escapeHtml(tpl.branding?.footer || 'Sent via Mimic.')

  // Shell tones mirror the in-app violet system so the email preview in the
  // invite wizard and the delivered mail read as one surface. Figtree is the
  // product face; the rest of the stack is what mail clients actually have.
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5FB;padding:24px 0;font-family:Figtree,Roboto,'Segoe UI',Arial,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #E7E2F2;border-radius:16px;overflow:hidden">
      <tr><td style="border-top:4px solid ${accent};padding:20px 28px 8px">${logo}</td></tr>
      <tr><td style="padding:8px 28px;color:#1B0B3B;font-size:15px;line-height:1.6">
        ${bodyRendered}
        ${fallbackCta}
        ${note}
        ${pasteLink}
      </td></tr>
      <tr><td style="padding:14px 28px 22px;color:#645C7B;font-size:12px;border-top:1px solid #E7E2F2">${footer}</td></tr>
    </table>
  </td></tr>
</table>`

  return { subject, html }
}

/**
 * Build the final { subject, html } for one candidate. `bodyHtml` on the template is
 * assumed SAFE (server sanitises first; the client editor is already constrained).
 * The `{{interview_link}}` token in the body becomes the CTA button; all other
 * tokens are escaped text. The locked link + "exact email" note are always injected.
 */
export function renderInviteEmail(
  tpl: InviteEmailTemplate,
  vars: InviteRenderVars,
  opts: InviteRenderOpts,
): { subject: string; html: string } {
  const textVars: Record<string, string> = {
    candidate_name: escapeHtml(vars.candidate_name),
    role: escapeHtml(vars.role),
    recruiter_name: escapeHtml(vars.recruiter_name),
    company: escapeHtml(vars.company),
    deadline: escapeHtml(vars.deadline),
  }
  return renderEmailShell(
    tpl, textVars,
    { interviewLink: opts.interviewLink, candidateEmail: opts.candidateEmail },
    { includeLink: true, includeNote: true },
  )
}

export interface TransitionRenderVars {
  candidate_name: string
  role: string
  recruiter_name: string
  company: string
  round_name?: string
  previous_round_name?: string
  score?: string
}

/** Render a transition email (advance/selected/rejection). advance carries the link+note. */
export function renderTransitionEmail(
  tpl: InviteEmailTemplate,
  kind: 'advance' | 'selected' | 'rejection',
  vars: TransitionRenderVars,
  opts: { interviewLink?: string; candidateEmail?: string } = {},
): { subject: string; html: string } {
  const textVars: Record<string, string> = {
    candidate_name: escapeHtml(vars.candidate_name),
    role: escapeHtml(vars.role),
    recruiter_name: escapeHtml(vars.recruiter_name),
    company: escapeHtml(vars.company),
    round_name: escapeHtml(vars.round_name ?? ''),
    previous_round_name: escapeHtml(vars.previous_round_name ?? ''),
    score: escapeHtml(vars.score ?? ''),
  }
  const includeLink = kind === 'advance'
  return renderEmailShell(tpl, textVars, opts, { includeLink, includeNote: includeLink })
}

/**
 * A sensible default invite-email config that preloads for a recruiter who has none.
 * Passes locked-token validation. Caller stamps id/recruiterId/timestamps.
 */
export function defaultInviteEmailTemplate() {
  return {
    name: 'Default invite',
    isDefault: true,
    sender: { verifiedSenderEmail: '', fromName: 'Mimic', replyTo: '' },
    subject: 'Interview invitation — {{role}}',
    bodyHtml:
      '<p>Hi {{candidate_name}},</p>' +
      '<p><strong>{{recruiter_name}}</strong> has invited you to a screening interview for the <strong>{{role}}</strong> role at {{company}}.</p>' +
      "<p>When you're ready, open your interview, upload your résumé, and begin — it takes just a few minutes:</p>" +
      '<p>{{interview_link}}</p>',
    cta: { text: 'Start your interview', color: '#6B2BE0' },
    branding: {
      companyName: 'Mimic',
      accentColor: '#6B2BE0',
      footer: 'Sent via Mimic.',
    } as { companyName: string; accentColor: string; footer?: string; logoUrl?: string },
    deadlineText: '',
  }
}

type EmailTemplateSeed = Omit<InviteEmailTemplate, 'id' | 'recruiterId' | 'createdAt' | 'updatedAt'>

/** Kind-appropriate default template. `defaultTemplateFor('invite')` === the invite default + kind. */
export function defaultTemplateFor(kind: EmailKind): EmailTemplateSeed {
  const sender = { verifiedSenderEmail: '', fromName: 'Mimic', replyTo: '' }
  const branding = { companyName: 'Mimic', accentColor: '#6B2BE0', footer: 'Sent via Mimic.' } as {
    companyName: string; accentColor: string; footer?: string; logoUrl?: string
  }
  if (kind === 'advance') {
    return {
      name: 'Default advance', isDefault: true, kind: 'advance', sender,
      subject: "You've advanced — {{role}} ({{round_name}})",
      bodyHtml:
        '<p>Hi {{candidate_name}},</p>' +
        '<p>Congratulations — you\'ve advanced to the <strong>{{round_name}}</strong> round for the <strong>{{role}}</strong> role at {{company}}.</p>' +
        '<p>Open your next interview to continue:</p>' +
        '<p>{{interview_link}}</p>',
      cta: { text: 'Start next round', color: '#6B2BE0' }, branding, deadlineText: '',
    }
  }
  if (kind === 'selected') {
    return {
      name: 'Default selection', isDefault: true, kind: 'selected', sender,
      subject: "You've been selected — {{role}}",
      bodyHtml:
        '<p>Hi {{candidate_name}},</p>' +
        '<p>Congratulations — following your interviews for the <strong>{{role}}</strong> role at {{company}}, we\'re delighted to move you forward as a selected candidate. Our team will be in touch with next steps.</p>',
      cta: { text: 'View details', color: '#6B2BE0' }, branding, deadlineText: '',
    }
  }
  if (kind === 'rejection') {
    return {
      name: 'Default rejection', isDefault: true, kind: 'rejection', sender,
      subject: 'Update on your {{role}} application',
      bodyHtml:
        '<p>Hi {{candidate_name}},</p>' +
        '<p>Thank you for taking the time to interview for the <strong>{{role}}</strong> role at {{company}}. After careful consideration we won\'t be moving forward at this time. We genuinely appreciate the effort you put in and wish you every success.</p>',
      cta: { text: '', color: '#6B2BE0' }, branding, deadlineText: '',
    }
  }
  return { ...defaultInviteEmailTemplate(), kind: 'invite' }
}
