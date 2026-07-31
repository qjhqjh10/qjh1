import { useState, useEffect, useRef } from 'react'
import Modal from './Modal'
import Button from './Button'
import { SparklesIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import type { PromptTemplate } from '@/types/settings'
import { aiCapability } from '@/services/aiCapabilityService'
import { chatAIStream } from '@/utils/chatAI'

interface Props {
  isOpen: boolean
  mode: '改写' | '续写'
  selectedText: string
  /** 本章全文（快照），勾选「插入原文」时拼入提示词供 AI 参考，保持一致性 */
  chapterText?: string
  prompts: PromptTemplate[]
  configId: string | null
  projectId: string | null
  onClose: () => void
  onInsert: (text: string) => void
}

const MODE_LABELS: Record<string, string> = {
  '改写': '改写',
  '续写': '续写',
}

const DEFS: Record<string, string> = {
  '改写': '请改写以下文字，在保持原意和风格不变的前提下，优化表达、丰富细节、提升文采。不要只做保守的微调，应充分按要求执行。',
  '续写': '请紧跟在【原文】段落之后自然续写新内容，保持风格一致。注意保持人物性格、叙事节奏和语言风格的连贯性；不要重复或改写【原文】已有的内容。',
}

const NONE_ID = '__none__'

// 本章原文插入提示词时的最大字符数（防止超长章节撑爆上下文）
const MAX_CHAPTER_CHARS = 30000

const COL_HEADER: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8,
  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
}

