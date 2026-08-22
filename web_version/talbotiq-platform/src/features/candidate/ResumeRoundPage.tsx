import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, CheckCircle2, FileText, Upload } from 'lucide-react'
import { Button, Card, Page, cn } from '@/components/ui'
import { AmbientField } from '@/components/shell/AmbientField'
import { MimicLockup } from '@/components/brand/MimicMark'
import { resumeApi, describeFetchError } from '@/lib/api'

/**
 * A résumé round: the candidate submits a CV instead of sitting an interview.
 *
 * **Why this is a separate page and not a step in the interview engine.** A résumé
 * round is a submission, not a session — it has no questions, no clock and nothing to
 * join. Routed through the engine a candidate lands in a chat interview with zero
 * questions and no way to tell that from a broken page. The recruiter could always
 * create this round; only the Flutter client could complete one.
 *
 * **Two steps on purpose, mirroring `resume_intake_page.dart`.** Extraction is useful
 * on its own: the candidate reads back what was actually parsed out of their PDF and
 * confirms it, so a scanned or image-only CV is caught by the person who can fix it
 * rather than silently scored as an empty document. It also means a scoring failure
 * does not throw away a transcription that cost an upload.
 *
 * **No score is ever shown here.** A résumé score is a recruiter's screening tool, and
 * whether a candidate sees any result at all is decided by `resultPublished` — a
 * recruiter action. This confirms the submission and stops.
 */
const MAX_PDF_BYTES = 10 * 1024 * 1024

export default function ResumeRoundPage() {
  const { sessionId = '' } = useParams()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState<'reading' | 'scoring' | null>(null)
  const [done, setDone] = useState(false)

  const onFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Please choose a PDF.')
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error('That file is larger than 10 MB.')
      return
    }
    setBusy('reading')
    try {
      const base64 = await toBase64(file)
      const extracted = await resumeApi.extract(base64, file.name)
      if (!extracted.text.trim()) {
        /* An image-only or scanned PDF. Named plainly, because the candidate is the
           only person who can fix it and "0 characters" is not an instruction. */
        toast.error('No text could be read from that PDF — it may be a scan. Try a text-based export.')
        return
      }
      setText(extracted.text)
      setFileName(file.name)
      setTruncated(extracted.truncated)
    } catch (e) {
      toast.error(describeFetchError(e, 'Could not read that file. Try again.'))
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    setBusy('scoring')
    try {
      await resumeApi.score(sessionId, text, fileName || undefined)
      setDone(true)
    } catch (e) {
      toast.error(describeFetchError(e, 'Could not submit your résumé. Try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative min-h-screen bg-ground">
      <AmbientField variant="record" />

      <header className="relative z-sticky border-b border-rule bg-surface">
        <div className="mx-auto flex h-[60px] max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <MimicLockup />
          <Link
            to="/candidate"
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <ArrowLeft size={15} aria-hidden="true" /> Your interviews
          </Link>
        </div>
      </header>

      <main className="relative z-raised">
        <Page width="reading">
          {done ? (
            <Card className="p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={20} className="mt-0.5 flex-shrink-0 text-ok" aria-hidden="true" />
                <div>
                  <h1 className="font-display text-lg font-bold text-ink">Résumé received</h1>
                  {/* Deliberately no score. It is a screening tool, and whether a
                      candidate sees any result is the recruiter's decision. */}
                  <p className="mt-1.5 text-sm text-ink-muted">
                    Thank you — the hiring team has it. You will hear from them about the
                    next step; there is nothing further to do here.
                  </p>
                  <Link
                    to="/candidate"
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline underline-offset-2"
                  >
                    Back to your interviews
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <>
              <h1 className="font-display text-[28px] font-bold tracking-[-0.03em] text-ink">
                Submit your résumé
              </h1>
              <p className="mt-1.5 text-sm text-ink-muted">
                A PDF, under 10 MB. You will see what we read from it before it is sent.
              </p>

              <Card className="mt-6 p-6">
                <label
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-rule px-6 py-8 text-center transition-colors',
                    busy === 'reading' ? 'opacity-60' : 'hover:border-rule-strong',
                  )}
                >
                  <Upload size={22} className="text-ink-faint" aria-hidden="true" />
                  <span className="text-sm font-semibold text-ink">
                    {busy === 'reading' ? 'Reading your PDF…' : 'Choose a PDF'}
                  </span>
                  {fileName ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                      <FileText size={13} aria-hidden="true" /> {fileName}
                    </span>
                  ) : null}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    disabled={busy !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void onFile(file)
                    }}
                  />
                </label>

                {text ? (
                  <div className="mt-5">
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="field-label mb-0">What we read</span>
                      <span className="text-xs text-ink-muted">
                        {text.length.toLocaleString()} characters
                      </span>
                    </div>
                    {/* Editable, because the candidate is the only one who can tell that
                        a two-column layout came out interleaved. */}
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={12}
                      className="input-base font-mono text-xs leading-relaxed"
                      aria-label="Résumé text"
                    />
                    {truncated ? (
                      <p className="mt-2 text-xs text-warning">
                        {/* Said rather than hidden: a clipped résumé scored as if
                            complete is a worse outcome than being told. */}
                        Your résumé is longer than we store, so the end has been trimmed.
                        Check that the part that matters most is above.
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-ink-muted">
                      Fix anything the PDF read badly, then submit.
                    </p>
                  </div>
                ) : null}

                <div className="mt-5 flex justify-end border-t border-rule pt-4">
                  <Button
                    onClick={() => void submit()}
                    loading={busy === 'scoring'}
                    /* 30 is the server's own minimum; refusing here says why instead of
                       letting the request come back as a validation error. */
                    disabled={busy !== null || text.trim().length < 30}
                  >
                    Submit résumé
                  </Button>
                </div>
              </Card>
            </>
          )}
        </Page>
      </main>
    </div>
  )
}

/** A file as base64, without the data-URL prefix the server does not expect. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}
