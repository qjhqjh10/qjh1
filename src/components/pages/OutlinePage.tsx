import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import { sceneService } from '@/services/sceneService'
import { loadCharacters } from '@/services/characterService'
import { loadOutlineContent, saveOutlineContent, loadWorldbuildingContent, saveWorldbuildingContent } from '@/services/outlineService'
import { nanoid } from 'nanoid'
import WordCount from '@/components/common/WordCount'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import RichTextEditor from '@/components/common/RichTextEditor'
import CharactersPanel from '@/components/panels/CharactersPanel'
import { EntityEditModal } from '@/components/common/EntityEditModal'
import { loadOutlineData, saveOutlineData } from '@/utils/outlineData'
import {
  DocumentTextIcon, GlobeAltIcon, ListBulletIcon, FlagIcon, LightBulbIcon,
  UserGroupIcon, PlusIcon, TrashIcon, CubeIcon, MapPinIcon, ShieldCheckIcon,
  ArrowTrendingUpIcon, FaceSmileIcon,
} from '@heroicons/react/24/outline'
import type { DetailedChapter } from '@/types/chapter'
import type { ChapterSceneConfig, ForeshadowItem, PlotThread, OutlineMeta } from '@/types/story'
import type { OutlineItem, OutlineLocation, OutlineFaction, PowerSystem, EmotionData, EmotionSegment, OutlineItemsData, OutlineLocationsData, OutlineFactionsData } from '@/types/outline'
import { inputStyle } from '@/components/common/styles'

type Tab = 'basic' | 'worldbuilding' | 'characters' | 'items' | 'locations' | 'factions' | 'powerSystem' | 'foreshadow' | 'emotion' | 'threads'

/**
 * 大纲页 10 个 Tab 定义
 *
 * 故事剧情 (basic) — 核心剧情协作空间: 用户与AI在此讨论、碰撞和发展故事剧情。
 *   数据: outline/plot.md（纯文本/Markdown）。AI 可通过 edit_file 实时修改，界面自动刷新。
 *   设计意图: 多用、活用此 Tab，让AI成为创作伙伴而非一次性工具。
 *
 * 世界观（设定） (worldbuilding) — 世界观体系设定: 地理/政治/社会/历史/魔法科技。
 *   数据: outline/worldbuilding.md（纯文本/Markdown）。与故事剧情互补，前者聚焦"发生了什么"，
 *   后者聚焦"这个世界是怎样的"。
 *
 * 角色/道具/地点/势力/等级/伏笔/情绪/故事线 — 结构化数据管理。
 */
const TABS: { key: Tab; label: string; icon: typeof DocumentTextIcon }[] = [
  { key: 'basic', label: '故事剧情', icon: DocumentTextIcon },
  { key: 'worldbuilding', label: '世界观（设定）', icon: GlobeAltIcon },
  { key: 'characters', label: '角色', icon: UserGroupIcon },
  { key: 'items', label: '道具', icon: CubeIcon },
  { key: 'locations', label: '地点', icon: MapPinIcon },
  { key: 'factions', label: '势力', icon: ShieldCheckIcon },
  { key: 'powerSystem', label: '等级', icon: ArrowTrendingUpIcon },
  { key: 'foreshadow', label: '伏笔', icon: LightBulbIcon },
  { key: 'emotion', label: '情绪', icon: FaceSmileIcon },
  { key: 'threads', label: '故事线', icon: FlagIcon },
]

const THREAD_TYPES: { value: PlotThread['type']; label: string; color: string }[] = [
  { value: 'main', label: '主线', color: '#7c3aed' },
  { value: 'sub', label: '副线', color: '#3b82f6' },
  { value: 'hidden', label: '暗线', color: '#f59e0b' },
]

const THREAD_COLORS = ['#7c3aed', '#3b82f6', '#f59e0b', '#ec4899', '#16a34a', '#ef4444', '#8b5cf6', '#06b6d4']

const DEFAULT_OUTLINE_META: OutlineMeta = { foreshadowing: [], plotThreads: [], updatedAt: '' }

