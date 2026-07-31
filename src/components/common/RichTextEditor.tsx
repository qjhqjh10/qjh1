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
import AIPolishDialog from '@/components/common/AIPolishDialog'
import { useStore, useSettingsStore } from '@/store'
import { aiService, fileService } from '@/services/fileService'


import { logError } from '@/utils/logger'

interface Props {
  content: string
  onContentChange: (html: string) => void
  onBlur?: () => void
  placeholder?: string
  showFind?: boolean
  onToggleFind?: () => void
  projectPath?: string
  chapterId?: string
  onPolishApplied?: (generatedText: string, mode: string) => void
}

export default function RichTextEditor({ content, onContentChange, onBlur, placeholder = '开始写作...', showFind: externalShowFind, onToggleFind: externalToggleFind, projectPath, chapterId, onPolishApplied }: Props) {
  const [showSymbols, setShowSymbols] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const effectiveShowFind = externalShowFind !== undefined ? externalShowFind : showFind
  const effectiveToggleFind = externalToggleFind || (() => setShowFind(!showFind))
  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [selectedText, setSelectedText] = useState('')
  // Polish dialog
  const [polishDialogOpen, setPolishDialogOpen] = useState(false)
  const [polishMode, setPolishMode] = useState<'改写' | '续写'>('改写')
  // 打开弹窗时快照本章全文，供「插入原文」参考
  const [chapterText, setChapterText] = useState('')

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
      editor.state.selection.from, editor.state.selection.to, '\n\n'
    ) : ''
    if (text.trim().length < 2) return
    setSelectedText(text.trim())
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [editor])

  // Unified AI text editing: rewrite / continue
  const doAiEdit = useCallback((mode: '改写' | '续写') => {
    setCtxMenu(null)
    if (!activeConfigId || !selectedText) return
    // 快照本章全文，供弹窗内「插入本章原文」使用
    setChapterText(editor ? editor.getText({ blockSeparator: '\n\n' }) : '')
    setPolishMode(mode)
    setPolishDialogOpen(true)
  }, [activeConfigId, selectedText, editor])

  const handleRewrite = () => doAiEdit('改写')
  const handleContinue = () => doAiEdit('续写')

  // 发送选中文字到 AI 写作助手（走完整 Agent Runtime，有工具支持）
  const handleSendToAI = useCallback(() => {
    setCtxMenu(null)
    if (!selectedText) return
    const store = useStore.getState()
    store.setPendingMessage(selectedText)
    store.setAIChatOpen(true)
  }, [selectedText])

  const handleInsertPolish = useCallback((text: string) => {
    if (!editor) return
    if (polishMode === '续写') {
      // 续写: 追加在选中内容之后，不删除原文
      const { to } = editor.state.selection
      editor.chain().focus().setTextSelection(to).insertContent('\n\n' + text).run()
    } else {
      // 改写: 替换选中内容
      editor.chain().focus().deleteSelection().insertContent(text).run()
    }
    // 保存版本历史
    if (onPolishApplied) {
      onPolishApplied(text, polishMode)
    }
  }, [editor, polishMode, onPolishApplied])

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
        {/* Toolbar — sticky, scrolls with content */}
      <div style={{ padding: '0', width: '100%', position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
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
          <EditorContent editor={editor} style={{ height: '100%' }} />
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onRewrite={handleRewrite}
          onContinue={handleContinue}
          onSendToAI={handleSendToAI}
          onClose={closeCtxMenu}
        />
      )}

      {/* Polish/Continue dialog */}
      <AIPolishDialog
        isOpen={polishDialogOpen}
        mode={polishMode}
        selectedText={selectedText}
        chapterText={chapterText}
        prompts={prompts}
        configId={activeConfigId}
        projectId={activeProjectId || ''}
        onClose={() => setPolishDialogOpen(false)}
        onInsert={handleInsertPolish}
      />

      <SymbolPicker isOpen={showSymbols} onClose={() => setShowSymbols(false)} onSelect={handleInsertSymbol} />
    </div>
  </>
)}
