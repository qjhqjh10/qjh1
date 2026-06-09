import { useState, useEffect } from 'react'
import Modal from './Modal'
import Button from './Button'
import { SparklesIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import type { PromptTemplate } from '@/types/settings'
import { aiCapability } from '@/services/aiCapabilityService'

interface Props {
  isOpen: boolean
  mode: '润色' | '改写' | '续写'
  selectedText: string
  prompts: PromptTemplate[]
  configId: string | null
  projectId: string | null
  onClose: () => void
  onInsert: (text: string) => void
}

const MODE_LABELS: Record<string, string> = {
  '润色': '润色',
  '改写': '改写',
  '续写': '续写',
}

const DEFS: Record<string, string> = {
  '润色': '请润色以下文字，优化表达、修正语病、提升文采，但保持原意不变。',
  '改写': '请改写以下文字，在保持原意和风格不变的前提下，优化表达、丰富细节、提升文采。',
  '续写': '请根据以下内容自然续写，保持风格一致。注意保持人物性格、叙事节奏和语言风格的连贯性。',
}

const NONE_ID = '__none__'

const COL_HEADER: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8,
  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
}

export default function AIPolishDialog({ isOpen, mode, selectedText, prompts, configId, projectId, onClose, onInsert }: Props) {
  const [customRequirement, setCustomRequirement] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState(NONE_ID)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const modePrompts = prompts.filter(p => p.type === mode && p.enabled)
  const activePrompt = selectedPromptId !== NONE_ID ? modePrompts.find(p => p.id === selectedPromptId) : null
  const modeLabel = MODE_LABELS[mode] || mode
  const isAppend = mode === '续写'

  useEffect(() => {
    if (isOpen) {
      setCustomRequirement('')
      setSelectedPromptId(NONE_ID)
      setResult('')
      setError('')
    }
  }, [isOpen])

  const handleGenerate = async () => {
    if (!selectedText.trim() || !configId) return
    setLoading(true)
    setError('')
    try {
      const tpl = selectedPromptId !== NONE_ID ? prompts.find(p => p.id === selectedPromptId) : null
      const customPart = customRequirement.trim() ? `${customRequirement}\n\n` : ''
      const wantTemplate = selectedPromptId !== NONE_ID
      const templateContent = wantTemplate && tpl?.content
      const useDefault = !wantTemplate && !customPart
      const templatePart = templateContent
        ? `【提示词模板】\n${tpl!.content}\n\n`
        : useDefault
          ? `${DEFS[mode]}\n\n`
          : ''
      const prompt = `${customPart}${templatePart}[原文]\n${selectedText}`
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
                  <option key={p.id} value={p.id}>{p.title}</option>
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
        <div style={{ flex: 8, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
        <div style={{ flex: 10, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
            {loading && (
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
          </div>

          {/* Bottom actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid #f0ece8' }}>
            <div>
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
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
              <Button size="sm" onClick={handleInsert} disabled={!result.trim() || loading}>
                {isAppend ? '插入原文后面' : '替换原文'}
              </Button>
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
