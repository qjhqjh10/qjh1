import { useState } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, fileService, kbService } from '@/services/fileService'
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
情节一致性: X/10 | <一句话评价>`

export default function ReviewModal({ isOpen, onClose, chapterTitle, chapterLabel, chapterContent, projectId, configId }: Props) {
  const prompts = useSettingsStore(s => s.prompts)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const reviewPrompt = prompts.find(p => p.type === '审稿' && p.enabled)
  const promptContent = reviewPrompt?.content || DEFAULT_REVIEW_PROMPT

  const handleReview = async () => {
    if (!chapterContent.trim()) { setError('当前章节无内容'); return }
    setLoading(true)
    setError('')
    setSaved(false)
    try {
      const msg = `${promptContent}\n\n---\n章节标题: ${chapterTitle}\n\n章节正文:\n${chapterContent.slice(0, 15000)}`
      const reply = await aiService.chat([{ role: 'user', content: msg }], configId, projectId || undefined)
      setResult(reply)
      // Save review as KB file
      if (projectId && projectsBasePath) {
        const now = new Date()
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
        const fileName = `审稿_${chapterLabel}_${dateStr}.txt`
        const fileContent = `审稿时间: ${now.toLocaleString()}\n章节: ${chapterLabel} ${chapterTitle}\n\n${reply}`
        const tmpPath = `${projectsBasePath}/${projectId}/${fileName}`
        await fileService.write(tmpPath, fileContent)
        await kbService.uploadFiles([tmpPath], projectId)
        await fileService.deleteFile(tmpPath) // clean up temp
        setSaved(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '审稿失败')
    }
    setLoading(false)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`AI 审稿 — ${chapterTitle}`} width={680}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 11, color: reviewPrompt ? '#7c3aed' : '#9b8e84', padding: '6px 10px', borderRadius: 6, background: reviewPrompt ? 'rgba(124,58,237,0.04)' : '#faf9f8' }}>
          {reviewPrompt ? `审稿提示词: ${reviewPrompt.title}` : '使用默认审稿提示词（可在提示词库中自定义）'}
        </div>
        <div style={{ fontSize: 11, color: '#6b5e54' }}>
          当前章节 {chapterContent.length} 字符，将截取前 15000 字进行分析
        </div>
        {result && (
          <div style={{ padding: 14, borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.06)', fontSize: 13, lineHeight: 1.8, color: '#2d2520', whiteSpace: 'pre-wrap', maxHeight: 500, overflowY: 'auto' }} className="custom-scrollbar">
            {result}
          </div>
        )}
        {saved && (
          <div style={{ fontSize: 11, color: '#16a34a', textAlign: 'center' }}>✓ 已保存至知识库，AI 助手可引用此审稿结果</div>
        )}
        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', fontSize: 12 }}>{error}</div>
        )}
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
