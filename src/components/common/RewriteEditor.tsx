import { useState, useCallback, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

interface Props {
  content: string
  onContentChange: (plainText: string) => void
  onRewriteSelection?: (selectedText: string) => Promise<string | null>
  onContinueSelection?: (contextText: string) => Promise<string | null>
  readOnly?: boolean
}

/**
 * Convert plain text → HTML for TipTap (paragraphs separated by blank lines)
 */
function plainToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(p => p.trim() ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '')
    .join('')
}

/**
 * Convert TipTap HTML → plain text
 */
function htmlToPlain(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  // Replace <p> tags with double newlines, <br> with single newline
  let text = ''
  for (const child of Array.from(div.childNodes)) {
    if (child.nodeName === 'P') {
      const pText = child.textContent || ''
      text += (text ? '\n\n' : '') + pText
    } else if (child.nodeName === 'BR') {
      text += '\n'
    } else {
      text += child.textContent || ''
    }
  }
  return text.trim()
}

export default function RewriteEditor({
  content,
  onContentChange,
  onRewriteSelection,
  onContinueSelection,
  readOnly = false,
}: Props) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState('')

  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  const editor = useEditor({
    extensions: [StarterKit],
    editable: !readOnly,
    editorProps: {
      attributes: {
        style: `outline: none; min-height: 400px; padding: 32px 40px; font-size: 17px; line-height: 2.1; font-family: "Noto Serif SC", "Source Han Serif SC", "SimSun", serif; color: #1a1410; background: #fff;`,
      },
    },
    content: plainToHtml(content),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      const plain = htmlToPlain(html)
      onContentChangeRef.current(plain)
    },
  })

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

  // Right-click handler
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onRewriteSelection && !onContinueSelection) return
    if (!editor) return
    e.preventDefault()
    const text = editor.state.doc.textBetween(
      editor.state.selection.from, editor.state.selection.to, '\n\n'
    ).trim()
    if (text.length < 2 && !onContinueSelection) return
    setSelectedText(text)
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [editor, onRewriteSelection, onContinueSelection])

  // AI rewrite selected text
  const handleAiRewrite = useCallback(async () => {
    setCtxMenu(null)
    if (!onRewriteSelection || !selectedText || !editor) return
    setAiLoading(true)
    setAiStatus('AI 改写中...')
    try {
      const result = await onRewriteSelection(selectedText)
      if (result) {
        // Replace selected text with AI result
        editor.chain().focus().deleteSelection().insertContent(plainToHtml(result)).run()
      }
    } catch { /* ignore */ }
    setAiLoading(false)
    setAiStatus('')
  }, [onRewriteSelection, selectedText, editor])

  // AI continue after selected text
  const handleAiContinue = useCallback(async () => {
    setCtxMenu(null)
    if (!onContinueSelection || !editor) return
    const contextText = selectedText || editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    setAiLoading(true)
    setAiStatus('AI 续写中...')
    try {
      const result = await onContinueSelection(contextText)
      if (result) {
        // Insert AI continuation at end of document
        editor.chain().focus().insertContentAt(editor.state.doc.content.size, plainToHtml('\n\n' + result)).run()
      }
    } catch { /* ignore */ }
    setAiLoading(false)
    setAiStatus('')
  }, [onContinueSelection, selectedText, editor])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* AI status indicator */}
      {aiLoading && (
        <div style={{
          padding: '8px 16px', background: 'rgba(236,72,153,0.08)',
          borderBottom: '1px solid rgba(236,72,153,0.15)',
          fontSize: 13, fontWeight: 600, color: '#ec4899',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span className="breathe-dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', color: '#ec4899' }} />
          {aiStatus}
        </div>
      )}

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
          <div
            onClick={closeCtxMenu}
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          />
          <div style={{
            position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
            background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: '6px 0',
            minWidth: 160, fontFamily: 'inherit',
          }}>
            {selectedText.length >= 2 && onRewriteSelection && (
              <button
                onClick={handleAiRewrite}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 16px', border: 'none', cursor: 'pointer',
                  background: 'transparent', color: '#7c3aed',
                  fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                  textAlign: 'left' as const,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                ✨ 改写选中段落
              </button>
            )}
            {onContinueSelection && (
              <button
                onClick={handleAiContinue}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 16px', border: 'none', cursor: 'pointer',
                  background: 'transparent', color: '#6366f1',
                  fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                  textAlign: 'left' as const,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                ➕ 续写
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
