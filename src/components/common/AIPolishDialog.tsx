import { useState, useEffect } from 'react'
import Modal from './Modal'
import Button from './Button'
import { SparklesIcon } from '@heroicons/react/24/outline'
import type { PromptTemplate } from '@/types/settings'

interface Props {
  isOpen: boolean
  mode: '润色' | '改写' | '续写'
  selectedText: string
  prompts: PromptTemplate[]
  loading: boolean
  onClose: () => void
  onGenerate: (customRequirement: string, promptId: string) => void
}

const MODE_LABELS: Record<string, string> = {
  '润色': '润色',
  '改写': '改写',
  '续写': '续写',
}

const MODE_DEFAULTS: Record<string, string> = {
  '润色': '优化表达、修正语病、提升文采，保持原意不变。',
  '改写': '保持原意和风格不变，优化表达、丰富细节、提升文采。',
  '续写': '自然续写，保持风格一致、人物性格和叙事节奏连贯。',
}

export default function AIPolishDialog({ isOpen, mode, selectedText, prompts, loading, onClose, onGenerate }: Props) {
  const [customRequirement, setCustomRequirement] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState('')

  const modePrompts = prompts.filter(p => p.type === mode && p.enabled)
  const NONE_ID = '__none__'
  const activePrompt = selectedPromptId !== NONE_ID ? modePrompts.find(p => p.id === selectedPromptId) : null

  useEffect(() => {
    if (isOpen) {
      setCustomRequirement('')
      setSelectedPromptId(NONE_ID)
    }
  }, [isOpen])

  const modeLabel = MODE_LABELS[mode] || mode
  const defaultHint = MODE_DEFAULTS[mode] || ''

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`AI ${modeLabel}`} width={720} draggable resizable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Selected text */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84', marginBottom: 4 }}>选中片段</div>
          <div style={{
            padding: 12, borderRadius: 10, background: '#faf9f8',
            fontSize: 13, lineHeight: 1.8, color: '#6b5e54',
            maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap',
            border: '1px solid #e5e0da',
          }} className="custom-scrollbar">
            {selectedText}
          </div>
        </div>

        {/* Prompt template selector */}
        {modePrompts.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>提示词模板</div>
            <select
              value={selectedPromptId}
              onChange={e => setSelectedPromptId(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 10,
                border: '1px solid #e5e0da', outline: 'none', cursor: 'pointer',
                background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520',
              }}
            >
              <option value={NONE_ID}>不使用模板（{defaultHint}）</option>
              {modePrompts.map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            {activePrompt && (
              <div style={{ fontSize: 11, color: '#7c3aed', padding: '4px 8px', marginTop: 4, borderRadius: 6, background: 'rgba(124,58,237,0.04)', lineHeight: 1.5 }}>
                {activePrompt.content.slice(0, 100)}...
              </div>
            )}
          </div>
        )}

        {/* Custom requirements */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>
            自定义要求 <span style={{ fontWeight: 400, color: '#9b8e84' }}>（优先于模板）</span>
          </div>
          <textarea
            value={customRequirement}
            onChange={e => setCustomRequirement(e.target.value)}
            placeholder={`例如：只改动词汇和句式，不改变情节；增加比喻和细节描写...`}
            style={{
              width: '100%', border: '1px solid #e5e0da', borderRadius: 12, outline: 'none',
              resize: 'vertical', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
              color: '#2d2520', background: '#faf9f8', padding: 14, minHeight: 80,
            }}
            autoFocus
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={() => onGenerate(customRequirement, selectedPromptId)}
            disabled={loading}
            icon={<SparklesIcon style={{ width: 16, height: 16 }} />}
          >
            {loading ? '生成中...' : `AI ${modeLabel}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
