import { SparklesIcon } from '@heroicons/react/24/outline'
import Button from '@/components/common/Button'
import type { PromptTemplate } from '@/types/settings'

interface ChapterSummaryPanelProps {
  summaryContent: string
  onSummaryChange: (content: string) => void
  enabledSummaryTemplate: PromptTemplate | undefined
  aiLoading: boolean
  activeConfigId: string
  content: string
  onShowTemplateModal: () => void
  onAIExtract: () => void
}

export default function ChapterSummaryPanel({
  summaryContent,
  onSummaryChange,
  enabledSummaryTemplate,
  aiLoading,
  activeConfigId,
  content,
  onShowTemplateModal,
  onAIExtract,
}: ChapterSummaryPanelProps) {
  return (
    <div style={{ padding: '14px 16px' }}>
      <h4 style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        章节正文摘要
      </h4>
      <textarea
        value={summaryContent}
        onChange={e => onSummaryChange(e.target.value)}
        className="custom-scrollbar"
        style={{
          width: '100%', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 8, outline: 'none',
          resize: 'none', fontSize: 11, lineHeight: 1.6, fontFamily: 'inherit',
          color: '#4a3f38', background: 'rgba(255,255,255,0.7)', padding: 8, minHeight: 72,
        }}
        placeholder="章节摘要..."
      />
      {enabledSummaryTemplate && (
        <div style={{
          marginTop: 6, padding: '6px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.04)',
          fontSize: 10, color: '#7c3aed', lineHeight: 1.4,
        }}>
          已启用提示词: {enabledSummaryTemplate.title}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <Button size="sm" variant="secondary" onClick={onShowTemplateModal}>
          选择摘要模板
        </Button>
        <Button size="sm" onClick={onAIExtract} disabled={aiLoading || !activeConfigId || !content.trim()} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>
          {aiLoading ? '提取中...' : 'AI提取'}
        </Button>
      </div>
    </div>
  )
}