export default function AIPolishDialog({ isOpen, mode, selectedText, chapterText, prompts, configId, projectId, onClose, onInsert }: Props) {
  const [customRequirement, setCustomRequirement] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState(NONE_ID)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [streamMode, setStreamMode] = useState(true)
  const [includeChapter, setIncludeChapter] = useState(true)
  const abortRef = useRef<(() => void) | null>(null)

  const modePrompts = prompts.filter(p => p.type === mode)
  const activePrompt = selectedPromptId !== NONE_ID ? modePrompts.find(p => p.id === selectedPromptId) : null
  const modeLabel = MODE_LABELS[mode] || mode
  const isAppend = mode === '续写'

  useEffect(() => {
    if (isOpen) {
      setCustomRequirement('')
      setSelectedPromptId(NONE_ID)
      setResult('')
      setError('')
      setIncludeChapter(true)
    }
  }, [isOpen])

  const handleGenerate = async () => {
    if (!selectedText.trim() || !configId) return
    setLoading(true)
    setError('')
    setResult('')
    const tpl = selectedPromptId !== NONE_ID ? prompts.find(p => p.id === selectedPromptId) : null
    const customPart = customRequirement.trim() ? `[用户要求]\n${customRequirement}\n\n` : ''
    const wantTemplate = selectedPromptId !== NONE_ID
    const templateContent = wantTemplate && tpl?.content
    const useDefault = !wantTemplate && !customPart
    const templatePart = templateContent
      ? `【提示词模板】\n${tpl!.content}\n\n`
      : useDefault
        ? `【默认指令】\n${DEFS[mode]}\n\n`
        : ''
    const chapterTrimmed = chapterText?.trim() ?? ''
    const chapterPart = includeChapter && chapterTrimmed
      ? `【本章原文（仅作背景参考，用于保持人物、情节与文风一致）】\n${chapterTrimmed.slice(0, MAX_CHAPTER_CHARS)}\n\n`
      : ''
    // 任务设定放最前（最高权重位置），声明执行标准优先级；
    // 参考原文紧贴文末【原文】处理对象，上下文延续性最强
    const chapterNote = includeChapter && chapterTrimmed
      ? '本章全文只是背景参考，不得限制改动幅度：该扩充就扩充、该调整就调整，不要只做保守的小修小改。'
      : ''
    const appendNote = isAppend
      ? '续写内容须紧跟在【原文】选中段落之后自然展开，不要重复或改写【原文】已有的内容。'
      : ''
    const taskPart = `【任务】对文末【原文】选中段落进行${modeLabel}。执行标准优先级：用户要求 > 提示词模板 > 默认指令。${chapterNote}${appendNote}\n\n`
    const prompt = `${taskPart}${customPart}${templatePart}${chapterPart}[原文]\n${selectedText}`

    if (streamMode) {
      // Streaming mode — real-time output
      abortRef.current?.()
      const messages = [{ role: 'user' as const, content: prompt }]
      const handle = chatAIStream(
        messages, configId, projectId || undefined,
        (data) => { setResult(data.accumulated) },
        (data) => { setResult(data.text); setLoading(false); abortRef.current = null },
        (err) => { setError(err.message); setLoading(false); abortRef.current = null },
      )
      abortRef.current = handle.abort
    } else {
      try {
        const res = await aiCapability.generate(prompt, { configId, projectId: projectId || undefined })
        if (res.success) {
          setResult(res.content)
        } else {
          setError(res.error || '请求失败')
        }
      } catch (err: any) {
        setError(err?.message || '请求失败')
      }
      setLoading(false)
    }
  }

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.() }
  }, [])

  const handleClear = () => {
    setShowClearConfirm(false)
    setResult('')
  }

  const handleInsert = () => {
    if (!result.trim()) return
    onInsert(result)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`AI ${modeLabel} — ${isAppend ? '生成续写内容插入原文之后' : '生成结果将替换选中原文'}`} width="85vw" draggable resizable>
      <div style={{ display: 'flex', gap: 14, height: '62vh', minHeight: 460 }}>

        {/* ===== 左栏：配置面板 ===== */}
        <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', paddingRight: 4 }} className="custom-scrollbar">
          {/* Prompt template selector */}
          {modePrompts.length > 0 && (
            <div>
              <div style={COL_HEADER}>提示词模板</div>
              <select
                value={selectedPromptId}
                onChange={e => setSelectedPromptId(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 10,
                  border: '1px solid #e5e0da', outline: 'none', cursor: 'pointer',
                  background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520',
                }}
              >
                <option value={NONE_ID}>不使用模板</option>
                {modePrompts.map(p => (
                  <option key={p.id} value={p.id}>{p.enabled ? '✓ ' : ''}{p.title}</option>
                ))}
              </select>
              {activePrompt && (
                <div style={{ fontSize: 11, color: '#7c3aed', padding: '6px 10px', marginTop: 6, borderRadius: 8, background: 'rgba(124,58,237,0.04)', lineHeight: 1.5 }}>
                  {activePrompt.content.slice(0, 100)}...
                </div>
              )}
            </div>
          )}

          {/* Custom requirements */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={COL_HEADER}>
              自定义要求
              <span style={{ fontWeight: 400, color: '#9b8e84', fontSize: 11, marginLeft: 2 }}>（留空用默认指令）</span>
            </div>
            <textarea
              value={customRequirement}
              onChange={e => setCustomRequirement(e.target.value)}
              placeholder="例如：只改动词汇和句式，不改变情节..."
              style={{
                flex: 1, minHeight: 100, border: '1px solid #e5e0da', borderRadius: 12, outline: 'none',
                resize: 'none', fontSize: 16, lineHeight: 1.9, fontFamily: 'inherit',
                color: '#1a1512', background: '#faf9f8', padding: 12, fontWeight: 500,
              }}
              autoFocus
            />
          </div>

          {/* 插入本章原文参考（保持一致性） */}
          {chapterText && chapterText.trim().length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label
                title="将本章全文拼入提示词，让 AI 在改写/续写时保持人物、情节与文风一致"
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: includeChapter ? '#7c3aed' : '#9b8e84', fontWeight: includeChapter ? 600 : 400 }}
              >
                <input type="checkbox" checked={includeChapter} onChange={() => setIncludeChapter(!includeChapter)} style={{ width: 14, height: 14, accentColor: '#7c3aed', cursor: 'pointer' }} />
                插入本章原文参考
              </label>
              <span style={{ fontSize: 11, color: '#9b8e84', paddingLeft: 20 }}>
                {chapterText.trim().length > MAX_CHAPTER_CHARS
                  ? `已截取前 ${MAX_CHAPTER_CHARS} 字（本章共 ${chapterText.trim().length} 字）`
                  : `本章共 ${chapterText.trim().length} 字`}
              </span>
            </div>
          )}

          {/* Generate + Error */}
          <Button
            onClick={handleGenerate}
            disabled={loading || !configId}
            icon={<SparklesIcon style={{ width: 18, height: 18 }} />}
          >
            {loading ? 'AI 生成中...' : `开始 AI ${modeLabel}`}
          </Button>

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', fontSize: 12 }}>{error}</div>
          )}
        </div>

        {/* 分隔 */}
        <div style={{ width: 1, alignSelf: 'stretch', background: '#d0cbc4', flexShrink: 0 }} />

        {/* ===== 中栏：原文展示 ===== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={COL_HEADER}>
            <DocumentTextIcon style={{ width: 14, height: 14, color: '#9b8e84' }} />
            选中原文
            <span style={{ fontSize: 11, fontWeight: 400, color: '#9b8e84', marginLeft: 'auto' }}>{selectedText.length} 字符</span>
          </div>
          <div style={{
            flex: 1, padding: 16, borderRadius: 10,
            background: '#fbfaf8',
            border: '2px solid #3d352a',
            fontSize: 17, lineHeight: 2, color: '#1a1512', fontWeight: 500,
            whiteSpace: 'pre-wrap', overflow: 'auto', marginBottom: 54,
          }} className="custom-scrollbar">
            {selectedText}
          </div>
        </div>

        {/* 分隔 */}
        <div style={{ width: 1, alignSelf: 'stretch', background: '#d0cbc4', flexShrink: 0 }} />

        {/* ===== 右栏：生成结果展示 ===== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={COL_HEADER}>
            <SparklesIcon style={{ width: 14, height: 14, color: '#7c3aed' }} />
            {modeLabel}结果
            <span style={{ fontSize: 11, fontWeight: 400, color: '#9b8e84', marginLeft: 'auto' }}>{result.length} 字符</span>
          </div>

          <div style={{ flex: 1, position: 'relative' }}>
            <textarea
              value={result}
              onChange={e => setResult(e.target.value)}
              placeholder={isAppend ? '续写结果将显示在这里，也可以直接在此输入...' : `${modeLabel}结果将显示在这里，也可以直接在此输入...`}
              className="custom-scrollbar"
              style={{
                width: '100%', height: '100%', padding: 16, borderRadius: 10,
                border: '2px solid #3d352a', outline: 'none',
                background: '#faf8fd',
                fontSize: 17, lineHeight: 2, color: '#1a1512',
                resize: 'none', fontFamily: 'inherit', fontWeight: 500,
              }}
            />
            {loading && !streamMode && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 10,
                background: 'rgba(255,255,255,0.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#7c3aed', fontSize: 14 }}>
                  <span style={{
                    display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                    border: '2px solid #7c3aed', borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  AI 正在{modeLabel}...
                </span>
              </div>
            )}
            {loading && streamMode && (
              <div style={{
                position: 'absolute', top: 8, right: 12, zIndex: 5,
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 8,
                background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)',
              }}>
                <span style={{
                  display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                  border: '2px solid #7c3aed', borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>生成中...</span>
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid #f0ece8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {showClearConfirm ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: '#fff3f0', border: '1px solid #fecaca' }}>
                  <span style={{ fontSize: 12, color: '#dc2626' }}>确认清空？</span>
                  <button onClick={handleClear} style={{ padding: '3px 12px', fontSize: 12, borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer' }}>清空</button>
                  <button onClick={() => setShowClearConfirm(false)} style={{ padding: '3px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #e5e0da', background: '#fff', color: '#6b5e54', cursor: 'pointer' }}>取消</button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setShowClearConfirm(true)} disabled={loading}>
                  清空结果
                </Button>
              )}
              <label title="逐字实时输出到右侧文本框" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: streamMode ? '#7c3aed' : '#9b8e84', fontWeight: streamMode ? 600 : 400 }}>
                <input type="checkbox" checked={streamMode} onChange={() => setStreamMode(!streamMode)} style={{ width: 14, height: 14, accentColor: '#7c3aed', cursor: 'pointer' }} />
                流式生成
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {loading && streamMode ? (
                <Button variant="danger" size="sm" onClick={() => { abortRef.current?.(); abortRef.current = null; setLoading(false) }}>停止</Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
                  <Button size="sm" onClick={handleInsert} disabled={!result.trim() || loading}>
                    {isAppend ? '插入原文后面' : '替换原文'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Modal>
  )
}
