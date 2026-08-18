import { useState } from 'react'
import { AgentStatus, type AgentStage } from '../components/AgentStatus'
import { pressHandlers } from '../motion/press'

/**
 * DEV ONLY. A specimen of the candidate Apple layer.
 *
 * It exists because a design language cannot be reviewed from a diff, and the
 * real Chatbot needs a live session to reach — so without this, the only way to
 * judge the feel is to run a whole interview. Everything here is the real
 * component or the real token, never a mock-up of one.
 */
const STAGES: AgentStage[] = ['thinking', 'reading', 'cooking', 'almost']

export default function LanguageHarness() {
  const [stage, setStage] = useState<AgentStage | null>('thinking')

  return (
    <div data-surface="candidate" className="min-h-screen bg-[var(--ap-ground)] p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="ap-display">Quick system check</h1>
          <p className="ap-body mt-2 text-[var(--ap-label-secondary)]">
            The same type scale a candidate reads, at the size they read it.
          </p>
        </header>

        {/* Material, over content, so the blur has something to blur. */}
        <div className="relative overflow-hidden rounded-[var(--ap-r-xl)]" style={{ boxShadow: 'var(--ap-shadow-card)' }}>
          <div className="space-y-2 bg-[var(--ap-surface-sunken)] p-6">
            <p className="ap-body">Content sits underneath the chrome.</p>
            <p className="ap-body">It is not beside it, and not cut by a rule.</p>
            <p className="ap-body">The material blurs whatever passes below.</p>
            <p className="ap-body">That is the whole point of the layer.</p>
          </div>
          <div className="ap-material ap-edge-top absolute inset-x-0 bottom-0 p-4" data-testid="material-chrome">
            <span className="ap-vibrant ap-caption">Floating translucent chrome</span>
          </div>
        </div>

        {/* The status system, all four stages, driven by the real component. */}
        <section className="rounded-[var(--ap-r-lg)] bg-[var(--ap-surface)] p-5" style={{ boxShadow: 'var(--ap-shadow-card)' }}>
          <h2 className="ap-title">Agent status</h2>
          <p className="ap-caption mt-1 text-[var(--ap-label-tertiary)]">
            Each stage has its own rhythm. It should be ignorable by the second interview.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => setStage(s)}
                {...pressHandlers()}
                data-testid={`stage-${s}`}
                className="ap-hit rounded-[var(--ap-r-full)] border border-[var(--ap-separator)] px-4 text-sm font-medium"
                style={{
                  transitionProperty: 'transform',
                  transitionDuration: '100ms',
                  background: stage === s ? 'var(--ap-accent-soft)' : 'transparent',
                }}
              >
                {s}
              </button>
            ))}
            <button
              onClick={() => setStage(null)}
              {...pressHandlers()}
              data-testid="stage-idle"
              className="ap-hit rounded-[var(--ap-r-full)] border border-[var(--ap-separator)] px-4 text-sm font-medium"
              style={{ transitionProperty: 'transform', transitionDuration: '100ms' }}
            >
              idle
            </button>
          </div>

          {/* The row keeps its height at idle — that is the zero-layout-shift claim,
              and it is visible here because the rule below never moves. */}
          <div className="mt-4">
            <AgentStatus stage={stage} />
          </div>
          <hr className="mt-4 border-[var(--ap-separator)]" />
        </section>

        {/* Press feedback, on pointer-down. */}
        <section className="rounded-[var(--ap-r-lg)] bg-[var(--ap-surface)] p-5" style={{ boxShadow: 'var(--ap-shadow-card)' }}>
          <h2 className="ap-title">Press</h2>
          <p className="ap-caption mt-1 text-[var(--ap-label-tertiary)]">
            Hold it down. The response is on press, not on release.
          </p>
          <button
            {...pressHandlers({ haptic: true })}
            data-testid="press-sample"
            className="ap-hit mt-4 rounded-[var(--ap-r-md)] px-6 font-semibold text-white"
            style={{ background: 'var(--ap-accent)', transitionProperty: 'transform', transitionDuration: '100ms' }}
          >
            Send
          </button>
        </section>
      </div>
    </div>
  )
}
