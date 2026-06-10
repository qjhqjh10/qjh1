import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { continuationService, aiService, fileService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { saveDetailedChapter, loadDetailedChapters } from '@/services/chapterService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import { ChapterListPanel } from '@/components/panels/ChapterListPanel'
import { ArrowLeftIcon, SparklesIcon, PencilIcon } from '@heroicons/react/24/outline'
import * as cs from '@/services/continuationService'
import { logError } from '@/utils/logger'
import { safeJsonParseAs } from '@/utils/safeJsonParse'
import { nanoid } from 'nanoid'
import type { ContinuationProject, PlotDirectionSegment } from '@/types/continuation'
import type { DetailedChapter } from '@/types/chapter'

export default function ContinuationDetailedPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileVersion = useStore(s => s.fileVersion)
  const [project, setProject] = useState<ContinuationProject | null>(null)
  const [selectedSegIdx, setSelectedSegIdx] = useState(0)
  const [chapters, setChapters] = useState<DetailedChapter[]>([])
  const [generating, setGenerating] = useState(false)
  const [editSegment, setEditSegment] = useState<PlotDirectionSegment | null>(null)

  useEffect(() => { if (!activeProjectId) { navigate('/continuation'); return }; load() }, [activeProjectId, fileVersion])

  const pp = `${projectsBasePath}/${activeProjectId}`

  const load = async () => {
    const list = await continuationService.list() as ContinuationProject[]
    const found = list.find(p => p.id === activeProjectId || p.name === activeProjectId)
    if (found) {
      setProject(found)
      // Load existing detailed chapters from project directory
      loadDetailedChapters(pp).then(setChapters).catch(() => setChapters([]))
    }
  }

  const segments = project?.plotDirection || []

  // ====================== Generate chapter plans ======================

  const handleGeneratePlans = async () => {
    if (!activeConfigId || !segments[selectedSegIdx]) return
    setGenerating(true)
    try {
      const content = segments[selectedSegIdx].content
      const prompt = cs.buildSegmentChapterPlansPrompt(content, 10)
      const reply = await chatAI([{ role: 'user', content: prompt }], activeConfigId)
      const data = safeJsonParseAs<{ chapters: any[] }>(reply)
      if (!data) { setGenerating(false); return }
      const plans: any[] = data.chapters || []

      // Ensure project directory exists
      await fileService.ensureDir(pp)
      await fileService.ensureDir(`${pp}/detailed_outline`)
      await fileService.ensureDir(`${pp}/chapters`)
      await fileService.ensureDir(`${pp}/summaries`)

      const newChapters: DetailedChapter[] = []
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i]
        const id = nanoid(8)
        const ch: DetailedChapter = {
          id,
          title: p.title || `续第${i + 1}章`,
          description: [
            p.summary || '',
            p.plotPoints?.length > 0 ? '剧情点: ' + p.plotPoints.join(' → ') : '',
            p.characterFocus?.length > 0 ? '角色: ' + p.characterFocus.join('、') : '',
          ].filter(Boolean).join('\n'),
          summary: p.summary || '',
          order: i,
          status: 'incomplete',
        }
        await saveDetailedChapter(pp, ch)
        // Create empty chapter file
        await fileService.write(`${pp}/chapters/${id}.txt`, '')
        newChapters.push(ch)
      }
      setChapters(newChapters)
    } catch (err) { logError('生成细纲失败', err) }
    setGenerating(false)
  }

  const handleWrite = (ch: DetailedChapter) => { navigate(`/chapter/${ch.id}`) }

  // ====================== Segment edit ======================

  const handleEditSegment = (seg: PlotDirectionSegment) => { setEditSegment({ ...seg }) }

  const handleSaveSegment = async () => {
    if (!editSegment || !project) return
    const updated = (project.plotDirection || []).map(s => s.id === editSegment.id ? editSegment : s)
    const saved = await continuationService.save({ ...project, plotDirection: updated, updatedAt: new Date().toISOString() })
    setProject(saved)
    setEditSegment(null)
  }

  // ====================== Styles ======================

  const segCard = (selected: boolean): React.CSSProperties => ({
    padding: '12px 14px', borderRadius: 10, cursor: 'pointer', marginBottom: 8,
    background: selected ? 'rgba(124,58,237,0.04)' : '#faf9f8',
    border: selected ? '2px solid #7c3aed' : '1px solid rgba(0,0,0,0.04)',
    borderLeft: selected ? '3px solid #7c3aed' : '3px solid transparent',
  })

  const selectedSeg = segments[selectedSegIdx]

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/continuation-workspace')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>续写细纲</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{chapters.length}章</span>
        <span style={{ fontSize: 11, color: '#16a34a' }}>{chapters.filter(c => c.status === 'completed').length}已完成</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => navigate('/continuation-workspace')} variant="secondary">返回工作台</Button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: plot direction segments */}
        <div style={{ width: '35%', borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>后续剧情</div>
            <div style={{ fontSize: 11, color: '#9b8e84' }}>选择一段剧情来生成细纲</div>
          </div>
          <ScrollArea style={{ flex: 1, padding: '10px 12px' }}>
            {segments.length === 0 ? (
              <div style={{ fontSize: 11, color: '#9b8e84', textAlign: 'center', padding: 40 }}>暂无后续剧情段，请先在续写大纲页生成</div>
            ) : (
              segments.map((seg, i) => (
                <div key={seg.id} style={segCard(selectedSegIdx === i)}>
                  <div onClick={() => setSelectedSegIdx(i)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: selectedSegIdx === i ? '#7c3aed' : '#f59e0b' }}>{seg.label}</span>
                      <span style={{ fontSize: 10, color: '#9b8e84' }}>{seg.content.length}字</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {seg.content.slice(0, 150)}{seg.content.length > 150 ? '...' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <Button size="sm" variant="secondary" onClick={() => handleEditSegment(seg)} style={{ fontSize: 10, padding: '2px 8px' }} icon={<PencilIcon style={{ width: 10, height: 10 }} />}>编辑</Button>
                    <Button size="sm" onClick={() => setSelectedSegIdx(i)} style={{ fontSize: 10, padding: '2px 8px' }}>选择</Button>
                  </div>
                </div>
              ))
            )}
          </ScrollArea>
        </div>

        {/* Right: chapter plans */}
        <ScrollArea style={{ flex: 1, padding: '16px 20px' }}>
          {selectedSeg ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>选中: {selectedSeg.label}</div>
                  <div style={{ fontSize: 11, color: '#9b8e84' }}>{selectedSeg.content.length}字 → 预计分为10章</div>
                </div>
                <Button size="sm" onClick={handleGeneratePlans} disabled={generating || !activeConfigId} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>{generating ? '生成中...' : '生成后续细纲'}</Button>
              </div>

              {!generating && (
                <ChapterListPanel
                  chapters={chapters}
                  setChapters={setChapters}
                  projectPath={pp}
                  onWriteChapter={handleWrite}
                  emptyTitle="点击'生成后续细纲'"
                  emptyDescription="AI 将根据选中的剧情段自动分为10章细纲"
                />
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>👈</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>请先在左侧选择一段后续剧情</div>
              <div style={{ fontSize: 12 }}>选择后可基于该段剧情生成细纲</div>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Edit Segment Modal */}
      <Modal isOpen={editSegment !== null} onClose={() => setEditSegment(null)} title={`编辑 ${editSegment?.label || ''}`} width={700} draggable>
        {editSegment && (
          <>
            <textarea value={editSegment.content} onChange={e => setEditSegment({ ...editSegment, content: e.target.value })} rows={20} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 13, lineHeight: 1.8, fontFamily: 'inherit', resize: 'vertical' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <Button variant="secondary" onClick={() => setEditSegment(null)}>取消</Button>
              <Button onClick={handleSaveSegment}>保存</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
