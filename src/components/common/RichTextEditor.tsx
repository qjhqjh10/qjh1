import { useState, useCallback, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import UnderlineExtension from '@tiptap/extension-underline'
import ColorExtension from '@tiptap/extension-color'
import TextStyleExtension from '@tiptap/extension-text-style'
import HighlightExtension from '@tiptap/extension-highlight'
import TextAlignExtension from '@tiptap/extension-text-align'
import FontFamilyExtension from '@tiptap/extension-font-family'
import PlaceholderExtension from '@tiptap/extension-placeholder'
import CharacterCountExtension from '@tiptap/extension-character-count'
import EditorToolbar from '@/components/chapterWriting/EditorToolbar'
import SymbolPicker from '@/components/common/SymbolPicker'
import FindReplace from '@/components/common/FindReplace'
import ContextMenu from '@/components/common/ContextMenu'
import PolishPreview from '@/components/common/PolishPreview'
import { useStore, useSettingsStore } from '@/store'
import { aiService } from '@/services/fileService'
import { parseAiErrorMessage } from '@/utils/textUtils'

interface Props {
  content: string
  onContentChange: (html: string) => void
  onBlur?: () => void
  placeholder?: string
}

export default function RichTextEditor({ content, onContentChange, onBlur, placeholder = '开始写作...' }: Props) {
  const [showSymbols, setShowSymbols] = useState(false)
  const [showFind, setShowFind] = useState(false)
  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [selectedText, setSelectedText] = useState('')
  // Polish/continue preview
  const [polishResult, setPolishResult] = useState<string | null>(null)
  const [polishError, setPolishError] = useState('')
  const [polishTitle, setPolishTitle] = useState('')
  const [polishLoading, setPolishLoading] = useState(false)

  const activeProjectId = useStore(s => s.activeProjectId)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const prompts = useSettingsStore(s => s.prompts)

  // Refs to avoid stale closure in TipTap callbacks
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur

  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExtension, ColorExtension, TextStyleExtension, HighlightExtension,
      TextAlignExtension.configure({ types: ['heading', 'paragraph'] }),
      FontFamilyExtension,
      PlaceholderExtension.configure({ placeholder }),
      CharacterCountExtension,
    ],
    editorProps: {
      attributes: {
        style: `outline: none; min-height: 500px; padding: 48px 56px; font-size: var(--editor-font-size, 16px); line-height: 2; font-family: "PingFang SC", "Microsoft YaHei", "Noto Serif SC", Georgia, serif; color: #2d2520;`,
      },
    },
    content,
    onUpdate: ({ editor }) => { onContentChangeRef.current(editor.getHTML()) },
    onBlur: () => { onBlurRef.current?.() },
  })

  const prevContentRef = useRef(content)
  useEffect(() => {
    if (editor && content !== prevContentRef.current) {
      prevContentRef.current = content
      const currentHtml = editor.getHTML()
      if (currentHtml !== content) {
        try { editor.commands.setContent(content) } catch { /* ignore */ }
      }
    }
  }, [content, editor])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const handleInsertSymbol = useCallback((symbol: string) => {
    if (editor) editor.chain().focus().insertContent(symbol).run()
  }, [editor])

  // Right-click handler
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const text = editor ? editor.state.doc.textBetween(
      editor.state.selection.from, editor.state.selection.to, ' '
    ) : ''
    if (text.trim().length < 2) return
    setSelectedText(text.trim())
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [editor])

  // AI generation guard
  const generationRef = useRef(0)

  // Polish
  const handlePolish = useCallback(async () => {
    setCtxMenu(null)
    if (!activeConfigId || !selectedText) return
    setPolishLoading(true)
    setPolishTitle('润色结果')
    setPolishError('')
    const genId = ++generationRef.current
    try {
      const polishPrompt = prompts.find(p => p.type === '润色' && p.enabled)
      const msg = polishPrompt?.content || '请润色以下文字，优化表达、修正语病、提升文采，但保持原意不变。'
      const reply = await aiService.chat([{ role: 'user', content: `${msg}\n\n${selectedText}` }], activeConfigId, activeProjectId || undefined)
      if (genId === generationRef.current) setPolishResult(reply)
    } catch (err) {
      if (genId === generationRef.current) {
        setPolishError(parseAiErrorMessage(err, '请求失败，请检查 AI 配置'))
      }
    }
    if (genId === generationRef.current) setPolishLoading(false)
  }, [activeConfigId, selectedText, prompts, activeProjectId])

  // Continue
  const handleContinue = useCallback(async () => {
    setCtxMenu(null)
    if (!activeConfigId || !selectedText) return
    setPolishLoading(true)
    setPolishTitle('续写结果')
    setPolishError('')
    const genId = ++generationRef.current
    try {
      const continuePrompt = prompts.find(p => p.type === '续写' && p.enabled)
      const msg = continuePrompt?.content || '请根据以下内容自然续写，保持风格一致。'
      const reply = await aiService.chat([{ role: 'user', content: `${msg}\n\n${selectedText}` }], activeConfigId, activeProjectId || undefined)
      if (genId === generationRef.current) setPolishResult(reply)
    } catch (err) {
      if (genId === generationRef.current) {
        setPolishError(parseAiErrorMessage(err, '请求失败，请检查 AI 配置'))
      }
    }
    if (genId === generationRef.current) setPolishLoading(false)
  }, [activeConfigId, selectedText, prompts, activeProjectId])

  const handleApplyPolish = (text: string) => {
    if (editor) editor.chain().focus().deleteSelection().insertContent(text).run()
    setPolishResult(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center' }}>
      {/* Toolbar — full width */}
      <div style={{ padding: '0', marginBottom: 6, width: '100%' }}>
        <div style={{ borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
          <EditorToolbar
            editor={editor}
            onOpenSymbols={() => setShowSymbols(true)}
            onToggleFind={() => setShowFind(!showFind)}
          />
        </div>
      </div>

      {/* Find/replace bar */}
      {showFind && <FindReplace editor={editor} onClose={() => setShowFind(false)} />}

      {/* Writing paper — centered with maxWidth */}
      <div className="writing-paper" style={{ flex: 1, borderRadius: '0 0 8px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 900 }}>
        <div onContextMenu={handleContextMenu} style={{ flex: 1 }}>
          {polishLoading && <div role="status" aria-live="polite" style={{ padding: '12px 24px', fontSize: 13, color: '#7c3aed', textAlign: 'center' }}>AI 生成中...</div>}
          {polishError && <div role="alert" style={{ padding: '12px 24px', fontSize: 13, color: '#dc2626', textAlign: 'center' }}>{polishError}</div>}
          <EditorContent editor={editor} style={{ height: '100%' }} />
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onPolish={handlePolish}
          onContinue={handleContinue}
          onClose={closeCtxMenu}
        />
      )}

      {/* Polish/Continue preview */}
      <PolishPreview
        isOpen={polishResult !== null}
        title={polishTitle}
        original={selectedText}
        result={polishResult || ''}
        onApply={handleApplyPolish}
        onClose={() => setPolishResult(null)}
      />

      <SymbolPicker isOpen={showSymbols} onClose={() => setShowSymbols(false)} onSelect={handleInsertSymbol} />
    </div>
  )
}
