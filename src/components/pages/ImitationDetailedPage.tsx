import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { aiService, fileService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { loadExtraction, loadDetailResults, saveDetailResults } from '@/services/imitationService'
import { saveDetailedChapter, loadDetailedChapters } from '@/services/chapterService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import { ChapterListPanel } from '@/components/panels/ChapterListPanel'
import { ArrowLeftIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { logError } from '@/utils/logger'
import { safeJsonParseAs } from '@/utils/safeJsonParse'
import { nanoid } from 'nanoid'
import type { NovelExtraction, DetailGenResult } from '@/types/story'
import type { DetailedChapter } from '@/types/chapter'

export default function ImitationDetailedPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const fileVersion = useStore(s => s.fileVersion)
  const [extraction, setExtraction] = useState<NovelExtraction | null>(null)
  const [chapters, setChapters] = useState<DetailedChapter[]>([])
  const [detailResults, setDetailResults] = useState<DetailGenResult[]>([])
  const [generating, setGenerating] = useState(false)
  const [selectedSrcIndex, setSelectedSrcIndex] = useState(0)

  const pp = activeProjectId ? `${projectsBasePath}/${activeProjectId}` : ''

  useEffect(() => { if (!activeProjectId) { navigate('/'); return }; loadData() }, [activeProjectId, fileVersion])

  const loadData = async () => {
    const ext = await loadExtraction(pp)
    setExtraction(ext)
    const dr = await loadDetailResults(pp)
    setDetailResults(dr)
    // Load chapters written to disk (using unified loader for summary merge)
    try {
      const chs = await loadDetailedChapters(pp)
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
        const reply = await chatAI([{ role: 'user', content: prompt }], activeConfigId)
        const d = safeJsonParseAs<{ chapterNumber: number; title: string; summary: string; keyEvents?: string[]; plotPoints?: string[]; charactersAppearing?: string[]; characters?: string[]; levelChange?: string; itemsUsed?: string[]; location?: string; foreshadowingOps?: string[]; emotionalTone?: string; eroticScene?: string }>(reply)
        if (d) {
          results.push({ chapterNumber: ch.chapterNumber, title: ch.chapterTitle, summary: d.summary || '', keyEvents: d.keyEvents || d.plotPoints || [], charactersAppearing: d.charactersAppearing || d.characters || [], levelChange: d.levelChange || '', itemsUsed: d.itemsUsed || [], location: d.location || '', foreshadowingOps: d.foreshadowingOps || [], emotionalTone: d.emotionalTone || '', eroticScene: d.eroticScene || '' })
        }
      }
      setDetailResults(results)
      await saveDetailResults(pp, results)
      // Create chapter files
      await fileService.ensureDir(`${pp}/detailed_outline`)
      await fileService.ensureDir(`${pp}/chapters`)
      await fileService.ensureDir(`${pp}/summaries`)
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

          {!generating && (
            <ChapterListPanel
              chapters={chapters}
              setChapters={setChapters}
              projectPath={pp}
              onWriteChapter={handleWrite}
              emptyTitle="点击'生成全部细纲'"
              emptyDescription="AI 将为每章生成仿写细纲"
            />
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
