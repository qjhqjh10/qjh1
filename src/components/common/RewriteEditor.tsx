import { useState, useCallback, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useSettingsStore } from '@/store'
import AIPolishDialog from '@/components/common/AIPolishDialog'

interface Props {
  content: string
  onContentChange: (plainText: string) => void
  configId: string | null
  projectId?: string
  readOnly?: boolean
}

/**
 * Convert plain text → HTML for TipTap.
 * Paragraphs separated by blank lines. Each paragraph gets text-indent: 2em via CSS.
 */
function plainToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(p => {
      // Strip leading full-width spaces (added by htmlToPlain for indent)
      const trimmed = p.replace(/^[　]+/, '').trim()
      if (!trimmed) return ''
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
    })
    .filter(Boolean)
    .join('')
}

/**
 * Convert TipTap HTML → plain text with proper formatting:
 * - Paragraphs separated by \n\n
 * - Each paragraph starts with 2 full-width spaces (indent)
 */
function htmlToPlain(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  const paragraphs: string[] = []
  for (const child of Array.from(div.childNodes)) {
    if (child.nodeName === 'P') {
      const pText = child.textContent || ''
      if (pText.trim()) {
        // Add 2 full-width spaces for paragraph indent in saved text
        paragraphs.push('　　' + pText)
      }
    } else if (child.nodeName === 'BR') {
      // skip — <br> inside <p> is already handled
    } else {
      const text = child.textContent?.trim()
      if (text) paragraphs.push(text)
    }
  }
  return paragraphs.join('\n\n')
}

export default function RewriteEditor({
  content,
  onContentChange,
  configId,
  projectId,
  readOnly = false,
}: Props) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const [polishDialogOpen, setPolishDialogOpen] = useState(false)
  const [polishMode, setPolishMode] = useState<'改写' | '续写'>('改写')

  const prompts = useSettingsStore(s => s.prompts)

  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  const editor = useEditor({
    extensions: [StarterKit],
    editable: !readOnly,
    editorProps: {
      attributes: {
        style: `outline: none; min-height: 400px; padding: 32px 40px; font-size: 17px; line-height: 2.1; font-family: "Noto Serif SC", "Source Han Serif SC", "SimSun", serif; color: #1a1410; background: #fff;`,
        class: 'rewrite-editor-content',
      },
    },
    content: plainToHtml(content),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      const plain = htmlToPlain(html)
      onContentChangeRef.current(plain)
    },
  })

  // Inject CSS for paragraph indent in the editor
  useEffect(() => {
    const styleId = 'rewrite-editor-styles'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        .rewrite-editor-content p { text-indent: 2em; margin: 0 0 0.5em 0; }
        .rewrite-editor-content p:last-child { margin-bottom: 0; }
      `
      document.head.appendChild(style)
    }
  }, [])

  // Sync external content changes → editor
  const prevContentRef = useRef(content)
  useEffect(() => {
    if (editor && content !== prevContentRef.current) {
      prevContentRef.current = content
      const currentHtml = editor.getHTML()
      const targetHtml = plainToHtml(content)
      if (currentHtml !== targetHtml) {
        editor.commands.setContent(targetHtml)
      }
    }
  }, [content, editor])

  // Toggle editable
  useEffect(() => {
    if (editor) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // Right-click handler → show context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!editor) return
    e.preventDefault()
    const text = editor.state.doc.textBetween(
      editor.state.selection.from, editor.state.selection.to, '\n\n'
    ).trim()
    if (text.length < 2) return
    setSelectedText(text)
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [editor])

  // Open polish dialog for selected mode
  const openPolishDialog = useCallback((mode: '改写' | '续写') => {
    setCtxMenu(null)
    setPolishMode(mode)
    setPolishDialogOpen(true)
  }, [])

  // Handle AI result insertion
  const handleInsertPolish = useCallback((text: string) => {
    if (!editor) return
    if (polishMode === '续写') {
      const { to } = editor.state.selection
      editor.chain().focus().setTextSelection(to).insertContent('\n\n' + text).run()
    } else {
      editor.chain().focus().deleteSelection().insertContent(text).run()
    }
  }, [editor, polishMode])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Editor content */}
      <div
        onContextMenu={handleContextMenu}
        style={{ flex: 1, overflow: 'auto' }}
        className="custom-scrollbar"
      >
        <EditorContent editor={editor} />
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <>
          <div onClick={closeCtxMenu} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
            background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: '6px 0',
            minWidth: 160, fontFamily: 'inherit',
          }}>
            <button onClick={() => openPolishDialog('改写')} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 16px', border: 'none', cursor: 'pointer',
              background: 'transparent', color: '#7c3aed', fontSize: 14,
              fontWeight: 600, fontFamily: 'inherit', textAlign: 'left' as const,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              ✨ 改写选中段落
            </button>
            <button onClick={() => openPolishDialog('续写')} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 16px', border: 'none', cursor: 'pointer',
              background: 'transparent', color: '#6366f1', fontSize: 14,
              fontWeight: 600, fontFamily: 'inherit', textAlign: 'left' as const,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.06)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              ➕ 续写
            </button>
          </div>
        </>
      )}

      {/* AI Polish Dialog */}
      <AIPolishDialog
        isOpen={polishDialogOpen}
        mode={polishMode}
        selectedText={selectedText}
        prompts={prompts}
        configId={configId}
        projectId={projectId || null}
        onClose={() => setPolishDialogOpen(false)}
        onInsert={handleInsertPolish}
      />
    </div>
  )
}
