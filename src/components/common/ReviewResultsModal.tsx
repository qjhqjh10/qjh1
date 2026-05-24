import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { kbService } from '@/services/fileService'
import Modal from './Modal'
import Button from './Button'
import ScrollArea from './ScrollArea'
import { TrashIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

interface ReviewFile {
  id: string
  originalName: string
  uploadedAt: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function ReviewResultsModal({ isOpen, onClose }: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const [reviews, setReviews] = useState<ReviewFile[]>([])
  const [selectedReview, setSelectedReview] = useState<{ id: string; content: string; name: string } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen) { loadReviews() }
  }, [isOpen, activeProjectId])

  const loadReviews = async () => {
    try {
      const meta = await kbService.list() as { files: { id: string; originalName: string; uploadedAt: string; projects: string[] }[] }
      const projectReviews = meta.files
        .filter(f => f.originalName.startsWith('审稿_') && f.projects.includes(activeProjectId || ''))
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      setReviews(projectReviews)
    } catch { setReviews([]) }
  }

  const handleView = async (file: ReviewFile) => {
    setLoading(true)
    try {
      const result = await kbService.read(file.id) as { content: string }
      setSelectedReview({ id: file.id, content: result.content || '', name: file.originalName })
    } catch { /* ignore */ }
    setLoading(false)
  }

  const handleDelete = async (fileId: string) => {
    if (!confirm('确定删除此审稿结果？')) return
    await kbService.delete(fileId)
    setSelectedReview(null)
    loadReviews()
  }

  // Parse score summary from review text
  const parseScores = (text: string) => {
    const scores: { label: string; score: number; comment: string }[] = []
    const lines = text.split('\n')
    for (const line of lines) {
      const m = line.match(/^(.+):\s*(\d+)\/10\s*\|\s*(.+)/)
      if (m) scores.push({ label: m[1].trim(), score: parseInt(m[2]), comment: m[3].trim() })
    }
    return scores
  }

  const scores = selectedReview ? parseScores(selectedReview.content) : []

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="审稿结果" width={selectedReview ? 760 : 560} draggable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {selectedReview ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>{selectedReview.name}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" variant="secondary" onClick={() => setSelectedReview(null)}>返回列表</Button>
                <Button size="sm" variant="danger" onClick={() => handleDelete(selectedReview.id)} icon={<TrashIcon style={{ width: 13, height: 13 }} />}>删除</Button>
              </div>
            </div>
            {/* Score cards */}
            {scores.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                {scores.map(s => (
                  <div key={s.label} style={{ flex: '1 1 120px', padding: '8px 12px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.score >= 8 ? '#16a34a' : s.score >= 6 ? '#e67e00' : '#dc2626' }}>{s.score}<span style={{ fontSize: 12, fontWeight: 400, color: '#9b8e84' }}>/10</span></div>
                    <div style={{ fontSize: 10, color: '#6b5e54', marginTop: 2, lineHeight: 1.3 }}>{s.comment}</div>
                  </div>
                ))}
              </div>
            )}
            <ScrollArea maxHeight="55vh">
              <div style={{ fontSize: 13, lineHeight: 1.8, color: '#2d2520', whiteSpace: 'pre-wrap', padding: '8px 0' }}>{selectedReview.content}</div>
            </ScrollArea>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {reviews.length > 0 ? reviews.map(r => {
              const date = r.uploadedAt ? new Date(r.uploadedAt).toLocaleString() : ''
              return (
                <button key={r.id} onClick={() => handleView(r)} style={{
                  width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: 'none',
                  cursor: 'pointer', background: '#faf9f8', fontSize: 13,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <DocumentTextIcon style={{ width: 16, height: 16, color: '#7c3aed', flexShrink: 0 }} />
                    <span style={{ flex: 1, color: '#2d2520', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.originalName.replace('.txt', '')}
                    </span>
                    <span style={{ fontSize: 10, color: '#9b8e84', flexShrink: 0 }}>{date}</span>
                    <button onClick={e => { e.stopPropagation(); handleDelete(r.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 2 }} onMouseEnter={e => { e.currentTarget.style.color = '#dc2626' }} onMouseLeave={e => { e.currentTarget.style.color = '#d4ccc4' }}>
                      <TrashIcon style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </button>
              )
            }) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>
                暂无审稿结果。使用 "AI 审稿" 功能后，结果将自动保存至知识库。
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
