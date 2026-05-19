import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { continuationService, aiService, fileService } from '@/services/fileService'
import { saveDetailedChapter, loadDetailedChapters } from '@/services/chapterService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import { ArrowLeftIcon, SparklesIcon, PencilIcon, TrashIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline'
import * as cs from '@/services/continuationService'
import { logError } from '@/utils/logger'
import { inputStyle } from '@/components/common/styles'
import { nanoid } from 'nanoid'
import type { ContinuationProject, PlotDirectionSegment } from '@/types/continuation'
import type { DetailedChapter } from '@/types/chapter'

export default function ContinuationDetailedPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const [project, setProject] = useState<ContinuationProject | null>(null)
  const [selectedSegIdx, setSelectedSegIdx] = useState(0)
  const [chapters, setChapters] = useState<DetailedChapter[]>([])
  const [generating, setGenerating] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editChapter, setEditChapter] = useState<DetailedChapter | null>(null)
  const [editSegment, setEditSegment] = useState<PlotDirectionSegment | null>(null)

  useEffect(() => { if (!activeProjectId) { navigate('/continuation'); return }; load() }, [activeProjectId])

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
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const m = reply.match(/\{[\s\S]*\}/)
      if (!m) { setGenerating(false); return }
      const data = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1'))
      const plans: any[] = data.chapters || []

      // Ensure project directory exists
      await fileService.ensureDir(pp)
      await fileService.ensureDir(`${pp}/detailed_outline`)
      await fileService.ensureDir(`${pp}/chapters`)

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

  // ====================== Chapter CRUD ======================

  const handleEdit = (idx: number) => { setEditingIdx(idx); setEditChapter({ ...chapters[idx] }) }

  const handleSaveEdit = async () => {
    if (editingIdx === null || !editChapter) return
    const updated = [...chapters]
    updated[editingIdx] = editChapter
    await saveDetailedChapter(pp, editChapter)
    setChapters(updated)
    setEditingIdx(null); setEditChapter(null)
  }

  const handleDelete = async (ch: DetailedChapter) => {
    await fileService.deleteFile(`${pp}/detailed_outline/${ch.id}.json`)
    await fileService.deleteFile(`${pp}/chapters/${ch.id}.txt`).catch(() => {})
    setChapters(prev => prev.filter(c => c.id !== ch.id))
  }

  const handleMove = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= chapters.length) return
    const updated = [...chapters]
    ;[updated[idx], updated[target]] = [updated[target], updated[idx]]
    updated.forEach((c, i) => { c.order = i })
    setChapters(updated)
    for (const c of [updated[idx], updated[target]]) { await saveDetailedChapter(pp, c) }
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

  const chapCard: React.CSSProperties = {
    padding: '14px 16px', borderRadius: 12, background: '#fff',
    border: '1px solid rgba(0,0,0,0.06)', marginBottom: 8,
  }

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

              {chapters.length === 0 && !generating && (
                <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>点击"生成后续细纲"</div>
                  <div style={{ fontSize: 12 }}>AI 将根据选中的剧情段自动分为10章细纲</div>
                </div>
              )}

              {chapters.map((ch, i) => (
                <div key={ch.id} style={{
                  ...chapCard,
                  borderLeft: ch.status === 'completed' ? '3px solid #16a34a' : '3px solid #ef4444',
                }}>
                  {editingIdx === i && editChapter ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input value={editChapter.title} onChange={e => setEditChapter({ ...editChapter, title: e.target.value })} style={{ ...inputStyle as any, flex: 1, fontSize: 12, fontWeight: 600 }} />
                      </div>
                      <textarea value={editChapter.description} onChange={e => setEditChapter({ ...editChapter, description: e.target.value })} rows={4} style={{ ...inputStyle as any, width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit' }} />
                      <textarea value={editChapter.summary} onChange={e => setEditChapter({ ...editChapter, summary: e.target.value })} rows={2} style={{ ...inputStyle as any, width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit' }} placeholder="摘要" />
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="secondary" onClick={() => { setEditingIdx(null); setEditChapter(null) }}>取消</Button>
                        <Button size="sm" onClick={handleSaveEdit}>保存</Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: ch.status === 'completed' ? '#16a34a' : '#ef4444' }}>
                            {ch.status === 'completed' ? '✓ 已完成' : '○ 待续写'}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>第{i + 1}章: {ch.title}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => handleMove(i, -1)} disabled={i === 0} style={iconBtn} title="上移"><ArrowUpIcon style={iconS} /></button>
                          <button onClick={() => handleMove(i, 1)} disabled={i === chapters.length - 1} style={iconBtn} title="下移"><ArrowDownIcon style={iconS} /></button>
                          <button onClick={() => handleEdit(i)} style={iconBtn} title="编辑"><PencilIcon style={iconS} /></button>
                          <button onClick={() => handleDelete(ch)} style={{ ...iconBtn, color: '#ef4444' }} title="删除"><TrashIcon style={iconS} /></button>
                          <Button size="sm" onClick={() => handleWrite(ch)}>撰写本章</Button>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{ch.description}</div>
                    </div>
                  )}
                </div>
              ))}
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
      <Modal isOpen={editSegment !== null} onClose={() => setEditSegment(null)} title={`编辑 ${editSegment?.label || ''}`} width={700}>
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

const iconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2 }
const iconS = { width: 14, height: 14 }
