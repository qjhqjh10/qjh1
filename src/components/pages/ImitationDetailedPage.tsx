import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { aiService, fileService } from '@/services/fileService'
import { loadExtraction, loadDetailResults, saveDetailResults } from '@/services/imitationService'
import { saveDetailedChapter } from '@/services/chapterService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import { ArrowLeftIcon, SparklesIcon, PencilIcon, TrashIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline'
import { logError } from '@/utils/logger'
import { inputStyle } from '@/components/common/styles'
import { nanoid } from 'nanoid'
import type { NovelExtraction, DetailGenResult } from '@/types/story'
import type { DetailedChapter } from '@/types/chapter'

export default function ImitationDetailedPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const [extraction, setExtraction] = useState<NovelExtraction | null>(null)
  const [chapters, setChapters] = useState<DetailedChapter[]>([])
  const [detailResults, setDetailResults] = useState<DetailGenResult[]>([])
  const [generating, setGenerating] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editChapter, setEditChapter] = useState<DetailedChapter | null>(null)
  const [selectedSrcIndex, setSelectedSrcIndex] = useState(0)

  const pp = activeProjectId ? `${projectsBasePath}/${activeProjectId}` : ''

  useEffect(() => { if (!activeProjectId) { navigate('/'); return }; loadData() }, [activeProjectId])

  const loadData = async () => {
    const ext = await loadExtraction(pp)
    setExtraction(ext)
    const dr = await loadDetailResults(pp)
    setDetailResults(dr)
    // Load chapters written to disk
    try {
      const files = await fileService.listDir(`${pp}/detailed_outline`)
      const chs: DetailedChapter[] = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const raw = await fileService.read(`${pp}/detailed_outline/${f}`)
          chs.push(JSON.parse(raw) as DetailedChapter)
        } catch { /* skip */ }
      }
      chs.sort((a, b) => a.order - b.order)
      setChapters(chs)
    } catch { setChapters([]) }
  }

  const srcChapters = extraction?.chapters || []

  // ====================== AI Generate ======================

  const handleGenerateAll = async () => {
    if (!extraction || !activeConfigId || srcChapters.length === 0) return
    setGenerating(true)
    try {
      const results: DetailGenResult[] = []
      for (const ch of extraction.chapters) {
        const prompt = `请为以下章节生成细纲（150字内的剧情概要）:\n第${ch.chapterNumber}章: ${ch.chapterTitle}\n内容摘要: ${ch.chapterContent.slice(0, 1000)}\n\n输出JSON: {"chapterNumber":${ch.chapterNumber},"title":"${ch.chapterTitle}","summary":"剧情概要","characters":["角色1"],"keyEvents":["事件1"],"emotionalTone":"情绪"}`
        const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
        const m = reply.match(/\{[\s\S]*\}/)
        if (m) {
          const d = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1'))
          results.push({ chapterNumber: ch.chapterNumber, title: ch.chapterTitle, summary: d.summary || '', keyEvents: d.keyEvents || d.plotPoints || [], charactersAppearing: d.charactersAppearing || d.characters || [], levelChange: d.levelChange || '', itemsUsed: d.itemsUsed || [], location: d.location || '', foreshadowingOps: d.foreshadowingOps || [], emotionalTone: d.emotionalTone || '', eroticScene: d.eroticScene || '' })
        }
      }
      setDetailResults(results)
      await saveDetailResults(pp, results)
      // Create chapter files
      await fileService.ensureDir(`${pp}/detailed_outline`)
      await fileService.ensureDir(`${pp}/chapters`)
      const newChs: DetailedChapter[] = []
      for (const dr of results) {
        const id = nanoid(8)
        const ch: DetailedChapter = { id, title: dr.title, description: dr.summary, summary: dr.summary, order: dr.chapterNumber - 1, status: 'incomplete' }
        await saveDetailedChapter(pp, ch)
        await fileService.write(`${pp}/chapters/${id}.txt`, '')
        newChs.push(ch)
      }
      setChapters(newChs)
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

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/imitation')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84' }}><ArrowLeftIcon style={{ width: 18, height: 18 }} /></button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>(仿写)细纲</span>
        <span style={{ fontSize: 11, color: '#9b8e84' }}>{chapters.length}章</span>
        <span style={{ fontSize: 11, color: '#16a34a' }}>{chapters.filter(c => c.status === 'completed').length}已完成</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => navigate('/imitation')} variant="secondary">返回仿写页</Button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 220, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)' }}>
          <div style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: '#6b5e54', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>原书章节 ({srcChapters.length})</div>
          <ScrollArea style={{ flex: 1, padding: '8px' }}>
            {srcChapters.map((ch, i) => (
              <div key={i} onClick={() => setSelectedSrcIndex(i)} style={{
                padding: '6px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 6, marginBottom: 2,
                background: selectedSrcIndex === i ? 'rgba(124,58,237,0.06)' : 'transparent',
                borderLeft: selectedSrcIndex === i ? '2px solid #7c3aed' : '2px solid transparent',
                color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>第{ch.chapterNumber}章 {ch.chapterTitle}</div>
            ))}
          </ScrollArea>
        </div>

        <ScrollArea style={{ flex: 1, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>仿写细纲</div>
              <div style={{ fontSize: 11, color: '#9b8e84' }}>{detailResults.length > 0 ? `已生成 ${detailResults.length} 章` : '尚未生成'}</div>
            </div>
            <Button size="sm" onClick={handleGenerateAll} disabled={generating || !activeConfigId || srcChapters.length === 0} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>{generating ? '生成中...' : '生成全部细纲'}</Button>
          </div>

          {chapters.length === 0 && !generating && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>点击"生成全部细纲"</div>
              <div style={{ fontSize: 12 }}>AI 将为每章生成仿写细纲</div>
            </div>
          )}

          {chapters.map((ch, i) => (
            <div key={ch.id} style={{
              padding: '14px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', marginBottom: 8,
              borderLeft: ch.status === 'completed' ? '3px solid #16a34a' : '3px solid #ef4444',
            }}>
              {editingIdx === i && editChapter ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input value={editChapter.title} onChange={e => setEditChapter({ ...editChapter, title: e.target.value })} style={{ ...inputStyle as any, fontSize: 12, fontWeight: 600 }} />
                  <textarea value={editChapter.description} onChange={e => setEditChapter({ ...editChapter, description: e.target.value })} rows={4} style={{ ...inputStyle as any, width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit' }} />
                  <textarea value={editChapter.summary} onChange={e => setEditChapter({ ...editChapter, summary: e.target.value })} rows={2} style={{ ...inputStyle as any, width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit' }} />
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
                      <button onClick={() => handleMove(i, -1)} disabled={i === 0} style={iconBtn}><ArrowUpIcon style={iconS} /></button>
                      <button onClick={() => handleMove(i, 1)} disabled={i === chapters.length - 1} style={iconBtn}><ArrowDownIcon style={iconS} /></button>
                      <button onClick={() => handleEdit(i)} style={iconBtn}><PencilIcon style={iconS} /></button>
                      <button onClick={() => handleDelete(ch)} style={{ ...iconBtn, color: '#ef4444' }}><TrashIcon style={iconS} /></button>
                      <Button size="sm" onClick={() => handleWrite(ch)}>撰写本章</Button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7 }}>{ch.description || ch.summary}</div>
                </div>
              )}
            </div>
          ))}
        </ScrollArea>
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2 }
const iconS = { width: 14, height: 14 }
