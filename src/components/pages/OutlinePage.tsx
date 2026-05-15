import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/store'
import { fileService } from '@/services/fileService'
import { sceneService } from '@/services/sceneService'
import { loadCharacters } from '@/services/characterService'
import { nanoid } from 'nanoid'
import { useFileSync } from '@/hooks/useFileSync'
import WordCount from '@/components/common/WordCount'
import Button from '@/components/common/Button'
import RichTextEditor from '@/components/common/RichTextEditor'
import ScrollArea from '@/components/common/ScrollArea'
import { logError } from '@/utils/logger'
import {
  DocumentTextIcon, GlobeAltIcon, ListBulletIcon, FlagIcon, LightBulbIcon,
  UserIcon, PlusIcon, TrashIcon, CheckCircleIcon, SparklesIcon,
} from '@heroicons/react/24/outline'
import type { Character } from '@/types/character'
import type { DetailedChapter } from '@/types/chapter'
import type { ChapterSceneConfig, ForeshadowItem, PlotThread, OutlineMeta } from '@/types/story'
import { inputStyle } from '@/components/common/styles'

type Tab = 'outline' | 'worldbuilding' | 'chapters' | 'threads' | 'foreshadow'

const TABS: { key: Tab; label: string; icon: typeof DocumentTextIcon }[] = [
  { key: 'outline', label: '大纲', icon: DocumentTextIcon },
  { key: 'worldbuilding', label: '世界观', icon: GlobeAltIcon },
  { key: 'chapters', label: '细纲', icon: ListBulletIcon },
  { key: 'threads', label: '故事线', icon: FlagIcon },
  { key: 'foreshadow', label: '伏笔', icon: LightBulbIcon },
]

const THREAD_TYPES: { value: PlotThread['type']; label: string; color: string }[] = [
  { value: 'main', label: '主线', color: '#7c3aed' },
  { value: 'sub', label: '副线', color: '#3b82f6' },
  { value: 'hidden', label: '暗线', color: '#f59e0b' },
]

const THREAD_COLORS = ['#7c3aed', '#3b82f6', '#f59e0b', '#ec4899', '#16a34a', '#ef4444', '#8b5cf6', '#06b6d4']

const STATUS_LABELS: Record<string, string> = { outline: '大纲', draft: '草稿', revising: '修改', final: '终稿' }
const STATUS_COLORS: Record<string, string> = { outline: '#f59e0b', draft: '#e67e00', revising: '#2563eb', final: '#16a34a' }

const DEFAULT_OUTLINE_META: OutlineMeta = {
  foreshadowing: [],
  plotThreads: [],
  updatedAt: '',
}

const mini: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', background: '#fff' }

function CharDetail({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: '#4a3f38' }}>{value}</div>
    </div>
  )
}

