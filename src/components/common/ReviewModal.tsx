import { useState, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { fileService, kbService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { stripHtml } from '@/utils/textUtils'
import Modal from './Modal'
import Button from './Button'
import { SparklesIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

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

const COL_HEADER: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8,
  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
}

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
  const plainContent = stripHtml(chapterContent)

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
    if (!plainContent.trim()) { setError('当前章节无内容'); return }
    setLoading(true)
    setError('')
    setSaved(false)
    try {
      const customPart = customRequirement.trim() ? `${customRequirement}\n\n` : ''
      const wantTemplate = selectedPromptId && selectedPromptId !== NONE_ID
      const templateContent = wantTemplate && activePrompt?.content
      const useDefault = !wantTemplate && !customPart
      const templatePart = templateContent ? `【审稿模板】\n${templateContent}\n\n` : useDefault ? `${DEFAULT_REVIEW_PROMPT}\n\n` : ''
      const msg = `${customPart}${templatePart}---\n章节标题: ${chapterTitle}\n\n章节正文:\n${plainContent.slice(0, 50000)}`
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
    <Modal isOpen={isOpen} onClose={onClose} title={`AI 审稿 — ${chapterTitle}`} width="85vw" draggable resizable>
      <div style={{ display: 'flex', gap: 18, height: '62vh', minHeight: 460 }}>
        {/* ===== 左栏：原文 + 配置 ===== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', minWidth: 0, paddingRight: 4 }} className="custom-scrollbar">
          {/* Chapter content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={COL_HEADER}>
              <DocumentTextIcon style={{ width: 14, height: 14, color: '#9b8e84' }} />
              章节原文
              <span style={{ fontSize: 11, fontWeight: 400, color: '#9b8e84', marginLeft: 'auto' }}>{plainContent.length} 字符（审稿截取前 50000 字）</span>
            </div>
            <div style={{
              flex: 1, padding: 14, borderRadius: 10,
              background: '#fbfaf8',
              border: '2px solid #3d352a',
              fontSize: 15, lineHeight: 2, color: '#4a3f38',
              whiteSpace: 'pre-wrap', overflow: 'auto',
            }} className="custom-scrollbar">
              {plainContent.slice(0, 2000)}{plainContent.length > 2000 && <span style={{ color: '#9b8e84' }}>...（共 {plainContent.length} 字符，此处仅展示前 2000 字符）</span>}
            </div>
          </div>

          {/* Prompt template selector */}
          {reviewPrompts.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>提示词模板</div>
              <select
                value={selectedPromptId}
                onChange={e => setSelectedPromptId(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 10,
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
                <div style={{ fontSize: 11, color: '#7c3aed', padding: '6px 10px', marginTop: 6, borderRadius: 8, background: 'rgba(124,58,237,0.04)', lineHeight: 1.5 }}>
                  {activePrompt.content.slice(0, 120)}...
                </div>
              )}
            </div>
          )}

          {/* Custom requirements */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>
              自定义审稿要求 <span style={{ fontWeight: 400, color: '#9b8e84' }}>（优先于模板）</span>
            </div>
            <textarea
              value={customRequirement}
              onChange={e => setCustomRequirement(e.target.value)}
              placeholder="例如：重点审查人物对话是否贴切、情节转折是否合理..."
              style={{
                width: '100%', border: '1px solid #e5e0da', borderRadius: 12, outline: 'none',
                resize: 'none', fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
                color: '#2d2520', background: '#faf9f8', padding: 10, minHeight: 60,
              }}
            />
          </div>

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', fontSize: 12 }}>{error}</div>
          )}

          {/* Generate button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button onClick={handleReview} disabled={loading || !configId} icon={<SparklesIcon style={{ width: 16, height: 16 }} />}>
              {loading ? '审稿中...' : '开始审稿'}
            </Button>
          </div>
        </div>

        {/* 分隔 */}
        <div style={{ width: 1, alignSelf: 'stretch', background: '#d0cbc4', flexShrink: 0 }} />

        {/* ===== 右栏：审稿结果 ===== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={COL_HEADER}>
            <SparklesIcon style={{ width: 14, height: 14, color: '#7c3aed' }} />
            审稿结果
            {result && <span style={{ fontSize: 11, fontWeight: 400, color: '#9b8e84', marginLeft: 'auto' }}>{result.length} 字符</span>}
          </div>

          <div style={{
            flex: 1, padding: 16, borderRadius: 10,
            border: result ? '2px solid #3d352a' : '1px dashed #d8d2cb',
            background: loading ? 'rgba(124,58,237,0.02)' : result ? '#faf8fd' : '#faf9f8',
            fontSize: 15, lineHeight: 2, color: '#2d2520',
            whiteSpace: 'pre-wrap', overflow: 'auto',
          }} className="custom-scrollbar">
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#7c3aed', fontSize: 14 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                    border: '2px solid #7c3aed', borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  AI 正在审稿...
                </span>
              </div>
            ) : result ? (
              result
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#c5bfb8', fontSize: 13, gap: 6 }}>
                <SparklesIcon style={{ width: 28, height: 28, opacity: 0.25 }} />
                <span>配置审稿选项后，点击"开始审稿"</span>
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 10, marginTop: 12, borderTop: '1px solid #f0ece8' }}>
            {result && <Button variant="secondary" size="sm" onClick={() => { navigator.clipboard.writeText(result) }}>复制结果</Button>}
            {saved && <span style={{ fontSize: 11, color: '#16a34a', display: 'flex', alignItems: 'center' }}>✓ 已保存至知识库</span>}
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
