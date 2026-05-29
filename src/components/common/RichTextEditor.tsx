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
import { ResizableImage } from '@/components/common/ResizableImageExtension'
import LinkExtension from '@tiptap/extension-link'
import EditorToolbar from '@/components/chapterWriting/EditorToolbar'
import SymbolPicker from '@/components/common/SymbolPicker'
import FindReplace from '@/components/common/FindReplace'
import ContextMenu from '@/components/common/ContextMenu'
import PolishPreview from '@/components/common/PolishPreview'
import { useStore, useSettingsStore } from '@/store'
import { aiService, fileService } from '@/services/fileService'
import { aiCapability } from '@/services/aiCapabilityService'
import { parseAiErrorMessage } from '@/utils/textUtils'
import { logError } from '@/utils/logger'

interface Props {
  content: string
  onContentChange: (html: string) => void
  onBlur?: () => void
  placeholder?: string
  showFind?: boolean
  onToggleFind?: () => void
  projectPath?: string
}

export default function RichTextEditor({ content, onContentChange, onBlur, placeholder = '开始写作...', showFind: externalShowFind, onToggleFind: externalToggleFind, projectPath }: Props) {
  const [showSymbols, setShowSymbols] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const effectiveShowFind = externalShowFind !== undefined ? externalShowFind : showFind
  const effectiveToggleFind = externalToggleFind || (() => setShowFind(!showFind))
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
      ResizableImage.configure({ allowBase64: true, inline: true }),
      LinkExtension.configure({ openOnClick: false, autolink: false }),
    ],
    editorProps: {
      attributes: {
        style: `outline: none; min-height: 500px; padding: 48px 56px; font-size: var(--editor-font-size, 16px); line-height: 2; font-family: "PingFang SC", "Microsoft YaHei", "Noto Serif SC", Georgia, serif; color: #2d2520;`,
        class: 'rich-editor-content',
      },
      // Ctrl+V paste image support
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (!file) continue
            const reader = new FileReader()
            reader.onload = async () => {
              const dataUrl = reader.result as string
              let src = dataUrl
              if (projectPath) {
                try {
                  const fn = await fileService.saveImageUrl(dataUrl, projectPath)
                  if (fn) src = `images/${fn}`
                } catch { /* fallback to base64 */ }
              }
              const node = view.state.schema.nodes.image.create({ src })
              view.dispatch(view.state.tr.replaceSelectionWith(node))
            }
            reader.readAsDataURL(file)
            return true
          }
        }
        return false
      },
      // Drag-and-drop image support
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        const file = files[0]
        if (!file.type.startsWith('image/')) return false
        event.preventDefault()
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          let src = dataUrl
          if (projectPath) {
            try {
              const fn = await fileService.saveImageUrl(dataUrl, projectPath)
              if (fn) src = `images/${fn}`
            } catch { /* fallback to base64 */ }
          }
          const node = view.state.schema.nodes.image.create({ src })
          view.dispatch(view.state.tr.replaceSelectionWith(node))
        }
        reader.readAsDataURL(file)
        return true
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
        try {
          // Detect if content is already HTML (from RichTextEditor or AI edits)
          const looksLikeHtml = /<[a-zA-Z][^>]*>/.test(content)
          if (looksLikeHtml) {
            editor.commands.setContent(content)
          } else {
            // Convert plain text paragraphs to HTML: \n\n → </p><p>, single \n → <br>
            const htmlContent = content
              .split(/\n{2,}/)
              .map(p => p.trim() ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '')
              .filter(Boolean)
              .join('')
            editor.commands.setContent(htmlContent)
          }
        } catch { /* ignore */ }
      }
    }
  }, [content, editor])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  // Shared helper: save image file to project images/ dir, return src path
  const saveImageFile = useCallback(async (dataUrl: string): Promise<string> => {
    if (projectPath) {
      try {
        const fn = await fileService.saveImageUrl(dataUrl, projectPath)
        if (fn) return `images/${fn}`
      } catch (err) { logError('保存图片到项目失败，降级为base64', err) }
    }
    return dataUrl // fallback to base64
  }, [projectPath])

  // Image insertion via toolbar button
  const handleInsertImage = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file || !editor) return
      const reader = new FileReader()
      reader.onload = async () => {
        const src = await saveImageFile(reader.result as string)
        editor.chain().focus().setImage({ src }).run()
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }, [editor, saveImageFile])

  // Image alignment
  const handleImageAlign = useCallback((align: 'left' | 'center' | 'right') => {
    if (!editor) return
    editor.chain().focus().updateAttributes('image', { 'data-align': align }).run()
  }, [editor])

  const isImageActive = editor?.isActive('image')
  const currentImageAlign = isImageActive ? (editor?.getAttributes('image')['data-align'] || 'center') : null

  // Link insertion
  const handleInsertLink = useCallback(() => {
    if (!editor) return
    const prevUrl = editor.getAttributes('link').href || ''
    const url = prompt('输入链接地址:', prevUrl)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }, [editor])

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

  // Unified AI text editing: polish / rewrite / continue
  const doAiEdit = useCallback(async (mode: '润色' | '改写' | '续写') => {
    setCtxMenu(null)
    if (!activeConfigId || !selectedText) return
    setPolishLoading(true)
    setPolishTitle(`${mode}结果`)
    setPolishError('')
    const genId = ++generationRef.current
    try {
      const tpl = prompts.find(p => p.type === mode && p.enabled)
      const defs: Record<string, string> = {
        '润色': '请润色以下文字，优化表达、修正语病、提升文采，但保持原意不变。',
        '改写': '请改写以下文字，在保持原意和风格不变的前提下，优化表达、丰富细节、提升文采。',
        '续写': '请根据以下内容自然续写，保持风格一致。注意保持人物性格、叙事节奏和语言风格的连贯性。',
      }
      const result = await aiCapability.generate(
        `${tpl?.content || defs[mode]}\n\n${selectedText}`,
        { configId: activeConfigId, projectId: activeProjectId || undefined }
      )
      if (genId === generationRef.current) {
        if (result.success) setPolishResult(result.content)
        else setPolishError(result.error || '请求失败')
      }
    } catch (err) {
      if (genId === generationRef.current) setPolishError(parseAiErrorMessage(err, '请求失败'))
    }
    if (genId === generationRef.current) setPolishLoading(false)
  }, [activeConfigId, selectedText, prompts, activeProjectId])

  const handlePolish = () => doAiEdit('润色')
  const handleRewrite = () => doAiEdit('改写')
  const handleContinue = () => doAiEdit('续写')

  const handleApplyPolish = (text: string, append?: boolean) => {
    if (!editor) return
    if (append) {
      // 续写: 追加在选中内容之后，不删除原文
      const { from, to } = editor.state.selection
      editor.chain().focus().setTextSelection(to).insertContent('\n\n' + text).run()
    } else {
      // 改写/润色: 替换选中内容
      editor.chain().focus().deleteSelection().insertContent(text).run()
    }
    setPolishResult(null)
  }

  return (
    <>
      <style>{`
        .rich-editor-content p { margin: 0 0 1em 0; }
        .rich-editor-content img {
          max-width: 100%;
          height: auto;
          cursor: pointer;
          resize: both;
          overflow: auto;
          border-radius: 8px;
          margin: 8px 0;
        }
        .rich-editor-content img[data-align="left"] {
          float: left;
          margin-right: 16px;
          margin-bottom: 8px;
        }
        .rich-editor-content img[data-align="center"] {
          display: block;
          margin-left: auto;
          margin-right: auto;
          float: none;
        }
        .rich-editor-content img[data-align="right"] {
          float: right;
          margin-left: 16px;
          margin-bottom: 8px;
        }
        .rich-editor-content img[data-display="block"] {
          display: block;
          margin-left: auto;
          margin-right: auto;
          float: none;
        }
        .rich-editor-content p:has(img[data-align="left"]),
        .rich-editor-content p:has(img[data-align="right"]) {
          display: flow-root;
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', alignItems: 'center' }}>
        {/* Toolbar — full width */}
      <div style={{ padding: '0', marginBottom: 6, width: '100%' }}>
        <div style={{ borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
          <EditorToolbar
            editor={editor}
            onOpenSymbols={() => setShowSymbols(true)}
            onToggleFind={effectiveToggleFind}
            onInsertImage={handleInsertImage}
            onInsertLink={handleInsertLink}
            isImageActive={isImageActive}
            currentImageAlign={currentImageAlign}
            onImageAlign={handleImageAlign}
          />
        </div>
      </div>

      {/* Find/replace bar */}
      {effectiveShowFind && <FindReplace editor={editor} onClose={effectiveToggleFind} />}

      {/* Writing paper — centered with maxWidth */}
      <div className="writing-paper" style={{ flex: 1, borderRadius: '0 0 8px 8px', overflow: 'auto', display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 900 }}>
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
          onRewrite={handleRewrite}
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
  </>
)}
