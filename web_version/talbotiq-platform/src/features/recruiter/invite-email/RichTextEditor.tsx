import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Bold, Italic, List, ListOrdered, Link2, Heading2, Variable, ChevronDown } from 'lucide-react'
import { MERGE_VARS } from '@shared/inviteEmail'
import { cn } from '@/components/ui'

/**
 * Minimal WYSIWYG for the invite-email BODY. Tiptap (StarterKit + Link) emits a
 * constrained, safe HTML subset; the server re-sanitises before sending. An
 * "Insert variable" control drops merge tokens at the cursor — including the locked
 * {{interview_link}} which renders as the CTA button at send time.
 */
export function RichTextEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (html: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: false }),
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class: [
          'min-h-[200px] bg-white px-4 py-3 text-sm leading-relaxed text-neutral-800 focus:outline-none',
          // Give the editable region the shape of the email it produces.
          '[&_p]:my-2 [&_p:first-child]:mt-0',
          '[&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:text-base [&_h2]:font-bold [&_h2]:tracking-[-0.02em] [&_h2]:text-neutral-900',
          '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-neutral-900',
          '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
          '[&_a]:font-medium [&_a]:text-action-edge [&_a]:underline [&_a]:underline-offset-2',
          '[&_strong]:font-semibold [&_strong]:text-neutral-900',
        ].join(' '),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Sync external changes (e.g. loading a saved template) into the editor.
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (value !== current) editor.commands.setContent(value || '<p></p>', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  if (!editor) return null

  const Btn = ({ on, active, title, children }: { on: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      onMouseDown={(e) => { e.preventDefault(); on() }}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1',
        active ? 'bg-surface-hover text-ink' : 'text-ink-muted hover:bg-surface hover:text-ink',
      )}
    >
      {children}
    </button>
  )

  return (
    <div className={cn(
      'overflow-hidden rounded-xl border border-rule-strong bg-surface transition-all duration-150',
      'focus-within:border-action focus-within:ring-[3px] focus-within:ring-signal/12',
    )}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-sunk px-2 py-1.5">
        <Btn title="Bold" active={editor.isActive('bold')} on={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Btn>
        <Btn title="Italic" active={editor.isActive('italic')} on={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Btn>
        <Btn title="Heading" active={editor.isActive('heading', { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></Btn>

        <span className="mx-1 h-5 w-px bg-border" />

        <Btn title="Bullet list" active={editor.isActive('bulletList')} on={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')} on={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></Btn>
        <Btn title="Add link" active={editor.isActive('link')} on={() => {
          const prev = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('Link URL', prev || 'https://')
          if (url === null) return
          if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
          else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        }}><Link2 size={15} /></Btn>

        <span className="mx-1 h-5 w-px bg-border" />

        <div className="relative ml-auto">
          <select
            aria-label="Insert a merge variable"
            className="h-8 cursor-pointer appearance-none rounded-full border border-border bg-surface pl-7 pr-7 text-xs font-semibold text-ink-body transition-colors duration-150 hover:border-rule-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1"
            value=""
            onChange={(e) => {
              const tok = e.target.value
              if (tok) editor.chain().focus().insertContent(tok).run()
              e.target.value = ''
            }}
          >
            <option value="">Insert variable</option>
            {MERGE_VARS.map((v) => (
              <option key={v.token} value={v.token}>{v.label}</option>
            ))}
          </select>
          <Variable size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink" />
          <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
