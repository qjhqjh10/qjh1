import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { fileService, aiService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import { logError } from '@/utils/logger'
import { loadCharacters } from '@/services/characterService'
import { loadDetailedChapters } from '@/services/chapterService'
import { loadOutlineContent } from '@/services/outlineService'
import type { Character } from '@/types/character'
import type { DetailedChapter } from '@/types/chapter'
import type { StoryEvent, StoryLink, CharacterSnapshot, StoryGraph, ChapterEmotion, CharacterPresence, ChapterRhythm, ChapterPlotline, ChapterPOV, Plotline, GrowthTrack, GrowthEntry } from '@/types/story'
import { GENRE_TRACK_PRESETS } from '@/types/story'
import {
  SparklesIcon, PlusIcon, TrashIcon, PencilIcon, XMarkIcon,
  ClockIcon, LinkIcon, ShieldCheckIcon, MagnifyingGlassIcon,
  MapPinIcon, UserIcon, FlagIcon, ArrowRightIcon, ChartBarIcon,
  EyeIcon, TableCellsIcon, ArrowsRightLeftIcon, Bars3Icon, ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline'
import type { TabKey } from './constants'
import { TABS, EVENT_TYPE_LABELS, EVENT_TYPE_COLORS, EMPTY_EVENT, EMOTION_LINES, PLOTLINE_COLORS, POV_TYPE_LABELS, CHANGE_LABELS, CHANGE_COLORS } from './constants'
import { fieldLabel, linkBtn, iconBtn } from './styles'

export default function StoryMapPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const detailedChapters = useStore(s => s.detailedChapters)
  const writingChapters = useStore(s => s.writingChapters)
  const setDetailedChapters = useStore(s => s.setDetailedChapters)
  const outlineContent = useStore(s => s.outlineContent)
  const characters = useStore(s => s.characters)
  const setCharacters = useStore(s => s.setCharacters)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)

  const [projectPath, setProjectPath] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('timeline')
  const [graph, setGraph] = useState<StoryGraph>({ events: [], links: [], snapshots: [], emotions: [], presences: [], rhythms: [], plotlines: [], chapterPlotlines: [], povs: [], growthTracks: [], growthEntries: [], timeFlow: [], coOccurrence: null, romanceProgress: [], cultivationProgress: [], generatedAt: '', scannedChapterIds: [], scannedChapterHashes: {}, novelType: '' })
  const graphRef = useRef(graph)
  graphRef.current = graph

  // AI scan
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanProgress, setScanProgress] = useState('')

  // Event edit
  const [editingEvent, setEditingEvent] = useState<StoryEvent | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)

  // Link edit
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null)

  // Consistency: selected character
  const [consistencyCharId, setConsistencyCharId] = useState('')

  // Build chapter lookup
  const chapterMap = new Map(detailedChapters.map(c => [c.id, c]))
  const sortedChapters = [...detailedChapters].sort((a, b) => a.order - b.order)

  // Detect new / modified chapters
  const newChapterIds = sortedChapters.filter(c => !graph.scannedChapterIds.includes(c.id)).map(c => c.id)
  const modifiedChapterIds = sortedChapters.filter(c => {
    if (!graph.scannedChapterIds.includes(c.id)) return false
    const wc = writingChapters[c.id]
    if (!wc?.content) return false
    const storedLen = graph.scannedChapterHashes[c.id]
    return storedLen !== undefined && storedLen !== wc.content.length
  }).map(c => c.id)
  const pendingCount = newChapterIds.length + modifiedChapterIds.length

  useEffect(() => {
    if (!activeProjectId) { navigate('/'); return }
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)

    // Load outline if needed
    if (!outlineContent) {
      loadOutlineContent(pp).then(c => {
        if (c) useStore.getState().setOutlineContent(c)
      })
    }

    // Load detailed chapters
    loadDetailedChapters(pp).then(setDetailedChapters)

    // Load characters
    loadCharacters(pp).then(setCharacters)

    // Load story graph
    loadGraph(pp)
  }, [activeProjectId, projectsBasePath])

  const loadGraph = async (pp: string) => {
    try {
      const raw = await fileService.read(`${pp}/story_graph.json`)
      if (raw) {
        const data = JSON.parse(raw) as StoryGraph
        // If tracks key is missing entirely, init with empty (type selector will show)
        if (!data.growthTracks) {
          data.growthTracks = []
          data.growthEntries = data.growthEntries || []
        }
        data.timeFlow = data.timeFlow || []
        data.coOccurrence = data.coOccurrence || null
        data.romanceProgress = data.romanceProgress || []
        data.cultivationProgress = data.cultivationProgress || []
        setGraph(data)
        // Auto-select first character for consistency view
        if (data.snapshots.length > 0 && !consistencyCharId) {
          const firstCharId = data.snapshots[0]?.characterId
          if (firstCharId) setConsistencyCharId(firstCharId)
        }
      }
    } catch { /* no saved graph */ }
  }

  const saveGraph = async (data: StoryGraph) => {
    if (!projectPath) return
    try {
      await fileService.write(`${projectPath}/story_graph.json`, JSON.stringify(data, null, 2))
    } catch (err) {
      logError('保存故事脉络数据失败', err)
    }
  }

  // ---- AI Scan ----
  const handleAIScan = async (chapterIds: string[]) => {
    if (scanLoading) return // concurrency guard
    const genConfigId = activeConfigId
    if (!genConfigId) { setScanError('请先配置 AI 模型'); return }
    if (chapterIds.length === 0) { setScanError('请选择要扫描的章节'); return }

    setScanLoading(true)
    setScanError('')
    setScanProgress(`正在分析 ${chapterIds.length} 个章节...`)

    try {
      // Collect chapter contents
      const chapterData = chapterIds.map(id => {
        const dc = chapterMap.get(id)
        const wc = writingChapters[id]
        return {
          id,
          title: dc?.title || '未命名',
          order: dc?.order ?? 0,
          description: dc?.description || '',
          content: wc?.content || '',
        }
      }).filter(c => c.content || c.description)

      if (chapterData.length === 0) { setScanError('所选章节均无内容'); setScanLoading(false); return }

      // Build character reference
      const charRef = characters.map(c => ({
        id: c.id,
        name: c.name,
        role: c.role,
        personality: c.personality?.slice(0, 100) || '',
        appearance: c.appearance?.slice(0, 100) || '',
      }))

      const typeHints: Record<string, string> = {
        '仙侠/玄幻': '这是一部仙侠/玄幻小说。请侧重关注: 角色境界突破、法宝丹药获得、功法技能修炼、门派身份变化。',
        '都市/现实': '这是一部都市小说。请侧重关注: 角色职业发展、资产财富变化、社交圈层变动、情感状态起伏。',
        '恋爱/言情': '这是一部恋爱小说。请侧重关注: 男女主感情阶段变化、好感度提升、情敌干扰、关系确认节点。',
        '悬疑/推理': '这是一部悬疑小说。请侧重关注: 线索收集、嫌疑人圈变化、真相揭露进展、危险等级。',
        '后宫': '这是一部后宫小说。请侧重关注: 新角色加入、好感度变化、修罗场冲突、关系阶段确认。',
        '科幻': '这是一部科幻小说。请侧重关注: 科技等级提升、装备升级、组织地位变化、星际位置迁移。',
      }
      const typeHint = typeHints[graph.novelType] || (graph.novelType ? `这是一部${graph.novelType}类型的小说。` : '')
      const prompt = `你是小说分析专家。${typeHint ? '\n\n' + typeHint + '\n' : ''}请分析以下章节内容，提取四类信息，输出严格 JSON（不要 markdown）：

{
  "events": [
    { "id": "唯一ID", "type": "event|foreshadowing|payoff", "timeLabel": "第X章/三日后/十年前", "chapterId": "章节ID", "chapterTitle": "章节标题", "characters": ["角色名"], "location": "地点", "summary": "事件简述(30字内)", "quote": "原文关键句(可选,20字内)" }
  ],
  "links": [
    { "sourceEventId": "埋设事件ID", "targetEventId": "回收事件ID", "type": "foreshadowing|causality|reference", "note": "关联说明" }
  ],
  "snapshots": [
    { "characterId": "角色ID", "characterName": "角色名", "chapterId": "章节ID", "chapterTitle": "章节标题", "traits": { "外貌": "描述", "身份": "描述", "性格": "描述", "状态": "描述" } }
  ],
  "emotions": [
    { "chapterId": "章节ID", "chapterTitle": "章节标题", "scores": { "tension": 5, "warmth": 3, "sadness": 2, "excitement": 7, "lightness": 4 }, "summary": "本章情绪简述" }
  ]
}

emotions 各维度说明（0-10 分）：
- tension 紧张度: 冲突、危险、悬念程度
- warmth 温情度: 温情、亲情、甜蜜程度
- sadness 悲伤度: 伤感、离别、压抑程度
- excitement 激昂度: 热血、战斗、高潮程度
- lightness 轻松度: 幽默、日常、舒缓程度

同时输出以下四类数据：

"presences": [
  { "chapterId": "章节ID", "characters": [{ "characterId": "角色ID", "characterName": "角色名", "mentionCount": 提及次数, "role": "primary|secondary|mentioned" }] }
]

"rhythms": [
  { "chapterId": "章节ID", "metrics": { "dialogueRatio": 对白占比0-100, "descriptionRatio": 描写占比0-100, "actionRatio": 动作占比0-100, "paceScore": 节奏0-10(0=极慢10=极快), "infoDensity": 信息密度0-10, "wordCount": 字数 } }
]

"povs": [
  { "chapterId": "章节ID", "primaryPOV": { "characterId": "角色ID", "characterName": "角色名" }, "secondaryFocalPoints": [], "povType": "first|third-close|third-omniscient|mixed", "hasHeadHopping": true/false, "note": "简述" }
]

"growthEntries": [
  { "characterId": "角色ID", "characterName": "角色名", "chapterId": "章节ID", "trackLabel": "等级境界", "value": "金丹期", "change": "upgrade", "note": "突破" }
]

growthEntries.change 取值：new(新增获得)、upgrade(升级提升)、downgrade(降级削弱)、lost(失去/废除)、same(维持不变，用于首章标记初始状态)
trackLabel 可选值（根据项目配置的成长维度）: ${graph.growthTracks.map(t => t.label).join('、')}

注意：presences 中每个章节列出所有出场角色（至少有一个 primary）；rhythms 的 dialogueRatio+descriptionRatio+actionRatio 总和应接近100；povs 中 primaryPOV 使用角色列表中的 ID；growthEntries 只记录明显的变化，静态状态不重复记录。
支线分析在用户定义了支线后单独进行。

角色参考列表：${JSON.stringify(charRef)}

章节列表：${JSON.stringify(chapterData.map(c => ({ id: c.id, title: c.title, order: c.order, content: c.content.slice(0, 12000), description: c.description })))}

注意：
- events.type: foreshadowing=伏笔埋设, payoff=伏笔回收, event=普通事件
- links 连接同一伏笔的埋设和回收事件
- snapshots 提取每章中每个出场角色的关键特征
- 只输出 JSON，不要包含其他文字`

      const messages = [{ role: 'user' as const, content: prompt }]
      const reply = await aiService.chat(messages, genConfigId, activeProjectId || undefined)

      // Parse
      let jsonStr = reply
      const m = reply.match(/\{[\s\S]*\}/)
      if (m) jsonStr = m[0]

      const parsed = JSON.parse(jsonStr)
      const aiEvents: StoryEvent[] = (parsed.events || []).map((e: Record<string, unknown>) => ({
        ...EMPTY_EVENT,
        id: (e.id as string) || `evt_${nanoid(8)}`,
        type: (e.type as StoryEvent['type']) || 'event',
        timeLabel: (e.timeLabel as string) || '',
        chapterId: (e.chapterId as string) || '',
        chapterOrder: chapterMap.get(e.chapterId as string)?.order ?? 0,
        chapterTitle: (e.chapterTitle as string) || '',
        characters: Array.isArray(e.characters) ? e.characters as string[] : [],
        location: (e.location as string) || '',
        summary: (e.summary as string) || '',
        quote: (e.quote as string) || '',
        source: 'ai' as const,
        createdAt: new Date().toISOString(),
      }))

      const aiLinks: StoryLink[] = (parsed.links || []).map((l: Record<string, unknown>) => ({
        id: (l.id as string) || `lnk_${nanoid(8)}`,
        sourceEventId: l.sourceEventId as string || '',
        targetEventId: l.targetEventId as string || '',
        type: (l.type as StoryLink['type']) || 'foreshadowing',
        note: (l.note as string) || '',
      }))

      const aiSnapshots: CharacterSnapshot[] = (parsed.snapshots || []).map((s: Record<string, unknown>) => ({
        characterId: (s.characterId as string) || '',
        characterName: (s.characterName as string) || '',
        chapterId: (s.chapterId as string) || '',
        chapterOrder: chapterMap.get(s.chapterId as string)?.order ?? 0,
        chapterTitle: (s.chapterTitle as string) || '',
        traits: (s.traits as Record<string, string>) || {},
      }))

      const aiEmotions: ChapterEmotion[] = (parsed.emotions || []).map((e: Record<string, unknown>) => {
        const s = (e.scores || {}) as Record<string, number>
        return {
          chapterId: (e.chapterId as string) || '',
          chapterOrder: chapterMap.get(e.chapterId as string)?.order ?? 0,
          chapterTitle: (e.chapterTitle as string) || '',
          scores: { tension: s.tension ?? 0, warmth: s.warmth ?? 0, sadness: s.sadness ?? 0, excitement: s.excitement ?? 0, lightness: s.lightness ?? 0 },
          summary: (e.summary as string) || '',
        }
      })

      const aiPresences: CharacterPresence[] = (parsed.presences || []).map((p: Record<string, unknown>) => ({
        chapterId: (p.chapterId as string) || '',
        chapterOrder: chapterMap.get(p.chapterId as string)?.order ?? 0,
        chapterTitle: (p.chapterTitle as string) || '',
        characters: Array.isArray(p.characters) ? (p.characters as Record<string, unknown>[]).map(c => ({
          characterId: (c.characterId as string) || '',
          characterName: (c.characterName as string) || '',
          mentionCount: (c.mentionCount as number) || 0,
          role: (c.role as CharacterPresence['characters'][0]['role']) || 'secondary',
        })) : [],
      }))

      const aiRhythms: ChapterRhythm[] = (parsed.rhythms || []).map((r: Record<string, unknown>) => {
        const m = (r.metrics || {}) as Record<string, number>
        return {
          chapterId: (r.chapterId as string) || '',
          chapterOrder: chapterMap.get(r.chapterId as string)?.order ?? 0,
          chapterTitle: (r.chapterTitle as string) || '',
          metrics: {
            dialogueRatio: m.dialogueRatio ?? 0,
            descriptionRatio: m.descriptionRatio ?? 0,
            actionRatio: m.actionRatio ?? 0,
            paceScore: m.paceScore ?? 5,
            infoDensity: m.infoDensity ?? 5,
            wordCount: m.wordCount ?? 0,
          },
        }
      })

      const aiGrowthEntries: GrowthEntry[] = (parsed.growthEntries || []).map((g: Record<string, unknown>) => ({
        id: `ge_${nanoid(8)}`,
        characterId: (g.characterId as string) || '',
        characterName: (g.characterName as string) || '',
        chapterId: (g.chapterId as string) || '',
        chapterOrder: chapterMap.get(g.chapterId as string)?.order ?? 0,
        chapterTitle: (g.chapterTitle as string) || '',
        trackId: graph.growthTracks.find(t => t.label === (g.trackLabel as string))?.id || (g.trackLabel as string),
        trackLabel: (g.trackLabel as string) || '',
        value: (g.value as string) || '',
        change: (g.change as GrowthEntry['change']) || 'same',
        note: (g.note as string) || '',
        source: 'ai' as const,
        createdAt: new Date().toISOString(),
      }))

      const aiPOVs: ChapterPOV[] = (parsed.povs || []).map((p: Record<string, unknown>) => {
        const pp = (p.primaryPOV || {}) as Record<string, string>
        const sf = Array.isArray(p.secondaryFocalPoints) ? (p.secondaryFocalPoints as Record<string, string>[]) : []
        return {
          chapterId: (p.chapterId as string) || '',
          chapterOrder: chapterMap.get(p.chapterId as string)?.order ?? 0,
          chapterTitle: (p.chapterTitle as string) || '',
          primaryPOV: { characterId: pp.characterId || '', characterName: pp.characterName || '' },
          secondaryFocalPoints: sf.map(f => ({ characterId: f.characterId || '', characterName: f.characterName || '' })),
          povType: (p.povType as ChapterPOV['povType']) || 'third-close',
          hasHeadHopping: (p.hasHeadHopping as boolean) || false,
          note: (p.note as string) || '',
        }
      })

      // Merge: use graphRef.current for latest state (avoids stale closure overwrites)
      const latest = graphRef.current
      const scannedSet = new Set(chapterIds)
      // Keep manual events even from re-scanned chapters
      const existingEvents = latest.events.filter(e => !scannedSet.has(e.chapterId) || e.source === 'manual')
      const existingSnapshots = latest.snapshots.filter(s => !scannedSet.has(s.chapterId))
      const existingEmotions = latest.emotions.filter(em => !scannedSet.has(em.chapterId))
      const existingPresences = latest.presences.filter(p => !scannedSet.has(p.chapterId))
      const existingRhythms = latest.rhythms.filter(r => !scannedSet.has(r.chapterId))
      const existingPOVs = latest.povs.filter(pv => !scannedSet.has(pv.chapterId))
      // Plotlines are user-defined, preserve existing
      const existingPlotlines = latest.plotlines
      const existingGrowthEntries = latest.growthEntries.filter(ge => !scannedSet.has(ge.chapterId))
      // Deduplicate growth entries: same character+trackId+chapter → keep latest
      const mergedGrowthEntries = [...existingGrowthEntries, ...aiGrowthEntries]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((ge, i, arr) => arr.findIndex(g => g.characterId === ge.characterId && g.trackId === ge.trackId && g.chapterId === ge.chapterId) === i)
      // Keep all links + preserve links referencing manual events that survive re-scan
      const allEventIds = new Set([...existingEvents.map(e => e.id), ...aiEvents.map(e => e.id)])
      const existingLinks = latest.links.filter(l => allEventIds.has(l.sourceEventId) && allEventIds.has(l.targetEventId))

      const merged: StoryGraph = {
        events: [...existingEvents, ...aiEvents].sort((a, b) => a.chapterOrder - b.chapterOrder),
        links: [...existingLinks, ...aiLinks],
        snapshots: [...existingSnapshots, ...aiSnapshots].sort((a, b) => a.chapterOrder - b.chapterOrder),
        emotions: [...existingEmotions, ...aiEmotions].sort((a, b) => a.chapterOrder - b.chapterOrder),
        presences: [...existingPresences, ...aiPresences].sort((a, b) => a.chapterOrder - b.chapterOrder),
        rhythms: [...existingRhythms, ...aiRhythms].sort((a, b) => a.chapterOrder - b.chapterOrder),
        plotlines: existingPlotlines,
        chapterPlotlines: graph.chapterPlotlines.filter(cp => !scannedSet.has(cp.chapterId)),
        povs: [...existingPOVs, ...aiPOVs].sort((a, b) => a.chapterOrder - b.chapterOrder),
        growthTracks: graph.growthTracks,
        growthEntries: mergedGrowthEntries,
        generatedAt: new Date().toISOString(),
        scannedChapterIds: [...new Set([...latest.scannedChapterIds, ...chapterIds])],
        novelType: latest.novelType,
        timeFlow: latest.timeFlow || [],
        coOccurrence: latest.coOccurrence || null,
        romanceProgress: latest.romanceProgress || [],
        cultivationProgress: latest.cultivationProgress || [],
        scannedChapterHashes: {
          ...graph.scannedChapterHashes,
          ...Object.fromEntries(chapterIds.map(id => {
            const wc = writingChapters[id]
            return [id, wc?.content?.length || 0]
          })),
        },
      }

      setGraph(merged)
      await saveGraph(merged)

      if (!consistencyCharId && merged.snapshots.length > 0) {
        setConsistencyCharId(merged.snapshots[0].characterId)
      }

      setScanProgress(`扫描完成：提取 ${aiEvents.length} 个事件、${aiLinks.length} 条关联、${aiSnapshots.length} 个状态快照`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '扫描失败'
      logError('AI 故事脉络扫描失败', err)
      setScanError(msg)
    }
    setScanLoading(false)
  }

  // ---- Event CRUD ----
  const handleNewEvent = () => {
    setEditingEvent({
      ...EMPTY_EVENT,
      id: `evt_${nanoid(8)}`,
      chapterId: sortedChapters[0]?.id || '',
      chapterTitle: sortedChapters[0]?.title || '',
      chapterOrder: sortedChapters[0]?.order ?? 0,
      createdAt: new Date().toISOString(),
    })
    setShowEventModal(true)
  }

  const handleEditEvent = (evt: StoryEvent) => {
    setEditingEvent({ ...evt })
    setShowEventModal(true)
  }

  const handleSaveEvent = async () => {
    if (!editingEvent || !editingEvent.summary.trim()) return
    const idx = graph.events.findIndex(e => e.id === editingEvent.id)
    let updated: StoryEvent[]
    if (idx >= 0) {
      updated = [...graph.events]
      updated[idx] = editingEvent
    } else {
      updated = [...graph.events, editingEvent]
    }
    const newGraph = { ...graph, events: updated }
    setGraph(newGraph)
    await saveGraph(newGraph)
    setShowEventModal(false)
    setEditingEvent(null)
  }

  const handleDeleteEvent = async (eventId: string) => {
    const newGraph: StoryGraph = {
      ...graph,
      events: graph.events.filter(e => e.id !== eventId),
      links: graph.links.filter(l => l.sourceEventId !== eventId && l.targetEventId !== eventId),
    }
    setGraph(newGraph)
    await saveGraph(newGraph)
  }

  // ---- Link ----
  const handleStartLink = (eventId: string) => {
    setLinkingFrom(linkingFrom === eventId ? null : eventId)
  }

  const handleFinishLink = async (targetEventId: string) => {
    if (!linkingFrom || linkingFrom === targetEventId) { setLinkingFrom(null); return }
    const newLink: StoryLink = {
      id: `lnk_${nanoid(8)}`,
      sourceEventId: linkingFrom,
      targetEventId,
      type: 'foreshadowing',
      note: '',
    }
    const newGraph = { ...graph, links: [...graph.links, newLink] }
    setGraph(newGraph)
    await saveGraph(newGraph)
    setLinkingFrom(null)
  }

  const handleDeleteLink = async (linkId: string) => {
    const newGraph = { ...graph, links: graph.links.filter(l => l.id !== linkId) }
    setGraph(newGraph)
    await saveGraph(newGraph)
  }

  // Quick scan: auto-select new + modified chapters
  const handleQuickScan = () => {
    const ids = [...new Set([...newChapterIds, ...modifiedChapterIds])]
    if (ids.length > 0) {
      handleAIScan(ids)
    } else {
      handleAIScan(sortedChapters.map(c => c.id))
    }
  }

  // ---- Helpers ----
  const getEventsByChapter = (chapterId: string) =>
    graph.events.filter(e => e.chapterId === chapterId).sort((a, b) => a.type === 'foreshadowing' ? -1 : 1)

  const getLinkedEvents = (link: StoryLink) => ({
    source: graph.events.find(e => e.id === link.sourceEventId),
    target: graph.events.find(e => e.id === link.targetEventId),
  })

  // Characters for consistency filter
  const charIds = [...new Set(graph.snapshots.map(s => s.characterId))]
  const charSnapshots = graph.snapshots.filter(s => s.characterId === consistencyCharId)
  const allTraitKeys = [...new Set(charSnapshots.flatMap(s => Object.keys(s.traits)))]

  if (!activeProjectId) return null

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 24 }}>
      <div style={{ maxWidth: 1100, width: '100%', margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#2d2520' }}>故事脉络</h2>
            <p style={{ fontSize: 13, color: '#9b8e84', marginTop: 2 }}>
              {graph.events.length > 0
                ? `${graph.events.length}个事件 · ${graph.links.length}条关联 · 最近扫描: ${graph.generatedAt ? new Date(graph.generatedAt).toLocaleDateString() : '无'}`
                : '点击"AI 扫描"提取事件、伏笔和角色状态'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <AIScanButton
              chapters={sortedChapters}
              scannedIds={graph.scannedChapterIds}
              loading={scanLoading}
              onScan={handleAIScan}
            />
            <Button onClick={handleNewEvent} icon={<PlusIcon style={{ width: 14, height: 14 }} />} variant="secondary" size="sm">
              手动添加
            </Button>
          </div>
        </div>

        {/* Update prompt: new + modified chapters */}
        {pendingCount > 0 && !scanLoading && (
          <div style={{ marginBottom: 12, padding: '10px 16px', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#e67e00' }}>
              ⚠ {newChapterIds.length > 0 && `${newChapterIds.length}章新增 `}
              {modifiedChapterIds.length > 0 && `${modifiedChapterIds.length}章内容变更 `}
              — 建议重新扫描。已扫描 {graph.scannedChapterIds.length}/{sortedChapters.length} 章
            </span>
            <Button size="sm" onClick={handleQuickScan} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
              更新扫描
            </Button>
          </div>
        )}

        {/* Scan feedback */}
        {scanError && (
          <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 10, background: '#fee2e2', color: '#dc2626', fontSize: 12 }}>
            {scanError}
            <button onClick={() => setScanError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}>关闭</button>
          </div>
        )}
        {scanProgress && !scanError && (
          <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 10, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.12)', color: '#7c3aed', fontSize: 12 }}>
            <SparklesIcon style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
            {scanProgress}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid rgba(0,0,0,0.04)' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 20px', border: 'none', background: 'transparent',
              fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? '#7c3aed' : '#6b5e54',
              borderBottom: activeTab === tab.key ? '2px solid #7c3aed' : '2px solid transparent',
              cursor: 'pointer', marginBottom: -2, transition: 'all 0.15s ease',
            }}>
              <tab.icon style={{ width: 15, height: 15 }} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
            {activeTab === 'timeline' && (
              <TimelineView
                chapters={sortedChapters}
                events={graph.events}
                links={graph.links}
                linkingFrom={linkingFrom}
                onEdit={handleEditEvent}
                onDelete={handleDeleteEvent}
                onStartLink={handleStartLink}
                onFinishLink={handleFinishLink}
                onDeleteLink={handleDeleteLink}
                getEventsByChapter={getEventsByChapter}
                getLinkedEvents={getLinkedEvents}
              />
            )}
            {activeTab === 'foreshadowing' && (
              <ForeshadowChainView
                events={graph.events}
                links={graph.links}
                onDeleteLink={handleDeleteLink}
                getLinkedEvents={getLinkedEvents}
              />
            )}
            {activeTab === 'consistency' && (
              <ConsistencyView
                charIds={charIds}
                consistencyCharId={consistencyCharId}
                setConsistencyCharId={setConsistencyCharId}
                charSnapshots={charSnapshots}
                allTraitKeys={allTraitKeys}
                characters={characters}
                growthEntries={graph.growthEntries}
              />
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
              <PlotlineManagerView
                plotlines={graph.plotlines}
                chapterPlotlines={graph.chapterPlotlines}
                chapters={sortedChapters}
                onUpdate={async (plotlines) => {
                  const newGraph = { ...graph, plotlines }
                  setGraph(newGraph)
                  await saveGraph(newGraph)
                }}
                onScanPlotlines={async (chIds) => {
                  if (!activeConfigId || !projectPath) return
                  const plotData = graph.plotlines
                  if (plotData.length === 0) return
                  try {
                    const prompt = `分析以下章节内容，判断每条支线在各章的强度（0-10）。

支线定义：${JSON.stringify(plotData)}

章节列表：${JSON.stringify(chIds.map(id => {
  const dc = chapterMap.get(id)
  const wc = writingChapters[id]
  return { id, title: dc?.title || '', content: (wc?.content || '').slice(0, 8000) }
}))}

输出 JSON：{ "chapterPlotlines": [{ "chapterId": "章节ID", "plotlines": [{ "plotlineId": "支线ID", "plotlineName": "支线名", "intensity": 强度0-10 }] }] }`
                    const reply = await aiService.chat([{ role: 'user' as const, content: prompt }], activeConfigId, activeProjectId)
                    const m = reply.match(/\{[\s\S]*\}/)
                    const parsed = JSON.parse(m ? m[0] : reply)
                    const aiCP: ChapterPlotline[] = (parsed.chapterPlotlines || []).map((cp: Record<string, unknown>) => ({
                      chapterId: (cp.chapterId as string) || '',
                      chapterOrder: chapterMap.get(cp.chapterId as string)?.order ?? 0,
                      chapterTitle: (cp.chapterTitle as string) || '',
                      plotlines: Array.isArray(cp.plotlines) ? (cp.plotlines as Record<string, unknown>[]).map(pl => ({
                        plotlineId: (pl.plotlineId as string) || '',
                        plotlineName: (pl.plotlineName as string) || '',
                        intensity: (pl.intensity as number) || 0,
                      })) : [],
                    }))
                    const scannedSet = new Set(chIds)
                    const newGraph = {
                      ...graph,
                      chapterPlotlines: [...graph.chapterPlotlines.filter(cp => !scannedSet.has(cp.chapterId)), ...aiCP].sort((a, b) => a.chapterOrder - b.chapterOrder),
                    }
                    setGraph(newGraph)
                    await saveGraph(newGraph)
                  } catch (err) { logError('支线分析失败', err) }
                }}
              />
            )}
            {activeTab === 'pov' && (
              <POVTrackingView povs={graph.povs} characters={characters} chapters={sortedChapters} />
            )}
            {activeTab === 'growth' && (
              <GrowthTimelineView
                tracks={graph.growthTracks}
                entries={graph.growthEntries}
                novelType={graph.novelType}
                characters={characters}
                chapters={sortedChapters}
                onUpdateTracks={async (tracks) => {
                  const newGraph = { ...graph, growthTracks: tracks }
                  setGraph(newGraph)
                  await saveGraph(newGraph)
                }}
                onUpdateNovelType={async (novelType) => {
                  const newGraph = { ...graph, novelType }
                  setGraph(newGraph)
                  await saveGraph(newGraph)
                }}
                onAddEntry={async (entry) => {
                  const newGraph = { ...graph, growthEntries: [...graph.growthEntries, entry] }
                  setGraph(newGraph)
                  await saveGraph(newGraph)
                }}
                onUpdateEntry={async (entry) => {
                  const newGraph = { ...graph, growthEntries: graph.growthEntries.map(e => e.id === entry.id ? entry : e) }
                  setGraph(newGraph)
                  await saveGraph(newGraph)
                }}
                onDeleteEntry={async (id) => {
                  const newGraph = { ...graph, growthEntries: graph.growthEntries.filter(e => e.id !== id) }
                  setGraph(newGraph)
                  await saveGraph(newGraph)
                }}
              />
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

        {/* Empty state */}
        {graph.events.length === 0 && !scanLoading && (
          <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
            <FlagIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
            <p style={{ fontSize: 14 }}>暂无故事脉络数据</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>点击「AI 扫描」分析章节内容，或「手动添加」创建事件</p>
          </div>
        )}
      </div>

      {/* Event Edit Modal */}
      <Modal isOpen={showEventModal} onClose={() => { setShowEventModal(false); setEditingEvent(null) }} title={editingEvent?.source === 'manual' || !graph.events.find(e => e.id === editingEvent?.id) ? '新建事件' : '编辑事件'} width={560}>
        {editingEvent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={fieldLabel}>类型</label>
                <select value={editingEvent.type} onChange={e => setEditingEvent({ ...editingEvent, type: e.target.value as StoryEvent['type'] })} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="event">普通事件</option>
                  <option value="foreshadowing">伏笔·埋设</option>
                  <option value="payoff">伏笔·回收</option>
                </select>
              </div>
              <div style={{ flex: 2 }}>
                <label style={fieldLabel}>故事时间</label>
                <input value={editingEvent.timeLabel} onChange={e => setEditingEvent({ ...editingEvent, timeLabel: e.target.value })} style={inputStyle} placeholder="如: 第3章 / 三日之后" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={fieldLabel}>所属章节</label>
                <select value={editingEvent.chapterId} onChange={e => {
                  const ch = sortedChapters.find(c => c.id === e.target.value)
                  setEditingEvent({ ...editingEvent, chapterId: e.target.value, chapterTitle: ch?.title || '', chapterOrder: ch?.order ?? 0 })
                }} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {sortedChapters.map(c => <option key={c.id} value={c.id}>{c.title || `第${c.order + 1}章`}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={fieldLabel}>地点</label>
                <input value={editingEvent.location} onChange={e => setEditingEvent({ ...editingEvent, location: e.target.value })} style={inputStyle} placeholder="青云镇" />
              </div>
            </div>
            <div>
              <label style={fieldLabel}>事件简述</label>
              <input value={editingEvent.summary} onChange={e => setEditingEvent({ ...editingEvent, summary: e.target.value })} style={inputStyle} placeholder="主角登场，在酒楼偶遇故人..." />
            </div>
            <div>
              <label style={fieldLabel}>相关角色（逗号分隔）</label>
              <input
                value={editingEvent.characters.join('、')}
                onChange={e => setEditingEvent({ ...editingEvent, characters: e.target.value.split(/[、,，]/).map(s => s.trim()).filter(Boolean) })}
                style={inputStyle}
                placeholder="张三、李四"
              />
            </div>
            <div>
              <label style={fieldLabel}>原文引用（可选）</label>
              <input value={editingEvent.quote} onChange={e => setEditingEvent({ ...editingEvent, quote: e.target.value })} style={inputStyle} placeholder="他从风雪中走来..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
              <Button variant="secondary" onClick={() => { setShowEventModal(false); setEditingEvent(null) }}>取消</Button>
              <Button onClick={handleSaveEvent} disabled={!editingEvent.summary.trim()}>保存事件</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ---- Sub-components ----

// ============= Timeline View =============

function TimelineView({ chapters, events, links, linkingFrom, onEdit, onDelete, onStartLink, onFinishLink, onDeleteLink, getEventsByChapter, getLinkedEvents }: {
  chapters: DetailedChapter[]
  events: StoryEvent[]
  links: StoryLink[]
  linkingFrom: string | null
  onEdit: (e: StoryEvent) => void
  onDelete: (id: string) => void
  onStartLink: (id: string) => void
  onFinishLink: (id: string) => void
  onDeleteLink: (id: string) => void
  getEventsByChapter: (chapterId: string) => StoryEvent[]
  getLinkedEvents: (link: StoryLink) => { source?: StoryEvent; target?: StoryEvent }
}) {
  if (chapters.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>暂无章节数据</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {linkingFrom && (
        <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', fontSize: 12, color: '#e67e00', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>正在关联伏笔 — 点击目标事件完成链接</span>
          <button onClick={() => onStartLink(linkingFrom)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e67e00', fontWeight: 600 }}>取消</button>
        </div>
      )}
      {chapters.map(chapter => {
        const chapterEvents = getEventsByChapter(chapter.id)
        if (chapterEvents.length === 0) return null
        return (
          <div key={chapter.id}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FlagIcon style={{ width: 16, height: 16 }} />
              第{chapter.order + 1}章 {chapter.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginLeft: 8, borderLeft: '2px solid rgba(124,58,237,0.15)', paddingLeft: 20 }}>
              {chapterEvents.map(evt => {
                const eventLinks = links.filter(l => l.sourceEventId === evt.id || l.targetEventId === evt.id)
                const linkedPair = eventLinks.length > 0 ? getLinkedEvents(eventLinks[0]) : null
                const isLinked = linkingFrom && linkingFrom !== evt.id

                return (
                  <div key={evt.id} onClick={() => linkingFrom ? onFinishLink(evt.id) : undefined} style={{
                    padding: '12px 16px', borderRadius: 14,
                    background: linkingFrom === evt.id ? 'rgba(245,158,11,0.1)' : isLinked ? 'rgba(0,0,0,0.02)' : '#fff',
                    border: linkingFrom === evt.id ? '2px solid #f59e0b' : isLinked ? '1px solid rgba(0,0,0,0.03)' : '1px solid rgba(0,0,0,0.06)',
                    cursor: linkingFrom ? (linkingFrom !== evt.id ? 'pointer' : 'default') : 'default',
                    position: 'relative',
                    opacity: isLinked ? 0.5 : 1,
                    transition: 'all 0.15s ease',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1 }}>
                        {/* Type badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: `${EVENT_TYPE_COLORS[evt.type]}15`, color: EVENT_TYPE_COLORS[evt.type], fontSize: 10, fontWeight: 700 }}>
                            {EVENT_TYPE_LABELS[evt.type]}
                          </span>
                          {eventLinks.length > 0 && linkedPair && (
                            <span style={{ fontSize: 10, color: '#6b5e54' }}>
                              {eventLinks[0].sourceEventId === evt.id
                                ? `→ 回收: ${linkedPair.target?.summary?.slice(0, 16) || '...'}`
                                : `← 埋设: ${linkedPair.source?.summary?.slice(0, 16) || '...'}`}
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>{evt.summary}</div>

                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9b8e84', flexWrap: 'wrap' }}>
                          {evt.timeLabel && <span><ClockIcon style={{ width: 11, height: 11, display: 'inline', marginRight: 2 }} />{evt.timeLabel}</span>}
                          {evt.location && <span><MapPinIcon style={{ width: 11, height: 11, display: 'inline', marginRight: 2 }} />{evt.location}</span>}
                          {evt.characters.length > 0 && <span><UserIcon style={{ width: 11, height: 11, display: 'inline', marginRight: 2 }} />{evt.characters.join('、')}</span>}
                          {evt.quote && <span style={{ fontStyle: 'italic', color: '#9b8e84' }}>"{evt.quote}"</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 12 }}>
                        <button onClick={e => { e.stopPropagation(); onStartLink(evt.id) }} title="关联伏笔" style={iconBtn('#f59e0b')}><LinkIcon style={{ width: 13, height: 13 }} /></button>
                        <button onClick={e => { e.stopPropagation(); onEdit(evt) }} style={iconBtn('#7c3aed')}><PencilIcon style={{ width: 13, height: 13 }} /></button>
                        <button onClick={e => { e.stopPropagation(); onDelete(evt.id) }} style={iconBtn('#dc2626')}><TrashIcon style={{ width: 13, height: 13 }} /></button>
                      </div>
                    </div>
                    {eventLinks.map(link => (
                      <button key={link.id} onClick={e => { e.stopPropagation(); onDeleteLink(link.id) }} style={{ position: 'absolute', top: 8, right: 96, background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#d4ccc4' }}>
                        <XMarkIcon style={{ width: 10, height: 10 }} />
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============= Foreshadowing Chain View =============

function ForeshadowChainView({ events, links, onDeleteLink, getLinkedEvents }: {
  events: StoryEvent[]
  links: StoryLink[]
  onDeleteLink: (id: string) => void
  getLinkedEvents: (link: StoryLink) => { source?: StoryEvent; target?: StoryEvent }
}) {
  const foreshadowLinks = links.filter(l => l.type === 'foreshadowing' || l.type === 'causality')
  const linkedEventIds = new Set(foreshadowLinks.flatMap(l => [l.sourceEventId, l.targetEventId]))
  const unlinkedForeshadowing = events.filter(e => (e.type === 'foreshadowing' || e.type === 'payoff') && !linkedEventIds.has(e.id))

  if (foreshadowLinks.length === 0 && unlinkedForeshadowing.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
        <LinkIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
        <p style={{ fontSize: 14 }}>暂无伏笔关联</p>
        <p style={{ fontSize: 12, marginTop: 4 }}>在时间线中点击 🔗 按钮关联伏笔事件，或使用 AI 扫描自动识别</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Linked chains */}
      {foreshadowLinks.map(link => {
        const { source, target } = getLinkedEvents(link)
        if (!source || !target) return null
        return (
          <GlassCard key={link.id} hover={false} style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Source (foreshadowing plant) */}
              <div style={{ flex: 1, padding: 12, borderRadius: 12, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.12)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>◆ 伏笔埋设</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>{source.summary}</div>
                <div style={{ fontSize: 11, color: '#9b8e84' }}>
                  第{source.chapterOrder + 1}章{source.chapterTitle ? ` ${source.chapterTitle}` : ''}
                  {source.timeLabel && ` · ${source.timeLabel}`}
                </div>
              </div>

              {/* Arrow */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <ArrowRightIcon style={{ width: 24, height: 24, color: '#7c3aed' }} />
                {link.note && <span style={{ fontSize: 10, color: '#6b5e54', textAlign: 'center', maxWidth: 80 }}>{link.note}</span>}
                <button onClick={() => onDeleteLink(link.id)} title="断开" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#d4ccc4' }}>
                  <XMarkIcon style={{ width: 12, height: 12 }} />
                </button>
              </div>

              {/* Target (payoff) */}
              <div style={{ flex: 1, padding: 12, borderRadius: 12, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', marginBottom: 4 }}>▲ 伏笔回收</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 4 }}>{target.summary}</div>
                <div style={{ fontSize: 11, color: '#9b8e84' }}>
                  第{target.chapterOrder + 1}章{target.chapterTitle ? ` ${target.chapterTitle}` : ''}
                  {target.timeLabel && ` · ${target.timeLabel}`}
                </div>
              </div>
            </div>
          </GlassCard>
        )
      })}

      {/* Unlinked foreshadowing events */}
      {unlinkedForeshadowing.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b', marginBottom: 8 }}>
            ⚠ 未关联的伏笔事件（在时间线中点击 🔗 建立关联）
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {unlinkedForeshadowing.map(evt => (
              <div key={evt.id} style={{
                padding: '10px 14px', borderRadius: 10, background: '#fff',
                border: '1px solid rgba(245,158,11,0.15)', fontSize: 12, color: '#2d2520',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: EVENT_TYPE_COLORS[evt.type], padding: '2px 6px', borderRadius: 4, background: `${EVENT_TYPE_COLORS[evt.type]}10` }}>
                  {EVENT_TYPE_LABELS[evt.type]}
                </span>
                {evt.summary}
                <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 'auto' }}>第{evt.chapterOrder + 1}章</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============= Consistency View =============

function ConsistencyView({ charIds, consistencyCharId, setConsistencyCharId, charSnapshots, allTraitKeys, characters, growthEntries }: {
  charIds: string[]
  consistencyCharId: string
  setConsistencyCharId: (id: string) => void
  charSnapshots: CharacterSnapshot[]
  allTraitKeys: string[]
  characters: Character[]
  growthEntries: GrowthEntry[]
}) {
  if (charIds.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
        <ShieldCheckIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
        <p style={{ fontSize: 14 }}>暂无一致性数据</p>
        <p style={{ fontSize: 12, marginTop: 4 }}>使用 AI 扫描后，此处将展示角色特征跨章节变化</p>
      </div>
    )
  }

  // Check if a trait change has a growth entry (intentional)
  const hasGrowthRecord = (traitKey: string, chapterOrder: number) =>
    growthEntries.some(ge =>
      ge.characterId === consistencyCharId &&
      ge.chapterOrder === chapterOrder &&
      (ge.trackLabel === traitKey || ge.value.includes(traitKey) || ge.note.includes(traitKey))
    )

  // Find inconsistencies: same trait, different values across chapters
  // Exclude changes that have corresponding growth entries (intentional)
  const inconsistencies: { traitKey: string; values: { chapLabel: string; value: string; isIntentional: boolean }[] }[] = []
  for (const key of allTraitKeys) {
    const values = charSnapshots
      .filter(s => s.traits[key])
      .map(s => ({ chapLabel: `第${s.chapterOrder + 1}章 ${s.chapterTitle}`, value: s.traits[key] ?? '', chapOrder: s.chapterOrder }))
    // Check if all differing values have growth records
    const withIntentional = values.map(v => ({ ...v, isIntentional: hasGrowthRecord(key, v.chapOrder) }))
    const valuesNoIntentional = withIntentional.filter(v => !v.isIntentional)
    const uniqueValues = [...new Set(valuesNoIntentional.map(v => v.value))]
    if (uniqueValues.length > 1 && withIntentional.some(v => !v.isIntentional)) {
      inconsistencies.push({ traitKey: key, values: withIntentional })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Character selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54' }}>选择角色:</span>
        <select value={consistencyCharId} onChange={e => setConsistencyCharId(e.target.value)} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
          {charIds.map(id => {
            const ch = characters.find(c => c.id === id)
            return <option key={id} value={id}>{ch?.name || id}</option>
          })}
        </select>
      </div>

      {charSnapshots.length === 0 ? (
        <p style={{ fontSize: 13, color: '#9b8e84' }}>该角色暂无状态快照</p>
      ) : (
        <>
          {/* Trait table */}
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${charSnapshots.length}, 1fr)`, gap: 0, borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden', fontSize: 12 }}>
              {/* Header */}
              <div style={{ padding: '10px 12px', background: '#faf9f8', fontWeight: 700, color: '#2d2520', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>特征</div>
              {charSnapshots.map(s => (
                <div key={s.chapterId} style={{ padding: '10px 12px', background: '#faf9f8', fontWeight: 700, color: '#2d2520', borderBottom: '1px solid rgba(0,0,0,0.06)', textAlign: 'center' }}>
                  第{s.chapterOrder + 1}章
                  <div style={{ fontSize: 10, fontWeight: 400, color: '#9b8e84' }}>{s.chapterTitle}</div>
                </div>
              ))}
              {/* Rows */}
              {allTraitKeys.map(key => {
                const values = charSnapshots.map(s => s.traits[key] || '-')
                const unique = [...new Set(values)]
                const isInconsistent = unique.length > 1
                return (
                  <div key={key} style={{ display: 'contents' }}>
                    <div style={{ padding: '8px 12px', fontWeight: 600, color: '#6b5e54', borderBottom: '1px solid rgba(0,0,0,0.03)', background: isInconsistent ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                      {key}
                      {isInconsistent && <span style={{ fontSize: 10, color: '#dc2626', marginLeft: 4 }}>⚠</span>}
                    </div>
                    {values.map((v, i) => (
                      <div key={i} style={{
                        padding: '8px 12px', color: '#4a3f38', borderBottom: '1px solid rgba(0,0,0,0.03)', textAlign: 'center',
                        background: isInconsistent ? 'rgba(239,68,68,0.04)' : 'transparent',
                        fontWeight: isInconsistent ? 600 : 400,
                      }}>
                        {v}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Inconsistency alerts */}
          {inconsistencies.length > 0 && (
            <div style={{ padding: '14px 16px', borderRadius: 12, background: '#fee2e2', border: '1px solid #fecaca' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>⚠ 发现 {inconsistencies.length} 处特征不一致</div>
              {inconsistencies.map(inc => (
                <div key={inc.traitKey} style={{ fontSize: 12, color: '#4a3f38', marginBottom: 6, lineHeight: 1.6 }}>
                  <strong>{inc.traitKey}</strong>: {inc.values.map(v => `${v.chapLabel} → "${v.value}"`).join(' ; ')}
                </div>
              ))}
            </div>
          )}

          {inconsistencies.length === 0 && (
            <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)', fontSize: 13, color: '#16a34a' }}>
              ✓ 该角色在所有章节中的特征保持一致
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ============= AI Scan Button + Modal =============

function AIScanButton({ chapters, scannedIds, loading, onScan }: {
  chapters: DetailedChapter[]
  scannedIds: string[]
  loading: boolean
  onScan: (ids: string[]) => void
}) {
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const [showModal, setShowModal] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleOpen = () => {
    // Default: select all chapters
    const allIds = chapters.map(c => c.id)
    setSelectedIds(new Set(allIds))
    setShowModal(true)
  }

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleScan = () => {
    onScan([...selectedIds])
    setShowModal(false)
  }

  return (
    <>
      <Button
        onClick={handleOpen}
        disabled={loading || chapters.length === 0 || !activeConfigId}
        icon={<SparklesIcon style={{ width: 14, height: 14 }} />}
        size="sm"
      >
        {loading ? '扫描中...' : 'AI 扫描'}
      </Button>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="AI 扫描章节" width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: '#6b5e54' }}>
            选择要扫描的章节。AI 将提取事件、伏笔关联和角色状态快照。
            已扫描章节将被增量更新。
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSelectedIds(new Set(chapters.map(c => c.id)))} style={linkBtn}>全选</button>
            <button onClick={() => setSelectedIds(new Set())} style={linkBtn}>清空</button>
          </div>
          <div className="custom-scrollbar" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {chapters.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', borderRadius: 8, fontSize: 12, color: '#2d2520' }}>
                <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleId(c.id)} style={{ width: 15, height: 15, accentColor: '#7c3aed' }} />
                第{c.order + 1}章 {c.title}
                <span style={{ fontSize: 10, color: '#9b8e84' }}>{c.status}</span>
                {scannedIds.includes(c.id) && <span style={{ fontSize: 10, color: '#16a34a' }}>已扫描</span>}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={handleScan} disabled={selectedIds.size === 0}>
              扫描 {selectedIds.size} 个章节
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

// ============= Emotion Curve View =============

function EmotionCurveView({ emotions }: { emotions: ChapterEmotion[] }) {
  const [selectedLines, setSelectedLines] = useState<Set<string>>(
    new Set(EMOTION_LINES.map(l => l.key))
  )

  const toggleLine = (key: string) => {
    setSelectedLines(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  if (emotions.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
        <ChartBarIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
        <p style={{ fontSize: 14 }}>暂无情绪数据</p>
        <p style={{ fontSize: 12, marginTop: 4 }}>使用 AI 扫描后，此处将展示每章的情绪曲线变化</p>
      </div>
    )
  }

  const sorted = [...emotions].sort((a, b) => a.chapterOrder - b.chapterOrder)

  // SVG chart dimensions
  const width = 900
  const height = 320
  const pad = { top: 20, right: 20, bottom: 60, left: 40 }
  const chartW = width - pad.left - pad.right
  const chartH = height - pad.top - pad.bottom

  const xScale = (i: number) => pad.left + (i / Math.max(sorted.length - 1, 1)) * chartW
  const yScale = (v: number) => pad.top + chartH - (v / 10) * chartH

  const getLinePoints = (key: string): string => {
    const activeLines = EMOTION_LINES.filter(l => selectedLines.has(l.key))
    if (activeLines.length === 0) return ''
    if (!selectedLines.has(key)) return ''
    return sorted.map((e, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(e.scores[key as keyof typeof e.scores]).toFixed(1)}`).join(' ')
  }

  // Find global max score for smart Y-axis labeling
  const maxScore = Math.max(...sorted.flatMap(e => Object.values(e.scores)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Legend + toggle */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {EMOTION_LINES.map(l => (
          <button key={l.key} onClick={() => toggleLine(l.key)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 8, border: `1px solid ${l.color}20`,
            background: selectedLines.has(l.key) ? `${l.color}15` : 'transparent',
            color: selectedLines.has(l.key) ? l.color : '#9b8e84',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.1s ease',
            opacity: selectedLines.has(l.key) ? 1 : 0.5,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color }} />
            {l.label}
          </button>
        ))}
      </div>

      {/* SVG Chart */}
      <div style={{ borderRadius: 16, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
          {/* Grid lines */}
          {[0, 2, 4, 6, 8, 10].map(v => (
            <g key={v}>
              <line x1={pad.left} y1={yScale(v)} x2={width - pad.right} y2={yScale(v)} stroke="rgba(0,0,0,0.04)" strokeWidth={1} />
              <text x={pad.left - 8} y={yScale(v) + 4} textAnchor="end" fill="#9b8e84" fontSize={10}>{v}</text>
            </g>
          ))}

          {/* X-axis labels */}
          {sorted.map((e, i) => (
            <g key={e.chapterId}>
              <line x1={xScale(i)} y1={pad.top} x2={xScale(i)} y2={pad.top + chartH} stroke="rgba(0,0,0,0.03)" strokeWidth={1} />
              <text x={xScale(i)} y={height - pad.bottom + 18} textAnchor="middle" fill="#6b5e54" fontSize={11} fontWeight={600}>
                第{e.chapterOrder + 1}章
              </text>
              <text x={xScale(i)} y={height - pad.bottom + 34} textAnchor="middle" fill="#9b8e84" fontSize={9}>
                {e.chapterTitle.slice(0, 6)}{e.chapterTitle.length > 6 ? '…' : ''}
              </text>
            </g>
          ))}

          {/* Lines */}
          {EMOTION_LINES.map(l => (
            selectedLines.has(l.key) && (
              <path key={l.key} d={getLinePoints(l.key)} fill="none" stroke={l.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            )
          ))}

          {/* Data points + hover area */}
          {EMOTION_LINES.map(l => (
            selectedLines.has(l.key) && sorted.map((e, i) => (
              <g key={`${l.key}_${e.chapterId}`}>
                <circle cx={xScale(i)} cy={yScale(e.scores[l.key as keyof typeof e.scores])} r={4} fill="#fff" stroke={l.color} strokeWidth={2} />
                <title>{`${l.label}: ${e.scores[l.key as keyof typeof e.scores]}/10 — 第${e.chapterOrder + 1}章 ${e.chapterTitle}: ${e.summary}`}</title>
              </g>
            ))
          ))}
        </svg>
      </div>

      {/* Chapter summaries */}
      {sorted.some(e => e.summary) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>各章情绪简述</div>
          {sorted.map(e => (
            <div key={e.chapterId} style={{ display: 'flex', gap: 10, fontSize: 11, color: '#4a3f38', padding: '4px 8px', borderRadius: 6, background: '#faf9f8' }}>
              <span style={{ fontWeight: 600, color: '#7c3aed', whiteSpace: 'nowrap', minWidth: 56 }}>第{e.chapterOrder + 1}章</span>
              <span>{e.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============= Presence Heatmap View =============

function PresenceHeatmapView({ presences, characters, chapters }: {
  presences: CharacterPresence[]
  characters: Character[]
  chapters: DetailedChapter[]
}) {
  // Build character list from presences
  const charIds = [...new Set(presences.flatMap(p => p.characters.map(c => c.characterId)))]
  const charList = charIds.map(id => characters.find(c => c.id === id)).filter(Boolean) as Character[]
  const chaptersWithPresence = chapters.filter(ch => presences.some(p => p.chapterId === ch.id))

  if (presences.length === 0) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
      <TableCellsIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
      <p style={{ fontSize: 14 }}>暂无出场数据</p>
      <p style={{ fontSize: 12, marginTop: 4 }}>使用 AI 扫描后展示角色出场热力图</p>
    </div>
  }

  const getPresence = (chId: string, charId: string) =>
    presences.find(p => p.chapterId === chId)?.characters.find(c => c.characterId === charId)

  const maxMentions = Math.max(1, ...presences.flatMap(p => p.characters.map(c => c.mentionCount)))

  // Role badge colors
  const roleColor = (role: string) => role === 'primary' ? '#7c3aed' : role === 'secondary' ? '#3b82f6' : '#9b8e84'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `100px repeat(${chaptersWithPresence.length}, 1fr)`, gap: 0, borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden', fontSize: 11 }}>
          <div style={{ padding: '8px', background: '#faf9f8', fontWeight: 700, color: '#2d2520', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>角色</div>
          {chaptersWithPresence.map(ch => (
            <div key={ch.id} style={{ padding: '8px 4px', background: '#faf9f8', fontWeight: 700, color: '#2d2520', borderBottom: '1px solid rgba(0,0,0,0.06)', textAlign: 'center', fontSize: 10 }}>
              第{ch.order + 1}章
            </div>
          ))}
          {charList.map(char => (
            <div key={char.id} style={{ display: 'contents' }}>
              <div style={{ padding: '6px 8px', fontWeight: 600, color: '#6b5e54', borderBottom: '1px solid rgba(0,0,0,0.03)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: roleColor(getPresence(chaptersWithPresence[0]?.id || '', char.id)?.role || 'secondary'), flexShrink: 0 }} />
                {char.name.slice(0, 4)}
              </div>
              {chaptersWithPresence.map(ch => {
                const p = getPresence(ch.id, char.id)
                if (!p) return <div key={ch.id} style={{ padding: '6px', borderBottom: '1px solid rgba(0,0,0,0.03)', background: 'rgba(0,0,0,0.01)' }} />
                const alpha = 0.1 + (p.mentionCount / maxMentions) * 0.8
                return (
                  <div key={ch.id} title={`${char.name}: ${p.mentionCount}次提及 (${p.role})`} style={{
                    padding: '6px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.03)',
                    background: `rgba(124,58,237,${alpha.toFixed(2)})`,
                    color: alpha > 0.5 ? '#fff' : '#4a3f38',
                    fontWeight: p.role === 'primary' ? 700 : 400,
                    fontSize: 10, cursor: 'default',
                  }}>
                    {p.mentionCount}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Summary sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {charList.map(char => {
          const total = presences.filter(p => p.characters.some(c => c.characterId === char.id)).length
          const avg = presences.reduce((sum, p) => sum + (p.characters.find(c => c.characterId === char.id)?.mentionCount || 0), 0) / Math.max(total, 1)
          return (
            <GlassCard key={char.id} hover={false} style={{ padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>{char.name}</div>
              <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 4 }}>
                出场 {total}/{presences.length} 章 · 均次 {avg.toFixed(0)}
              </div>
            </GlassCard>
          )
        })}
      </div>
    </div>
  )
}

// ============= Rhythm Analysis View =============

function RhythmAnalysisView({ rhythms }: { rhythms: ChapterRhythm[] }) {
  if (rhythms.length === 0) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
      <ArrowsRightLeftIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
      <p style={{ fontSize: 14 }}>暂无节奏数据</p>
      <p style={{ fontSize: 12, marginTop: 4 }}>使用 AI 扫描后展示每章对白/描写/动作占比和节奏评分</p>
    </div>
  }

  const sorted = [...rhythms].sort((a, b) => a.chapterOrder - b.chapterOrder)
  const maxWordCount = Math.max(...sorted.map(r => r.metrics.wordCount), 1)
  const avgWordCount = sorted.reduce((s, r) => s + r.metrics.wordCount, 0) / sorted.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stacked bar chart for dialogue/description/action ratios */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>对白 · 描写 · 动作 占比</div>
        {sorted.map(r => (
          <div key={r.chapterId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', minWidth: 48, textAlign: 'right' }}>第{r.chapterOrder + 1}章</span>
            <div style={{ flex: 1, height: 20, borderRadius: 6, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.03)' }}>
              {r.metrics.dialogueRatio > 0 && (
                <div title={`对白 ${r.metrics.dialogueRatio}%`} style={{ width: `${r.metrics.dialogueRatio}%`, background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 600, minWidth: r.metrics.dialogueRatio > 8 ? 0 : undefined }}>
                  {r.metrics.dialogueRatio > 12 ? '对白' : ''}
                </div>
              )}
              {r.metrics.descriptionRatio > 0 && (
                <div title={`描写 ${r.metrics.descriptionRatio}%`} style={{ width: `${r.metrics.descriptionRatio}%`, background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 600 }}>
                  {r.metrics.descriptionRatio > 12 ? '描写' : ''}
                </div>
              )}
              {r.metrics.actionRatio > 0 && (
                <div title={`动作 ${r.metrics.actionRatio}%`} style={{ width: `${r.metrics.actionRatio}%`, background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 600 }}>
                  {r.metrics.actionRatio > 12 ? '动作' : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pace + Info Density + Word Count table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>节奏评分 · 信息密度 · 字数</div>
        {sorted.map(r => {
          const wordAnomaly = r.metrics.wordCount > avgWordCount * 1.8 || r.metrics.wordCount < avgWordCount * 0.4
          const dialogueAnomaly = r.metrics.dialogueRatio > 70 || r.metrics.dialogueRatio < 10
          return (
            <GlassCard key={r.chapterId} hover={false} style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: '#7c3aed', minWidth: 48 }}>第{r.chapterOrder + 1}章</span>
                <span>{r.chapterTitle}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span title="节奏速度" style={{ color: '#6b5e54' }}>节奏 <strong style={{ color: r.metrics.paceScore >= 7 ? '#ef4444' : r.metrics.paceScore <= 3 ? '#3b82f6' : '#7c3aed' }}>{r.metrics.paceScore}/10</strong></span>
                  <span title="信息密度" style={{ color: '#6b5e54' }}>密度 <strong style={{ color: '#7c3aed' }}>{r.metrics.infoDensity}/10</strong></span>
                  <span title={wordAnomaly ? '字数异常（相比平均偏差超过40%）' : '字数'} style={{ color: '#6b5e54' }}>
                    <strong style={{ color: wordAnomaly ? '#ef4444' : '#2d2520' }}>{r.metrics.wordCount.toLocaleString()}</strong>字
                  </span>
                  {wordAnomaly && <span style={{ fontSize: 10, color: '#ef4444' }}>⚠字数</span>}
                  {dialogueAnomaly && <span style={{ fontSize: 10, color: '#f59e0b' }}>
                    {r.metrics.dialogueRatio > 70 ? '⚠对白过多' : '⚠无对白'}
                  </span>}
                </div>
              </div>
            </GlassCard>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9b8e84' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#3b82f6', marginRight: 4 }} />对白</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#16a34a', marginRight: 4 }} />描写</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#f59e0b', marginRight: 4 }} />动作</span>
      </div>
    </div>
  )
}

// ============= Plotline Manager View =============

function PlotlineManagerView({ plotlines, chapterPlotlines, chapters, onUpdate, onScanPlotlines }: {
  plotlines: Plotline[]
  chapterPlotlines: ChapterPlotline[]
  chapters: DetailedChapter[]
  onUpdate: (plotlines: Plotline[]) => void
  onScanPlotlines: (chIds: string[]) => void
}) {
  const [showEdit, setShowEdit] = useState(false)
  const [editingLine, setEditingLine] = useState<Plotline | null>(null)

  const handleAdd = () => {
    if (plotlines.length >= 5) return
    setEditingLine({ id: `pl_${nanoid(8)}`, name: '', color: PLOTLINE_COLORS[plotlines.length], description: '', order: plotlines.length })
    setShowEdit(true)
  }

  const handleEdit = (pl: Plotline) => {
    setEditingLine({ ...pl })
    setShowEdit(true)
  }

  const handleSave = () => {
    if (!editingLine || !editingLine.name.trim()) return
    const idx = plotlines.findIndex(p => p.id === editingLine.id)
    const updated = idx >= 0
      ? plotlines.map(p => p.id === editingLine.id ? editingLine : p)
      : [...plotlines, editingLine]
    onUpdate(updated)
    setShowEdit(false)
    setEditingLine(null)
  }

  const handleDelete = (id: string) => {
    onUpdate(plotlines.filter(p => p.id !== id))
  }

  const sortedCP = [...chapterPlotlines].sort((a, b) => a.chapterOrder - b.chapterOrder)
  const sortedChapters = [...chapters].sort((a, b) => a.order - b.order)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Plotline CRUD */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54' }}>支线 ({plotlines.length}/5):</span>
          {plotlines.map(pl => (
            <span key={pl.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, background: `${pl.color}15`, border: `1px solid ${pl.color}30`, fontSize: 11, fontWeight: 600, color: pl.color }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: pl.color }} />
              {pl.name}
              <button onClick={() => handleEdit(pl)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: pl.color, display: 'flex' }}><PencilIcon style={{ width: 11, height: 11 }} /></button>
              <button onClick={() => handleDelete(pl.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#d4ccc4', display: 'flex' }}><XMarkIcon style={{ width: 11, height: 11 }} /></button>
            </span>
          ))}
          {plotlines.length < 5 && (
            <button onClick={handleAdd} style={{ ...linkBtn, fontSize: 12 }}>+ 新建支线</button>
          )}
        </div>
        {plotlines.length > 0 && (
          <Button size="sm" onClick={() => onScanPlotlines(sortedChapters.map(c => c.id))}>
            <SparklesIcon style={{ width: 12, height: 12 }} />
            {chapterPlotlines.length > 0 ? '重新分析' : 'AI 分析'}
          </Button>
        )}
      </div>

      {/* Intensity chart */}
      {sortedCP.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>支线强度走势</div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${sortedCP.length}, 1fr)`, gap: 0, borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden', fontSize: 10 }}>
              <div style={{ padding: '6px', background: '#faf9f8', fontWeight: 700, color: '#2d2520', borderBottom: '1px solid rgba(0,0,0,0.06)' }} />

              {sortedCP.map(cp => (
                <div key={cp.chapterId} style={{ padding: '6px 2px', background: '#faf9f8', fontWeight: 700, color: '#2d2520', borderBottom: '1px solid rgba(0,0,0,0.06)', textAlign: 'center' }}>
                  第{cp.chapterOrder + 1}章
                </div>
              ))}
              {plotlines.map(pl => (
                <div key={pl.id} style={{ display: 'contents' }}>
                  <div style={{ padding: '6px 8px', fontWeight: 600, color: pl.color, borderBottom: '1px solid rgba(0,0,0,0.03)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: pl.color, flexShrink: 0 }} />
                    {pl.name.slice(0, 4)}
                  </div>
                  {sortedCP.map(cp => {
                    const entry = cp.plotlines.find(pe => pe.plotlineId === pl.id)
                    const v = entry?.intensity || 0
                    return (
                      <div key={cp.chapterId} title={`${pl.name}: ${v}/10`} style={{
                        padding: '6px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.03)',
                        background: `${pl.color}${Math.round(v * 10 + 5).toString(16).padStart(2, '0')}`,
                        color: v > 5 ? '#fff' : '#4a3f38',
                        fontWeight: v > 5 ? 700 : 400,
                      }}>
                        {v}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {plotlines.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
          <Bars3Icon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
          <p style={{ fontSize: 14 }}>暂无支线定义</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>点击「新建支线」定义故事中的 A/B/C 故事线，然后用 AI 分析各条线在各章的强度</p>
        </div>
      )}

      {/* Edit Modal */}
      <Modal isOpen={showEdit} onClose={() => { setShowEdit(false); setEditingLine(null) }} title={editingLine?.name ? '编辑支线' : '新建支线'} width={440}>
        {editingLine && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={fieldLabel}>支线名称</label>
              <input value={editingLine.name} onChange={e => setEditingLine({ ...editingLine, name: e.target.value })} style={inputStyle} placeholder="如: 复仇主线、感情线" />
            </div>
            <div>
              <label style={fieldLabel}>颜色</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {PLOTLINE_COLORS.map(c => (
                  <button key={c} onClick={() => setEditingLine({ ...editingLine, color: c })} style={{
                    width: 28, height: 28, borderRadius: '50%', background: c,
                    border: editingLine.color === c ? '3px solid #2d2520' : '3px solid transparent',
                    cursor: 'pointer',
                  }} />
                ))}
              </div>
            </div>
            <div>
              <label style={fieldLabel}>描述</label>
              <input value={editingLine.description} onChange={e => setEditingLine({ ...editingLine, description: e.target.value })} style={inputStyle} placeholder="简述这条故事线的内容..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
              <Button variant="secondary" onClick={() => { setShowEdit(false); setEditingLine(null) }}>取消</Button>
              <Button onClick={handleSave} disabled={!editingLine.name.trim()}>保存</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ============= POV Tracking View =============

function POVTrackingView({ povs, characters, chapters }: {
  povs: ChapterPOV[]
  characters: Character[]
  chapters: DetailedChapter[]
}) {
  if (povs.length === 0) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
      <EyeIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.3 }} />
      <p style={{ fontSize: 14 }}>暂无 POV 数据</p>
      <p style={{ fontSize: 12, marginTop: 4 }}>使用 AI 扫描后展示每章视角角色和人称</p>
    </div>
  }

  const sorted = [...povs].sort((a, b) => a.chapterOrder - b.chapterOrder)
  const chaptersWithPOV = chapters.filter(ch => povs.some(p => p.chapterId === ch.id))

  // POV character stats for pie chart
  const povCharIds = [...new Set(povs.map(p => p.primaryPOV.characterId).filter(Boolean))]
  const povStats = povCharIds.map(id => {
    const name = characters.find(c => c.id === id)?.name || id
    const count = povs.filter(p => p.primaryPOV.characterId === id).length
    return { id, name, count }
  }).sort((a, b) => b.count - a.count)

  const total = povStats.reduce((s, p) => s + p.count, 0)
  const COLORS_PIE = ['#7c3aed', '#ec4899', '#3b82f6', '#f59e0b', '#16a34a', '#ef4444']

  // SVG pie slices
  let cumAngle = 0
  const slices = povStats.map((p, i) => {
    const angle = (p.count / total) * 2 * Math.PI
    const x1 = 50 + 40 * Math.cos(cumAngle)
    const y1 = 50 + 40 * Math.sin(cumAngle)
    cumAngle += angle
    const x2 = 50 + 40 * Math.cos(cumAngle)
    const y2 = 50 + 40 * Math.sin(cumAngle)
    const large = angle > Math.PI ? 1 : 0
    return { ...p, color: COLORS_PIE[i % COLORS_PIE.length], d: `M 50 50 L ${x1} ${y1} A 40 40 0 ${large} 1 ${x2} ${y2} Z` }
  })

  // Head-hopping warnings
  const headHoppingChapters = sorted.filter(p => p.hasHeadHopping)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* POV ribbon chart */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>POV 角色分布</div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 40 }}>
          {sorted.map(p => {
            const color = COLORS_PIE[povStats.findIndex(ps => ps.id === p.primaryPOV.characterId) % COLORS_PIE.length] || '#d4ccc4'
            return (
              <div key={p.chapterId} title={`第${p.chapterOrder + 1}章: ${p.primaryPOV.characterName || '未知'} (${POV_TYPE_LABELS[p.povType]})`} style={{
                flex: 1, minWidth: 14, height: '100%', background: color, borderRadius: 3,
                opacity: p.primaryPOV.characterId ? 1 : 0.3, cursor: 'default',
              }} />
            )
          })}
        </div>
        <div style={{ display: 'flex', marginTop: 4 }}>
          {sorted.map((p, i) => i % 3 === 0 ? (
            <span key={p.chapterId} style={{ flex: 3, minWidth: 42, fontSize: 9, color: '#9b8e84', textAlign: 'center' }}>
              第{p.chapterOrder + 1}章
            </span>
          ) : <span key={p.chapterId} style={{ flex: 1, minWidth: 14 }} />)}
        </div>
      </div>

      {/* Pie chart + stats row */}
      {povStats.length > 0 && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <svg viewBox="0 0 100 100" style={{ width: 120, height: 120, flexShrink: 0 }}>
            {slices.map(s => (
              <path key={s.id} d={s.d} fill={s.color} stroke="#fff" strokeWidth={1}>
                <title>{s.name}: {s.count}章 ({((s.count / total) * 100).toFixed(0)}%)</title>
              </path>
            ))}
            <circle cx={50} cy={50} r={22} fill="#fff" />
            <text x={50} y={48} textAnchor="middle" fill="#6b5e54" fontSize={11} fontWeight={700}>{total}章</text>
            <text x={50} y={60} textAnchor="middle" fill="#9b8e84" fontSize={8}>POV</text>
          </svg>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {povStats.map((ps, i) => (
              <div key={ps.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#4a3f38' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS_PIE[i % COLORS_PIE.length], flexShrink: 0 }} />
                {ps.name}: {ps.count}章 ({((ps.count / total) * 100).toFixed(0)}%)
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Head-hopping warnings */}
      {headHoppingChapters.length > 0 && (
        <div style={{ padding: '12px 16px', borderRadius: 12, background: '#fee2e2', border: '1px solid #fecaca' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>⚠ 检测到 {headHoppingChapters.length} 章存在视角切换（头跳）</div>
          {headHoppingChapters.map(p => (
            <div key={p.chapterId} style={{ fontSize: 11, color: '#4a3f38' }}>
              第{p.chapterOrder + 1}章: {p.note}
            </div>
          ))}
        </div>
      )}

      {/* Detail table */}
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>各章 POV 详情</div>
      {sorted.map(p => {
        const povColor = COLORS_PIE[povStats.findIndex(ps => ps.id === p.primaryPOV.characterId) % COLORS_PIE.length] || '#d4ccc4'
        return (
          <GlassCard key={p.chapterId} hover={false} style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: '#7c3aed', minWidth: 48 }}>第{p.chapterOrder + 1}章</span>
              <span style={{ padding: '2px 8px', borderRadius: 6, background: `${povColor}15`, color: povColor, fontWeight: 700, fontSize: 11 }}>
                {p.primaryPOV.characterName || '未知'}
              </span>
              <span style={{ fontSize: 10, color: '#9b8e84' }}>{POV_TYPE_LABELS[p.povType]}</span>
              {p.secondaryFocalPoints.length > 0 && (
                <span style={{ fontSize: 10, color: '#6b5e54' }}>
                  副焦点: {p.secondaryFocalPoints.map(f => f.characterName).join('、')}
                </span>
              )}
              {p.hasHeadHopping && <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 600 }}>⚠ 头跳</span>}
              {p.note && !p.hasHeadHopping && <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 'auto' }}>{p.note}</span>}
            </div>
          </GlassCard>
        )
      })}
    </div>
  )
}

// ============= Growth Timeline View =============

function GrowthTimelineView({ tracks, entries, characters, chapters, onUpdateTracks, onAddEntry, onUpdateEntry, onDeleteEntry, novelType, onUpdateNovelType }: {
  tracks: GrowthTrack[]
  entries: GrowthEntry[]
  characters: Character[]
  chapters: DetailedChapter[]
  onUpdateTracks: (tracks: GrowthTrack[]) => void
  onAddEntry: (entry: GrowthEntry) => void
  onUpdateEntry: (entry: GrowthEntry) => void
  onDeleteEntry: (id: string) => void
  novelType: string
  onUpdateNovelType: (type: string) => void
}) {
  const [selectedCharId, setSelectedCharId] = useState('all')
  const [selectedTrackId, setSelectedTrackId] = useState('all')
  const [showTrackConfig, setShowTrackConfig] = useState(false)
  const [showCustomType, setShowCustomType] = useState(false)
  const [customTypeName, setCustomTypeName] = useState('')
  const [customDims, setCustomDims] = useState<{ label: string; icon: string }[]>([{ label: '', icon: '' }, { label: '', icon: '' }, { label: '', icon: '' }, { label: '', icon: '' }, { label: '', icon: '' }])
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [editingEntry, setEditingEntry] = useState<GrowthEntry | null>(null)

  // Manual entry form state
  const [formCharId, setFormCharId] = useState('')
  const [formTrackId, setFormTrackId] = useState('')
  const [formChapterId, setFormChapterId] = useState('')
  const [formValue, setFormValue] = useState('')
  const [formChange, setFormChange] = useState<GrowthEntry['change']>('same')
  const [formNote, setFormNote] = useState('')

  const filteredEntries = entries.filter(e => {
    if (selectedCharId !== 'all' && e.characterId !== selectedCharId) return false
    if (selectedTrackId !== 'all' && e.trackLabel !== tracks.find(t => t.id === selectedTrackId)?.label) return false
    return true
  })

  const displayTracks = selectedTrackId === 'all' ? tracks : tracks.filter(t => t.id === selectedTrackId)

  const handleSaveEntry = () => {
    if (!formCharId || !formTrackId || !formChapterId || !formValue.trim()) return
    const ch = chapters.find(c => c.id === formChapterId)
    const tr = tracks.find(t => t.id === formTrackId)
    const chr = characters.find(c => c.id === formCharId)
    const entry: GrowthEntry = {
      id: `ge_${nanoid(8)}`,
      characterId: formCharId,
      characterName: chr?.name || '',
      chapterId: formChapterId,
      chapterOrder: ch?.order ?? 0,
      chapterTitle: ch?.title || '',
      trackId: formTrackId,
      trackLabel: tr?.label || '',
      value: formValue,
      change: formChange,
      note: formNote,
      source: 'manual',
      createdAt: new Date().toISOString(),
    }
    onAddEntry(entry)
    setShowAddEntry(false)
    resetForm()
  }

  const resetForm = () => {
    setFormCharId(''); setFormTrackId(''); setFormChapterId('')
    setFormValue(''); setFormChange('same'); setFormNote('')
  }

  // Group entries by character + track for timeline display
  const groupedByCharTrack = new Map<string, GrowthEntry[]>()
  for (const e of filteredEntries) {
    const key = `${e.characterId}_${e.trackLabel}`
    if (!groupedByCharTrack.has(key)) groupedByCharTrack.set(key, [])
    groupedByCharTrack.get(key)!.push(e)
  }
  // Sort each group by chapterOrder
  for (const [, list] of groupedByCharTrack) { list.sort((a, b) => a.chapterOrder - b.chapterOrder) }

  // Track config state
  const [editTrackName, setEditTrackName] = useState('')
  const [editTrackIcon, setEditTrackIcon] = useState('')
  const [editTrackId, setEditTrackId] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54' }}>角色:</span>
        <select value={selectedCharId} onChange={e => setSelectedCharId(e.target.value)} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
          <option value="all">全部角色</option>
          {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54' }}>维度:</span>
        <select value={selectedTrackId} onChange={e => setSelectedTrackId(e.target.value)} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
          <option value="all">全部维度</option>
          {tracks.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" onClick={() => setShowTrackConfig(true)}>配置维度</Button>
          <Button size="sm" variant="ghost" onClick={() => {
            if (confirm('确定重置所有维度？将回到类型选择页，现有记录保留但维度重新选择。')) {
              onUpdateTracks([]); onUpdateNovelType('')
            }
          }}>重置维度</Button>
          <Button size="sm" onClick={() => { resetForm(); setShowAddEntry(true) }} icon={<PlusIcon style={{ width: 12, height: 12 }} />}>
            手动添加
          </Button>
        </div>
      </div>

      {/* Track timeline cards */}
      {displayTracks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84' }}>
          <ArrowTrendingUpIcon style={{ width: 40, height: 40, margin: '0 auto 10px', opacity: 0.3 }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>选择你的小说类型</p>
          <p style={{ fontSize: 12, marginBottom: 20 }}>将根据类型提供合适的成长维度，后续可自由增删改</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, maxWidth: 600, margin: '0 auto' }}>
            {Object.entries(GENRE_TRACK_PRESETS).map(([genre, preset]) => (
              <button key={genre} onClick={() => {
                if (genre === '自定义') {
                  setShowCustomType(true)
                  return
                }
                const newTracks: GrowthTrack[] = preset.map((t, i) => ({ ...t, id: `gt_${nanoid(6)}`, order: i }))
                onUpdateTracks(newTracks)
                onUpdateNovelType(genre)
              }} style={{
                padding: '16px 14px', borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)',
                background: novelType === genre ? 'rgba(124,58,237,0.06)' : '#fff',
                cursor: 'pointer', textAlign: 'center',
                transition: 'all 0.15s ease',
              }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>{preset[0]?.icon || '📌'}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>{genre}</div>
                <div style={{ fontSize: 10, color: '#9b8e84', lineHeight: 1.5 }}>
                  {preset.map(t => t.label).join('、')}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        displayTracks.map(track => {
          const trackGroups = [...groupedByCharTrack.entries()]
            .filter(([key]) => key.endsWith(`_${track.label}`))
          if (trackGroups.length === 0 && selectedTrackId === track.id && filteredEntries.length === 0) {
            // Specific track selected but no entries — still show the track card
          }
          if (trackGroups.length === 0) {
            return null
          }
          return (
            <GlassCard key={track.id} hover={false} style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>
                {track.icon} {track.label}
              </div>
              {trackGroups.map(([key, charEntries]) => {
                const charId = key.split('_')[0]
                const char = characters.find(c => c.id === charId)
                return (
                  <div key={key} style={{ marginBottom: 14 }}>
                    {selectedCharId === 'all' && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 6 }}>
                        {char?.name || charId}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', paddingLeft: selectedCharId === 'all' ? 12 : 0 }}>
                      {charEntries.map((entry, i) => (
                        <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                          <button
                            onClick={() => setEditingEntry(entry)}
                            title={`第${entry.chapterOrder + 1}章 ${entry.chapterTitle}: ${entry.value} ${entry.note ? `(${entry.note})` : ''}`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', borderRadius: 8,
                              background: `${CHANGE_COLORS[entry.change]}12`,
                              border: `1px solid ${CHANGE_COLORS[entry.change]}30`,
                              color: CHANGE_COLORS[entry.change],
                              fontSize: 11, fontWeight: 600, cursor: 'pointer',
                              transition: 'all 0.1s ease',
                            }}
                          >
                            {entry.change !== 'same' && <span style={{ fontSize: 10 }}>{CHANGE_LABELS[entry.change]}</span>}
                            <span>{entry.value}</span>
                          </button>
                          {i < charEntries.length - 1 && (
                            <span style={{ fontSize: 10, color: '#d4ccc4', margin: '0 2px' }}>→</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Chapter markers */}
                    <div style={{ display: 'flex', gap: 2, marginTop: 4, paddingLeft: selectedCharId === 'all' ? 12 : 0 }}>
                      {charEntries.map(entry => (
                        <span key={entry.id} style={{ fontSize: 9, color: '#9b8e84', minWidth: 36, textAlign: 'center' }}>
                          第{entry.chapterOrder + 1}章
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </GlassCard>
          )
        })
      )}

      {/* Track Config Modal */}
      <Modal isOpen={showTrackConfig} onClose={() => setShowTrackConfig(false)} title="配置成长维度" width={480}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tracks.map((t, i) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: '#faf9f8' }}>
              <span>{t.icon}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#2d2520' }}>{t.label}</span>
              <button onClick={() => { setEditTrackId(t.id); setEditTrackName(t.label); setEditTrackIcon(t.icon) }} style={iconBtn('#7c3aed')}><PencilIcon style={{ width: 13, height: 13 }} /></button>
              <button onClick={() => {
                const updated = tracks.filter(tr => tr.id !== t.id).map((tr, j) => ({ ...tr, order: j }))
                onUpdateTracks(updated)
              }} style={iconBtn('#dc2626')}><TrashIcon style={{ width: 13, height: 13 }} /></button>
            </div>
          ))}
          {editTrackId !== null ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, borderRadius: 10, background: 'rgba(124,58,237,0.04)' }}>
              <input value={editTrackIcon} onChange={e => setEditTrackIcon(e.target.value)} style={{ ...inputStyle, width: 50 }} placeholder="图标" />
              <input value={editTrackName} onChange={e => setEditTrackName(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="维度名称" />
              <Button size="sm" onClick={() => {
                if (!editTrackName.trim()) return
                const updated = tracks.map(t => t.id === editTrackId ? { ...t, label: editTrackName, icon: editTrackIcon || '📌' } : t)
                onUpdateTracks(updated)
                setEditTrackId(null)
              }}>保存</Button>
              <Button variant="secondary" size="sm" onClick={() => setEditTrackId(null)}>取消</Button>
            </div>
          ) : (
            <button onClick={() => {
              const newTrack: GrowthTrack = { id: `gt_${nanoid(6)}`, label: '新维度', icon: '📌', order: tracks.length }
              onUpdateTracks([...tracks, newTrack])
              setEditTrackId(newTrack.id)
              setEditTrackName('新维度')
              setEditTrackIcon('📌')
            }} style={{ ...linkBtn, fontSize: 12 }}>+ 新增维度</button>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button onClick={() => setShowTrackConfig(false)}>完成</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Entry Modal */}
      <Modal isOpen={editingEntry !== null} onClose={() => setEditingEntry(null)} title="编辑成长记录" width={460}>
        {editingEntry && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={fieldLabel}>角色</label>
              <input value={editingEntry.characterName} disabled style={{ ...inputStyle, opacity: 0.6 }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={fieldLabel}>维度</label>
                <input value={editingEntry.trackLabel} disabled style={{ ...inputStyle, opacity: 0.6 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={fieldLabel}>章节</label>
                <input value={`第${editingEntry.chapterOrder + 1}章 ${editingEntry.chapterTitle}`} disabled style={{ ...inputStyle, opacity: 0.6 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={fieldLabel}>值</label>
                <input value={editingEntry.value} onChange={e => setEditingEntry({ ...editingEntry, value: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={fieldLabel}>变化类型</label>
                <select value={editingEntry.change} onChange={e => setEditingEntry({ ...editingEntry, change: e.target.value as GrowthEntry['change'] })} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="same">初始</option>
                  <option value="new">新增</option>
                  <option value="upgrade">升级</option>
                  <option value="downgrade">降级</option>
                  <option value="lost">失去</option>
                </select>
              </div>
            </div>
            <div>
              <label style={fieldLabel}>备注</label>
              <input value={editingEntry.note} onChange={e => setEditingEntry({ ...editingEntry, note: e.target.value })} style={inputStyle} placeholder="进阶原因、获得方式等" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
              <Button variant="danger" onClick={() => { onDeleteEntry(editingEntry.id); setEditingEntry(null) }}>删除</Button>
              <Button variant="secondary" onClick={() => setEditingEntry(null)}>取消</Button>
              <Button onClick={() => { onUpdateEntry(editingEntry); setEditingEntry(null) }}>保存</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Entry Modal */}
      <Modal isOpen={showAddEntry} onClose={() => setShowAddEntry(false)} title="手动添加成长记录" width={460}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={fieldLabel}>角色</label>
            <select value={formCharId} onChange={e => setFormCharId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">选择角色</option>
              {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>维度</label>
              <select value={formTrackId} onChange={e => setFormTrackId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">选择维度</option>
                {tracks.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>章节</label>
              <select value={formChapterId} onChange={e => setFormChapterId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">选择章节</option>
                {chapters.map(c => <option key={c.id} value={c.id}>第{c.order + 1}章 {c.title}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 2 }}>
              <label style={fieldLabel}>值</label>
              <input value={formValue} onChange={e => setFormValue(e.target.value)} style={inputStyle} placeholder="如: 金丹期" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>变化类型</label>
              <select value={formChange} onChange={e => setFormChange(e.target.value as GrowthEntry['change'])} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="same">初始</option>
                <option value="new">新增</option>
                <option value="upgrade">升级</option>
                <option value="downgrade">降级</option>
                <option value="lost">失去</option>
              </select>
            </div>
          </div>
          <div>
            <label style={fieldLabel}>备注</label>
            <input value={formNote} onChange={e => setFormNote(e.target.value)} style={inputStyle} placeholder="可选" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setShowAddEntry(false)}>取消</Button>
            <Button onClick={handleSaveEntry} disabled={!formCharId || !formTrackId || !formChapterId || !formValue.trim()}>添加</Button>
          </div>
        </div>
      </Modal>

      {/* Custom Type Modal */}
      <Modal isOpen={showCustomType} onClose={() => setShowCustomType(false)} title="自定义类型" width={480}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={fieldLabel}>类型名称</label>
            <input value={customTypeName} onChange={e => setCustomTypeName(e.target.value)} style={inputStyle} placeholder="如: 赛博朋克" />
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>成长维度 (名称 / 图标)</div>
          {customDims.map((d, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={d.label} onChange={e => { const n = [...customDims]; n[i] = {...n[i], label: e.target.value}; setCustomDims(n) }} placeholder="维度名" style={{ ...inputStyle, flex: 1 }} />
              <input value={d.icon} onChange={e => { const n = [...customDims]; n[i] = {...n[i], icon: e.target.value}; setCustomDims(n) }} placeholder="图标" style={{ ...inputStyle, width: 60 }} />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
            <Button variant="secondary" onClick={() => setShowCustomType(false)}>取消</Button>
            <Button onClick={() => {
              const valid = customDims.filter(d => d.label.trim())
              if (!customTypeName.trim() || valid.length === 0) return
              const newTracks: GrowthTrack[] = valid.map((d, i) => ({ id: `gt_${nanoid(6)}`, label: d.label, icon: d.icon || '📌', order: i }))
              onUpdateTracks(newTracks)
              onUpdateNovelType(customTypeName)
              setShowCustomType(false)
            }} disabled={!customTypeName.trim()}>保存</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}


// ====================== Time Flow View ======================

function TimeFlowView({ chapters }: { chapters: DetailedChapter[] }) {
  const items = chapters.map((ch, i) => {
    const timeSpan = ch.description?.match(/(\d+[天日月年])/) || ['?']
    const gap = i === 0 ? '—' : '?'
    return { ...ch, order: i + 1, timeSpan: timeSpan[0] || '?', gap, cumulative: 0 }
  })
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>各章时间流速</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>
        基于章节描述中的时间线索。请在章节细纲中补充每章的时间跨度信息（如"3天""次日"）以获取更准确的数据。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderRadius: 8, background: i % 2 === 0 ? '#faf9f8' : '#fff', fontSize: 11 }}>
            <span style={{ fontWeight: 600, minWidth: 50, color: '#7c3aed' }}>第{item.order}章</span>
            <span style={{ flex: 1, color: '#2d2520' }}>{item.title}</span>
            <span style={{ color: '#6b5e54', minWidth: 80, textAlign: 'right' }}>时间跨度: {item.timeSpan}</span>
          </div>
        ))}
      </div>
      {items.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84' }}>暂无章节数据，请先在细纲中加入章节</div>}
    </div>
  )
}

// ====================== Co-Occurrence Network View ======================

function CoOccurrenceView({ chapters }: { chapters: DetailedChapter[] }) {
  const coMap = new Map<string, number>()
  const charSet = new Set<string>()
  chapters.forEach(ch => {
    const names = (ch.description || '').match(/[：:]\s*(.+)/)?.[1]?.split(/[,，、]/) || []
    names.forEach(n => { const t = n.trim(); if (t) charSet.add(t) })
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i].trim(); const b = names[j].trim()
        if (!a || !b) continue
        const key = [a, b].sort().join('|||')
        coMap.set(key, (coMap.get(key) || 0) + 1)
      }
    }
  })
  const pairs = [...coMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => {
    const [a, b] = k.split('|||')
    return { charA: a, charB: b, coCount: v }
  })
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>角色共现网络</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>
        基于章节细纲中的角色字段。统计角色在同一章中共同出现的频率。
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {pairs.map((p, i) => (
          <div key={i} style={{ padding: '8px 12px', borderRadius: 10, background: `rgba(124,58,237,${0.04 + p.coCount * 0.03})`, border: '1px solid rgba(124,58,237,0.1)', fontSize: 11 }}>
            <span style={{ fontWeight: 600, color: '#7c3aed' }}>{p.charA}</span>
            <span style={{ color: '#9b8e84', margin: '0 4px' }}>+</span>
            <span style={{ fontWeight: 600, color: '#7c3aed' }}>{p.charB}</span>
            <span style={{ marginLeft: 8, color: '#6b5e54' }}>共现 {p.coCount} 章</span>
          </div>
        ))}
      </div>
      {pairs.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84' }}>暂无角色数据。请在细纲中为各章添加角色信息。</div>}
    </div>
  )
}

// ====================== Romance Progress View ======================

function RomanceProgressView({ chapters }: { chapters: DetailedChapter[] }) {
  const items = chapters.map((ch, i) => {
    const chars = (ch.description || '').match(/[：:]\s*(.+)/)?.[1]?.split(/[,，、]/)?.map(s => s.trim()) || []
    return { order: i + 1, title: ch.title, chars, desc: ch.description?.slice(0, 200) || '' }
  })
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>感情线进度</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>
        基于章节细纲中的角色字段。请为各章标注男女主角以追踪感情线发展。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 12px', borderRadius: 8, background: i % 2 === 0 ? 'rgba(236,72,153,0.03)' : '#fff', border: '1px solid rgba(236,72,153,0.06)', fontSize: 11 }}>
            <span style={{ fontWeight: 600, minWidth: 50, color: '#ec4899' }}>第{item.order}章</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: '#2d2520', marginBottom: 2 }}>{item.title}</div>
              <div style={{ color: '#6b5e54' }}>角色: {item.chars.length > 0 ? item.chars.join('、') : '未标注'}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ====================== Cultivation Progress View ======================

function CultivationProgressView({ chapters }: { chapters: DetailedChapter[] }) {
  const items = chapters.map((ch, i) => ({
    order: i + 1, title: ch.title, desc: ch.description || ''
  }))
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 12 }}>修炼/等级进度</h3>
      <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>
        基于章节细纲描述中的等级信息。请在细纲描述中标注各章的等级变化（如"突破斗王→斗皇"）。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => {
          const levelMatch = item.desc.match(/等级[：:]\s*([^\n]+)/) || item.desc.match(/突破[至到]?\s*(\S+)/)
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, background: i % 2 === 0 ? 'rgba(22,163,74,0.03)' : '#fff', border: '1px solid rgba(22,163,74,0.06)', fontSize: 11 }}>
              <span style={{ fontWeight: 600, minWidth: 50, color: '#16a34a' }}>第{item.order}章</span>
              <span style={{ flex: 1, color: '#2d2520' }}>{item.title}</span>
              {levelMatch && (
                <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(22,163,74,0.08)', color: '#16a34a', fontWeight: 600 }}>
                  {levelMatch[1] || levelMatch[0]}
                </span>
              )}
              {!levelMatch && <span style={{ color: '#9b8e84', fontSize: 10 }}>未检测到等级信息</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
