import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { SparklesIcon } from '@heroicons/react/24/outline'
import type { ModelConfig, PromptTemplate } from '@/types/settings'

interface AICharacterGenerateDialogProps {
  isOpen: boolean
  aiGenDesc: string
  aiGenConfigId: string | null
  aiGenLoading: boolean
  aiGenImageNote: string
  configs: ModelConfig[]
  promptTemplates: PromptTemplate[]
  activeConfigId: string | null
  onClose: () => void
  onDescChange: (v: string) => void
  onConfigChange: (v: string) => void
  onGenerate: () => void
}

export function AICharacterGenerateDialog({
  isOpen, aiGenDesc, aiGenConfigId, aiGenLoading, aiGenImageNote,
  configs, promptTemplates, activeConfigId,
  onClose, onDescChange, onConfigChange, onGenerate,
}: AICharacterGenerateDialogProps) {
  const rp = promptTemplates.find(p => p.type === '角色' && p.enabled)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI 生成角色" width={560} draggable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 6 }}>
            描述你需要的角色
          </label>
          <textarea
            value={aiGenDesc}
            onChange={e => onDescChange(e.target.value)}
            placeholder="例如：一个冷酷的剑客，曾是皇家护卫队长，因一场冤案被逐出师门，背负血海深仇寻找真相..."
            style={{
              width: '100%', border: '1px solid #e5e0da', borderRadius: 12, outline: 'none',
              resize: 'vertical', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
              color: '#2d2520', background: '#faf9f8', padding: 14, minHeight: 140,
            }}
            autoFocus
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>
            选择模型配置
          </label>
          <select
            value={aiGenConfigId || activeConfigId || ''}
            onChange={e => onConfigChange(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 10,
              border: '1px solid #e5e0da', outline: 'none', cursor: 'pointer',
              background: '#faf9f8', fontFamily: 'inherit', color: '#2d2520',
            }}
          >
            {configs.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.model})</option>
            ))}
          </select>
        </div>

        <div style={{
          fontSize: 12, color: rp ? '#7c3aed' : '#9b8e84',
          padding: '8px 12px', borderRadius: 8, background: rp ? 'rgba(124,58,237,0.04)' : '#f5f2f0',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <SparklesIcon style={{ width: 14, height: 14 }} />
          {rp ? `已加载提示词: ${rp.title}` : '未启用角色提示词，将使用默认格式'}
        </div>

        {!aiGenConfigId && !activeConfigId && (
          <div style={{ fontSize: 12, color: '#dc2626', padding: '8px 12px', borderRadius: 8, background: '#fee2e2' }}>
            请先在系统设置中配置AI模型
          </div>
        )}

        {aiGenImageNote && (
          <div style={{ fontSize: 11, color: aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? '#e67e00' : '#16a34a', padding: '6px 10px', borderRadius: 8, background: aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? 'rgba(245,158,11,0.06)' : 'rgba(16,163,74,0.04)', border: `1px solid ${aiGenImageNote.includes('失败') || aiGenImageNote.includes('不可用') ? 'rgba(245,158,11,0.15)' : 'rgba(16,163,74,0.12)'}` }}>
            {aiGenImageNote}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={onGenerate}
            disabled={!aiGenDesc.trim() || (!aiGenConfigId && !activeConfigId) || aiGenLoading}
            icon={<SparklesIcon style={{ width: 16, height: 16 }} />}
          >
            {aiGenLoading ? '生成中...' : '生成角色'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
