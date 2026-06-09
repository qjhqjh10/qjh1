import { Editor } from '@tiptap/react'
import {
  BoldIcon, ItalicIcon,
  QueueListIcon,
  MagnifyingGlassIcon,
  PhotoIcon, LinkIcon,
} from '@heroicons/react/24/outline'

interface Props {
  editor: Editor | null
  onOpenSymbols: () => void
  onToggleFind: () => void
  onInsertImage: () => void
  onInsertLink: () => void
  isImageActive?: boolean
  currentImageAlign?: string | null
  onImageAlign?: (align: 'left' | 'center' | 'right') => void
}

const FONTS = ['PingFang SC', 'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Noto Serif SC', 'Georgia']
const SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px']
const LINE_HEIGHTS = ['1.0', '1.5', '1.8', '2.0', '2.5']
const COLORS = ['#2d2520', '#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#7c3aed', '#db2777', '#9b8e84']

export default function EditorToolbar({ editor, onOpenSymbols, onToggleFind, onInsertImage, onInsertLink, isImageActive, currentImageAlign, onImageAlign }: Props) {
  if (!editor) return null

  const btn = (action: () => void, active: boolean, children: React.ReactNode, title: string) => (
    <button type="button" onClick={action} title={title} style={{
      width: 40, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: 'none', borderRadius: 6, cursor: 'pointer',
      background: active ? 'rgba(124,58,237,0.1)' : 'transparent',
      color: active ? '#7c3aed' : '#5c5048', fontSize: 15, fontWeight: active ? 700 : 400,
      transition: 'background 0.1s',
    }}>{children}</button>
  )

  const D = () => <div style={{ width: 1, height: 26, background: 'rgba(0,0,0,0.06)', margin: '0 6px' }} />
  const selStyle: React.CSSProperties = {
    padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.1)',
    fontSize: 12, color: '#4a3f38', background: '#fff', cursor: 'pointer', height: 30, outline: 'none',
  }

  const mergedTextStyle = (updates: Record<string, string>) => {
    const current = editor.getAttributes('textStyle')
    const merged = { ...current, ...updates }
    // Remove empty keys
    Object.keys(merged).forEach(k => { if (!merged[k]) delete merged[k] })
    return merged
  }

  const mergedParagraphStyle = (cssProp: string, value: string) => {
    const attrs = editor.getAttributes('paragraph')
    const currentStyle = attrs.style || ''
    // Parse current style into object
    const styleMap: Record<string, string> = {}
    currentStyle.split(';').forEach((part: string) => {
      const [k, v] = part.split(':').map((s: string) => s.trim())
      if (k && v) styleMap[k] = v
    })
    // Set/unset the specific property
    if (value) {
      styleMap[cssProp] = value
    } else {
      delete styleMap[cssProp]
    }
    // Rebuild style string
    const newStyle = Object.entries(styleMap).map(([k, v]) => `${k}:${v}`).join(';')
    return newStyle || (cssProp in styleMap ? '' : currentStyle)
  }

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 3,
      padding: '8px 16px', userSelect: 'none',
    }}>
      {/* Font */}
      <select onChange={e => editor.chain().focus().setFontFamily(e.target.value).run()} style={selStyle} defaultValue="">
        <option value="" disabled>字体</option>
        {FONTS.map(f => <option key={f} value={f}>{f.replace(' SC', '').replace(' Serif', '')}</option>)}
      </select>
      <D />
      {/* Size */}
      <select onChange={e => editor.chain().focus().setMark('textStyle', mergedTextStyle({ fontSize: e.target.value })).run()} style={selStyle} defaultValue="">
        <option value="" disabled>字号</option>
        {SIZES.map(s => <option key={s} value={s}>{s.replace('px', '')}</option>)}
      </select>
      <D />
      {/* Bold/Italic/Underline/Strike */}
      {btn(() => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), <BoldIcon style={{ width: 18, height: 18 }} />, '粗体')}
      {btn(() => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), <ItalicIcon style={{ width: 18, height: 18 }} />, '斜体')}
      {btn(() => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), <span style={{ fontSize: 14, textDecoration: 'underline' }}>U</span>, '下划线')}
      {btn(() => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'), <span style={{ fontSize: 14, textDecoration: 'line-through' }}>S</span>, '删除线')}
      <D />
      {/* Undo/Redo */}
      {btn(() => editor.chain().focus().undo().run(), false, <span style={{ fontSize: 16 }}>↩</span>, '撤消')}
      {btn(() => editor.chain().focus().redo().run(), false, <span style={{ fontSize: 16 }}>↪</span>, '重做')}
      <D />
      {/* Image & Link */}
      {btn(onInsertImage, false, <PhotoIcon style={{ width: 18, height: 18 }} />, '插入图片')}
      {btn(onInsertLink, editor.isActive('link'), <LinkIcon style={{ width: 18, height: 18 }} />, '插入链接')}
      {/* Image alignment (visible when image selected) */}
      {isImageActive && onImageAlign && (
        <>
          <D />
          {btn(() => {
            const attrs = editor.getAttributes('image')
            const isBlock = attrs['data-display'] === 'block'
            if (isBlock) {
              editor.chain().focus().updateAttributes('image', { 'data-display': null, 'data-align': null }).run()
            } else {
              editor.chain().focus().updateAttributes('image', { 'data-display': 'block', 'data-align': 'center' }).run()
            }
          }, editor.getAttributes('image')?.['data-display'] === 'block', <span style={{ fontSize: 15 }}>⊞</span>, '嵌入(文字环绕) / 独立成行')}
          {btn(() => onImageAlign('left'), currentImageAlign === 'left', <span style={{ fontSize: 15 }}>⫷</span>, '左对齐(文字环绕)')}
          {btn(() => onImageAlign('center'), currentImageAlign === 'center', <span style={{ fontSize: 15 }}>⫿</span>, '居中')}
          {btn(() => onImageAlign('right'), currentImageAlign === 'right', <span style={{ fontSize: 15 }}>⫸</span>, '右对齐(文字环绕)')}
        </>
      )}
      <D />
      {/* Alignment */}
      {btn(() => editor.chain().focus().setTextAlign('left').run(), editor.isActive({ textAlign: 'left' }), <span style={{ fontSize: 15 }}>⫷</span>, '左对齐')}
      {btn(() => editor.chain().focus().setTextAlign('center').run(), editor.isActive({ textAlign: 'center' }), <span style={{ fontSize: 15 }}>⫿</span>, '居中')}
      {btn(() => editor.chain().focus().setTextAlign('right').run(), editor.isActive({ textAlign: 'right' }), <span style={{ fontSize: 15 }}>⫸</span>, '右对齐')}
      {btn(() => editor.chain().focus().setTextAlign('justify').run(), editor.isActive({ textAlign: 'justify' }), <span style={{ fontSize: 15, fontWeight: 700 }}>≡≡</span>, '两端对齐')}
      <D />
      {/* Indent */}
      {btn(() => {
        const attrs = editor.getAttributes('paragraph')
        const indent = /text-indent\s*:\s*2em/i.test(attrs.style || '')
        if (indent) {
          editor.chain().focus().updateAttributes('paragraph', { style: mergedParagraphStyle('text-indent', '') }).run()
        } else {
          editor.chain().focus().updateAttributes('paragraph', { style: mergedParagraphStyle('text-indent', '2em') }).run()
        }
      }, /text-indent\s*:\s*2em/i.test(editor.getAttributes('paragraph')?.style || ''), <span style={{ fontSize: 15, fontWeight: 600 }}>↦↦</span>, '首行缩进')}
      <D />
      {/* Line height */}
      <select onChange={e => {
        editor.chain().focus().updateAttributes('paragraph', {
          style: mergedParagraphStyle('line-height', e.target.value),
        }).run()
      }} style={selStyle} defaultValue="">
        <option value="" disabled>行距</option>
        {LINE_HEIGHTS.map(lh => <option key={lh} value={lh}>{lh}</option>)}
      </select>
      {/* Hard break */}
      {btn(() => editor.chain().focus().setHardBreak().run(), false, <span style={{ fontSize: 15 }}>↵</span>, '换行符 (Shift+Enter)')}
      <D />
      {/* Letter spacing */}
      <select onChange={e => editor.chain().focus().setMark('textStyle', mergedTextStyle({ letterSpacing: e.target.value })).run()} style={selStyle} defaultValue="">
        <option value="" disabled>字距</option>
        {['0px', '1px', '2px', '3px'].map(ls => <option key={ls} value={ls}>{ls.replace('px', '')}</option>)}
      </select>
      <D />
      {/* Headings */}
      {btn(() => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }), <span style={{ fontSize: 14, fontWeight: 700 }}>H1</span>, '标题1')}
      {btn(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }), <span style={{ fontSize: 14, fontWeight: 700 }}>H2</span>, '标题2')}
      {btn(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }), <span style={{ fontSize: 13, fontWeight: 600 }}>H3</span>, '标题3')}
      <D />
      {/* Block quote / lists / rule */}
      {btn(() => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'), <span style={{ fontSize: 16 }}>❝</span>, '引用')}
      {btn(() => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), <QueueListIcon style={{ width: 18, height: 18 }} />, '无序列表')}
      {btn(() => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), <span style={{ fontSize: 14 }}>1.</span>, '有序列表')}
      {btn(() => editor.chain().focus().setHorizontalRule().run(), false, <span style={{ fontSize: 15 }}>─</span>, '分割线')}
      <D />
      {/* Color */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {COLORS.map(c => (
          <button key={c} type="button" onClick={() => editor.chain().focus().setColor(c).run()} title={c} style={{
            width: 22, height: 22, borderRadius: '50%', border: editor.isActive('textStyle', { color: c }) ? '2px solid #7c3aed' : '2px solid rgba(0,0,0,0.1)',
            background: c, cursor: 'pointer', padding: 0,
          }} />
        ))}
      </div>
      <D />
      {/* Symbols / Find */}
      {btn(() => onOpenSymbols(), false, <span style={{ fontSize: 18 }}>Ω</span>, '符号库')}
      {btn(() => onToggleFind(), false, <MagnifyingGlassIcon style={{ width: 18, height: 18 }} />, '查找替换')}
    </div>
  )
}
