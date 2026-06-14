import { useEffect, useRef, useState } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { fileService, aiService, appService, extractionService } from '@/services/fileService'
import { chatAI } from '@/utils/chatAI'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { logError } from '@/utils/logger'
import { safeJsonParseAs } from '@/utils/safeJsonParse'
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
import { detectHardConflicts, SettingTimelineView } from './appendix'

const EMPTY_GRAPH: StoryGraph = { events: [], links: [], snapshots: [], emotions: [], presences: [], rhythms: [], plotlines: [], chapterPlotlines: [], povs: [], growthTracks: [], growthEntries: [], timeFlow: [], coOccurrence: null, romanceProgress: [], cultivationProgress: [], generatedAt: '', scannedChapterIds: [], scannedChapterHashes: {}, novelType: '' }

export default function StoryMapPage() {
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const setActivePage = useStore(s => s.setActivePage)
  const fileVersion = useStore(s => s.fileVersion)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

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
  const [chapterAnalyses, setChapterAnalyses] = useState<{ chapterOrder: number; chapterTitle: string; analysis: string; snapshots?: any }[]>([])
  const [conflicts, setConflicts] = useState<{ type: string; severity: string; chapterA: number; chapterB: number; summary: string; evidence: string; suggestion: string }[]>([])
  const [conflictSummary, setConflictSummary] = useState('')
  const [conflictDetecting, setConflictDetecting] = useState(false)

  const [editingEvent, setEditingEvent] = useState<StoryEvent | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null)
  const [consistencyCharId, setConsistencyCharId] = useState('')

  const characters: Character[] = [] // Story Map doesn't need character library
  const sortedChapters = [...detailedChapters].sort((a, b) => a.order - b.order)

  // Initialize + reload on file version bump
  useEffect(() => {
    setActivePage('story-map')
    appService.getStoryWorkspacePath().then(async (pp: string) => {
      setWorkspacePath(pp)
      await fileService.ensureDir(pp)
      await fileService.ensureDir(`${pp}/chapters`)
      await fileService.ensureDir(`${pp}/detailed_outline`)
      loadDetailedChapters(pp).then(setDetailedChapters)
      loadGraph(pp)
    })
  }, [fileVersion])

  // Targeted refresh when AI edits story map files
  useEffect(() => {
    if (!fileEditNotify || !workspacePath) return
    const normalized = fileEditNotify.filePath.replace(/\\/g, '/').toLowerCase()
    const ws = workspacePath.replace(/\\/g, '/').toLowerCase()
    // fileEditNotify uses project-relative paths; extract workspace name for matching
    const wsName = ws.split('/').filter(Boolean).pop() || ''
    if (normalized.startsWith(wsName + '/') || normalized.includes('/chapters/') || normalized.includes('/detailed_outline/')) {
      loadDetailedChapters(workspacePath).then(setDetailedChapters)
      loadGraph(workspacePath)
      setFileEditNotify(null)
    }
  }, [fileEditNotify, workspacePath])

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
    const results: { chapterOrder: number; chapterTitle: string; analysis: string; snapshots?: any }[] = []
    try {
      for (let i = 0; i < sortedChapters.length; i++) {
        const ch = sortedChapters[i]
        setChapterAnalysisProgress(`分析中 ${i + 1}/${sortedChapters.length}: ${ch.title}`)
        let content = ''
        try { content = await fileService.read(`${workspacePath}/chapters/${ch.id}.txt`) } catch { content = ch.description || '' }
        if (!content) { results.push({ chapterOrder: ch.order + 1, chapterTitle: ch.title, analysis: '' }); continue }
        const prompt = continuationService.buildChapterAnalysisPrompt(ch.title, content, ch.order + 1)
        try {
          const reply = await chatAI([{ role: 'user', content: prompt }], activeConfigId)
          let snaps: any = null
          const p = safeJsonParseAs<{ characterSnapshots?: any[]; itemSnapshots?: any[]; factionSnapshots?: any[]; locationSnapshots?: any[] }>(reply); if (p) { snaps = { characterSnapshots: p.characterSnapshots || [], itemSnapshots: p.itemSnapshots || [], factionSnapshots: p.factionSnapshots || [], locationSnapshots: p.locationSnapshots || [] } }
          results.push({ chapterOrder: ch.order + 1, chapterTitle: ch.title, analysis: reply, snapshots: snaps })
        } catch { results.push({ chapterOrder: ch.order + 1, chapterTitle: ch.title, analysis: '' }) }
      }
    } catch (err) { logError('逐章分析失败', err) }
    setChapterAnalyses(results)
    setChapterAnalysisProgress('')
    setChapterAnalysisRunning(false)
    alert(`分析完成: ${results.filter(r => r.analysis).length}/${results.length} 章`)
  }

  // ---- Conflict Detection (hard rules + AI soft rules) ----
  const handleDetectConflicts = async () => {
    if (!activeConfigId || chapterAnalyses.length === 0) return
    const valid = chapterAnalyses.filter(c => c.analysis)
    if (valid.length === 0) return
    setConflictDetecting(true)
    // Phase 1: Hard rule engine (code-based, 100% accurate)
    const hardConflicts = detectHardConflicts(valid)
    // Phase 2: AI soft rule detection
    let aiConflicts: any[] = []
    let summary = ''
    try {
      const summaries = valid.map(c => `第${c.chapterOrder}章 ${c.chapterTitle}:\n${c.analysis}`)
      const hardResult = hardConflicts.length > 0 ? `已由硬规则引擎检测到以下冲突:\n${hardConflicts.map(c => `- ${c.summary}`).join('\n')}\n\n请检测除此之外的软规则冲突:` : ''
      const prompt = continuationService.buildConflictDetectionPrompt(summaries, sortedChapters.length) + '\n' + hardResult
      const reply = await chatAI([{ role: 'user', content: prompt }], activeConfigId)
      const data = safeJsonParseAs<{ conflicts: any[]; summary: string }>(reply)
      if (data) {
        aiConflicts = data.conflicts || []
        summary = data.summary || ''
      }
    } catch (err) { logError('冲突检测失败', err) }
    // Merge results
    setConflicts([...hardConflicts, ...aiConflicts])
    setConflictSummary(summary)
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
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} className="interactive-accent" style={{
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
            <TimelineTab chapters={sortedChapters} events={graph.events} links={graph.links} linkingFrom={linkingFrom} onEdit={handleEditEvent} onDelete={handleDeleteEvent} onStartLink={handleStartLink} onFinishLink={handleFinishLink} onDeleteLink={handleDeleteLink} getEventsByChapter={getEventsByChapter} getLinkedEvents={getLinkedEvents} />
          )}
          {activeTab === 'foreshadowing' && (
            <ForeshadowChainTab events={graph.events} links={graph.links} onDeleteLink={handleDeleteLink} getLinkedEvents={getLinkedEvents} />
          )}
          {activeTab === 'consistency' && (
            <ConsistencyTab conflicts={conflicts} summary={conflictSummary} chapterCount={sortedChapters.length} analysisCount={chapterAnalyses.filter(c => c.analysis).length} />
          )}
          {activeTab === 'emotion' && (
            <EmotionCurveTab emotions={graph.emotions} />
          )}
          {activeTab === 'presence' && (
            <PresenceTab presences={graph.presences} characters={characters} chapters={sortedChapters} />
          )}
          {activeTab === 'rhythm' && (
            <RhythmTab rhythms={graph.rhythms} />
          )}
          {activeTab === 'plotline' && (
            <PlotlineTab plotlines={graph.plotlines} chapterPlotlines={graph.chapterPlotlines} chapters={sortedChapters} onUpdate={async (pls: any) => { const ng = { ...graph, plotlines: pls }; setGraph(ng); await saveGraph(ng) }} onScanPlotlines={async () => {}} />
          )}
          {activeTab === 'pov' && (
            <POVTab povs={graph.povs} characters={characters} chapters={sortedChapters} />
          )}
          {activeTab === 'growth' && (
            <GrowthTab tracks={graph.growthTracks} entries={graph.growthEntries} novelType={graph.novelType} characters={characters} chapters={sortedChapters} onUpdateTracks={async (tracks: any) => { const ng = { ...graph, growthTracks: tracks }; setGraph(ng); await saveGraph(ng) }} onUpdateNovelType={async (nt: any) => { const ng = { ...graph, novelType: nt }; setGraph(ng); await saveGraph(ng) }} onAddEntry={async (entry: any) => { const ng = { ...graph, growthEntries: [...graph.growthEntries, entry] }; setGraph(ng); await saveGraph(ng) }} onUpdateEntry={async (entry: any) => { const ng = { ...graph, growthEntries: graph.growthEntries.map((e: any) => e.id === entry.id ? entry : e) }; setGraph(ng); await saveGraph(ng) }} onDeleteEntry={async (id: any) => { const ng = { ...graph, growthEntries: graph.growthEntries.filter((e: any) => e.id !== id) }; setGraph(ng); await saveGraph(ng) }} />
          )}
          {activeTab === 'settingTimeline' && (
            <SettingTimelineView analyses={chapterAnalyses} />
          )}
          {activeTab === 'timeFlow' && (
            <TimeFlowTab chapters={sortedChapters} />
          )}
          {activeTab === 'coOccurrence' && (
            <CoOccurrenceTab chapters={sortedChapters} />
          )}
          {activeTab === 'romanceProgress' && (
            <RomanceProgressTab chapters={sortedChapters} />
          )}
          {activeTab === 'cultivationProgress' && (
            <CultivationProgressTab chapters={sortedChapters} />
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


import { TimelineTab } from './tabs/TimelineTab';
import { ForeshadowChainTab } from './tabs/ForeshadowChainTab';
import { EmotionCurveTab } from './tabs/EmotionCurveTab';
import { PresenceTab } from './tabs/PresenceTab';
import { RhythmTab } from './tabs/RhythmTab';
import { PlotlineTab } from './tabs/PlotlineTab';
import { POVTab } from './tabs/POVTab';
import { GrowthTab } from './tabs/GrowthTab';
import { ConsistencyTab } from './tabs/ConsistencyTab';
import { TimeFlowTab } from './tabs/TimeFlowTab';
import { CoOccurrenceTab } from './tabs/CoOccurrenceTab';
import { RomanceProgressTab } from './tabs/RomanceProgressTab';
import { CultivationProgressTab } from './tabs/CultivationProgressTab';

