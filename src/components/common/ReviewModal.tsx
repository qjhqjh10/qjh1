import { useState, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, fileService, kbService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import Modal from './Modal'
import Button from './Button'
import { SparklesIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onClose: () => void
  chapterTitle: string
  chapterLabel: string
  chapterContent: string
  projectId: string
  configId: string
}

const DEFAULT_REVIEW_PROMPT = `你是专业文学编辑，请对以下章节进行审稿。请从以下角度分析，并在评论结束后务必附上评分摘要：

1. 节奏 — 情节推进是否合理，有无拖沓或仓促
2. 对白 — 人物对话是否符合角色特点，是否自然
3. 描写 — 场景、动作、心理描写是否生动
4. 情节一致性 — 与前文设定是否存在矛盾

请按以下格式输出评分摘要（放在审稿末尾）：

--- 评分摘要 ---
总分: X/10
节奏: X/10 | <一句话评价>
对白: X/10 | <一句话评价>
描写: X/10 | <一句话评价>
情节一致性: X/10 | <一句话评价>

注意: X 为 1-10 整数。如果某维度在此章不适用（如纯对话章无描写、纯内心独白章无对白），标注 "N/A" 并说明原因。总分仅对适用的维度取平均。`

const NONE_ID = '__none__'

export default function ReviewModal({ isOpen, onClose, chapterTitle, chapterLabel, chapterContent, projectId, configId }: Props) {
  const prompts = useSettingsStore(s => s.prompts)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [customRequirement, setCustomRequirement] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState('')

  const reviewPrompts = prompts.filter(p => p.type === '审稿' && p.enabled)
  const activePrompt = selectedPromptId !== NONE_ID ? reviewPrompts.find(p => p.id === selectedPromptId) : null

  useEffect(() => {
    if (isOpen) {
      setCustomRequirement('')
      setResult('')
      setError('')
      setSaved(false)
      setSelectedPromptId(NONE_ID)
    }
  }, [isOpen])

  const handleReview = async () => {
    if (!chapterContent.trim()) { setError('当前章节无内容'); return }
    setLoading(true)
    setError('')
    setSaved(false)
    try {
      const customPart = customRequirement.trim() ? `${customRequirement}\n\n` : ''
      const wantTemplate = selectedPromptId && selectedPromptId !== NONE_ID
      const templateContent = wantTemplate && activePrompt?.content
      const useDefault = !wantTemplate && !customPart
      const templatePart = templateContent ? `【审稿模板】\n${templateContent}\n\n` : useDefault ? `${DEFAULT_REVIEW_PROMPT}\n\n` : ''
      const msg = `${customPart}${templatePart}---\n章节标题: ${chapterTitle}\n\n章节正文:\n${chapterContent.slice(0, 50000)}`
      const reply = await chatAI([{ role: 'user', content: msg }], configId, projectId || undefined)
      setResult(reply)
      if (projectId && projectsBasePath) {
        const now = new Date()
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
        const fileName = `审稿_${chapterLabel}_${dateStr}.txt`
        const fileContent = `审稿时间: ${now.toLocaleString()}\n章节: ${chapterLabel} ${chapterTitle}\n\n${reply}`
        const tmpPath = `${projectsBasePath}/${projectId}/${fileName}`
        await fileService.write(tmpPath, fileContent)
        await kbService.uploadFiles([tmpPath], projectId)
        await fileService.deleteFile(tmpPath)
        setSaved(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '审稿失败')
    }
    setLoading(false)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`AI 审稿 — ${chapterTitle}`} width={720} draggable resizable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Chapter content preview */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84', marginBottom: 4 }}>
            章节内容 <span style={{ fontWeight: 400 }}>({chapterContent.length} 字符，审稿截取前 50000 字)</span>
          </div>
          <div style={{
            padding: 12, borderRadius: 10, background: '#faf9f8',
            fontSize: 13, lineHeight: 1.8, color: '#6b5e54',
            maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap',
            border: '1px solid #e5e0da',
          }} className="custom-scrollbar">
            {chapterContent.slice(0, 2000)}{chapterContent.length > 2000 ? '...' : ''}
          </div>
        </div>

        {/* Prompt template selector */}
        {reviewPrompts.length > 0 && (
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
              <option value={NONE_ID}>不使用模板（默认审稿维度：节奏/对白/描写/情节一致性）</option>
              {reviewPrompts.map(p => (
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
            自定义审稿要求 <span style={{ fontWeight: 400, color: '#9b8e84' }}>（优先于模板）</span>
          </div>
          <textarea
            value={customRequirement}
            onChange={e => setCustomRequirement(e.target.value)}
            placeholder="例如：重点审查人物对话是否贴切、情节转折是否合理..."
            style={{
              width: '100%', border: '1px solid #e5e0da', borderRadius: 12, outline: 'none',
              resize: 'vertical', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
              color: '#2d2520', background: '#faf9f8', padding: 14, minHeight: 60,
            }}
          />
        </div>

        {/* Result */}
        {result && (
          <div style={{ padding: 14, borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.06)', fontSize: 13, lineHeight: 1.8, color: '#2d2520', whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto' }} className="custom-scrollbar">
            {result}
          </div>
        )}
        {saved && (
          <div style={{ fontSize: 11, color: '#16a34a', textAlign: 'center' }}>✓ 已保存至知识库，AI 助手可引用此审稿结果</div>
        )}
        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', fontSize: 12 }}>{error}</div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={onClose}>关闭</Button>
          {result && <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(result) }}>复制结果</Button>}
          <Button onClick={handleReview} disabled={loading || !configId} icon={<SparklesIcon style={{ width: 16, height: 16 }} />}>
            {loading ? '审稿中...' : '开始审稿'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