const mini: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', background: '#fff' }
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }
const fieldInput: React.CSSProperties = { ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%' }

const cardStyle: React.CSSProperties = { padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }

const ITEM_TYPES = ['武器', '法宝', '丹药', '功法', '道具', '其他']
const LOCATION_TYPES = ['门派', '城池', '秘境', '自然', '其他']
const FACTION_TYPES = ['正道', '邪道', '中立', '皇朝', '其他']

export default function OutlinePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const outlineContent = useStore(s => s.outlineContent)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)
  const setActivePage = useStore(s => s.setActivePage)
  const detailedChapters = useStore(s => s.detailedChapters)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)

  const [projectPath, setProjectPath] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const tab = searchParams.get('tab')
    if (tab && TABS.some(t => t.key === tab)) return tab as Tab
    return 'basic'
  })
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<OutlineMeta>(DEFAULT_OUTLINE_META)
  const [sceneConfigs, setSceneConfigs] = useState<Record<string, ChapterSceneConfig>>({})

  // Editing state for threads and foreshadowing
  const [editingThread, setEditingThread] = useState<PlotThread | null>(null)
  const [editingForeshadow, setEditingForeshadow] = useState<ForeshadowItem | null>(null)

  // Structured dimension data
  const [items, setItems] = useState<OutlineItem[]>([])
  const [locations, setLocations] = useState<OutlineLocation[]>([])
  const [factions, setFactions] = useState<OutlineFaction[]>([])
  const [powerSystem, setPowerSystem] = useState<PowerSystem>({ name: '', levels: [], description: '' })
  const [emotionData, setEmotionData] = useState<EmotionData>({ segments: [] })

  // Editing state for structured data
  const [editingItem, setEditingItem] = useState<OutlineItem | null>(null)
  const [editingLocation, setEditingLocation] = useState<OutlineLocation | null>(null)
  const [editingFaction, setEditingFaction] = useState<OutlineFaction | null>(null)
  const [editingEmotion, setEditingEmotion] = useState<EmotionSegment | null>(null)
  const [editingLevel, setEditingLevel] = useState('')
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null)

  const saveOutline = useCallback(async () => {
    if (!projectPath) return
    await saveOutlineContent(projectPath, outlineContent)
  }, [projectPath, outlineContent])

  // Auto-save on user edit (debounced 1s). Flag prevents saving during initial load.
  const outlineDirty = useRef(false)
  const handleOutlineChange = useCallback((text: string) => {
    setOutlineContent(text)
    outlineDirty.current = true
  }, [])
  useEffect(() => {
    if (!projectPath || !outlineDirty.current) return
    const timer = setTimeout(() => { saveOutlineContent(projectPath, outlineContent); outlineDirty.current = false }, 1000)
    return () => clearTimeout(timer)
  }, [outlineContent, projectPath])

  const wbDirty = useRef(false)
  const handleWbChange = useCallback((text: string) => {
    setWorldbuildingContent(text)
    wbDirty.current = true
  }, [])
  useEffect(() => {
    if (!projectPath || !wbDirty.current) return
    const timer = setTimeout(() => { saveWorldbuildingContent(projectPath, worldbuildingContent); wbDirty.current = false }, 1000)
    return () => clearTimeout(timer)
  }, [worldbuildingContent, projectPath])

  // Let AI assistant know which page we're on
  useEffect(() => { setActivePage(activeTab === 'worldbuilding' ? 'worldbuilding' : activeTab === 'characters' ? 'characters' : 'outline') }, [activeTab])

  // Sync tab to URL
  useEffect(() => {
    const currentTab = searchParams.get('tab')
    if (activeTab !== currentTab && activeTab !== 'basic') {
      setSearchParams({ tab: activeTab }, { replace: true })
    } else if (activeTab === 'basic' && currentTab) {
      setSearchParams({}, { replace: true })
    }
  }, [activeTab])

  // Load data
  useEffect(() => {
    if (!activeProjectId) { navigate('/'); return }
    if (!projectsBasePath) { return }
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)
    setLoading(true)

    Promise.all([
      loadOutlineContent(pp).then(c => { setOutlineContent(c) }),
      loadWorldbuildingContent(pp).then(c => { setWorldbuildingContent(c) }),
      loadCharacters(pp).then(chars => { useStore.getState().setCharacters(chars) }),
      fileService.read(`${pp}/outline/outline_meta.json`).then(c => {
        try { setMeta(JSON.parse(c) as OutlineMeta) } catch { setMeta(DEFAULT_OUTLINE_META) }
      }).catch(() => { setMeta(DEFAULT_OUTLINE_META) }),
      sceneService.listSceneConfigs(pp).then(configs => {
        const map: Record<string, ChapterSceneConfig> = {}
        configs.forEach(c => { map[c.chapterId] = c })
        setSceneConfigs(map)
      }),
      // Load structured dimension data
      loadOutlineData<OutlineItemsData>(pp, 'items.json', { items: [] }).then(d => setItems(d.items)),
      loadOutlineData<OutlineLocationsData>(pp, 'locations.json', { locations: [] }).then(d => setLocations(d.locations)),
      loadOutlineData<OutlineFactionsData>(pp, 'factions.json', { factions: [] }).then(d => setFactions(d.factions)),
      loadOutlineData<PowerSystem>(pp, 'power_system.json', { name: '', levels: [], description: '' }).then(d => {
        const normalized: PowerSystem = {
          ...d,
          levels: (d.levels || []).map(l => typeof l === 'string' ? { name: l as unknown as string, description: '' } : l)
        }
        setPowerSystem(normalized)
      }),
      loadOutlineData<EmotionData>(pp, 'emotion.json', { segments: [] }).then(setEmotionData),
    ]).finally(() => setLoading(false))
  }, [activeProjectId, projectsBasePath])

  // AI direct edit via edit_file → reload editor with clean content
  useEffect(() => {
    if (!fileEditNotify || !projectPath) return
    const normalized = fileEditNotify.filePath.replace(/\\/g, '/')
    const pp = projectPath.replace(/\\/g, '/')
    const outlinePath = `${pp}/outline/plot.md`
    const outlineJsonPath = `${pp}/outline/plot.json` // backward compat
    const outlineLegacyPath = `${pp}/outline/outline.json` // backward compat
    const wbPath = `${pp}/outline/worldbuilding.md`
    const wbJsonPath = `${pp}/outline/worldbuilding.json` // backward compat
    const metaPath = `${pp}/outline/outline_meta.json`
    const itemsPath = `${pp}/outline/items.json`
    const locationsPath = `${pp}/outline/locations.json`
    const factionsPath = `${pp}/outline/factions.json`
    const powerPath = `${pp}/outline/power_system.json`
    const emotionPath = `${pp}/outline/emotion.json`

    if (normalized === outlinePath || normalized === outlineJsonPath || normalized === outlineLegacyPath) {
      if (fileEditNotify.newContent === '__AI_EDITED__') {
        loadOutlineContent(projectPath).then(setOutlineContent)
      } else {
        setOutlineContent(fileEditNotify.newContent)
      }
    } else if (normalized === wbPath || normalized === wbJsonPath) {
      if (fileEditNotify.newContent === '__AI_EDITED__') {
        loadWorldbuildingContent(projectPath).then(setWorldbuildingContent)
      } else {
        setWorldbuildingContent(fileEditNotify.newContent)
      }
    } else if (normalized === metaPath) {
      if (fileEditNotify.newContent === '__AI_EDITED__') {
        fileService.read(`${pp}/outline/outline_meta.json`).then(c => {
          try { setMeta(JSON.parse(c) as OutlineMeta) } catch {}
        }).catch(() => {})
      } else {
        try { setMeta(JSON.parse(fileEditNotify.newContent) as OutlineMeta) } catch {}
      }
    } else if (normalized === itemsPath) {
      loadOutlineData<OutlineItemsData>(projectPath, 'items.json', { items: [] }).then(d => setItems(d.items))
    } else if (normalized === locationsPath) {
      loadOutlineData<OutlineLocationsData>(projectPath, 'locations.json', { locations: [] }).then(d => setLocations(d.locations))
    } else if (normalized === factionsPath) {
      loadOutlineData<OutlineFactionsData>(projectPath, 'factions.json', { factions: [] }).then(d => setFactions(d.factions))
    } else if (normalized === powerPath) {
      loadOutlineData<PowerSystem>(projectPath, 'power_system.json', { name: '', levels: [], description: '' }).then(d => {
        setPowerSystem({ ...d, levels: (d.levels || []).map(l => typeof l === 'string' ? { name: l as unknown as string, description: '' } : l) })
      })
    } else if (normalized === emotionPath) {
      loadOutlineData<EmotionData>(projectPath, 'emotion.json', { segments: [] }).then(setEmotionData)
    }
    setFileEditNotify(null)
  }, [fileEditNotify])

  const handleSaveWorldbuilding = useCallback(async () => {
    if (!projectPath) return
    await saveWorldbuildingContent(projectPath, worldbuildingContent)
  }, [projectPath, worldbuildingContent])

  const saveMeta = async (newMeta: OutlineMeta) => {
    setMeta(newMeta)
    await fileService.write(`${projectPath}/outline/outline_meta.json`, JSON.stringify({ ...newMeta, updatedAt: new Date().toISOString() }, null, 2))
  }

  // ---- Threads ----
  const handleAddThread = () => { setEditingThread({ id: nanoid(6), name: '', type: 'main', color: THREAD_COLORS[0], chapterIds: [] }) }
  const handleSaveThread = async () => {
    if (!editingThread || !editingThread.name.trim()) return
    const pts = meta.plotThreads || []
    const threads = pts.find(t => t.id === editingThread.id)
      ? pts.map(t => t.id === editingThread.id ? editingThread : t)
      : [...pts, editingThread]
    await saveMeta({ ...meta, plotThreads: threads })
    setEditingThread(null)
  }
  const handleDeleteThread = async (id: string) => { await saveMeta({ ...meta, plotThreads: (meta.plotThreads || []).filter(t => t.id !== id) }) }

  // ---- Foreshadowing ----
  const handleAddForeshadow = () => { setEditingForeshadow({ id: nanoid(6), description: '', plantChapterId: '', payoffChapterId: '', status: 'planted' }) }
  const handleSaveForeshadow = async () => {
    if (!editingForeshadow || !editingForeshadow.description.trim()) return
    const fs = meta.foreshadowing || []
    const items = fs.find(f => f.id === editingForeshadow.id)
      ? fs.map(f => f.id === editingForeshadow.id ? editingForeshadow : f)
      : [...fs, editingForeshadow]
    await saveMeta({ ...meta, foreshadowing: items })
    setEditingForeshadow(null)
  }
  const handleDeleteForeshadow = async (id: string) => { await saveMeta({ ...meta, foreshadowing: (meta.foreshadowing || []).filter(f => f.id !== id) }) }
  const handleToggleForeshadow = async (item: ForeshadowItem) => {
    const updated = { ...item, status: item.status === 'planted' ? 'resolved' as const : 'planted' as const }
    await saveMeta({ ...meta, foreshadowing: (meta.foreshadowing || []).map(f => f.id === item.id ? updated : f) })
  }

  // ---- Structured data CRUD helpers ----
  const saveItems = async (next: OutlineItem[]) => { setItems(next); await saveOutlineData(projectPath, 'items.json', { items: next }) }
  const saveLocations = async (next: OutlineLocation[]) => { setLocations(next); await saveOutlineData(projectPath, 'locations.json', { locations: next }) }
  const saveFactions = async (next: OutlineFaction[]) => { setFactions(next); await saveOutlineData(projectPath, 'factions.json', { factions: next }) }
  const savePowerSystem = async (next: PowerSystem) => { setPowerSystem(next); await saveOutlineData(projectPath, 'power_system.json', next) }
  const saveEmotion = async (next: EmotionData) => { setEmotionData(next); await saveOutlineData(projectPath, 'emotion.json', next) }

  // ---- Render structured CRUD list ----
  const renderStructuredList = <T extends { id: string; name: string }>(
    data: T[],
    onAdd: () => void,
    onEdit: (item: T) => void,
    onDelete: (id: string) => void,
    getDetail: (item: T) => string,
    getTypeBadge?: (item: T) => string | undefined,
  ) => (
    <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(data || []).map(item => (
          <div key={item.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>{item.name || '未命名'}</span>
                {getTypeBadge && getTypeBadge(item) && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>{getTypeBadge(item)}</span>}
              </div>
              <p style={{ fontSize: 11, color: '#6b5e54', margin: '2px 0 0', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getDetail(item)}</p>
            </div>
            <button onClick={() => onEdit(item)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>编辑</button>
            <button onClick={() => onDelete(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
          </div>
        ))}
        {(data || []).length === 0 && <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>暂无数据</div>}
        <button onClick={onAdd} style={{ padding: '10px 14px', borderRadius: 12, border: '1px dashed rgba(0,0,0,0.1)', background: 'transparent', cursor: 'pointer', fontSize: 11, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6 }}>
          <PlusIcon style={{ width: 14, height: 14 }} />添加
        </button>
      </div>
    </ScrollArea>
  )

  // ---- Render main content by tab ----
  const renderMainContent = () => {
    switch (activeTab) {
      case 'basic':
        return (
          <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
            <RichTextEditor
              content={outlineContent}
              onContentChange={handleOutlineChange}
              placeholder="故事剧情协作空间。直接输入，或让 AI 帮你整理。支持标题、列表、图片、排版..."
            />
          </div>
        )
      case 'worldbuilding':
        return (
          <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
            <RichTextEditor
              content={worldbuildingContent}
              onContentChange={handleWbChange}
              placeholder="世界观设定。直接输入，或让 AI 帮你整理。支持标题、列表、图片、排版..."
            />
          </div>
        )
      case 'characters':
        return <CharactersPanel showWorldbuildingPanel={false} standalone={false} />
      case 'items':
        return renderStructuredList(items,
          () => setEditingItem({ id: nanoid(6), name: '', type: '道具', grade: '', ability: '', owner: '' }),
          item => setEditingItem({ ...item }),
          async id => await saveItems(items.filter(i => i.id !== id)),
          item => item.ability || item.owner || '暂无描述',
          item => item.type,
        )
      case 'locations':
        return renderStructuredList(locations,
          () => setEditingLocation({ id: nanoid(6), name: '', description: '', type: '' }),
          loc => setEditingLocation({ ...loc }),
          async id => await saveLocations(locations.filter(l => l.id !== id)),
          loc => loc.description || '暂无描述',
          loc => loc.type,
        )
      case 'factions':
        return renderStructuredList(factions,
          () => setEditingFaction({ id: nanoid(6), name: '', description: '', type: '' }),
          f => setEditingFaction({ ...f }),
          async id => await saveFactions(factions.filter(f => f.id !== id)),
          f => f.description || '暂无描述',
          f => f.type,
        )
      case 'powerSystem':
        return (
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={cardStyle}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>体系名称</div>
                <input value={powerSystem.name} onChange={e => setPowerSystem({ ...powerSystem, name: e.target.value })} onBlur={() => savePowerSystem(powerSystem)} placeholder="如: 修仙等级" style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%' }} />
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>等级列表</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {(powerSystem.levels || []).map((lv, i) => {
                    const isSelected = selectedLevel === i
                    return (
                      <span key={i} onClick={() => setSelectedLevel(isSelected ? null : i)} style={{ padding: '4px 10px', borderRadius: 8, cursor: 'pointer', background: isSelected ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.06)', border: isSelected ? '1px solid #7c3aed' : '1px solid rgba(124,58,237,0.15)', fontSize: 11, color: '#7c3aed', fontWeight: isSelected ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {lv.name}
                        <button onClick={e => { e.stopPropagation(); const next = { ...powerSystem, levels: powerSystem.levels.filter((_, j) => j !== i) }; setPowerSystem(next); savePowerSystem(next); if (selectedLevel === i) setSelectedLevel(null); else if (selectedLevel !== null && selectedLevel > i) setSelectedLevel(selectedLevel - 1) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 0, lineHeight: 1 }}>×</button>
                      </span>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={editingLevel} onChange={e => setEditingLevel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && editingLevel.trim()) { const next = { ...powerSystem, levels: [...powerSystem.levels, { name: editingLevel.trim(), description: '' }] }; setPowerSystem(next); savePowerSystem(next); setEditingLevel('') } }} placeholder="输入等级名称，回车添加" style={{ ...inputStyle, fontSize: 11, padding: '4px 8px', flex: 1 }} />
                  <Button size="sm" variant="secondary" onClick={() => { if (editingLevel.trim()) { const next = { ...powerSystem, levels: [...powerSystem.levels, { name: editingLevel.trim(), description: '' }] }; setPowerSystem(next); savePowerSystem(next); setEditingLevel('') } }}>添加</Button>
                </div>
              </div>
              {selectedLevel !== null && selectedLevel < (powerSystem.levels || []).length && (
                <div style={cardStyle}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>「{(powerSystem.levels || [])[selectedLevel]?.name}」描述</div>
                  <input value={(powerSystem.levels || [])[selectedLevel]?.name} onChange={e => { const next = { ...powerSystem, levels: (powerSystem.levels || []).map((l, j) => j === selectedLevel ? { ...l, name: e.target.value } : l) }; setPowerSystem(next) }} onBlur={() => savePowerSystem(powerSystem)} placeholder="等级名称" style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%', marginBottom: 6 }} />
                  <textarea value={(powerSystem.levels || [])[selectedLevel]?.description} onChange={e => { const next = { ...powerSystem, levels: (powerSystem.levels || []).map((l, j) => j === selectedLevel ? { ...l, description: e.target.value } : l) }; setPowerSystem(next) }} onBlur={() => savePowerSystem(powerSystem)} rows={3} placeholder="描述该等级的能力、特征、晋升条件等..." style={{ ...inputStyle, fontSize: 12, padding: '8px 10px', width: '100%', resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }} />
                </div>
              )}
              <div style={cardStyle}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>体系描述</div>
                <textarea value={powerSystem.description} onChange={e => setPowerSystem({ ...powerSystem, description: e.target.value })} onBlur={() => savePowerSystem(powerSystem)} rows={4} placeholder="描述等级体系的规则、晋升条件等..." style={{ ...inputStyle, fontSize: 12, padding: '8px 10px', width: '100%', resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }} />
              </div>
            </div>
          </ScrollArea>
        )
      case 'foreshadow':
        return (
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 80px 50px', gap: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#9b8e84' }}>
                <span>描述</span><span>埋设章节</span><span>回收章节</span><span>状态</span><span></span>
              </div>
              {(meta.foreshadowing || []).map(f => {
                const plantCh = detailedChapters.find(c => c.id === f.plantChapterId)
                const payoffCh = detailedChapters.find(c => c.id === f.payoffChapterId)
                return (
                  <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 80px 50px', gap: 8, padding: '8px 10px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', alignItems: 'center', fontSize: 11 }}>
                    <span style={{ color: '#2d2520' }}>{f.description}</span>
                    <span style={{ fontSize: 10, color: '#6b5e54' }}>{plantCh?.title || '未指定'}</span>
                    <span style={{ fontSize: 10, color: '#6b5e54' }}>{payoffCh?.title || '待回收'}</span>
                    <button onClick={() => handleToggleForeshadow(f)} style={{ padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, background: f.status === 'resolved' ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.1)', color: f.status === 'resolved' ? '#16a34a' : '#f59e0b' }}>
                      {f.status === 'resolved' ? '已回收' : '已埋'}
                    </button>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button onClick={() => setEditingForeshadow({ ...f })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: '#7c3aed' }}>编辑</button>
                      <button onClick={() => handleDeleteForeshadow(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 10, height: 10 }} /></button>
                    </div>
                  </div>
                )
              })}
              <button onClick={handleAddForeshadow} style={{ padding: '8px 14px', borderRadius: 12, border: '1px dashed rgba(0,0,0,0.1)', background: 'transparent', cursor: 'pointer', fontSize: 11, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6 }}>
                <PlusIcon style={{ width: 14, height: 14 }} />添加伏笔
              </button>
            </div>
          </ScrollArea>
        )
      case 'emotion':
        return (
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(emotionData.segments || []).map((seg, i) => (
                <div key={i} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#7c3aed', minWidth: 60 }}>第{seg.chapterStart}-{seg.chapterEnd}章</span>
                  <span style={{ fontSize: 12, color: '#2d2520', flex: 1 }}>{seg.dominantEmotion}</span>
                  <button onClick={() => setEditingEmotion({ ...seg })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>编辑</button>
                  <button onClick={() => saveEmotion({ segments: (emotionData.segments || []).filter((_, j: number) => j !== i) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
                </div>
              ))}
              {(emotionData.segments || []).length === 0 && <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>暂无情绪模板</div>}
              <button onClick={() => setEditingEmotion({ chapterStart: 1, chapterEnd: 10, dominantEmotion: '' })} style={{ padding: '8px 14px', borderRadius: 12, border: '1px dashed rgba(0,0,0,0.1)', background: 'transparent', cursor: 'pointer', fontSize: 11, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6 }}>
                <PlusIcon style={{ width: 14, height: 14 }} />添加情绪段
              </button>
            </div>
          </ScrollArea>
        )
      case 'threads':
        return (
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(meta.plotThreads || []).map(t => (
                <div key={t.id} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: `1px solid ${t.color}33` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', flex: 1 }}>{t.name}</span>
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: t.color + '18', color: t.color, fontWeight: 600 }}>{THREAD_TYPES.find(tt => tt.value === t.type)?.label}</span>
                    <span style={{ fontSize: 10, color: '#9b8e84' }}>{(t.chapterIds || []).length} 章</span>
                    <button onClick={() => setEditingThread({ ...t })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>编辑</button>
                    <button onClick={() => handleDeleteThread(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
                  </div>
                  {(t.chapterIds || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {(t.chapterIds || []).map(cid => { const ch = detailedChapters.find(d => d.id === cid); return <span key={cid} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.03)', color: '#6b5e54' }}>{ch?.title || cid}</span> })}
                    </div>
                  )}
                </div>
              ))}
              <button onClick={handleAddThread} style={{ padding: '10px 14px', borderRadius: 12, border: '1px dashed rgba(0,0,0,0.1)', background: 'transparent', cursor: 'pointer', fontSize: 11, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6 }}>
                <PlusIcon style={{ width: 14, height: 14 }} />添加故事线
              </button>
            </div>
          </ScrollArea>
        )
    }
  }

  if (!activeProjectId) return null
  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ fontSize: 14, color: '#9b8e84' }}>加载中...</p></div>

  const TAB_LABELS: Record<Tab, string> = {
    basic: '故事剧情', worldbuilding: '世界观（设定）', characters: '角色档案',
    items: '道具管理', locations: '地点管理', factions: '势力管理',
    powerSystem: '等级体系', foreshadow: '伏笔追踪', emotion: '情绪模板', threads: '故事线管理',
  }

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left tabs */}
        <div style={{ width: 140, minWidth: 140, borderRight: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column', padding: '12px 6px', gap: 2, overflowY: 'auto' }} className="custom-scrollbar">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 10, border: 'none',
              background: activeTab === tab.key ? 'rgba(124,58,237,0.08)' : 'transparent',
              color: activeTab === tab.key ? '#7c3aed' : '#6b5e54',
              fontWeight: activeTab === tab.key ? 700 : 400, fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.1s',
            }}>
              <tab.icon style={{ width: 14, height: 14 }} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>{TAB_LABELS[activeTab]}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {activeTab === 'basic' && <WordCount text={outlineContent} />}
              {activeTab === 'worldbuilding' && <WordCount text={worldbuildingContent} />}
            </div>
          </div>
          {renderMainContent()}
        </div>
      </div>

      {/* Thread editing modal */}
      {editingThread && (
        <EntityEditModal
          title={editingThread.name ? '编辑故事线' : '新建故事线'}
          onClose={() => setEditingThread(null)}
          onSave={handleSaveThread}
        >
          <div><div style={fieldLabel}>名称</div><input value={editingThread.name} onChange={e => setEditingThread({ ...editingThread, name: e.target.value })} placeholder="如: 主角复仇线" style={fieldInput} /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><div style={fieldLabel}>类型</div><select value={editingThread.type} onChange={e => setEditingThread({ ...editingThread, type: e.target.value as PlotThread['type'] })} style={{ ...mini, width: '100%' }}>{THREAD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div style={{ flex: 1 }}><div style={fieldLabel}>颜色</div><div style={{ display: 'flex', gap: 4 }}>{THREAD_COLORS.map(c => <button key={c} onClick={() => setEditingThread({ ...editingThread, color: c })} style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: editingThread.color === c ? '2px solid #2d2520' : '2px solid transparent', cursor: 'pointer' }} />)}</div></div>
          </div>
          <div><div style={fieldLabel}>关联章节</div>
            <details><summary style={{ fontSize: 11, color: '#7c3aed', cursor: 'pointer' }}>已选 {(editingThread.chapterIds || []).length} 章</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, maxHeight: 160, overflow: 'auto' }}>
                {detailedChapters.map((ch, idx) => <label key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}><input type="checkbox" checked={(editingThread.chapterIds || []).includes(ch.id)} onChange={() => setEditingThread({ ...editingThread, chapterIds: (editingThread.chapterIds || []).includes(ch.id) ? (editingThread.chapterIds || []).filter(id => id !== ch.id) : [...(editingThread.chapterIds || []), ch.id] })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />第{idx + 1}章: {ch.title || '未命名'}</label>)}
              </div>
            </details>
          </div>
        </EntityEditModal>
      )}

      {/* Foreshadow editing modal */}
      {editingForeshadow && (
        <EntityEditModal
          title={editingForeshadow.description ? '编辑伏笔' : '新建伏笔'}
          onClose={() => setEditingForeshadow(null)}
          onSave={handleSaveForeshadow}
        >
          <div><div style={fieldLabel}>描述</div><input value={editingForeshadow.description} onChange={e => setEditingForeshadow({ ...editingForeshadow, description: e.target.value })} placeholder="如: 第1章提到主角母亲的遗物" style={fieldInput} /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><div style={fieldLabel}>埋设章节</div><select value={editingForeshadow.plantChapterId} onChange={e => setEditingForeshadow({ ...editingForeshadow, plantChapterId: e.target.value })} style={{ ...mini, width: '100%' }}><option value="">未选择</option>{detailedChapters.map((ch, idx) => <option key={ch.id} value={ch.id}>第{idx + 1}章: {ch.title}</option>)}</select></div>
            <div style={{ flex: 1 }}><div style={fieldLabel}>回收章节</div><select value={editingForeshadow.payoffChapterId} onChange={e => setEditingForeshadow({ ...editingForeshadow, payoffChapterId: e.target.value })} style={{ ...mini, width: '100%' }}><option value="">未选择</option>{detailedChapters.map((ch, idx) => <option key={ch.id} value={ch.id}>第{idx + 1}章: {ch.title}</option>)}</select></div>
          </div>
        </EntityEditModal>
      )}

      {/* Item editing modal */}
      {editingItem && (
        <EntityEditModal
          title={editingItem.name ? '编辑道具' : '新建道具'}
          onClose={() => setEditingItem(null)}
          onSave={async () => { if (!editingItem.name.trim()) return; const next = items.find(i => i.id === editingItem.id) ? items.map(i => i.id === editingItem.id ? editingItem : i) : [...items, editingItem]; await saveItems(next); setEditingItem(null) }}
        >
          <div><div style={fieldLabel}>名称</div><input value={editingItem.name} onChange={e => setEditingItem({ ...editingItem, name: e.target.value })} style={fieldInput} /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><div style={fieldLabel}>类型</div><select value={editingItem.type} onChange={e => setEditingItem({ ...editingItem, type: e.target.value })} style={{ ...mini, width: '100%' }}>{ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div style={{ flex: 1 }}><div style={fieldLabel}>品级</div><input value={editingItem.grade || ''} onChange={e => setEditingItem({ ...editingItem, grade: e.target.value })} placeholder="如: 灵器" style={fieldInput} /></div>
          </div>
          <div><div style={fieldLabel}>能力</div><textarea value={editingItem.ability || ''} onChange={e => setEditingItem({ ...editingItem, ability: e.target.value })} rows={3} style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%', resize: 'vertical', fontFamily: 'inherit' }} /></div>
          <div><div style={fieldLabel}>持有者</div><input value={editingItem.owner || ''} onChange={e => setEditingItem({ ...editingItem, owner: e.target.value })} style={fieldInput} /></div>
        </EntityEditModal>
      )}

      {/* Location editing modal */}
      {editingLocation && (
        <EntityEditModal
          title={editingLocation.name ? '编辑地点' : '新建地点'}
          onClose={() => setEditingLocation(null)}
          onSave={async () => { if (!editingLocation.name.trim()) return; const next = locations.find(l => l.id === editingLocation.id) ? locations.map(l => l.id === editingLocation.id ? editingLocation : l) : [...locations, editingLocation]; await saveLocations(next); setEditingLocation(null) }}
        >
          <div><div style={fieldLabel}>名称</div><input value={editingLocation.name} onChange={e => setEditingLocation({ ...editingLocation, name: e.target.value })} style={fieldInput} /></div>
          <div><div style={fieldLabel}>类型</div><select value={editingLocation.type || ''} onChange={e => setEditingLocation({ ...editingLocation, type: e.target.value })} style={{ ...mini, width: '100%' }}><option value="">未分类</option>{LOCATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><div style={fieldLabel}>描述</div><textarea value={editingLocation.description} onChange={e => setEditingLocation({ ...editingLocation, description: e.target.value })} rows={3} style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%', resize: 'vertical', fontFamily: 'inherit' }} /></div>
        </EntityEditModal>
      )}

      {/* Faction editing modal */}
      {editingFaction && (
        <EntityEditModal
          title={editingFaction.name ? '编辑势力' : '新建势力'}
          onClose={() => setEditingFaction(null)}
          onSave={async () => { if (!editingFaction.name.trim()) return; const next = factions.find(f => f.id === editingFaction.id) ? factions.map(f => f.id === editingFaction.id ? editingFaction : f) : [...factions, editingFaction]; await saveFactions(next); setEditingFaction(null) }}
        >
          <div><div style={fieldLabel}>名称</div><input value={editingFaction.name} onChange={e => setEditingFaction({ ...editingFaction, name: e.target.value })} style={fieldInput} /></div>
          <div><div style={fieldLabel}>类型</div><select value={editingFaction.type || ''} onChange={e => setEditingFaction({ ...editingFaction, type: e.target.value })} style={{ ...mini, width: '100%' }}><option value="">未分类</option>{FACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><div style={fieldLabel}>描述</div><textarea value={editingFaction.description} onChange={e => setEditingFaction({ ...editingFaction, description: e.target.value })} rows={3} style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%', resize: 'vertical', fontFamily: 'inherit' }} /></div>
        </EntityEditModal>
      )}

      {/* Emotion editing modal */}
      {editingEmotion && (
        <EntityEditModal
          title="编辑情绪段"
          onClose={() => setEditingEmotion(null)}
          onSave={async () => { if (!editingEmotion.dominantEmotion.trim()) return; const segs = emotionData.segments || []; const exists = segs.some((s, i) => s.chapterStart === editingEmotion.chapterStart && s.chapterEnd === editingEmotion.chapterEnd); const next = exists ? segs.map(s => s.chapterStart === editingEmotion.chapterStart && s.chapterEnd === editingEmotion.chapterEnd ? editingEmotion : s) : [...segs, editingEmotion]; await saveEmotion({ segments: next }); setEditingEmotion(null) }}
          width={380}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><div style={fieldLabel}>起始章</div><input type="number" value={editingEmotion.chapterStart} onChange={e => setEditingEmotion({ ...editingEmotion, chapterStart: parseInt(e.target.value) || 1 })} style={fieldInput} /></div>
            <div style={{ flex: 1 }}><div style={fieldLabel}>结束章</div><input type="number" value={editingEmotion.chapterEnd} onChange={e => setEditingEmotion({ ...editingEmotion, chapterEnd: parseInt(e.target.value) || 1 })} style={fieldInput} /></div>
          </div>
          <div><div style={fieldLabel}>主导情绪</div><input value={editingEmotion.dominantEmotion} onChange={e => setEditingEmotion({ ...editingEmotion, dominantEmotion: e.target.value })} placeholder="如: 压抑、热血、温馨" style={fieldInput} /></div>
        </EntityEditModal>
      )}
    </div>
  )
}
