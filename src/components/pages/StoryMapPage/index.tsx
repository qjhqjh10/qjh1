import { useEffect, useRef, useState } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { fileService, aiService, appService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { logError } from '@/utils/logger'
import { loadDetailedChapters, saveDetailedChapter } from '@/services/chapterService'
import { splitChaptersByHeadings } from '@/utils/textUtils'
import * as continuationService from '@/services/continuationService'
import type { Character } from '@/types/character'
import type { DetailedChapter } from '@/types/chapter'
import type { StoryEvent, StoryLink, CharacterSnapshot, StoryGraph, ChapterEmotion, CharacterPresence, ChapterRhythm, ChapterPlotline, ChapterPOV, Plotline, GrowthTrack, GrowthEntry } from '@/types/story'
import { GENRE_TRACK_PRESETS } from '@/types/story'
import {
  SparklesIcon, PlusIcon, TrashIcon, PencilIcon, XMarkIcon,
  ClockIcon, LinkIcon, ShieldCheckIcon,
  MapPinIcon, UserIcon, FlagIcon, ArrowRightIcon, ChartBarIcon,
  EyeIcon, TableCellsIcon, ArrowsRightLeftIcon, Bars3Icon, ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline'
import { TabKey, TABS, EVENT_TYPE_LABELS, EVENT_TYPE_COLORS, EMOTION_LINES, PLOTLINE_COLORS, POV_TYPE_LABELS, CHANGE_LABELS, CHANGE_COLORS } from './constants'
import { fieldLabel } from './styles'

const EMPTY_GRAPH: StoryGraph = { events: [], links: [], snapshots: [], emotions: [], presences: [], rhythms: [], plotlines: [], chapterPlotlines: [], povs: [], growthTracks: [], growthEntries: [], timeFlow: [], coOccurrence: null, romanceProgress: [], cultivationProgress: [], generatedAt: '', scannedChapterIds: [], scannedChapterHashes: {}, novelType: '' }

export default function StoryMapPage() {
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)

  const [workspacePath, setWorkspacePath] = useState('')
  const [detailedChapters, setDetailedChapters] = useState<DetailedChapter[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('consistency')
  const [graph, setGraph] = useState<StoryGraph>(EMPTY_GRAPH)
  const graphRef = useRef(graph)
  graphRef.current = graph

  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanProgress, setScanProgress] = useState('')
  const [chapterAnalysisRunning, setChapterAnalysisRunning] = useState(false)
  const [chapterAnalysisProgress, setChapterAnalysisProgress] = useState('')
  const [chapterAnalyses, setChapterAnalyses] = useState<{ chapterOrder: number; chapterTitle: string; analysis: string }[]>([])
  const [conflicts, setConflicts] = useState<{ type: string; severity: string; chapterA: number; chapterB: number; summary: string; evidence: string; suggestion: string }[]>([])
  const [conflictSummary, setConflictSummary] = useState('')
  const [conflictDetecting, setConflictDetecting] = useState(false)

  const [editingEvent, setEditingEvent] = useState<StoryEvent | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null)
  const [consistencyCharId, setConsistencyCharId] = useState('')

  const characters: Character[] = [] // Story Map doesn't need character library
  const sortedChapters = [...detailedChapters].sort((a, b) => a.order - b.order)

  // Initialize workspace
  useEffect(() => {
    appService.getStoryWorkspacePath().then(async (pp: string) => {
      setWorkspacePath(pp)
      await fileService.ensureDir(pp)
      await fileService.ensureDir(`${pp}/chapters`)
      await fileService.ensureDir(`${pp}/detailed_outline`)
      loadDetailedChapters(pp).then(setDetailedChapters)
      loadGraph(pp)
    })
  }, [])

  const loadGraph = async (pp: string) => {
    try {
      const raw = await fileService.read(`${pp}/story_graph.json`)
      if (raw) {
        const data = JSON.parse(raw) as StoryGraph
        data.growthTracks = data.growthTracks || []
        data.growthEntries = data.growthEntries || []
        data.timeFlow = data.timeFlow || []
        data.coOccurrence = data.coOccurrence || null
        data.romanceProgress = data.romanceProgress || []
        data.cultivationProgress = data.cultivationProgress || []
        setGraph(data)
      }
    } catch { /* no saved graph */ }
  }

  const saveGraph = async (data: StoryGraph) => {
    if (!workspacePath) return
    await fileService.write(`${workspacePath}/story_graph.json`, JSON.stringify(data, null, 2))
  }

  // ---- TXT Import ----
  const handleImportTXT = async () => {
    if (!workspacePath) return
    try {
      const extractionService = (await import('@/services/fileService')).extractionService
      const result = await extractionService.importFile() as { name: string; content: string } | null
      if (!result) return
      const split = splitChaptersByHeadings(result.content)
      if (split.length === 1 && split[0].chapterType === 'chapter' && split[0].title === '全文') {
        alert('未检测到章节标题，已导入为单章全文。\n请确认小说文件使用了标准的"第X章"格式。')
      }
      for (let i = 0; i < split.length; i++) {
        const ch = split[i]
        const id = `ch_${i + 1}`
        await fileService.write(`${workspacePath}/chapters/${id}.txt`, ch.content)
        await saveDetailedChapter(workspacePath, { id, title: ch.title, description: '', summary: '', order: i, status: 'incomplete' })
      }
      setScanError('')
      alert(`导入完成: ${split.length} 章。请点击"逐章分析"开始 AI 分析。`)
      loadDetailedChapters(workspacePath).then(setDetailedChapters)
    } catch (err) { logError('导入失败', err); alert('导入失败') }
  }

  // ---- Chapter Analysis ----
  const handleAnalyzeAllChapters = async () => {
    if (!activeConfigId || sortedChapters.length === 0) return
    setChapterAnalysisRunning(true)
    setChapterAnalyses([])
    const results: { chapterOrder: number; chapterTitle: string; analysis: string }[] = []
    try {
      for (let i = 0; i < sortedChapters.length; i++) {
        const ch = sortedChapters[i]
        setChapterAnalysisProgress(`分析中 ${i + 1}/${sortedChapters.length}: ${ch.title}`)
        let content = ''
        try { content = await fileService.read(`${workspacePath}/chapters/${ch.id}.txt`) } catch { content = ch.description || '' }
        if (!content) { results.push({ chapterOrder: ch.order + 1, chapterTitle: ch.title, analysis: '' }); continue }
        const prompt = continuationService.buildChapterAnalysisPrompt(ch.title, content, ch.order + 1)
        try {
          const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
          results.push({ chapterOrder: ch.order + 1, chapterTitle: ch.title, analysis: reply })
        } catch { results.push({ chapterOrder: ch.order + 1, chapterTitle: ch.title, analysis: '' }) }
      }
    } catch (err) { logError('逐章分析失败', err) }
    setChapterAnalyses(results)
    setChapterAnalysisProgress('')
    setChapterAnalysisRunning(false)
    alert(`分析完成: ${results.filter(r => r.analysis).length}/${results.length} 章`)
  }

  // ---- Conflict Detection ----
  const handleDetectConflicts = async () => {
    if (!activeConfigId || chapterAnalyses.length === 0) return
    const valid = chapterAnalyses.filter(c => c.analysis)
    if (valid.length === 0) return
    setConflictDetecting(true)
    try {
      const summaries = valid.map(c => `第${c.chapterOrder}章 ${c.chapterTitle}:\n${c.analysis}`)
      const prompt = continuationService.buildConflictDetectionPrompt(summaries, sortedChapters.length)
      const reply = await aiService.chat([{ role: 'user', content: prompt }], activeConfigId)
      const m = reply.match(/\{[\s\S]*\}/)
      if (m) {
        const data = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1'))
        setConflicts(data.conflicts || [])
        setConflictSummary(data.summary || '')
      }
    } catch (err) { logError('冲突检测失败', err) }
    setConflictDetecting(false)
  }

  // ---- Event CRUD ----
  const handleEditEvent = (ev: StoryEvent) => { setEditingEvent({ ...ev }); setShowEventModal(true) }
  const handleDeleteEvent = async (id: string) => {
    const ng = { ...graph, events: graph.events.filter(e => e.id !== id), links: graph.links.filter(l => l.sourceEventId !== id && l.targetEventId !== id) }
    setGraph(ng); await saveGraph(ng)
  }
  const handleSaveEvent = async () => {
    if (!editingEvent) return
    const ng = { ...graph, events: graph.events.some(e => e.id === editingEvent.id) ? graph.events.map(e => e.id === editingEvent.id ? editingEvent : e) : [...graph.events, editingEvent] }
    setGraph(ng); await saveGraph(ng)
    setShowEventModal(false); setEditingEvent(null)
  }

  const handleStartLink = (id: string) => { setLinkingFrom(id) }
  const handleFinishLink = async (targetId: string) => {
    if (!linkingFrom || linkingFrom === targetId) { setLinkingFrom(null); return }
    const id = `lnk_${nanoid(6)}`
    const ng = { ...graph, links: [...graph.links, { id, sourceEventId: linkingFrom, targetEventId: targetId, type: 'foreshadowing' as const, note: '' }] }
    setGraph(ng); await saveGraph(ng); setLinkingFrom(null)
  }
  const handleDeleteLink = async (id: string) => {
    const ng = { ...graph, links: graph.links.filter(l => l.id !== id) }
    setGraph(ng); await saveGraph(ng)
  }

  const getEventsByChapter = (chapterId: string) => graph.events.filter(e => e.chapterId === chapterId).sort((a, b) => a.type === 'foreshadowing' ? -1 : 1)
  const getLinkedEvents = (link: StoryLink) => ({ source: graph.events.find(e => e.id === link.sourceEventId), target: graph.events.find(e => e.id === link.targetEventId) })

  // ====================== Import screen (no chapters loaded) ======================
  if (sortedChapters.length === 0 && graph.events.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 500 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>📖</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#2d2520', marginBottom: 8 }}>故事脉络</h2>
          <p style={{ fontSize: 14, color: '#9b8e84', marginBottom: 16 }}>导入任意 TXT 小说，AI 自动逐章分析</p>
          <p style={{ fontSize: 12, color: '#9b8e84', marginBottom: 24 }}>检测 8 类一致性冲突：角色生死 · 等级倒退 · 道具矛盾 · 势力存亡 · 时间线 · 关系矛盾 · 伏笔遗漏 · 情绪断裂</p>
          <Button size="sm" onClick={handleImportTXT} disabled={!activeConfigId} style={{ padding: '10px 24px' }} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>导入 TXT 文件</Button>
          {!activeConfigId && <p style={{ fontSize: 11, color: '#9b8e84', marginTop: 12 }}>请先在系统设置中配置 AI 模型</p>}
        </div>
      </div>
    )
  }

  // ====================== Main workspace ======================
  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>📖 故事脉络</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="sm" variant="secondary" onClick={handleImportTXT}>导入 TXT</Button>
          <Button size="sm" onClick={handleAnalyzeAllChapters} disabled={chapterAnalysisRunning || sortedChapters.length === 0 || !activeConfigId} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>
            {chapterAnalysisRunning ? chapterAnalysisProgress : '逐章分析'}
          </Button>
          <Button size="sm" onClick={handleDetectConflicts} disabled={conflictDetecting || chapterAnalyses.length === 0 || !activeConfigId} icon={<SparklesIcon style={{ width: 12, height: 12 }} />}>
            {conflictDetecting ? '检测中...' : '冲突检测'}
          </Button>
          {chapterAnalyses.length > 0 && <span style={{ fontSize: 11, color: '#9b8e84' }}>已分析 {chapterAnalyses.filter(c => c.analysis).length}/{chapterAnalyses.length} 章</span>}
          {conflicts.length > 0 && <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>{conflicts.length} 个冲突</span>}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '16px 20px' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid rgba(0,0,0,0.04)', flexWrap: 'wrap' }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 16px', border: 'none', background: 'transparent',
                fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 500,
                color: activeTab === tab.key ? '#7c3aed' : '#6b5e54',
                borderBottom: activeTab === tab.key ? '2px solid #7c3aed' : '2px solid transparent',
                cursor: 'pointer', marginBottom: -2,
              }}><tab.icon style={{ width: 14, height: 14 }} />{tab.label}</button>
            ))}
          </div>

          {activeTab === 'timeline' && (
            <TimelineView chapters={sortedChapters} events={graph.events} links={graph.links} linkingFrom={linkingFrom} onEdit={handleEditEvent} onDelete={handleDeleteEvent} onStartLink={handleStartLink} onFinishLink={handleFinishLink} onDeleteLink={handleDeleteLink} getEventsByChapter={getEventsByChapter} getLinkedEvents={getLinkedEvents} />
          )}
          {activeTab === 'foreshadowing' && (
            <ForeshadowChainView events={graph.events} links={graph.links} onDeleteLink={handleDeleteLink} getLinkedEvents={getLinkedEvents} />
          )}
          {activeTab === 'consistency' && (
            <ConflictDetectionView conflicts={conflicts} summary={conflictSummary} chapterCount={sortedChapters.length} analysisCount={chapterAnalyses.filter(c => c.analysis).length} />
          )}
          {activeTab === 'emotion' && (
            <EmotionCurveView emotions={graph.emotions} />
          )}
          {activeTab === 'presence' && (
            <PresenceHeatmapView presences={graph.presences} characters={characters} chapters={sortedChapters} />
          )}
          {activeTab === 'rhythm' && (
            <RhythmAnalysisView rhythms={graph.rhythms} />
          )}
          {activeTab === 'plotline' && (
            <PlotlineManagerView plotlines={graph.plotlines} chapterPlotlines={graph.chapterPlotlines} chapters={sortedChapters} onUpdate={async (pls: any) => { const ng = { ...graph, plotlines: pls }; setGraph(ng); await saveGraph(ng) }} onScanPlotlines={async () => {}} />
          )}
          {activeTab === 'pov' && (
            <POVTrackingView povs={graph.povs} characters={characters} chapters={sortedChapters} />
          )}
          {activeTab === 'growth' && (
            <GrowthTimelineView tracks={graph.growthTracks} entries={graph.growthEntries} novelType={graph.novelType} characters={characters} chapters={sortedChapters} onUpdateTracks={async (tracks: any) => { const ng = { ...graph, growthTracks: tracks }; setGraph(ng); await saveGraph(ng) }} onUpdateNovelType={async (nt: any) => { const ng = { ...graph, novelType: nt }; setGraph(ng); await saveGraph(ng) }} onAddEntry={async (entry: any) => { const ng = { ...graph, growthEntries: [...graph.growthEntries, entry] }; setGraph(ng); await saveGraph(ng) }} onUpdateEntry={async (entry: any) => { const ng = { ...graph, growthEntries: graph.growthEntries.map((e: any) => e.id === entry.id ? entry : e) }; setGraph(ng); await saveGraph(ng) }} onDeleteEntry={async (id: any) => { const ng = { ...graph, growthEntries: graph.growthEntries.filter((e: any) => e.id !== id) }; setGraph(ng); await saveGraph(ng) }} />
          )}
          {activeTab === 'timeFlow' && (
            <TimeFlowView chapters={sortedChapters} />
          )}
          {activeTab === 'coOccurrence' && (
            <CoOccurrenceView chapters={sortedChapters} />
          )}
          {activeTab === 'romanceProgress' && (
            <RomanceProgressView chapters={sortedChapters} />
          )}
          {activeTab === 'cultivationProgress' && (
            <CultivationProgressView chapters={sortedChapters} />
          )}
        </ScrollArea>
      </div>

      {/* Event edit modal */}
      <Modal isOpen={showEventModal} onClose={() => { setShowEventModal(false); setEditingEvent(null) }} title={editingEvent?.id && graph.events.some(e => e.id === editingEvent.id) ? '编辑事件' : '新建事件'} width={520}>
        {editingEvent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div><div style={fieldLabel}>类型</div>
              <select value={editingEvent.type} onChange={e => setEditingEvent({ ...editingEvent, type: e.target.value as StoryEvent['type'] })} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, width: '100%' }}>
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><div style={fieldLabel}>时间标签</div><input value={editingEvent.timeLabel} onChange={e => setEditingEvent({ ...editingEvent, timeLabel: e.target.value })} placeholder="如: 第3天·夜晚" style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, width: '100%' }} /></div>
            <div><div style={fieldLabel}>地点</div><input value={editingEvent.location} onChange={e => setEditingEvent({ ...editingEvent, location: e.target.value })} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, width: '100%' }} /></div>
            <div><div style={fieldLabel}>角色</div><input value={editingEvent.characters.join(', ')} onChange={e => setEditingEvent({ ...editingEvent, characters: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, width: '100%' }} /></div>
            <div><div style={fieldLabel}>摘要</div><textarea value={editingEvent.summary} onChange={e => setEditingEvent({ ...editingEvent, summary: e.target.value })} rows={3} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
              <Button variant="secondary" onClick={() => { setShowEventModal(false); setEditingEvent(null) }}>取消</Button>
              <Button onClick={handleSaveEvent}>保存</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ====================== Tab Components (reused from original) ======================
// The following tab view functions are kept from the original implementation.
// They receive data as props and are 100% independent of project/store.

function TimelineView({ chapters, events, links, linkingFrom, onEdit, onDelete, onStartLink, onFinishLink, onDeleteLink, getEventsByChapter, getLinkedEvents }: any) {
  if (chapters.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无章节数据，请先导入 TXT</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {chapters.map((ch: any) => {
        const evs = getEventsByChapter(ch.id)
        return (
          <div key={ch.id} style={{ padding: '14px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>第{ch.order + 1}章 {ch.title}</div>
            {evs.length === 0 && <div style={{ fontSize: 11, color: '#9b8e84' }}>暂无事件</div>}
            {evs.map((ev: any) => {
              const isForeshadow = ev.type === 'foreshadowing'
              const linked = links.filter((l: any) => l.sourceEventId === ev.id || l.targetEventId === ev.id)
              return (
                <div key={ev.id} style={{ padding: '8px 12px', borderRadius: 8, background: isForeshadow ? 'rgba(245,158,11,0.04)' : 'rgba(59,130,246,0.04)', marginBottom: 4, borderLeft: `3px solid ${EVENT_TYPE_COLORS[ev.type] || '#9b8e84'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                    <span><span style={{ fontWeight: 600, color: EVENT_TYPE_COLORS[ev.type] || '#6b5e54' }}>{EVENT_TYPE_LABELS[ev.type] || ev.type}</span> {ev.timeLabel && <span style={{ color: '#9b8e84', marginLeft: 8 }}>{ev.timeLabel}</span>}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {linkingFrom && <button onClick={() => onFinishLink(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex', borderRadius: 6 }}>🔗</button>}
                      {!linkingFrom && <button onClick={() => onStartLink(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex', borderRadius: 6 }}><LinkIcon style={{ width: 12, height: 12 }} /></button>}
                      <button onClick={() => onEdit(ev)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', display: 'flex', borderRadius: 6 }}><PencilIcon style={{ width: 12, height: 12 }} /></button>
                      <button onClick={() => onDelete(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444', display: 'flex', borderRadius: 6 }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#4a3f38', marginTop: 4 }}>{ev.summary}</div>
                  {ev.characters?.length > 0 && <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>角色: {ev.characters.join('、')}</div>}
                  {linked.length > 0 && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>{linked.map((l: any) => { const src = getLinkedEvents(l)?.source; const tgt = getLinkedEvents(l)?.target; return src && tgt ? (ev.id === l.sourceEventId ? `→ 回收: ${tgt.summary?.slice(0, 40)}` : `← 伏笔: ${src.summary?.slice(0, 40)}`) : '' }).filter(Boolean).join(' | ')}</div>}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function ForeshadowChainView({ events, links, onDeleteLink, getLinkedEvents }: any) {
  const fEvents = events.filter((e: any) => e.type === 'foreshadowing' || e.type === 'payoff')
  const chains = links.filter((l: any) => l.type === 'foreshadowing').map((l: any) => ({ link: l, src: getLinkedEvents(l)?.source, tgt: getLinkedEvents(l)?.target })).filter((c: any) => c.src && c.tgt)
  if (chains.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无伏笔链数据</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {chains.map(({ link, src, tgt }: any, i: number) => (
        <div key={link.id} style={{ padding: '12px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, fontSize: 11 }}>
            <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 4 }}>🌱 第{src.chapterOrder}章: {src.summary?.slice(0, 60)}</div>
            <div style={{ color: '#16a34a', fontWeight: 600 }}>✅ 第{tgt.chapterOrder}章: {tgt.summary?.slice(0, 60)}</div>
          </div>
          <button onClick={() => onDeleteLink(link.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444', display: 'flex', borderRadius: 6 }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
        </div>
      ))}
      {fEvents.filter((e: any) => !chains.some((c: any) => c.link.sourceEventId === e.id || c.link.targetEventId === e.id) && e.type === 'foreshadowing').map((e: any) => (
        <div key={e.id} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.04)', fontSize: 11, color: '#ef4444' }}>⚠ 未回收伏笔: 第{e.chapterOrder}章 {e.summary?.slice(0, 60)}</div>
      ))}
    </div>
  )
}

function EmotionCurveView({ emotions }: { emotions: ChapterEmotion[] }) {
  if (emotions.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无情绪数据</div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {EMOTION_LINES.map(el => (
          <label key={el.key} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: el.color, display: 'inline-block' }} />{el.label}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {emotions.sort((a, b) => a.chapterOrder - b.chapterOrder).map((em, i) => (
          <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
            <span style={{ fontWeight: 600, color: '#7c3aed', marginRight: 8 }}>第{em.chapterOrder}章</span>
            {EMOTION_LINES.map(el => <span key={el.key} style={{ marginRight: 12, color: el.color }}>{el.label}: {(em.scores as any)[el.key]}</span>)}
            <span style={{ color: '#6b5e54', marginLeft: 8 }}>{em.summary}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PresenceHeatmapView({ presences, characters, chapters }: any) {
  if (presences.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无出场数据</div>
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ fontSize: 10, borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ padding: 4, position: 'sticky', left: 0, background: '#fff' }}>角色</th>{chapters.map((ch: any) => <th key={ch.id} style={{ padding: 4, writingMode: 'vertical-rl', fontSize: 9 }}>{ch.title?.slice(0, 6)}</th>)}</tr></thead>
        <tbody>{presences.map((p: any, i: number) => (
          <tr key={i}>{p.characters?.map((c: any, j: number) => <td key={j} style={{ padding: 4, textAlign: 'center', background: `rgba(124,58,237,${Math.min(c.mentionCount * 0.2, 0.9)})`, color: c.mentionCount > 2 ? '#fff' : '#2d2520', fontSize: 9 }}>{c.mentionCount}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function RhythmAnalysisView({ rhythms }: { rhythms: ChapterRhythm[] }) {
  if (rhythms.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无节奏数据</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rhythms.sort((a, b) => a.chapterOrder - b.chapterOrder).map((r, i) => (
        <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11, display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: '#7c3aed', minWidth: 50 }}>第{r.chapterOrder}章</span>
          <span>对话: {r.metrics.dialogueRatio}%</span><span>描写: {r.metrics.descriptionRatio}%</span><span>动作: {r.metrics.actionRatio}%</span>
          <span style={{ color: '#9b8e84' }}>节奏: {r.metrics.paceScore}</span>
        </div>
      ))}
    </div>
  )
}

function PlotlineManagerView({ plotlines, chapterPlotlines, chapters, onUpdate, onScanPlotlines }: any) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {PLOTLINE_COLORS.map((color, i) => (
          <div key={i} style={{ width: 16, height: 16, borderRadius: 4, background: color }} />
        ))}
      </div>
      {plotlines.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无支线数据</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chapters.map((ch: any, i: number) => {
            const cpl = chapterPlotlines.find((cp: any) => cp.chapterId === ch.id)
            return (
              <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: '#7c3aed', marginRight: 12 }}>第{ch.order + 1}章</span>
                {plotlines.map((pl: any, j: number) => {
                  const ip = cpl?.plotlines?.find((p: any) => p.plotlineId === pl.id)
                  return <span key={j} style={{ marginRight: 12, color: PLOTLINE_COLORS[j] }}>{pl.name}: {ip?.intensity ?? '-'}</span>
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function POVTrackingView({ povs, characters, chapters }: any) {
  if (povs.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无POV数据</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {povs.sort((a: any, b: any) => a.chapterOrder - b.chapterOrder).map((p: any, i: number) => (
        <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
          <span style={{ fontWeight: 600, color: '#7c3aed', marginRight: 8 }}>第{p.chapterOrder}章</span>
          <span>POV: {p.primaryPOV?.characterName || '未知'}</span>
          <span style={{ marginLeft: 8, color: p.hasHeadHopping ? '#ef4444' : '#16a34a' }}>{p.hasHeadHopping ? '⚠ 视角跳跃' : '✓'}</span>
        </div>
      ))}
    </div>
  )
}

function GrowthTimelineView({ tracks, entries, characters, chapters, onUpdateTracks, onUpdateNovelType, onAddEntry, onUpdateEntry, onDeleteEntry, novelType }: any) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <select value={novelType} onChange={e => onUpdateNovelType(e.target.value)} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12 }}>
          <option value="">选择小说类型</option>
          {Object.entries(GENRE_TRACK_PRESETS).map(([k, v]: [string, any]) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      {tracks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>请先选择小说类型以配置成长维度</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.sort((a: any, b: any) => a.chapterOrder - b.chapterOrder).map((e: any, i: number) => (
            <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#faf9f8', fontSize: 11 }}>
              <span style={{ fontWeight: 600, color: '#7c3aed', marginRight: 8 }}>第{e.chapterOrder}章</span>
              <span>{e.characterName}</span>
              <span style={{ marginLeft: 8, color: CHANGE_COLORS[e.change] || '#6b5e54' }}>{CHANGE_LABELS[e.change] || e.change}: {e.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ConflictDetectionView({ conflicts, summary, chapterCount, analysisCount }: {
  conflicts: { type: string; severity: string; chapterA: number; chapterB: number; summary: string; evidence: string; suggestion: string }[]
  summary: string; chapterCount: number; analysisCount: number
}) {
  const TYPE_LABELS: Record<string, { label: string; icon: string }> = {
    character_death: { label: '角色生死', icon: '💀' }, level_regression: { label: '等级倒退', icon: '📉' },
    item_status: { label: '道具矛盾', icon: '🗡️' }, faction_status: { label: '势力存亡', icon: '🏛️' },
    timeline: { label: '时间线', icon: '⏰' }, relationship: { label: '角色关系', icon: '💔' },
    foreshadowing: { label: '伏笔遗漏', icon: '🔮' }, emotion: { label: '情绪断裂', icon: '🎭' },
  }
  const SEVERITY: Record<string, any> = {
    critical: { bg: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)', text: '#dc2626', badge: '严重' },
    warning: { bg: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.2)', text: '#e67e00', badge: '警告' },
    info: { bg: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.2)', text: '#3b82f6', badge: '提示' },
  }
  if (conflicts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
        {analysisCount === 0 ? <div style={{ fontSize: 14 }}>请先导入 TXT 并点击"逐章分析"，然后点击"冲突检测"</div> : <div style={{ fontSize: 14 }}>🎉 暂未检测到冲突，已分析 {analysisCount}/{chapterCount} 章</div>}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {summary && <div style={{ fontSize: 12, padding: '10px 14px', borderRadius: 10, background: '#faf9f8', marginBottom: 4 }}>{summary}</div>}
      {conflicts.map((c, i) => {
        const info = TYPE_LABELS[c.type] || { label: c.type, icon: '📌' }
        const sev = SEVERITY[c.severity] || SEVERITY.info
        return (
          <div key={i} style={{ padding: '14px 16px', borderRadius: 12, background: sev.bg, border: sev.border }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>{info.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: sev.text }}>{info.label}</span>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, color: sev.text, fontWeight: 600 }}>{sev.badge}</span>
              <span style={{ fontSize: 11, color: '#9b8e84' }}>第{c.chapterA}章 ⟷ 第{c.chapterB}章</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>{c.summary}</div>
            <div style={{ fontSize: 11, color: '#6b5e54', lineHeight: 1.6 }}>📎 {c.evidence}</div>
            <div style={{ fontSize: 11, color: '#16a34a', lineHeight: 1.6 }}>💡 {c.suggestion}</div>
          </div>
        )
      })}
    </div>
  )
}

function TimeFlowView({ chapters }: { chapters: DetailedChapter[] }) {
  if (chapters.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无章节</div>
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>时间流速</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>基于章节描述中的时间线索</div>
      {chapters.map((ch, i) => (
        <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderRadius: 8, background: i % 2 === 0 ? '#faf9f8' : '#fff', fontSize: 11 }}>
          <span style={{ fontWeight: 600, minWidth: 50, color: '#7c3aed' }}>第{i + 1}章</span>
          <span style={{ flex: 1 }}>{ch.title}</span>
          <span style={{ color: '#9b8e84' }}>{ch.description?.match(/(\d+[天日月年])/) || '?'}</span>
        </div>
      ))}
    </div>
  )
}

function CoOccurrenceView({ chapters }: { chapters: DetailedChapter[] }) {
  const coMap = new Map<string, number>()
  chapters.forEach(ch => {
    const names = (ch.description || '').match(/[：:]\s*(.+)/)?.[1]?.split(/[,，、]/)?.map((s: string) => s.trim()).filter(Boolean) || []
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const key = [names[i], names[j]].sort().join('|||')
      coMap.set(key, (coMap.get(key) || 0) + 1)
    }
  })
  const pairs = [...coMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => { const [a, b] = k.split('|||'); return { charA: a, charB: b, coCount: v } })
  if (pairs.length === 0) return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>暂无角色共现数据。请在细纲描述中为各章添加角色信息。</div>
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>角色共现网络</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {pairs.map((p, i) => (
          <div key={i} style={{ padding: '8px 12px', borderRadius: 10, background: `rgba(124,58,237,${0.04 + p.coCount * 0.03})`, border: '1px solid rgba(124,58,237,0.1)', fontSize: 11 }}>
            <span style={{ fontWeight: 600, color: '#7c3aed' }}>{p.charA}</span><span style={{ color: '#9b8e84', margin: '0 4px' }}>+</span><span style={{ fontWeight: 600, color: '#7c3aed' }}>{p.charB}</span><span style={{ marginLeft: 8, color: '#6b5e54' }}>共现 {p.coCount} 章</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RomanceProgressView({ chapters }: { chapters: DetailedChapter[] }) {
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>感情线进度</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>基于章节细纲描述中的角色标注</div>
      {chapters.map((ch, i) => (
        <div key={ch.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 12px', borderRadius: 8, background: i % 2 === 0 ? 'rgba(236,72,153,0.03)' : '#fff', border: '1px solid rgba(236,72,153,0.06)', fontSize: 11, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, minWidth: 50, color: '#ec4899' }}>第{i + 1}章</span>
          <div><div style={{ fontWeight: 600 }}>{ch.title}</div><div style={{ color: '#6b5e54' }}>角色: {ch.description?.match(/[：:]\s*(.+)/)?.[1] || '未标注'}</div></div>
        </div>
      ))}
    </div>
  )
}

function CultivationProgressView({ chapters }: { chapters: DetailedChapter[] }) {
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>修炼进度</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>基于章节细纲描述中的等级信息</div>
      {chapters.map((ch, i) => {
        const lm = (ch.description || '').match(/突破[至到]?\s*(\S+)/)
        return (
          <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderRadius: 8, background: i % 2 === 0 ? 'rgba(22,163,74,0.03)' : '#fff', border: '1px solid rgba(22,163,74,0.06)', fontSize: 11, marginBottom: 2 }}>
            <span style={{ fontWeight: 600, minWidth: 50, color: '#16a34a' }}>第{i + 1}章</span>
            <span style={{ flex: 1 }}>{ch.title}</span>
            {lm && <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(22,163,74,0.08)', color: '#16a34a', fontWeight: 600 }}>{lm[1]}</span>}
          </div>
        )
      })}
    </div>
  )
}