export default function OutlinePage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const outlineContent = useStore(s => s.outlineContent)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)
  const characters = useStore(s => s.characters)
  const setCharacters = useStore(s => s.setCharacters)
  const detailedChapters = useStore(s => s.detailedChapters)

  const [projectPath, setProjectPath] = useState('')
  const [outlinePath, setOutlinePath] = useState<string | null>(null)
  const [worldbuildingPath, setWorldbuildingPath] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('outline')
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<OutlineMeta>(DEFAULT_OUTLINE_META)
  const [sceneConfigs, setSceneConfigs] = useState<Record<string, ChapterSceneConfig>>({})
  const [selectedChar, setSelectedChar] = useState<Character | null>(null)

  // Editing state for threads and foreshadowing
  const [editingThread, setEditingThread] = useState<PlotThread | null>(null)
  const [editingForeshadow, setEditingForeshadow] = useState<ForeshadowItem | null>(null)

  const { save: saveOutline } = useFileSync(outlinePath, outlineContent, setOutlineContent)

  // Load data
  useEffect(() => {
    if (!activeProjectId) { navigate('/'); return }
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)
    setLoading(true)

    const op = `${pp}/outline/outline.txt`
    const wp = `${pp}/worldbuilding/worldbuilding.txt`
    setOutlinePath(op)
    setWorldbuildingPath(wp)

    // Load outline
    fileService.read(op).then(c => { setOutlineContent(c) }).catch(() => {})
    // Load worldbuilding
    fileService.read(wp).then(c => { setWorldbuildingContent(c) }).catch(() => {})
    // Load characters
    loadCharacters(pp).then(chars => { setCharacters(chars) })
    // Load outline meta
    fileService.read(`${pp}/outline/outline_meta.json`).then(c => {
      try { setMeta(JSON.parse(c) as OutlineMeta) } catch { setMeta(DEFAULT_OUTLINE_META) }
    }).catch(() => { setMeta(DEFAULT_OUTLINE_META) })
    // Load scene configs
    sceneService.listSceneConfigs(pp).then(configs => {
      const map: Record<string, ChapterSceneConfig> = {}
      configs.forEach(c => { map[c.chapterId] = c })
      setSceneConfigs(map)
    })

    setLoading(false)
  }, [activeProjectId, projectsBasePath])

  // Save worldbuilding
  const handleSaveWorldbuilding = useCallback(async () => {
    if (!worldbuildingPath) return
    await fileService.write(worldbuildingPath, worldbuildingContent)
  }, [worldbuildingPath, worldbuildingContent])

  // Save outline meta
  const saveMeta = async (newMeta: OutlineMeta) => {
    setMeta(newMeta)
    const mp = `${projectPath}/outline/outline_meta.json`
    await fileService.write(mp, JSON.stringify({ ...newMeta, updatedAt: new Date().toISOString() }, null, 2))
  }

  // ---- Story Threads ----
  const handleAddThread = () => {
    const t: PlotThread = { id: nanoid(6), name: '', type: 'main', color: THREAD_COLORS[0], chapterIds: [] }
    setEditingThread(t)
  }
  const handleSaveThread = async () => {
    if (!editingThread || !editingThread.name.trim()) return
    const threads = meta.plotThreads.find(t => t.id === editingThread.id)
      ? meta.plotThreads.map(t => t.id === editingThread.id ? editingThread : t)
      : [...meta.plotThreads, editingThread]
    await saveMeta({ ...meta, plotThreads: threads })
    setEditingThread(null)
  }
  const handleDeleteThread = async (id: string) => {
    await saveMeta({ ...meta, plotThreads: meta.plotThreads.filter(t => t.id !== id) })
  }

  // ---- Foreshadowing ----
  const handleAddForeshadow = () => {
    const f: ForeshadowItem = { id: nanoid(6), description: '', plantChapterId: '', payoffChapterId: '', status: 'planted' }
    setEditingForeshadow(f)
  }
  const handleSaveForeshadow = async () => {
    if (!editingForeshadow || !editingForeshadow.description.trim()) return
    const items = meta.foreshadowing.find(f => f.id === editingForeshadow.id)
      ? meta.foreshadowing.map(f => f.id === editingForeshadow.id ? editingForeshadow : f)
      : [...meta.foreshadowing, editingForeshadow]
    await saveMeta({ ...meta, foreshadowing: items })
    setEditingForeshadow(null)
  }
  const handleDeleteForeshadow = async (id: string) => {
    await saveMeta({ ...meta, foreshadowing: meta.foreshadowing.filter(f => f.id !== id) })
  }
  const handleToggleForeshadow = async (item: ForeshadowItem) => {
    const updated = { ...item, status: item.status === 'planted' ? 'resolved' as const : 'planted' as const }
    await saveMeta({
      ...meta,
      foreshadowing: meta.foreshadowing.map(f => f.id === item.id ? updated : f),
    })
  }

  // ---- Render main content by tab ----
  const renderMainContent = () => {
    switch (activeTab) {
      case 'outline':
        return (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
            <div className="custom-scrollbar" style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
              <RichTextEditor
                content={outlineContent}
                onContentChange={setOutlineContent}
                placeholder="在这里编写你的小说大纲..."
              />
            </div>
          </div>
        )
      case 'worldbuilding':
        return (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
            <div className="custom-scrollbar" style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
              <RichTextEditor
                content={worldbuildingContent}
                onContentChange={setWorldbuildingContent}
                placeholder="在这里编写你的世界观设定..."
              />
            </div>
          </div>
        )
      case 'chapters':
        return (
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {detailedChapters.map((ch, idx) => {
                const hasScene = !!sceneConfigs[ch.id]
                return (
                  <div key={ch.id} style={{
                    padding: '10px 14px', borderRadius: 12, background: '#fff',
                    border: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', minWidth: 36, paddingTop: 1 }}>
                      第{idx + 1}章
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>{ch.title || '未命名'}</span>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: STATUS_COLORS[ch.status] + '18', color: STATUS_COLORS[ch.status], fontWeight: 600 }}>
                          {STATUS_LABELS[ch.status] || ch.status}
                        </span>
                        {hasScene && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>已配场景</span>}
                      </div>
                      {ch.summary && <p style={{ fontSize: 11, color: '#6b5e54', lineHeight: 1.5, margin: 0 }}>{ch.summary}</p>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => navigate(`/chapter/${ch.id}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed', whiteSpace: 'nowrap' }}>去创作</button>
                    </div>
                  </div>
                )
              })}
              {detailedChapters.length === 0 && (
                <div style={{ textAlign: 'center', padding: 24, fontSize: 12, color: '#9b8e84' }}>暂无章节，请先在细纲页创建</div>
              )}
            </div>
          </ScrollArea>
        )
      case 'threads':
        return (
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {meta.plotThreads.map(t => (
                <div key={t.id} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: `1px solid ${t.color}33` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', flex: 1 }}>{t.name}</span>
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: t.color + '18', color: t.color, fontWeight: 600 }}>
                      {THREAD_TYPES.find(tt => tt.value === t.type)?.label}
                    </span>
                    <span style={{ fontSize: 10, color: '#9b8e84' }}>{t.chapterIds.length} 章</span>
                    <button onClick={() => setEditingThread({ ...t })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>编辑</button>
                    <button onClick={() => handleDeleteThread(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
                  </div>
                  {t.chapterIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {t.chapterIds.map(cid => {
                        const ch = detailedChapters.find(d => d.id === cid)
                        return <span key={cid} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.03)', color: '#6b5e54' }}>{ch?.title || cid}</span>
                      })}
                    </div>
                  )}
                </div>
              ))}
              <button onClick={handleAddThread} style={{
                padding: '10px 14px', borderRadius: 12, border: '1px dashed rgba(0,0,0,0.1)', background: 'transparent',
                cursor: 'pointer', fontSize: 11, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <PlusIcon style={{ width: 14, height: 14 }} />添加故事线
              </button>
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
              {meta.foreshadowing.map(f => {
                const plantCh = detailedChapters.find(c => c.id === f.plantChapterId)
                const payoffCh = detailedChapters.find(c => c.id === f.payoffChapterId)
                return (
                  <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 80px 50px', gap: 8, padding: '8px 10px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.04)', alignItems: 'center', fontSize: 11 }}>
                    <span style={{ color: '#2d2520' }}>{f.description}</span>
                    <span style={{ fontSize: 10, color: '#6b5e54' }}>{plantCh?.title || '未指定'}</span>
                    <span style={{ fontSize: 10, color: '#6b5e54' }}>{payoffCh?.title || '待回收'}</span>
                    <button onClick={() => handleToggleForeshadow(f)} style={{
                      padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600,
                      background: f.status === 'resolved' ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.1)',
                      color: f.status === 'resolved' ? '#16a34a' : '#f59e0b',
                    }}>
                      {f.status === 'resolved' ? '已回收' : '已埋'}
                    </button>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button onClick={() => setEditingForeshadow({ ...f })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: '#7c3aed' }}>编辑</button>
                      <button onClick={() => handleDeleteForeshadow(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 10, height: 10 }} /></button>
                    </div>
                  </div>
                )
              })}
              <button onClick={handleAddForeshadow} style={{
                padding: '8px 14px', borderRadius: 12, border: '1px dashed rgba(0,0,0,0.1)', background: 'transparent',
                cursor: 'pointer', fontSize: 11, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <PlusIcon style={{ width: 14, height: 14 }} />添加伏笔
              </button>
            </div>
          </ScrollArea>
        )
    }
  }

  if (!activeProjectId) return null

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 14, color: '#9b8e84' }}>加载中...</p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Main body: tabs + content + right panel */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left tabs */}
        <div style={{ width: 160, minWidth: 160, borderRight: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 4 }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 10, border: 'none',
                background: activeTab === tab.key ? 'rgba(124,58,237,0.08)' : 'transparent',
                color: activeTab === tab.key ? '#7c3aed' : '#6b5e54',
                fontWeight: activeTab === tab.key ? 700 : 400, fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.1s',
              }}
            >
              <tab.icon style={{ width: 16, height: 16 }} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Top bar */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>
              {activeTab === 'outline' && '故事大纲'}
              {activeTab === 'worldbuilding' && '世界观设定'}
              {activeTab === 'chapters' && '章节概览'}
              {activeTab === 'threads' && '故事线管理'}
              {activeTab === 'foreshadow' && '伏笔追踪'}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {(activeTab === 'outline') && (
                <>
                  <WordCount text={outlineContent} />
                  <Button variant="secondary" size="sm" onClick={() => setOutlineContent('')}>清空</Button>
                  <Button size="sm" onClick={saveOutline}>保存大纲</Button>
                </>
              )}
              {activeTab === 'worldbuilding' && (
                <>
                  <WordCount text={worldbuildingContent} />
                  <Button variant="secondary" size="sm" onClick={() => setWorldbuildingContent('')}>清空</Button>
                  <Button size="sm" onClick={handleSaveWorldbuilding}>保存世界观</Button>
                </>
              )}
            </div>
          </div>

          {renderMainContent()}
        </div>

        {/* Right reference panel */}
        <div style={{ width: 220, minWidth: 200, borderLeft: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column' }}>
          {/* Characters */}
          <div style={{ height: '45%', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserIcon style={{ width: 14, height: 14, color: '#7c3aed' }} />
              <h4 style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', margin: 0 }}>角色速览</h4>
              <span style={{ fontSize: 10, color: '#9b8e84' }}>{characters.length}</span>
            </div>
            <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 8px 8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[...characters].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)).map(char => (
                  <button
                    key={char.id}
                    onClick={() => setSelectedChar(selectedChar?.id === char.id ? null : char)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.04)',
                      background: selectedChar?.id === char.id ? 'rgba(124,58,237,0.04)' : '#fff', cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#2d2520' }}>{char.name || '未命名'}</span>
                      {char.role && <span style={{ fontSize: 9, color: '#9b8e84', marginLeft: 'auto' }}>{char.role}</span>}
                    </div>
                    {selectedChar?.id === char.id && (
                      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <CharDetail label="性别" value={char.gender} />
                        <CharDetail label="性格" value={char.personality} />
                        <CharDetail label="背景" value={char.background?.slice(0, 80)} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Foreshadowing overview */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <LightBulbIcon style={{ width: 14, height: 14, color: '#f59e0b' }} />
              <h4 style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', margin: 0 }}>伏笔清单</h4>
              <span style={{ fontSize: 10, color: '#9b8e84' }}>
                {meta.foreshadowing.filter(f => f.status === 'resolved').length}/{meta.foreshadowing.length}
              </span>
            </div>
            <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 10px 8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {meta.foreshadowing.map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 4px' }}>
                    {f.status === 'resolved'
                      ? <CheckCircleIcon style={{ width: 12, height: 12, color: '#16a34a', flexShrink: 0 }} />
                      : <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #f59e0b', flexShrink: 0 }} />
                    }
                    <span style={{ color: '#2d2520', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.description}</span>
                  </div>
                ))}
                {meta.foreshadowing.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 12, fontSize: 10, color: '#9b8e84' }}>暂无伏笔</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

      {/* Editing Modals */}
      {editingThread && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setEditingThread(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: 420, boxShadow: '0 12px 40px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 14 }}>{editingThread.name ? '编辑故事线' : '新建故事线'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>名称</div>
                <input value={editingThread.name} onChange={e => setEditingThread({ ...editingThread, name: e.target.value })} placeholder="如: 主角复仇线" style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>类型</div>
                  <select value={editingThread.type} onChange={e => setEditingThread({ ...editingThread, type: e.target.value as PlotThread['type'] })} style={{ ...mini, width: '100%' }}>
                    {THREAD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>颜色</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {THREAD_COLORS.map(c => (
                      <button key={c} onClick={() => setEditingThread({ ...editingThread, color: c })} style={{
                        width: 24, height: 24, borderRadius: '50%', background: c, border: editingThread.color === c ? '2px solid #2d2520' : '2px solid transparent', cursor: 'pointer',
                      }} />
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>关联章节</div>
                <details>
                  <summary style={{ fontSize: 11, color: '#7c3aed', cursor: 'pointer' }}>
                    已选 {editingThread.chapterIds.length} 章
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, maxHeight: 160, overflow: 'auto' }}>
                    {detailedChapters.map((ch, idx) => (
                      <label key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={editingThread.chapterIds.includes(ch.id)}
                          onChange={() => {
                            setEditingThread({
                              ...editingThread,
                              chapterIds: editingThread.chapterIds.includes(ch.id)
                                ? editingThread.chapterIds.filter(id => id !== ch.id)
                                : [...editingThread.chapterIds, ch.id],
                            })
                          }}
                          style={{ width: 12, height: 12, accentColor: '#7c3aed' }}
                        />
                        第{idx + 1}章: {ch.title || '未命名'}
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
              <Button variant="secondary" size="sm" onClick={() => setEditingThread(null)}>取消</Button>
              <Button size="sm" onClick={handleSaveThread}>保存</Button>
            </div>
          </div>
        </div>
      )}

      {editingForeshadow && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setEditingForeshadow(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: 420, boxShadow: '0 12px 40px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 14 }}>{editingForeshadow.description ? '编辑伏笔' : '新建伏笔'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>描述</div>
                <input value={editingForeshadow.description} onChange={e => setEditingForeshadow({ ...editingForeshadow, description: e.target.value })} placeholder="如: 第1章提到主角母亲的遗物" style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>埋设章节</div>
                  <select value={editingForeshadow.plantChapterId} onChange={e => setEditingForeshadow({ ...editingForeshadow, plantChapterId: e.target.value })} style={{ ...mini, width: '100%' }}>
                    <option value="">未选择</option>
                    {detailedChapters.map((ch, idx) => <option key={ch.id} value={ch.id}>第{idx + 1}章: {ch.title}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>回收章节</div>
                  <select value={editingForeshadow.payoffChapterId} onChange={e => setEditingForeshadow({ ...editingForeshadow, payoffChapterId: e.target.value })} style={{ ...mini, width: '100%' }}>
                    <option value="">未选择</option>
                    {detailedChapters.map((ch, idx) => <option key={ch.id} value={ch.id}>第{idx + 1}章: {ch.title}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
              <Button variant="secondary" size="sm" onClick={() => setEditingForeshadow(null)}>取消</Button>
              <Button size="sm" onClick={handleSaveForeshadow}>保存</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
