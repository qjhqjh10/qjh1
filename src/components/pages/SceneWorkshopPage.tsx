import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { templateService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import type { EroticSceneConfig, EroticSceneCharacter, NovelSceneConfig, SceneTemplate, SceneTemplateType } from '@/types/story'
import { SparklesIcon, TrashIcon, PencilIcon, PlusIcon, DocumentTextIcon, FireIcon, BookOpenIcon } from '@heroicons/react/24/outline'
import {
  LOCATIONS as EROTIC_LOCATIONS, TIMES as EROTIC_TIMES, ATMOSPHERES, PUBLICITIES,
  ROLES as EROTIC_ROLES, ROLE_LABELS, BODY_STATES, KINKS_GROUPS,
  OPENINGS, POSES, RHYTHMS, CHANGES, CLIMAXES, AFTERMATHS,
  SOUND_DENSITIES, MOAN_STYLES, DEGRADE_LANGS, POVS,
} from '@/components/common/eroticSceneConstants'

// ===== Constants =====
import {
  NOVEL_SCENE_TYPES, NOVEL_PURPOSES, NOVEL_CONFLICTS, NOVEL_DIALOGUES, NOVEL_SENTENCES,
  NOVEL_DENSITIES, NOVEL_WEATHERS, NOVEL_SUBTEXTS, NOVEL_GENRE_ELEMENTS,
  WORLD_RULES, PROP_LIST, COSTUME_LIST, STRENGTH_LABELS, SENSORY_ANCHORS,
  NOVEL_NARRATIVE_STYLES, NOVEL_TIME_COMPRESSION, NOVEL_INTROSPECTION,
  NOVEL_DOMINANT_EMOTIONS, NOVEL_PACINGS, NOVEL_FORESHADOW_USE,
  NOVEL_BODY_LANGUAGES, NOVEL_PROPS_PRESETS, NOVEL_APPEARANCE_PRESETS,
  EROTIC_PACINGS, EROTIC_BODY_LANGUAGES, EROTIC_CONSENT_DYNAMICS, EROTIC_AFTERCARE,
  DEFAULT_EROTIC, DEFAULT_NOVEL, SECTIONS,
} from './sceneWorkshopConstants'
import type { EditorType } from './sceneWorkshopConstants'

function safeCSV(v: unknown): string {
  if (Array.isArray(v)) return (v as string[]).join(',')
  return (v as string) || ''
}

function getSectionSummary(section: number, config: EroticSceneConfig): string {
  switch (section) {
    case 1: return `${config.characters.length}个角色: ${config.characters.map((c) => c.characterName || '?').slice(0,3).join(', ') || '无'}${config.characters.length > 3 ? '...' : ''}`
    case 2: return config.location + (config.customLocation ? ', ' + config.customLocation : '')
    case 3: return config.time + (config.customTime ? ', ' + config.customTime : '')
    case 4: return config.atmosphere + (config.customAtmosphere ? ', ' + config.customAtmosphere : '')
    case 5: return config.publicity + (config.customPublicity ? ', ' + config.customPublicity : '')
    case 6: return config.selectedKinks.length + '个: ' + config.selectedKinks.slice(0,4).join(',') + (config.selectedKinks.length > 4 ? '...' : '') || '未选择'
    case 7: return `姿势:${config.mainPose} | 节奏:${config.mainRhythm}`
    case 8: return `起始:${(config.opening||[]).join(',')||'无'} | 高潮:${(config.climax||[]).join(',')||'无'} | 余韵:${(config.aftermath||[]).join(',')||'无'}`
    case 9: return `密度:${config.soundDensity} | 呻吟:${config.moanStyle} | 侮辱${(config.degradeLangs || []).length}个`
    case 10: return `强度:${config.intensity}/5`
    case 11: return config.extraNote?.slice(0, 30) || '无'
    case 12: return config.narrativePOV + (safeCSV(config.customPOVs).split(',').filter(Boolean).length ? ` +${safeCSV(config.customPOVs).split(',').filter(Boolean).length}自定义` : '')
    case 13: return [config.bodyFluidFocus?.length && `体液${config.bodyFluidFocus.length}`, config.bodyPartFocus?.length && `部位${config.bodyPartFocus.length}`, config.tactileFocus?.length && `触感${config.tactileFocus.length}`].filter(Boolean).join(' ') || '无'
    case 14: return config.narrativeStyle || '沉浸式长镜'
    case 15: return config.timeCompression || '实时'
    case 16: return '内省: ' + (config.introspection || '中')
    case 17: return config.sensoryAnchors?.slice(0, 40) || '—'
    case 18: return config.dominantEmotion || '—'
    case 19: return config.worldRules?.slice(0, 50) || '—'
    case 20: return config.propList?.slice(0, 40) || '—'
    case 21: return config.costumeList?.slice(0, 40) || '—'
    case 22: return config.wordTarget + '字'
    case 23: return config.pacing || '—'
    case 24: return config.bodyLanguage || '—'
    case 25: return config.consentDynamic || '—'
    case 26: return config.aftercareDetail || '—'
    default: return ''
  }
}

const EROTIC_SECTION_FIELDS: Record<number, string[]> = {
  1: ['characters'], 2: ['location'], 3: ['time'], 4: ['atmosphere'], 5: ['publicity'],
  6: ['selectedKinks'], 7: ['mainPose','opening'], 8: ['climax','aftermath'],
  9: ['soundDensity','moanStyle','degradeLangs'], 10: ['intensity','wordTarget'],
  11: ['extraNote','bannedWords'], 12: ['narrativePOV'], 13: ['bodyFluidFocus','bodyPartFocus','tactileFocus'],
  14: ['narrativeStyle'], 15: ['timeCompression'], 16: ['introspection'], 17: ['sensoryAnchors'],
  18: ['dominantEmotion','emotionCurveInput','triggerWords'], 19: ['worldRules'],
  20: ['propList'], 21: ['costumeList'], 22: ['wordTarget'], 23: ['pacing'],
  24: ['bodyLanguage'], 25: ['consentDynamic'], 26: ['aftercareDetail'],
}
function sectionIsAuto(section: number, cfg: EroticSceneConfig): boolean {
  const fields = EROTIC_SECTION_FIELDS[section]
  if (!fields) return false
  return fields.every(f => cfg.autoFields[f])
}

const NOVEL_SECTION_FIELDS: Record<number, string[]> = {
  1: ['sceneType','scenePurpose','conflictType'], 2: ['povCharacterId','characters'],
  3: ['location','weather','time'], 4: ['genreElements'], 5: ['dialogueRatio','subtextLevel','sentenceStyle','paragraphDensity'],
  6: ['wordTarget','narrativePOV'], 7: ['narrativeStyle','timeCompression','introspection'],
  8: ['dominantEmotion','emotionCurveInput','pacing'], 9: ['sensoryAnchors','props','appearance','bodyLanguage'],
  10: ['foreshadowUse','sceneTurningPoint'],
}
function novelSectionIsAuto(section: number, cfg: NovelSceneConfig): boolean {
  const fields = NOVEL_SECTION_FIELDS[section]
  if (!fields) return false
  return fields.every(f => cfg.autoFields[f])
}

function SectionCard({ id, label, summary, isAuto, onClick }: { id: number; label: string; summary: string; isAuto?: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  const colors = [
    '#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#6366f1','#14b8a6','#f97316',
    '#06b6d4','#84cc16','#e11d48','#7c3aed','#0ea5e9','#d946ef','#22c55e','#eab308','#a855f7',
    '#0891b2','#65a30d','#c026d3','#2563eb','#ca8a04','#9333ea','#059669','#dc2626',
  ]
  const accent = colors[(id - 1) % colors.length]
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      display: 'flex', flexDirection: 'column', textAlign: 'left', width: '100%', minHeight: 110,
      borderRadius: 16, border: hover ? `1px solid ${accent}40` : isAuto ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(0,0,0,0.06)',
      background: hover ? `linear-gradient(135deg, ${accent}08, #fff)` : isAuto ? 'rgba(139,92,246,0.03)' : '#fff',
      cursor: 'pointer', padding: 0, overflow: 'hidden',
      boxShadow: hover ? `0 8px 24px ${accent}15` : '0 1px 3px rgba(0,0,0,0.04)',
      transform: hover ? 'translateY(-2px)' : 'none',
      transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
    }}>
      <div style={{ padding: '12px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: isAuto ? 'rgba(139,92,246,0.12)' : `${accent}15`, color: isAuto ? '#7c3aed' : accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{id < 10 ? '0' + id : id}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>{label.replace(/^\d+\.\s*/, '')}</span>
        {isAuto && <span style={{ fontSize: 9, color: '#7c3aed', fontWeight: 600, background: 'rgba(139,92,246,0.08)', padding: '1px 6px', borderRadius: 4, flexShrink: 0, marginLeft: 'auto' }}>🤖 自动</span>}
      </div>
      <div className="custom-scrollbar" style={{ flex: 1, padding: '4px 16px 12px', fontSize: 11, lineHeight: 1.65, color: isAuto ? '#9b8e84' : '#6b5e54', overflowY: 'auto', maxHeight: 70, wordBreak: 'break-word' }}>{isAuto ? 'AI 生成时自动填写' : (summary || '点击编辑 →')}</div>
    </button>
  )
}

const NOVEL_SECTIONS = [
  { id: 1, label: '1. 场景类型与目的' }, { id: 2, label: '2. 角色与视角' }, { id: 3, label: '3. 环境描写' },
  { id: 4, label: '4. 类型专属' }, { id: 5, label: '5. 对话与节奏' }, { id: 6, label: '6. 篇幅与注入' },
  { id: 7, label: '7. 叙事技法' }, { id: 8, label: '8. 情绪设计' }, { id: 9, label: '9. 感官与细节' },
  { id: 10, label: '10. 伏笔与转折' },
]

function getNovelSectionSummary(section: number, config: NovelSceneConfig): string {
  switch (section) {
    case 1: return `${config.sceneType} | ${config.conflictType} | 目的${config.scenePurpose.length}个`
    case 2: return config.povCharacterName || '无主视角' + ` | ${config.characters.length}个角色`
    case 3: return `${config.location}${config.customLocation ? '/' + config.customLocation : ''} | ${config.weather} | ${config.time}`
    case 4: return `${config.genreElements.length}个元素`
    case 5: return `对话${config.dialogueRatio} | 潜台词${config.subtextLevel}`
    case 6: return `${config.wordTarget}字 | ${config.narrativePOV}`
    case 7: return [config.narrativeStyle, config.timeCompression, config.introspection && '内省'+config.introspection].filter(Boolean).join(' · ') || '—'
    case 8: return [config.dominantEmotion, config.pacing].filter(Boolean).join(' · ') || '—'
    case 9: return [config.sensoryAnchors && '锚点', config.props && '道具', config.appearance && '外观', config.bodyLanguage && '肢体'].filter(Boolean).join(' · ') || '—'
    case 10: return [config.foreshadowUse, config.sceneTurningPoint].filter(Boolean).join(' · ') || '—'
    default: return ''
  }
}

function NovelSectionCard({ id, label, summary, isAuto, onClick }: { id: number; label: string; summary: string; isAuto?: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  const colors = ['#3b82f6','#6366f1','#0ea5e9','#8b5cf6','#2563eb','#06b6d4','#7c3aed','#14b8a6','#a855f7','#0891b2']
  const accent = colors[(id - 1) % colors.length]
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      display: 'flex', flexDirection: 'column', textAlign: 'left', width: '100%', minHeight: 110,
      borderRadius: 16, border: hover ? `1px solid ${accent}40` : isAuto ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(0,0,0,0.06)',
      background: hover ? `linear-gradient(135deg, ${accent}08, #fff)` : isAuto ? 'rgba(139,92,246,0.03)' : '#fff',
      cursor: 'pointer', padding: 0, overflow: 'hidden',
      boxShadow: hover ? `0 8px 24px ${accent}15` : '0 1px 3px rgba(0,0,0,0.04)',
      transform: hover ? 'translateY(-2px)' : 'none',
      transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
    }}>
      <div style={{ padding: '12px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: isAuto ? 'rgba(139,92,246,0.12)' : `${accent}15`, color: isAuto ? '#7c3aed' : accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{id < 10 ? '0' + id : id}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>{label.replace(/^\d+\.\s*/, '')}</span>
        {isAuto && <span style={{ fontSize: 9, color: '#7c3aed', fontWeight: 600, background: 'rgba(139,92,246,0.08)', padding: '1px 6px', borderRadius: 4, flexShrink: 0, marginLeft: 'auto' }}>🤖 自动</span>}
      </div>
      <div className="custom-scrollbar" style={{ flex: 1, padding: '4px 16px 12px', fontSize: 11, lineHeight: 1.65, color: isAuto ? '#9b8e84' : '#6b5e54', overflowY: 'auto', maxHeight: 70, wordBreak: 'break-word' }}>{isAuto ? 'AI 生成时自动填写' : (summary || '点击编辑 →')}</div>
    </button>
  )
}


function AutoField({ field, autoFields, onToggle, children }: { field: string; autoFields: Record<string, boolean>; onToggle: (field: string, v: boolean) => void; children: React.ReactNode }) {
  const isAuto = !!autoFields[field]
  return (
    <div style={{ position: 'relative' }}>
      {isAuto && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', borderRadius: 8, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#8b5cf6', fontWeight: 600, pointerEvents: 'none' }}>AI 自动</div>}
      <div style={{ opacity: isAuto ? 0.35 : 1, pointerEvents: isAuto ? 'none' : 'auto' }}>{children}</div>
      <button onClick={() => onToggle(field, !isAuto)} title={isAuto ? '切换为手动' : '切换为AI自动'} style={{ position: 'absolute', top: 0, right: 0, background: isAuto ? 'rgba(139,92,246,0.12)' : 'rgba(0,0,0,0.03)', border: isAuto ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(0,0,0,0.06)', borderRadius: 6, cursor: 'pointer', padding: '2px 5px', fontSize: 10, color: isAuto ? '#7c3aed' : '#9b8e84', zIndex: 2, lineHeight: 1 }}>{isAuto ? '🤖✓' : '🤖'}</button>
    </div>
  )
}

function CustomTagButton({ label, selected, onToggle, onRemove, editMode }: { label: string; selected: boolean; onToggle: () => void; onRemove: () => void; editMode?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <button onClick={onToggle} style={{
        padding: '3px 8px', borderRadius: 6,
        border: selected ? '1px solid #dc2626' : '1px solid rgba(124,58,237,0.15)',
        background: selected ? 'rgba(220,38,38,0.08)' : 'rgba(124,58,237,0.04)',
        cursor: 'pointer', fontSize: 10,
        color: selected ? '#dc2626' : '#7c3aed', fontWeight: selected ? 600 : 400,
      }}>{label}</button>
      {editMode && <button onClick={onRemove} title="删除" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#dc2626', fontSize: 12, lineHeight: 1 }}>×</button>}
    </span>
  )
}

function CustomInput({ label, values, onAdd, onRemove, hideDisplay }: { label?: string; values: string[]; onAdd: (v: string) => void; onRemove: (v: string) => void; hideDisplay?: boolean }) {
  const [input, setInput] = useState('')
  const [justAdded, setJustAdded] = useState(false)
  const handleAdd = () => { if (input.trim()) { onAdd(input.trim()); setInput(''); setJustAdded(true); setTimeout(() => setJustAdded(false), 1500) } }
  return (
    <div style={{ marginTop: 6 }}>
      {label && <span style={{ fontSize: 10, color: '#9b8e84', marginRight: 4 }}>{label}</span>}
      <div style={{ display: 'flex', gap: 4, marginTop: 2, alignItems: 'center' }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} placeholder="添加自定义..." style={{ ...inputStyle, flex: 1, fontSize: 10, padding: '4px 8px' }} />
        <button onClick={handleAdd} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #7c3aed', background: 'rgba(124,58,237,0.06)', color: '#7c3aed', cursor: 'pointer', fontSize: 10, whiteSpace: 'nowrap' }}>+</button>
        {justAdded && <span style={{ fontSize: 10, color: '#16a34a', whiteSpace: 'nowrap' }}>已添加 ✓</span>}
      </div>
      {!hideDisplay && values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
          {values.map(v => (
            <span key={v} style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', fontSize: 10, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 4 }}>
              {v}
              <button onClick={() => onRemove(v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#d4ccc4', fontSize: 12, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SceneWorkshopPage() {
  const characters = useStore(s => s.characters)
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const setActivePage = useStore(s => s.setActivePage)
  const fileEditNotify = useStore(s => s.fileEditNotify)
  const [editorType, setEditorType] = useState<EditorType>(null)
  const [templateType, setTemplateType] = useState<SceneTemplateType>('普通小说')
  const [templates, setTemplates] = useState<SceneTemplate[]>([])
  const [editingTemplate, setEditingTemplate] = useState<SceneTemplate | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [eroticConfig, setEroticConfig] = useState<EroticSceneConfig>(DEFAULT_EROTIC)
  const [novelConfig, setNovelConfig] = useState<NovelSceneConfig>(DEFAULT_NOVEL)
  const [novelGenreType, setNovelGenreType] = useState('都市')
  const [showSectionModal, setShowSectionModal] = useState(false)
  const [editingSection, setEditingSection] = useState<number | null>(null)
  const [showNovelSectionModal, setShowNovelSectionModal] = useState(false)
  const [editingNovelSection, setEditingNovelSection] = useState<number | null>(null)
  const [editTagMode, setEditTagMode] = useState(false)
  useEffect(() => { setActivePage('scene-workshop'); loadTemplates() }, [])

  // Reload templates when AI creates scene templates
  useEffect(() => {
    if (fileEditNotify?.filePath?.includes('scene_templates')) loadTemplates()
  }, [fileEditNotify])

  const toggleEroticAuto = (field: string, v: boolean) => setEroticConfig({ ...eroticConfig, autoFields: { ...eroticConfig.autoFields, [field]: v } })
  const toggleNovelAuto = (field: string, v: boolean) => setNovelConfig({ ...novelConfig, autoFields: { ...novelConfig.autoFields, [field]: v } })

  const loadTemplates = async () => {
    try {
      const globalRaw = await templateService.list() as any[]
      let projectRaw: any[] = []
      if (activeProjectId && projectsBasePath) {
        try {
          projectRaw = await templateService.listProject(`${projectsBasePath}/${activeProjectId}`) as any[]
        } catch { /* project dir may not exist */ }
      }
      // Normalize all templates to SceneTemplate shape (handle AI custom formats)
      const normalize = (raw: any, fromProject: boolean): SceneTemplate => ({
        id: raw.id || raw.templateId || `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
        name: raw.name || raw.templateName || '未命名模板',
        type: raw.type || '普通小说',
        config: raw.config || raw,
        createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
        _fromProject: fromProject,
      } as SceneTemplate & { _fromProject?: boolean })
      const globalList = globalRaw.map(t => normalize(t, false))
      const projectList = projectRaw.map(t => normalize(t, true))
      const seen = new Set(globalList.map(t => t.id))
      const merged = [...globalList]
      for (const t of projectList) { if (!seen.has(t.id)) { merged.push(t); seen.add(t.id) } }
      setTemplates(merged)
    } catch { setTemplates([]) }
  }

  const handleEnterType = (tmplType: SceneTemplateType) => {
    const editType = tmplType === '情色小说' ? 'erotic' : 'novel'
    setEditorType(editType); setEditingTemplate(null); setTemplateName('')
    setEroticConfig(DEFAULT_EROTIC); setNovelConfig(DEFAULT_NOVEL); loadTemplates()
    setTemplateType(tmplType)
  }

  const handleNewTemplate = () => {
    setEditingTemplate(null); setTemplateName('')
    setEroticConfig(DEFAULT_EROTIC); setNovelConfig(DEFAULT_NOVEL); setNovelGenreType('都市'); setShowEditor(true)
  }

  const handleEditTemplate = (tpl: SceneTemplate) => {
    const isErotic = tpl.type === '情色小说'
    setEditorType(isErotic ? 'erotic' : 'novel')
    setTemplateType(tpl.type || '普通小说')
    setEditingTemplate(tpl); setTemplateName(tpl.name)
    if (isErotic) {
      const cfg = { ...DEFAULT_EROTIC, ...(tpl.config || {}) } as EroticSceneConfig
      if (Array.isArray((cfg as any).customPOVs)) (cfg as any).customPOVs = ((cfg as any).customPOVs as unknown as string[]).join(',')
      setEroticConfig(cfg)
    }
    else {
      const cfg = { ...DEFAULT_NOVEL, ...(tpl.config || {}) } as NovelSceneConfig
      setNovelConfig(cfg)
    }
    setShowEditor(true)
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) { alert('请输入模板名称'); return }
    const tpl: SceneTemplate = {
      id: editingTemplate?.id || nanoid(8), name: templateName.trim(), type: templateType,
      config: editorType === 'erotic' ? eroticConfig : novelConfig,
      createdAt: editingTemplate?.createdAt || new Date().toISOString(),
    } as SceneTemplate
    await templateService.save(tpl)
    setShowEditor(false); loadTemplates()
  }

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('确定删除此模板？')) return
    await templateService.delete(id); loadTemplates()
  }

  const handleDuplicateTemplate = (tpl: SceneTemplate) => {
    const isErotic = tpl.type === '情色小说'
    setEditorType(isErotic ? 'erotic' : 'novel')
    setTemplateType(tpl.type || '普通小说')
    setEditingTemplate(null); setTemplateName(tpl.name + ' (副本)')
    if (isErotic) setEroticConfig({ ...DEFAULT_EROTIC, ...(tpl.config || {}) } as EroticSceneConfig)
    else setNovelConfig({ ...DEFAULT_NOVEL, ...(tpl.config || {}) } as NovelSceneConfig)
    setShowEditor(true)
  }


  const renderSectionEditor = (section: number) => {
    switch (section) {
      case 1: return (<AutoField field="characters" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, color: '#6b5e54', marginBottom: 6, lineHeight: 1.5 }}>参与本章情色场景的角色。每个角色设置其定位/身体状态/备注。</div>
          {eroticConfig.characters.map((ch, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={ch.characterName} onChange={e => { const nc = [...eroticConfig.characters]; nc[i] = { ...nc[i], characterName: e.target.value }; setEroticConfig({ ...eroticConfig, characters: nc }) }} style={{ ...inputStyle, flex: 2 }} placeholder='角色名' />
              <select value={ch.role} onChange={e => { const nc = [...eroticConfig.characters]; nc[i] = { ...nc[i], role: e.target.value as EroticSceneCharacter['role'] }; setEroticConfig({ ...eroticConfig, characters: nc }) }} style={{ ...inputStyle, flex: 1 }}>{EROTIC_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
              <select value={ch.bodyState} onChange={e => { const nc = [...eroticConfig.characters]; nc[i] = { ...nc[i], bodyState: e.target.value }; setEroticConfig({ ...eroticConfig, characters: nc }) }} style={{ ...inputStyle, flex: 1 }}>{BODY_STATES.map(s => <option key={s} value={s}>{s}</option>)}</select>
              <input value={ch.customNote} onChange={e => { const nc = [...eroticConfig.characters]; nc[i] = { ...nc[i], customNote: e.target.value }; setEroticConfig({ ...eroticConfig, characters: nc }) }} style={{ ...inputStyle, flex: 2 }} placeholder='备注' />
              <button onClick={() => setEroticConfig({ ...eroticConfig, characters: eroticConfig.characters.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 14, height: 14 }} /></button>
            </div>
          ))}
          <Button size='sm' variant='ghost' onClick={() => setEroticConfig({ ...eroticConfig, characters: [...eroticConfig.characters, { characterId: '', characterName: '', role: 'sub', bodyState: '正常', customNote: '' }] })} icon={<PlusIcon style={{ width: 11, height: 11 }} />}>添加角色</Button>
        </div>
          </AutoField>)
      case 2: return (<AutoField field="location" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {EROTIC_LOCATIONS.map(p => { const sel = eroticConfig.location === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, location: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.customLocation || '').split(',').filter((v: string) => v && !EROTIC_LOCATIONS.includes(v)).map((v: string) => <CustomTagButton key={'c'+v} label={v} selected={eroticConfig.location === v} onToggle={() => setEroticConfig({ ...eroticConfig, location: eroticConfig.location === v ? '卧室' : v })} onRemove={() => { setEroticConfig({ ...eroticConfig, customLocation: (eroticConfig.customLocation||'').split(',').filter((x:string)=>x!==v).join(','), location: eroticConfig.location === v ? '卧室' : eroticConfig.location }) }}  editMode={editTagMode} />)}
          </div>
          <CustomInput hideDisplay values={(eroticConfig.customLocation || '').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customLocation: eroticConfig.customLocation ? eroticConfig.customLocation+','+v : v, location: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customLocation: (eroticConfig.customLocation||'').split(',').filter((x:string)=>x!==v).join(','), location: eroticConfig.location === v ? '卧室' : eroticConfig.location }) } />
        </div>
          </AutoField>)
      case 3: return (<AutoField field="time" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {EROTIC_TIMES.map(p => { const sel = eroticConfig.time === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, time: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.customTime || '').split(',').filter((v: string) => v && !EROTIC_TIMES.includes(v)).map((v: string) => <CustomTagButton key={'c'+v} label={v} selected={eroticConfig.time === v} onToggle={() => setEroticConfig({ ...eroticConfig, time: eroticConfig.time === v ? '深夜' : v })} onRemove={() => { setEroticConfig({ ...eroticConfig, customTime: (eroticConfig.customTime||'').split(',').filter((x:string)=>x!==v).join(','), time: eroticConfig.time === v ? '深夜' : eroticConfig.time }) }}  editMode={editTagMode} />)}
          </div>
          <CustomInput hideDisplay values={(eroticConfig.customTime || '').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customTime: eroticConfig.customTime ? eroticConfig.customTime+','+v : v, time: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customTime: (eroticConfig.customTime||'').split(',').filter((x:string)=>x!==v).join(','), time: eroticConfig.time === v ? '深夜' : eroticConfig.time }) } />
        </div>
          </AutoField>)
      case 4: return (<AutoField field="atmosphere" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {ATMOSPHERES.map(p => { const sel = eroticConfig.atmosphere === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, atmosphere: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.customAtmosphere || '').split(',').filter((v: string) => v && !ATMOSPHERES.includes(v)).map((v: string) => <CustomTagButton key={'c'+v} label={v} selected={eroticConfig.atmosphere === v} onToggle={() => setEroticConfig({ ...eroticConfig, atmosphere: eroticConfig.atmosphere === v ? '羞辱' : v })} onRemove={() => { setEroticConfig({ ...eroticConfig, customAtmosphere: (eroticConfig.customAtmosphere||'').split(',').filter((x:string)=>x!==v).join(','), atmosphere: eroticConfig.atmosphere === v ? '羞辱' : eroticConfig.atmosphere }) }}  editMode={editTagMode} />)}
          </div>
          <CustomInput hideDisplay values={(eroticConfig.customAtmosphere || '').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customAtmosphere: eroticConfig.customAtmosphere ? eroticConfig.customAtmosphere+','+v : v, atmosphere: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customAtmosphere: (eroticConfig.customAtmosphere||'').split(',').filter((x:string)=>x!==v).join(','), atmosphere: eroticConfig.atmosphere === v ? '羞辱' : eroticConfig.atmosphere }) } />
        </div>
          </AutoField>)
      case 5: return (<AutoField field="publicity" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {PUBLICITIES.map(p => { const sel = eroticConfig.publicity === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, publicity: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.customPublicity || '').split(',').filter((v: string) => v && !PUBLICITIES.includes(v)).map((v: string) => <CustomTagButton key={'c'+v} label={v} selected={eroticConfig.publicity === v} onToggle={() => setEroticConfig({ ...eroticConfig, publicity: eroticConfig.publicity === v ? '私密' : v })} onRemove={() => { setEroticConfig({ ...eroticConfig, customPublicity: (eroticConfig.customPublicity||'').split(',').filter((x:string)=>x!==v).join(','), publicity: eroticConfig.publicity === v ? '私密' : eroticConfig.publicity }) }}  editMode={editTagMode} />)}
          </div>
          <CustomInput hideDisplay values={(eroticConfig.customPublicity || '').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customPublicity: eroticConfig.customPublicity ? eroticConfig.customPublicity+','+v : v, publicity: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customPublicity: (eroticConfig.customPublicity||'').split(',').filter((x:string)=>x!==v).join(','), publicity: eroticConfig.publicity === v ? '私密' : eroticConfig.publicity }) } />
        </div>
          </AutoField>)
      case 6: return (<AutoField field="selectedKinks" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {KINKS_GROUPS.flat().map(p => { const sel = (eroticConfig.selectedKinks || []).includes(p); return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, selectedKinks: sel ? (eroticConfig.selectedKinks||[]).filter((x:string)=>x!==p) : [...(eroticConfig.selectedKinks||[]), p] })} style={{ padding: '3px 8px', borderRadius: 6, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.selectedKinks || []).filter((v: string) => !KINKS_GROUPS.flat().includes(v)).map((v: string) => <CustomTagButton key={'c'+v} label={v} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, selectedKinks: (eroticConfig.selectedKinks||[]).filter((x:string)=>x!==v) })} onRemove={() => setEroticConfig({ ...eroticConfig, selectedKinks: (eroticConfig.selectedKinks||[]).filter((x:string)=>x!==v), customKink: (eroticConfig.customKink||'').split(',').filter((x:string)=>x!==v).join(',') }) }  editMode={editTagMode} />)}
          </div>
          <CustomInput hideDisplay values={(eroticConfig.customKink || '').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customKink: eroticConfig.customKink ? eroticConfig.customKink+','+v : v, selectedKinks: [...(eroticConfig.selectedKinks||[]), v] })} onRemove={v => setEroticConfig({ ...eroticConfig, customKink: (eroticConfig.customKink||'').split(',').filter((x:string)=>x!==v).join(','), selectedKinks: (eroticConfig.selectedKinks||[]).filter((x:string)=>x!==v) }) } />
        </div>
          </AutoField>)
      case 7: return (<AutoField field="mainPose" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#6b5e54', marginBottom: 6, lineHeight: 1.5 }}>性爱流程中的姿势、节奏和转换方式。姿势为主体位，节奏为抽插频率，转换为体位变化频率。</div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>姿势:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>{POSES.map(p => { const sel = eroticConfig.mainPose === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, mainPose: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}{(eroticConfig.customPoses||[]).filter((v:string)=>!POSES.includes(v)).map((v:string) => <CustomTagButton key={'cp'+v} label={v} selected={eroticConfig.mainPose===v} onToggle={() => setEroticConfig({ ...eroticConfig, mainPose: eroticConfig.mainPose===v?'无偏好':v })} onRemove={() => setEroticConfig({ ...eroticConfig, customPoses: (eroticConfig.customPoses||[]).filter((x:string)=>x!==v), mainPose: eroticConfig.mainPose===v?'无偏好':eroticConfig.mainPose })}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay values={eroticConfig.customPoses || []} onAdd={v => setEroticConfig({ ...eroticConfig, customPoses: [...(eroticConfig.customPoses||[]), v], mainPose: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customPoses: (eroticConfig.customPoses||[]).filter((x:string)=>x!==v), mainPose: eroticConfig.mainPose===v?'无偏好':eroticConfig.mainPose })} />
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, marginTop: 10 }}>节奏:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>{RHYTHMS.map(r => { const sel = eroticConfig.mainRhythm === r; return <button key={r} onClick={() => setEroticConfig({ ...eroticConfig, mainRhythm: r })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{r}</button> })}{(eroticConfig.customRhythms||[]).filter((v:string)=>!RHYTHMS.includes(v)).map((v:string) => <CustomTagButton key={'cr'+v} label={v} selected={eroticConfig.mainRhythm===v} onToggle={() => setEroticConfig({ ...eroticConfig, mainRhythm: eroticConfig.mainRhythm===v?'无偏好':v })} onRemove={() => setEroticConfig({ ...eroticConfig, customRhythms: (eroticConfig.customRhythms||[]).filter((x:string)=>x!==v), mainRhythm: eroticConfig.mainRhythm===v?'无偏好':eroticConfig.mainRhythm })}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay label='自定义节奏' values={eroticConfig.customRhythms || []} onAdd={v => setEroticConfig({ ...eroticConfig, customRhythms: [...(eroticConfig.customRhythms||[]), v], mainRhythm: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customRhythms: (eroticConfig.customRhythms||[]).filter((x:string)=>x!==v), mainRhythm: eroticConfig.mainRhythm===v?'无偏好':eroticConfig.mainRhythm })} />
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, marginTop: 10 }}>转换:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>{CHANGES.map(ch => { const sel = eroticConfig.poseChanges === ch; return <button key={ch} onClick={() => setEroticConfig({ ...eroticConfig, poseChanges: ch })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{ch}</button> })}{(eroticConfig.customPoseChanges||'').split(',').filter((v:string)=>v&&!CHANGES.includes(v)).map((v:string)=><CustomTagButton key={'pch'+v} label={v} selected={eroticConfig.poseChanges===v} onToggle={()=>setEroticConfig({...eroticConfig,poseChanges:eroticConfig.poseChanges===v?'2-3次转换':v})} onRemove={()=>setEroticConfig({...eroticConfig,customPoseChanges:(eroticConfig.customPoseChanges||'').split(',').filter((x:string)=>x!==v).join(','),poseChanges:eroticConfig.poseChanges===v?'2-3次转换':eroticConfig.poseChanges})}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay label='自定义转换' values={(eroticConfig.customPoseChanges||'').split(',').filter(Boolean)} onAdd={v=>setEroticConfig({...eroticConfig,customPoseChanges:eroticConfig.customPoseChanges?eroticConfig.customPoseChanges+','+v:v,poseChanges:v})} onRemove={v=>setEroticConfig({...eroticConfig,customPoseChanges:(eroticConfig.customPoseChanges||'').split(',').filter((x:string)=>x!==v).join(','),poseChanges:eroticConfig.poseChanges===v?'2-3次转换':eroticConfig.poseChanges})} />
        </div>
          </AutoField>)
      case 8: return (<AutoField field="opening" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#6b5e54', marginBottom: 6, lineHeight: 1.5 }}>完整的性爱流程: 起始→主戏→高潮→余韵。AI将按此顺序组织情色描写。</div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>起始:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{OPENINGS.map(o => { const sel = (eroticConfig.opening||[]).includes(o); return <button key={o} onClick={() => setEroticConfig({ ...eroticConfig, opening: sel ? eroticConfig.opening.filter((x:string)=>x!==o) : [...(eroticConfig.opening||[]), o] })} style={{ padding: '3px 8px', borderRadius: 6, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54' }}>{o}</button> })}{(eroticConfig.opening||[]).filter((v:string)=>!OPENINGS.includes(v)).map((v:string) => <CustomTagButton key={'op'+v} label={v} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, opening: (eroticConfig.opening||[]).filter((x:string)=>x!==v) })} onRemove={() => setEroticConfig({ ...eroticConfig, opening: (eroticConfig.opening||[]).filter((x:string)=>x!==v), customOpening: (eroticConfig.customOpening||[]).filter((x:string)=>x!==v) })}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay label='自定义起始' values={eroticConfig.customOpening || []} onAdd={v => setEroticConfig({ ...eroticConfig, customOpening: [...(eroticConfig.customOpening||[]), v], opening: [...(eroticConfig.opening||[]), v] })} onRemove={v => setEroticConfig({ ...eroticConfig, customOpening: (eroticConfig.customOpening||[]).filter((x:string)=>x!==v), opening: (eroticConfig.opening||[]).filter((x:string)=>x!==v) })} />
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, marginTop: 10 }}>高潮:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{CLIMAXES.map(c => { const sel = (eroticConfig.climax||[]).includes(c); return <button key={c} onClick={() => setEroticConfig({ ...eroticConfig, climax: sel ? eroticConfig.climax.filter((x:string)=>x!==c) : [...(eroticConfig.climax||[]), c] })} style={{ padding: '3px 8px', borderRadius: 6, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54' }}>{c}</button> })}{(eroticConfig.climax||[]).filter((v:string)=>!CLIMAXES.includes(v)).map((v:string) => <CustomTagButton key={'cl'+v} label={v} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, climax: (eroticConfig.climax||[]).filter((x:string)=>x!==v) })} onRemove={() => setEroticConfig({ ...eroticConfig, climax: (eroticConfig.climax||[]).filter((x:string)=>x!==v), customClimax: (eroticConfig.customClimax||[]).filter((x:string)=>x!==v) })}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay label='自定义高潮' values={eroticConfig.customClimax || []} onAdd={v => setEroticConfig({ ...eroticConfig, customClimax: [...(eroticConfig.customClimax||[]), v], climax: [...(eroticConfig.climax||[]), v] })} onRemove={v => setEroticConfig({ ...eroticConfig, customClimax: (eroticConfig.customClimax||[]).filter((x:string)=>x!==v), climax: (eroticConfig.climax||[]).filter((x:string)=>x!==v) })} />
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, marginTop: 10 }}>余韵:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{AFTERMATHS.map(a => { const sel = (eroticConfig.aftermath||[]).includes(a); return <button key={a} onClick={() => setEroticConfig({ ...eroticConfig, aftermath: sel ? (eroticConfig.aftermath||[]).filter((x:string)=>x!==a) : [...(eroticConfig.aftermath||[]), a] })} style={{ padding: '3px 8px', borderRadius: 6, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54' }}>{a}</button> })}{(eroticConfig.aftermath||[]).filter((v:string)=>!AFTERMATHS.includes(v)).map((v:string) => <CustomTagButton key={'af'+v} label={v} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, aftermath: (eroticConfig.aftermath||[]).filter((x:string)=>x!==v) })} onRemove={() => setEroticConfig({ ...eroticConfig, aftermath: (eroticConfig.aftermath||[]).filter((x:string)=>x!==v), customAftermath: (eroticConfig.customAftermath||[]).filter((x:string)=>x!==v) })}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay label='自定义余韵' values={eroticConfig.customAftermath || []} onAdd={v => setEroticConfig({ ...eroticConfig, customAftermath: [...(eroticConfig.customAftermath||[]), v], aftermath: [...(eroticConfig.aftermath||[]), v] })} onRemove={v => setEroticConfig({ ...eroticConfig, customAftermath: (eroticConfig.customAftermath||[]).filter((x:string)=>x!==v), aftermath: (eroticConfig.aftermath||[]).filter((x:string)=>x!==v) })} />
        </div>
          </AutoField>)
      case 9: return (<AutoField field="soundDensity" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>密度:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{SOUND_DENSITIES.map(s => { const sel = eroticConfig.soundDensity === s; return <button key={s} onClick={() => setEroticConfig({ ...eroticConfig, soundDensity: s })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{s}</button> })}{(eroticConfig.customSoundDensity||'').split(',').filter((v:string)=>v&&!SOUND_DENSITIES.includes(v)).map((v:string)=><CustomTagButton key={'sd'+v} label={v} selected={eroticConfig.soundDensity===v} onToggle={()=>setEroticConfig({...eroticConfig,soundDensity:eroticConfig.soundDensity===v?'密集':v})} onRemove={()=>setEroticConfig({...eroticConfig,customSoundDensity:(eroticConfig.customSoundDensity||'').split(',').filter((x:string)=>x!==v).join(','),soundDensity:eroticConfig.soundDensity===v?'密集':eroticConfig.soundDensity})}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay label='自定义密度' values={(eroticConfig.customSoundDensity||'').split(',').filter(Boolean)} onAdd={v=>setEroticConfig({...eroticConfig,customSoundDensity:eroticConfig.customSoundDensity?eroticConfig.customSoundDensity+','+v:v,soundDensity:v})} onRemove={v=>setEroticConfig({...eroticConfig,customSoundDensity:(eroticConfig.customSoundDensity||'').split(',').filter((x:string)=>x!==v).join(','),soundDensity:eroticConfig.soundDensity===v?'密集':eroticConfig.soundDensity})} />
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, marginTop: 10 }}>呻吟:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{MOAN_STYLES.map(m => { const sel = eroticConfig.moanStyle === m; return <button key={m} onClick={() => setEroticConfig({ ...eroticConfig, moanStyle: m })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{m}</button> })}{(eroticConfig.customMoanStyle||'').split(',').filter((v:string)=>v&&!MOAN_STYLES.includes(v)).map((v:string)=><CustomTagButton key={'ms'+v} label={v} selected={eroticConfig.moanStyle===v} onToggle={()=>setEroticConfig({...eroticConfig,moanStyle:eroticConfig.moanStyle===v?'哭喊破音':v})} onRemove={()=>setEroticConfig({...eroticConfig,customMoanStyle:(eroticConfig.customMoanStyle||'').split(',').filter((x:string)=>x!==v).join(','),moanStyle:eroticConfig.moanStyle===v?'哭喊破音':eroticConfig.moanStyle})}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay label='自定义呻吟' values={(eroticConfig.customMoanStyle||'').split(',').filter(Boolean)} onAdd={v=>setEroticConfig({...eroticConfig,customMoanStyle:eroticConfig.customMoanStyle?eroticConfig.customMoanStyle+','+v:v,moanStyle:v})} onRemove={v=>setEroticConfig({...eroticConfig,customMoanStyle:(eroticConfig.customMoanStyle||'').split(',').filter((x:string)=>x!==v).join(','),moanStyle:eroticConfig.moanStyle===v?'哭喊破音':eroticConfig.moanStyle})} />
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, marginTop: 10 }}>侮辱词:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{DEGRADE_LANGS.map(d => { const sel = (eroticConfig.degradeLangs||[]).includes(d); return <button key={d} onClick={() => setEroticConfig({ ...eroticConfig, degradeLangs: sel ? (eroticConfig.degradeLangs||[]).filter((x:string)=>x!==d) : [...(eroticConfig.degradeLangs||[]), d] })} style={{ padding: '3px 8px', borderRadius: 6, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54' }}>{d}</button> })}{(eroticConfig.degradeLangs||[]).filter((v:string)=>!DEGRADE_LANGS.includes(v)).map((v:string) => <CustomTagButton key={'dl'+v} label={v} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, degradeLangs: (eroticConfig.degradeLangs||[]).filter((x:string)=>x!==v) })} onRemove={() => setEroticConfig({ ...eroticConfig, degradeLangs: (eroticConfig.degradeLangs||[]).filter((x:string)=>x!==v), customDegradeLangs: (eroticConfig.customDegradeLangs||[]).filter((x:string)=>x!==v) })}  editMode={editTagMode} />)}</div>
          <CustomInput hideDisplay label='自定义侮辱词' values={eroticConfig.customDegradeLangs || []} onAdd={v => setEroticConfig({ ...eroticConfig, customDegradeLangs: [...(eroticConfig.customDegradeLangs||[]), v], degradeLangs: [...(eroticConfig.degradeLangs||[]), v] })} onRemove={v => setEroticConfig({ ...eroticConfig, customDegradeLangs: (eroticConfig.customDegradeLangs||[]).filter((x:string)=>x!==v), degradeLangs: (eroticConfig.degradeLangs||[]).filter((x:string)=>x!==v) })} />
        </div>
          </AutoField>)
      case 10: return (<AutoField field="intensity" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: '#9b8e84', marginRight: 4 }}>强度:</span>
            {[1,2,3,4,5].map(i => { const sel = eroticConfig.intensity === i; return <button key={i} onClick={() => setEroticConfig({ ...eroticConfig, intensity: i })} title={STRENGTH_LABELS[i]} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400, minWidth: 32, textAlign: 'center' }}>{i}</button> })}
          </div>
          <div style={{ fontSize: 10, color: '#6b5e54', marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.02)' }}>强度说明: 1=暗示为主 2=有动作不详细 3=标准完整 4=大量细节 5=极尽细致</div>
        </div>
          </AutoField>)
      case 11: return (<AutoField field="extraNote" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#6b5e54', marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.04)', lineHeight: 1.6 }}>这里是给 AI 的额外创作指令，会注入到模板 prompt 末尾。点击预设标签填入上方文本框。</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>{(eroticConfig.customExtraNotes || '').split(',').filter(Boolean).map((v: string) => <CustomTagButton key={'ex'+v} label={v.slice(0,20)} selected={eroticConfig.extraNote === v} onToggle={() => setEroticConfig({ ...eroticConfig, extraNote: eroticConfig.extraNote === v ? '' : v })} onRemove={() => setEroticConfig({ ...eroticConfig, customExtraNotes: (eroticConfig.customExtraNotes||'').split(',').filter((x:string)=>x!==v).join(','), extraNote: eroticConfig.extraNote === v ? '' : eroticConfig.extraNote })}  editMode={editTagMode} />)}</div>
          <textarea value={eroticConfig.extraNote} onChange={e => setEroticConfig({ ...eroticConfig, extraNote: e.target.value })} rows={6} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} placeholder='额外说明...' />
          <CustomInput hideDisplay label='添加常用说明' values={(eroticConfig.customExtraNotes || '').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customExtraNotes: eroticConfig.customExtraNotes ? eroticConfig.customExtraNotes+','+v : v, extraNote: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customExtraNotes: (eroticConfig.customExtraNotes||'').split(',').filter((x:string)=>x!==v).join(','), extraNote: eroticConfig.extraNote === v ? '' : eroticConfig.extraNote })} />
        </div>
          </AutoField>)
      case 12: return (<AutoField field="narrativePOV" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {POVS.map(p => { const sel = eroticConfig.narrativePOV === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, narrativePOV: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {safeCSV(eroticConfig.customPOVs).split(',').filter((v: string) => v && !POVS.includes(v)).map((v: string) => <CustomTagButton key={'c'+v} label={v} selected={eroticConfig.narrativePOV === v} onToggle={() => setEroticConfig({ ...eroticConfig, narrativePOV: eroticConfig.narrativePOV === v ? '第三人称' : v })} onRemove={() => { setEroticConfig({ ...eroticConfig, customPOVs: safeCSV(eroticConfig.customPOVs).split(',').filter((x:string)=>x!==v).join(','), narrativePOV: eroticConfig.narrativePOV === v ? '第三人称' : eroticConfig.narrativePOV }) }}  editMode={editTagMode} />)}
          </div>
          <CustomInput hideDisplay values={safeCSV(eroticConfig.customPOVs).split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customPOVs: safeCSV(eroticConfig.customPOVs) ? safeCSV(eroticConfig.customPOVs)+','+v : v, narrativePOV: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customPOVs: safeCSV(eroticConfig.customPOVs).split(',').filter((x:string)=>x!==v).join(','), narrativePOV: eroticConfig.narrativePOV === v ? '第三人称' : eroticConfig.narrativePOV }) } />
        </div>
          </AutoField>)
      case 13: return (<AutoField field="bodyFluidFocus" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>体液优先级:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{['精液','爱液','汗液','乳汁','尿液','血液'].map(f => { const sel = (eroticConfig.bodyFluidFocus||[]).includes(f); return <button key={f} onClick={() => setEroticConfig({ ...eroticConfig, bodyFluidFocus: sel ? (eroticConfig.bodyFluidFocus||[]).filter((x:string)=>x!==f) : [...(eroticConfig.bodyFluidFocus||[]), f] })} style={{ padding: '3px 8px', borderRadius: 6, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54' }}>{f}</button> })}{(eroticConfig.bodyFluidFocus||[]).filter((v:string)=>!['精液','爱液','汗液','乳汁','尿液','血液'].includes(v)).map((v:string) => <CustomTagButton key={'bf'+v} label={v} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, bodyFluidFocus: (eroticConfig.bodyFluidFocus||[]).filter((x:string)=>x!==v) })} onRemove={() => setEroticConfig({ ...eroticConfig, bodyFluidFocus: (eroticConfig.bodyFluidFocus||[]).filter((x:string)=>x!==v) })}  editMode={editTagMode} />)}</div>
          <CustomInput values={[]} onAdd={v => setEroticConfig({ ...eroticConfig, bodyFluidFocus: [...(eroticConfig.bodyFluidFocus||[]), v] })} onRemove={v => setEroticConfig({ ...eroticConfig, bodyFluidFocus: (eroticConfig.bodyFluidFocus||[]).filter((x:string)=>x!==v) })} />
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, marginTop: 10 }}>身体焦点:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{['胸','腿','脚','臀','腰','颈','手','眼','唇','发'].map(p => { const sel = (eroticConfig.bodyPartFocus||[]).includes(p); return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, bodyPartFocus: sel ? (eroticConfig.bodyPartFocus||[]).filter((x:string)=>x!==p) : [...(eroticConfig.bodyPartFocus||[]), p] })} style={{ padding: '3px 8px', borderRadius: 6, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54' }}>{p}</button> })}{(eroticConfig.bodyPartFocus||[]).filter((v:string)=>!['胸','腿','脚','臀','腰','颈','手','眼','唇','发'].includes(v)).map((v:string) => <CustomTagButton key={'bp'+v} label={v} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, bodyPartFocus: (eroticConfig.bodyPartFocus||[]).filter((x:string)=>x!==v) })} onRemove={() => setEroticConfig({ ...eroticConfig, bodyPartFocus: (eroticConfig.bodyPartFocus||[]).filter((x:string)=>x!==v) })}  editMode={editTagMode} />)}</div>
          <CustomInput values={[]} onAdd={v => setEroticConfig({ ...eroticConfig, bodyPartFocus: [...(eroticConfig.bodyPartFocus||[]), v] })} onRemove={v => setEroticConfig({ ...eroticConfig, bodyPartFocus: (eroticConfig.bodyPartFocus||[]).filter((x:string)=>x!==v) })} />
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4, marginTop: 10 }}>触感优先:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{['温度','湿度','压力','摩擦','振动'].map(t => { const sel = (eroticConfig.tactileFocus||[]).includes(t); return <button key={t} onClick={() => setEroticConfig({ ...eroticConfig, tactileFocus: sel ? (eroticConfig.tactileFocus||[]).filter((x:string)=>x!==t) : [...(eroticConfig.tactileFocus||[]), t] })} style={{ padding: '3px 8px', borderRadius: 6, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54' }}>{t}</button> })}{(eroticConfig.tactileFocus||[]).filter((v:string)=>!['温度','湿度','压力','摩擦','振动'].includes(v)).map((v:string) => <CustomTagButton key={'tf'+v} label={v} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, tactileFocus: (eroticConfig.tactileFocus||[]).filter((x:string)=>x!==v) })} onRemove={() => setEroticConfig({ ...eroticConfig, tactileFocus: (eroticConfig.tactileFocus||[]).filter((x:string)=>x!==v) })}  editMode={editTagMode} />)}</div>
          <CustomInput values={[]} onAdd={v => setEroticConfig({ ...eroticConfig, tactileFocus: [...(eroticConfig.tactileFocus||[]), v] })} onRemove={v => setEroticConfig({ ...eroticConfig, tactileFocus: (eroticConfig.tactileFocus||[]).filter((x:string)=>x!==v) })} />
        </div>
          </AutoField>)
      case 14: return (<AutoField field="narrativeStyle" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {NOVEL_NARRATIVE_STYLES.map(p => { const sel = eroticConfig.narrativeStyle === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, narrativeStyle: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.narrativeStyle || '').split(',').filter((v: string) => v && !NOVEL_NARRATIVE_STYLES.includes(v)).map((v: string) => <CustomTagButton key={'c'+v} label={v} selected={eroticConfig.narrativeStyle === v} onToggle={() => setEroticConfig({ ...eroticConfig, narrativeStyle: eroticConfig.narrativeStyle === v ? '沉浸式长镜' : v })} onRemove={() => { const filtered = (eroticConfig.narrativeStyle||'').split(',').filter((x:string)=>x!==v).join(','); setEroticConfig({ ...eroticConfig, narrativeStyle: filtered || '沉浸式长镜' }) }}  editMode={editTagMode} />)}
          </div>
          <CustomInput hideDisplay values={(eroticConfig.narrativeStyle || '').split(',').filter((v:string)=>v&&!NOVEL_NARRATIVE_STYLES.includes(v))} onAdd={v => setEroticConfig({ ...eroticConfig, narrativeStyle: eroticConfig.narrativeStyle ? eroticConfig.narrativeStyle+','+v : v })} onRemove={v => { const filtered = (eroticConfig.narrativeStyle||'').split(',').filter((x:string)=>x!==v).join(','); setEroticConfig({ ...eroticConfig, narrativeStyle: filtered || '沉浸式长镜' }) }} />
        </div>
          </AutoField>)
      case 15: return (<AutoField field="timeCompression" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {NOVEL_TIME_COMPRESSION.map(p => { const sel = eroticConfig.timeCompression === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, timeCompression: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.timeCompression || '').split(',').filter((v: string) => v && !NOVEL_TIME_COMPRESSION.includes(v)).map((v: string) => <CustomTagButton key={'c'+v} label={v} selected={eroticConfig.timeCompression === v} onToggle={() => setEroticConfig({ ...eroticConfig, timeCompression: eroticConfig.timeCompression === v ? '实时' : v })} onRemove={() => { const filtered = (eroticConfig.timeCompression||'').split(',').filter((x:string)=>x!==v).join(','); setEroticConfig({ ...eroticConfig, timeCompression: filtered || '实时' }) }}  editMode={editTagMode} />)}
          </div>
          <CustomInput hideDisplay values={(eroticConfig.timeCompression || '').split(',').filter((v:string)=>v&&!NOVEL_TIME_COMPRESSION.includes(v))} onAdd={v => setEroticConfig({ ...eroticConfig, timeCompression: eroticConfig.timeCompression ? eroticConfig.timeCompression+','+v : v })} onRemove={v => { const filtered = (eroticConfig.timeCompression||'').split(',').filter((x:string)=>x!==v).join(','); setEroticConfig({ ...eroticConfig, timeCompression: filtered || '实时' }) }} />
        </div>
          </AutoField>)
      case 16: return (<AutoField field="introspection" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>内省 <span style={{ fontWeight: 400 }}>(心理描写深度)</span>:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {[['无','不写心理描写'],['低','偶尔一笔带过角色想法'],['中','适度穿插心理活动'],['高','大量内心独白和心理分析']].map(([i,desc]) => { const sel = eroticConfig.introspection === i; return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <button onClick={() => setEroticConfig({ ...eroticConfig, introspection: i })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{i}</button>
                <span style={{ fontSize: 9, color: '#b0a69e', textAlign: 'center', maxWidth: 80 }}>{desc}</span>
              </div>
            ) })}
          </div>
        </div>
          </AutoField>)
      case 17: return (<AutoField field="sensoryAnchors" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>{SENSORY_ANCHORS.map(a => { const sel = eroticConfig.sensoryAnchors === a; return <button key={a} onClick={() => setEroticConfig({ ...eroticConfig, sensoryAnchors: a })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{a}</button> })}{eroticConfig.sensoryAnchors && !SENSORY_ANCHORS.includes(eroticConfig.sensoryAnchors) ? <CustomTagButton key={'sa'+eroticConfig.sensoryAnchors} label={eroticConfig.sensoryAnchors} selected={true} onToggle={() => setEroticConfig({ ...eroticConfig, sensoryAnchors: '' })} onRemove={() => setEroticConfig({ ...eroticConfig, sensoryAnchors: '' })} editMode={editTagMode} /> : null}</div>
          <CustomInput hideDisplay values={eroticConfig.sensoryAnchors && !SENSORY_ANCHORS.includes(eroticConfig.sensoryAnchors) ? [eroticConfig.sensoryAnchors] : []} onAdd={v => setEroticConfig({ ...eroticConfig, sensoryAnchors: v })} onRemove={() => setEroticConfig({ ...eroticConfig, sensoryAnchors: '' })} />
        </div>
          </AutoField>)
      case 18: return (<AutoField field="dominantEmotion" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>主导情绪</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>{['羞辱','快感','恐惧','温柔','支配','臣服','渴求','羞耻','爱慕','仇恨'].map(e => { const sel = eroticConfig.dominantEmotion === e; return <button key={e} onClick={() => setEroticConfig({ ...eroticConfig, dominantEmotion: e })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{e}</button> })}</div>
            <CustomInput hideDisplay label='添加自定义情绪' values={(eroticConfig.customEmotions||'').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customEmotions: eroticConfig.customEmotions ? eroticConfig.customEmotions+','+v : v, dominantEmotion: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customEmotions: (eroticConfig.customEmotions||'').split(',').filter((x:string)=>x!==v).join(','), dominantEmotion: eroticConfig.dominantEmotion===v?'':eroticConfig.dominantEmotion })} />
            {(eroticConfig.customEmotions||'').split(',').filter(Boolean).map((v:string) => <CustomTagButton key={'em'+v} label={v} selected={eroticConfig.dominantEmotion===v} onToggle={() => setEroticConfig({ ...eroticConfig, dominantEmotion: eroticConfig.dominantEmotion===v?'':v })} onRemove={() => setEroticConfig({ ...eroticConfig, customEmotions: (eroticConfig.customEmotions||'').split(',').filter((x:string)=>x!==v).join(','), dominantEmotion: eroticConfig.dominantEmotion===v?'':eroticConfig.dominantEmotion })}  editMode={editTagMode} />)}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>情绪曲线</div>
            <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>示例: 羞耻(开头)→兴奋(渐进)→失控(高潮)→羞耻(余韵)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>{(eroticConfig.customCurves||'').split(',').filter(Boolean).map((v:string) => <CustomTagButton key={'cv'+v} label={v.slice(0,25)} selected={eroticConfig.emotionCurveInput===v} onToggle={() => setEroticConfig({ ...eroticConfig, emotionCurveInput: eroticConfig.emotionCurveInput===v?'':v })} onRemove={() => setEroticConfig({ ...eroticConfig, customCurves: (eroticConfig.customCurves||'').split(',').filter((x:string)=>x!==v).join(','), emotionCurveInput: eroticConfig.emotionCurveInput===v?'':eroticConfig.emotionCurveInput })}  editMode={editTagMode} />)}</div>
            <input value={eroticConfig.emotionCurveInput} onChange={e => setEroticConfig({ ...eroticConfig, emotionCurveInput: e.target.value })} style={{ ...inputStyle, width: '100%' }} placeholder='情绪(阶段)→情绪(阶段)→...' />
            <CustomInput hideDisplay label='保存曲线为预设' values={(eroticConfig.customCurves||'').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customCurves: eroticConfig.customCurves ? eroticConfig.customCurves+','+v : v, emotionCurveInput: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customCurves: (eroticConfig.customCurves||'').split(',').filter((x:string)=>x!==v).join(','), emotionCurveInput: eroticConfig.emotionCurveInput===v?'':eroticConfig.emotionCurveInput })} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>触发词</div>
            <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>角色听到/说出此词时情绪失控或转变</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>{(eroticConfig.customTriggers||'').split(',').filter(Boolean).map((v:string) => <CustomTagButton key={'tg'+v} label={v.slice(0,20)} selected={eroticConfig.triggerWords===v} onToggle={() => setEroticConfig({ ...eroticConfig, triggerWords: eroticConfig.triggerWords===v?'':v })} onRemove={() => setEroticConfig({ ...eroticConfig, customTriggers: (eroticConfig.customTriggers||'').split(',').filter((x:string)=>x!==v).join(','), triggerWords: eroticConfig.triggerWords===v?'':eroticConfig.triggerWords })}  editMode={editTagMode} />)}</div>
            <input value={eroticConfig.triggerWords} onChange={e => setEroticConfig({ ...eroticConfig, triggerWords: e.target.value })} style={{ ...inputStyle, width: '100%' }} placeholder='如"求你了主人"' />
            <CustomInput hideDisplay label='保存触发词为预设' values={(eroticConfig.customTriggers||'').split(',').filter(Boolean)} onAdd={v => setEroticConfig({ ...eroticConfig, customTriggers: eroticConfig.customTriggers ? eroticConfig.customTriggers+','+v : v, triggerWords: v })} onRemove={v => setEroticConfig({ ...eroticConfig, customTriggers: (eroticConfig.customTriggers||'').split(',').filter((x:string)=>x!==v).join(','), triggerWords: eroticConfig.triggerWords===v?'':eroticConfig.triggerWords })} />
          </div>
        </div>
          </AutoField>)
      case 19: return (<AutoField field="worldRules" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>世界规则 — 本章特殊的设定/规则</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {WORLD_RULES.map(p => { const items = (eroticConfig.worldRules||'').split(',').map((s:string)=>s.trim()).filter(Boolean); const sel = items.includes(p); return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, worldRules: sel ? items.filter((x:string)=>x!==p).join(',') : [...items, p].join(',') })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.customWorldRules||'').split(',').filter((v:string) => v && !WORLD_RULES.includes(v)).map((v:string) => { const items = (eroticConfig.worldRules||'').split(',').map((s:string)=>s.trim()).filter(Boolean); const sel = items.includes(v); return <CustomTagButton key={'c'+v} label={v} selected={sel} onToggle={() => setEroticConfig({ ...eroticConfig, worldRules: sel ? items.filter((x:string)=>x!==v).join(',') : [...items, v].join(',') })} onRemove={() => setEroticConfig({ ...eroticConfig, customWorldRules: (eroticConfig.customWorldRules||'').split(',').filter((x:string)=>x!==v).join(','), worldRules: items.filter((x:string)=>x!==v).join(',') })}  editMode={editTagMode} /> })}
          </div>
          <CustomInput hideDisplay label='添加自定义' values={(eroticConfig.customWorldRules||'').split(',').filter(Boolean)} onAdd={v => { const items = (eroticConfig.worldRules||'').split(',').map((s:string)=>s.trim()).filter(Boolean); setEroticConfig({ ...eroticConfig, customWorldRules: eroticConfig.customWorldRules ? eroticConfig.customWorldRules+','+v : v, worldRules: [...items, v].join(',') }) }} onRemove={v => { const items = (eroticConfig.worldRules||'').split(',').map((s:string)=>s.trim()).filter(Boolean); setEroticConfig({ ...eroticConfig, customWorldRules: (eroticConfig.customWorldRules||'').split(',').filter((x:string)=>x!==v).join(','), worldRules: items.filter((x:string)=>x!==v).join(',') }) }} />
        </div>
          </AutoField>)
      case 20: return (<AutoField field="propList" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>道具清单 — 本章场景中出现的道具组合</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {PROP_LIST.map(p => { const items = (eroticConfig.propList||'').split(',').map((s:string)=>s.trim()).filter(Boolean); const sel = items.includes(p); return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, propList: sel ? items.filter((x:string)=>x!==p).join(',') : [...items, p].join(',') })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.customPropLists||'').split(',').filter((v:string) => v && !PROP_LIST.includes(v)).map((v:string) => { const items = (eroticConfig.propList||'').split(',').map((s:string)=>s.trim()).filter(Boolean); const sel = items.includes(v); return <CustomTagButton key={'c'+v} label={v} selected={sel} onToggle={() => setEroticConfig({ ...eroticConfig, propList: sel ? items.filter((x:string)=>x!==v).join(',') : [...items, v].join(',') })} onRemove={() => setEroticConfig({ ...eroticConfig, customPropLists: (eroticConfig.customPropLists||'').split(',').filter((x:string)=>x!==v).join(','), propList: items.filter((x:string)=>x!==v).join(',') })}  editMode={editTagMode} /> })}
          </div>
          <CustomInput hideDisplay label='添加自定义' values={(eroticConfig.customPropLists||'').split(',').filter(Boolean)} onAdd={v => { const items = (eroticConfig.propList||'').split(',').map((s:string)=>s.trim()).filter(Boolean); setEroticConfig({ ...eroticConfig, customPropLists: eroticConfig.customPropLists ? eroticConfig.customPropLists+','+v : v, propList: [...items, v].join(',') }) }} onRemove={v => { const items = (eroticConfig.propList||'').split(',').map((s:string)=>s.trim()).filter(Boolean); setEroticConfig({ ...eroticConfig, customPropLists: (eroticConfig.customPropLists||'').split(',').filter((x:string)=>x!==v).join(','), propList: items.filter((x:string)=>x!==v).join(',') }) }} />
        </div>
          </AutoField>)
      case 21: return (<AutoField field="costumeList" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>服装清单 — 本章角色穿着组合</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {COSTUME_LIST.map(p => { const items = (eroticConfig.costumeList||'').split(',').map((s:string)=>s.trim()).filter(Boolean); const sel = items.includes(p); return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, costumeList: sel ? items.filter((x:string)=>x!==p).join(',') : [...items, p].join(',') })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}
            {(eroticConfig.customCostumeLists||'').split(',').filter((v:string) => v && !COSTUME_LIST.includes(v)).map((v:string) => { const items = (eroticConfig.costumeList||'').split(',').map((s:string)=>s.trim()).filter(Boolean); const sel = items.includes(v); return <CustomTagButton key={'c'+v} label={v} selected={sel} onToggle={() => setEroticConfig({ ...eroticConfig, costumeList: sel ? items.filter((x:string)=>x!==v).join(',') : [...items, v].join(',') })} onRemove={() => setEroticConfig({ ...eroticConfig, customCostumeLists: (eroticConfig.customCostumeLists||'').split(',').filter((x:string)=>x!==v).join(','), costumeList: items.filter((x:string)=>x!==v).join(',') })}  editMode={editTagMode} /> })}
          </div>
          <CustomInput hideDisplay label='添加自定义' values={(eroticConfig.customCostumeLists||'').split(',').filter(Boolean)} onAdd={v => { const items = (eroticConfig.costumeList||'').split(',').map((s:string)=>s.trim()).filter(Boolean); setEroticConfig({ ...eroticConfig, customCostumeLists: eroticConfig.customCostumeLists ? eroticConfig.customCostumeLists+','+v : v, costumeList: [...items, v].join(',') }) }} onRemove={v => { const items = (eroticConfig.costumeList||'').split(',').map((s:string)=>s.trim()).filter(Boolean); setEroticConfig({ ...eroticConfig, customCostumeLists: (eroticConfig.customCostumeLists||'').split(',').filter((x:string)=>x!==v).join(','), costumeList: items.filter((x:string)=>x!==v).join(',') }) }} />
        </div>
          </AutoField>)
      case 22: return (<AutoField field="wordTarget" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#6b5e54', marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(124,58,237,0.04)', lineHeight: 1.6 }}>本模板覆盖的亲密/性交场景的建议字数。区别于 AI 生成弹窗的整章字数。</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type='number' value={eroticConfig.wordTarget} onChange={e => { const v = parseInt(e.target.value); setEroticConfig({ ...eroticConfig, wordTarget: isNaN(v) ? 2000 : v }) }} style={{ ...inputStyle, width: 120 }} /><span style={{ fontSize: 12, color: '#6b5e54' }}>字</span></div>
        </div>
          </AutoField>)
      case 23: return (<AutoField field="pacing" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 6 }}>情色节奏 — 控制场景的节奏感</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{EROTIC_PACINGS.map(p => { const sel = eroticConfig.pacing === p; return <button key={p} onClick={() => setEroticConfig({ ...eroticConfig, pacing: p })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}</div>
          <CustomInput hideDisplay label='自定义节奏' values={eroticConfig.pacing && !EROTIC_PACINGS.includes(eroticConfig.pacing) ? [eroticConfig.pacing] : []} onAdd={v => setEroticConfig({ ...eroticConfig, pacing: v })} onRemove={() => setEroticConfig({ ...eroticConfig, pacing: '渐进升温' })} />
        </div>
          </AutoField>)
      case 24: return (<AutoField field="bodyLanguage" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 6 }}>非言语表达 — 角色的肢体语言与微表情</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{EROTIC_BODY_LANGUAGES.map(b => { const sel = eroticConfig.bodyLanguage === b; return <button key={b} onClick={() => setEroticConfig({ ...eroticConfig, bodyLanguage: b })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{b}</button> })}</div>
          <CustomInput hideDisplay label='自定义' values={eroticConfig.bodyLanguage && !EROTIC_BODY_LANGUAGES.includes(eroticConfig.bodyLanguage) ? [eroticConfig.bodyLanguage] : []} onAdd={v => setEroticConfig({ ...eroticConfig, bodyLanguage: v })} onRemove={() => setEroticConfig({ ...eroticConfig, bodyLanguage: '' })} />
        </div>
          </AutoField>)
      case 25: return (<AutoField field="consentDynamic" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 6 }}>同意动态 — 角色间的同意模式</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{EROTIC_CONSENT_DYNAMICS.map(c => { const sel = eroticConfig.consentDynamic === c; return <button key={c} onClick={() => setEroticConfig({ ...eroticConfig, consentDynamic: c })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{c}</button> })}</div>
        </div>
          </AutoField>)
      case 26: return (<AutoField field="aftercareDetail" autoFields={eroticConfig.autoFields} onToggle={toggleEroticAuto}>
            <div>
          <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 6 }}>事后关怀 — 场景结束后的处理方式</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{EROTIC_AFTERCARE.map(a => { const sel = eroticConfig.aftercareDetail === a; return <button key={a} onClick={() => setEroticConfig({ ...eroticConfig, aftercareDetail: a })} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #dc2626' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(220,38,38,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#dc2626' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{a}</button> })}</div>
        </div>
          </AutoField>)
      default: return <div style={{ fontSize: 12, color: '#9b8e84', padding: 20, textAlign: 'center' }}>未知区块</div>
    }
  }

  function renderNovelSectionEditor(section: number) {
    const nc = novelConfig
    const setNC = setNovelConfig
    switch (section) {
      case 1: return (<AutoField field="sceneType" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
            类型: <select value={nc.sceneType} onChange={e => setNC({...nc, sceneType: e.target.value})} style={inputStyle}>{NOVEL_SCENE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}</select>
            冲突: <select value={nc.conflictType} onChange={e => setNC({...nc, conflictType: e.target.value})} style={inputStyle}>{NOVEL_CONFLICTS.map(c => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <div style={{ fontSize: 11 }}>目的: {NOVEL_PURPOSES.map(p => (
            <label key={p} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:8,cursor:'pointer' }}><input type="checkbox" checked={nc.scenePurpose.includes(p)} onChange={() => setNC({...nc, scenePurpose: nc.scenePurpose.includes(p) ? nc.scenePurpose.filter(x => x !== p) : [...nc.scenePurpose, p]})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />{p}</label>
          ))}</div>
        </div>
          </AutoField>)
      case 2: return (<AutoField field="povCharacterId" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11 }}>主视角: <select value={nc.povCharacterId} onChange={e => { const ch = characters.find(c => c.id === e.target.value); setNC({...nc, povCharacterId: e.target.value, povCharacterName: ch?.name || ''}) }} style={inputStyle}><option value="">无</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          {nc.characters.map((ch, i) => (
            <div key={ch.characterId} style={{ display:'flex',gap:4,alignItems:'center',flexWrap:'wrap' }}>
              <span style={{ fontSize:11,fontWeight:600,minWidth:50 }}>{ch.characterName}</span>
              <input value={ch.emotion || ''} onChange={e => { const n = [...nc.characters]; n[i] = {...n[i], emotion: e.target.value}; setNC({...nc, characters: n}) }} placeholder="情绪" style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,width:100 }} />
              <button onClick={() => setNC({...nc, characters: nc.characters.filter((_, j) => j !== i)})} style={{ background:'none',border:'none',cursor:'pointer',color:'#d4ccc4' }}><TrashIcon style={{ width:12,height:12 }} /></button>
            </div>
          ))}
          <details><summary style={{ fontSize:11,color:'#3b82f6',cursor:'pointer' }}>+ 添加角色</summary>
            <div style={{ display:'flex',flexWrap:'wrap',gap:4,marginTop:4 }}>
              {characters.filter(c => !nc.characters.find(x => x.characterId === c.id)).map(c => (
                <button key={c.id} onClick={() => setNC({...nc, characters: [...nc.characters, { characterId: c.id, characterName: c.name, emotion: '' }]})} style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',background:'#fff',fontSize:11,cursor:'pointer' }}>{c.name}</button>
              ))}
              {characters.length === 0 && <span style={{ fontSize:10,color:'#9b8e84' }}>项目暂无角色</span>}
            </div>
          </details>
        </div>
          </AutoField>)
      case 3: return (<AutoField field="location" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display:'flex',gap:8,flexWrap:'wrap',fontSize:11,alignItems:'center' }}>
            地点: <select value={nc.location} onChange={e => setNC({...nc, location: e.target.value})} style={inputStyle}>{EROTIC_LOCATIONS.map(l => <option key={l}>{l}</option>)}</select>
            <input value={nc.customLocation} onChange={e => setNC({...nc, customLocation: e.target.value})} placeholder="或自定义" style={{ padding:'2px 6px',borderRadius:4,border:'1px solid rgba(0,0,0,0.1)',fontSize:10,width:80 }} />
            天气: <select value={nc.weather} onChange={e => setNC({...nc, weather: e.target.value})} style={inputStyle}>{NOVEL_WEATHERS.map(w => <option key={w}>{w}</option>)}</select>
            时间: <select value={nc.time} onChange={e => setNC({...nc, time: e.target.value})} style={inputStyle}>{EROTIC_TIMES.map(t => <option key={t}>{t}</option>)}</select>
            氛围: <select value={nc.atmosphere} onChange={e => setNC({...nc, atmosphere: e.target.value})} style={inputStyle}>{ATMOSPHERES.map(a => <option key={a}>{a}</option>)}</select>
          </div>
          <div style={{ fontSize:11 }}>感官: {['视觉','听觉','嗅觉','触觉','味觉'].map(s => (
            <label key={s} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:8,cursor:'pointer' }}><input type="checkbox" checked={nc.senses.includes(s)} onChange={() => setNC({...nc, senses: nc.senses.includes(s) ? nc.senses.filter(x => x !== s) : [...nc.senses, s]})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />{s}</label>
          ))}</div>
        </div>
          </AutoField>)
      case 4: return (<AutoField field="genreElements" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div>
          <div style={{ marginBottom: 6, fontSize: 11 }}>
            小说类型: <select value={novelGenreType} onChange={e => { setNovelGenreType(e.target.value); setNC({...nc, genreElements: []}) }} style={inputStyle}>{Object.keys(NOVEL_GENRE_ELEMENTS).map(g => <option key={g}>{g}</option>)}</select>
          </div>
          {NOVEL_GENRE_ELEMENTS[novelGenreType]?.map(el => (
            <label key={el} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:10,cursor:'pointer',fontSize:11 }}>
              <input type="checkbox" checked={nc.genreElements.includes(el)} onChange={() => setNC({...nc, genreElements: nc.genreElements.includes(el) ? nc.genreElements.filter(x => x !== el) : [...nc.genreElements, el]})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />{el}
            </label>
          ))}
        </div>
          </AutoField>)
      case 5: return (<AutoField field="dialogueRatio" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display:'flex',gap:8,flexWrap:'wrap',fontSize:11 }}>
          对话: <select value={nc.dialogueRatio} onChange={e => setNC({...nc, dialogueRatio: e.target.value})} style={inputStyle}>{NOVEL_DIALOGUES.map(d => <option key={d}>{d}</option>)}</select>
          潜台词: <select value={nc.subtextLevel} onChange={e => setNC({...nc, subtextLevel: e.target.value})} style={inputStyle}>{NOVEL_SUBTEXTS.map(s => <option key={s}>{s}</option>)}</select>
          句式: <select value={nc.sentenceStyle} onChange={e => setNC({...nc, sentenceStyle: e.target.value})} style={inputStyle}>{NOVEL_SENTENCES.map(s => <option key={s}>{s}</option>)}</select>
          段落: <select value={nc.paragraphDensity} onChange={e => setNC({...nc, paragraphDensity: e.target.value})} style={inputStyle}>{NOVEL_DENSITIES.map(d => <option key={d}>{d}</option>)}</select>
        </div>
          </AutoField>)
      case 6: return (<AutoField field="wordTarget" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',fontSize:11 }}>
            字数: <input type="number" min={500} max={50000} step={100} value={nc.wordTarget} onChange={e => { const v = parseInt(e.target.value); setNC({...nc, wordTarget: isNaN(v) ? 3000 : Math.max(500, v)}) }} style={{ width:70,padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11 }} />
            视角: <select value={nc.narrativePOV} onChange={e => setNC({...nc, narrativePOV: e.target.value})} style={inputStyle}>{POVS.map(p => <option key={p}>{p}</option>)}</select>
          </div>
          <div style={{ display:'flex',gap:10,fontSize:11,alignItems:'center' }}>
            情绪起始: <input value={nc.emotionStart} onChange={e => setNC({...nc, emotionStart: e.target.value})} placeholder="如: 平静" style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,width:80 }} />
            → 结尾: <input value={nc.emotionEnd} onChange={e => setNC({...nc, emotionEnd: e.target.value})} placeholder="如: 暴怒" style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,width:80 }} />
          </div>
          <div style={{ display:'flex',gap:10,fontSize:11,alignItems:'center' }}>
            <label style={{ cursor:'pointer',display:'flex',alignItems:'center',gap:3 }}><input type="checkbox" checked={nc.useStyleProfile} onChange={e => setNC({...nc, useStyleProfile: e.target.checked})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />注入风格档案</label>
            <label style={{ cursor:'pointer',display:'flex',alignItems:'center',gap:3 }}><input type="checkbox" checked={nc.useChapterOutline} onChange={e => setNC({...nc, useChapterOutline: e.target.checked})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />注入章节大纲</label>
          </div>
          <textarea value={nc.extraNote} onChange={e => setNC({...nc, extraNote: e.target.value})} rows={3} placeholder="额外说明..." style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
        </div>
          </AutoField>)
      case 7: return (<AutoField field="narrativeStyle" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>叙事风格</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{NOVEL_NARRATIVE_STYLES.map(s => { const sel = nc.narrativeStyle === s; return <button key={s} onClick={() => setNC({...nc, narrativeStyle: s})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{s}</button> })}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>时间处理</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{NOVEL_TIME_COMPRESSION.map(t => { const sel = nc.timeCompression === t; return <button key={t} onClick={() => setNC({...nc, timeCompression: t})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{t}</button> })}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>内省深度</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{NOVEL_INTROSPECTION.map(i => { const sel = nc.introspection === i; return <button key={i} onClick={() => setNC({...nc, introspection: i})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{i}</button> })}</div>
          </div>
        </div>
          </AutoField>)
      case 8: return (<AutoField field="dominantEmotion" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>主导情绪</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{NOVEL_DOMINANT_EMOTIONS.map(e => { const sel = nc.dominantEmotion === e; return <button key={e} onClick={() => setNC({...nc, dominantEmotion: e})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{e}</button> })}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>情绪曲线</div>
            <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>示例: 平静→震惊→愤怒→释然</div>
            <input value={nc.emotionCurveInput} onChange={e => setNC({...nc, emotionCurveInput: e.target.value})} style={{ ...inputStyle, width: '100%' }} placeholder='情绪(阶段)→情绪(阶段)→...' />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>节奏</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{NOVEL_PACINGS.map(p => { const sel = nc.pacing === p; return <button key={p} onClick={() => setNC({...nc, pacing: p})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}</div>
          </div>
        </div>
          </AutoField>)
      case 9: return (<AutoField field="sensoryAnchors" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>感官锚点</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>{SENSORY_ANCHORS.map(a => { const sel = nc.sensoryAnchors === a; return <button key={a} onClick={() => setNC({...nc, sensoryAnchors: a})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{a}</button> })}</div>
            <CustomInput hideDisplay values={nc.sensoryAnchors && !SENSORY_ANCHORS.includes(nc.sensoryAnchors) ? [nc.sensoryAnchors] : []} onAdd={v => setNC({...nc, sensoryAnchors: v})} onRemove={() => setNC({...nc, sensoryAnchors: ''})} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>关键道具</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>{NOVEL_PROPS_PRESETS.map(p => { const sel = nc.props === p; return <button key={p} onClick={() => setNC({...nc, props: p})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{p}</button> })}</div>
            <CustomInput hideDisplay values={nc.props && !NOVEL_PROPS_PRESETS.includes(nc.props) ? [nc.props] : []} onAdd={v => setNC({...nc, props: v})} onRemove={() => setNC({...nc, props: ''})} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>角色外观</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>{NOVEL_APPEARANCE_PRESETS.map(a => { const sel = nc.appearance === a; return <button key={a} onClick={() => setNC({...nc, appearance: a})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{a}</button> })}</div>
            <CustomInput hideDisplay values={nc.appearance && !NOVEL_APPEARANCE_PRESETS.includes(nc.appearance) ? [nc.appearance] : []} onAdd={v => setNC({...nc, appearance: v})} onRemove={() => setNC({...nc, appearance: ''})} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>肢体语言</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{NOVEL_BODY_LANGUAGES.map(b => { const sel = nc.bodyLanguage === b; return <button key={b} onClick={() => setNC({...nc, bodyLanguage: b})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{b}</button> })}</div>
          </div>
        </div>
          </AutoField>)
      case 10: return (<AutoField field="foreshadowUse" autoFields={novelConfig.autoFields} onToggle={toggleNovelAuto}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>伏笔操作</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{NOVEL_FORESHADOW_USE.map(f => { const sel = nc.foreshadowUse === f; return <button key={f} onClick={() => setNC({...nc, foreshadowUse: f})} style={{ padding: '4px 10px', borderRadius: 8, border: sel ? '1px solid #3b82f6' : '1px solid rgba(0,0,0,0.08)', background: sel ? 'rgba(59,130,246,0.08)' : '#fff', cursor: 'pointer', fontSize: 10, color: sel ? '#3b82f6' : '#6b5e54', fontWeight: sel ? 600 : 400 }}>{f}</button> })}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 6 }}>场景转折点</div>
            <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 4 }}>本场景的核心转折事件</div>
            <input value={nc.sceneTurningPoint} onChange={e => setNC({...nc, sceneTurningPoint: e.target.value})} style={{ ...inputStyle, width: '100%' }} placeholder='如"发现真相"/"背叛时刻"' />
          </div>
        </div>
          </AutoField>)
      default: return <div style={{ fontSize: 12, color: '#9b8e84', padding: 20, textAlign: 'center' }}>未知区块</div>
    }
  }

  // Group templates by type
  const groupedTemplates = templates.reduce((acc, tpl) => {
    const type = tpl.type || '普通小说'
    if (!acc[type]) acc[type] = []
    acc[type].push(tpl)
    return acc
  }, {} as Record<string, SceneTemplate[]>)

  const TYPE_COLORS: Record<string, string> = {
    '情色小说': '#dc2626', '普通小说': '#3b82f6', '都市小说': '#06b6d4', '修仙小说': '#7c3aed',
    '武侠小说': '#f59e0b', '恋爱小说': '#ec4899', '古风小说': '#8b5cf6', '悬疑小说': '#6366f1',
    '历史小说': '#b45309', '科幻小说': '#10b981', '穿越小说': '#14b8a6',
  }

  return (
    <div className="page-enter" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {editorType ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditorType(null)}>← 返回</Button>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: editorType === 'erotic' ? '#dc2626' : '#3b82f6' }}>
              {editorType === 'erotic' ? '🔥 情色场景模板' : '📖 普通场景模板'}
            </h2>
          </>
        ) : (
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>场景工坊</h2>
        )}
        <div style={{ flex: 1 }} />
        <Button size="sm" onClick={handleNewTemplate} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>新建模板</Button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Template list (always visible, grouped by type) */}
        <div style={{ width: 280, borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
          <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b5e54', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            场景模板 ({templates.length})
          </div>
          <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {templates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, fontSize: 12, color: '#9b8e84' }}>暂无模板</div>
              ) : (
                Object.entries(groupedTemplates).map(([type, tpls]) => (
                  <div key={type}>
                    <div style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', marginBottom: 4,
                      color: TYPE_COLORS[type] || '#6b7280',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ width: 3, height: 14, borderRadius: 2, background: TYPE_COLORS[type] || '#6b7280', display: 'inline-block' }} />
                      {type} · {tpls.length}
                    </div>
                    {tpls.map(tpl => (
                      <div key={tpl.id} onClick={() => handleEditTemplate(tpl)} style={{
                        padding: '8px 10px 8px 14px', borderRadius: 8, cursor: 'pointer',
                        background: '#fff', border: '1px solid rgba(0,0,0,0.04)', marginBottom: 3,
                        fontSize: 12, transition: 'all 0.15s',
                      }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,0.15)'; e.currentTarget.style.background = 'rgba(124,58,237,0.02)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,0.04)'; e.currentTarget.style.background = '#fff' }}>
                        <div style={{ fontWeight: 600, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.name}</div>
                        <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 2 }}>
                          {tpl.createdAt ? new Date(tpl.createdAt).toLocaleDateString() : ''}
                          <span style={{ float: 'right', display: 'inline-flex', gap: 2 }}>
                            <span onClick={e => { e.stopPropagation(); handleDuplicateTemplate(tpl) }} title="复制" style={{ cursor: 'pointer', color: '#9b8e84' }}>📋</span>
                            <span onClick={e => { e.stopPropagation(); handleDeleteTemplate(tpl.id) }} title="删除" style={{ cursor: 'pointer', color: '#d4ccc4' }}>🗑</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: Content area */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {!editorType ? (
            /* Type selection grid */
            <div style={{ padding: 32, maxWidth: 700, margin: '0 auto' }}>
              <p style={{ fontSize: 13, color: '#9b8e84', marginBottom: 20 }}>选择场景类型创建新模板，或从左侧选择已有模板编辑</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {(['普通小说','情色小说','玄幻小说','奇幻小说','灵异小说','游戏小说','末世小说','轻小说','都市小说','修仙小说','武侠小说','恋爱小说','古风小说','悬疑小说','历史小说','科幻小说','穿越小说'] as SceneTemplateType[]).map(type => {
                  const isErotic = type === '情色小说'
                  const count = groupedTemplates[type]?.length || 0
                  return (
                    <button key={type} onClick={() => handleEnterType(type)} style={{
                      padding: '14px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit',
                      border: isErotic ? '1px solid rgba(220,38,38,0.15)' : '1px solid rgba(124,58,237,0.1)',
                      background: isErotic ? 'rgba(220,38,38,0.03)' : 'rgba(124,58,237,0.02)',
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isErotic ? '#dc2626' : '#3b82f6', marginBottom: 4 }}>{type.replace('小说','')}</div>
                      <div style={{ fontSize: 10, color: '#9b8e84' }}>{isErotic ? '26区块' : '10区块'} · {count}个模板</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : !showEditor ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#9b8e84' }}>
              <DocumentTextIcon style={{ width: 48, height: 48, margin: '0 auto 12px', opacity: 0.2 }} />
              <p style={{ fontSize: 14 }}>选择左侧模板编辑，或点击「新建模板」</p>
            </div>
          ) : editorType === 'erotic' ? (
            <>
              <div style={{ padding: '12px 16px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <input value={templateName} onChange={e => setTemplateName(e.target.value)} style={{ ...inputStyle, width: '100%', fontSize: 14, fontWeight: 600 }} placeholder="输入模板名称（必填）..." />
                  </div>
              <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
                <div style={{ padding: '12px 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  {SECTIONS.map(s => (
                    <SectionCard key={s.id} id={s.id} label={s.label} summary={getSectionSummary(s.id, eroticConfig)} isAuto={sectionIsAuto(s.id, eroticConfig)} onClick={() => { setEditingSection(s.id); setShowSectionModal(true) }} />
                  ))}
                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
                    <Button variant="secondary" onClick={() => setShowEditor(false)}>取消</Button>
                    <Button onClick={handleSaveTemplate}>💾 保存模板</Button>
                  </div>
                </div>
              </ScrollArea>
              <Modal isOpen={showSectionModal} onClose={() => { setShowSectionModal(false); setEditTagMode(false) }} title={editingSection ? (SECTIONS.find(s => s.id === editingSection)?.label || '') : ''} width={700}>
                {editingSection && (
                  <div style={{ maxHeight: '65vh', overflowY: 'auto' }} className="custom-scrollbar">
                    {renderSectionEditor(editingSection)}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 12 }}>
                  <Button variant={editTagMode ? 'primary' : 'secondary'} size="sm" onClick={() => setEditTagMode(!editTagMode)}>{editTagMode ? '✓ 完成编辑' : '✎ 编辑标签'}</Button>
                  <Button variant="secondary" size="sm" onClick={() => { setShowSectionModal(false); setEditTagMode(false) }}>关闭</Button>
                </div>
              </Modal>
            </>
          ) : (
            <>
              <div style={{ padding: '12px 16px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <input value={templateName} onChange={e => setTemplateName(e.target.value)} style={{ ...inputStyle, width: '100%', fontSize: 14, fontWeight: 600 }} placeholder="输入模板名称（必填）..." />
              </div>
              <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
                <div style={{ padding: '12px 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  {NOVEL_SECTIONS.map(s => (
                    <NovelSectionCard key={s.id} id={s.id} label={s.label} summary={getNovelSectionSummary(s.id, novelConfig)} isAuto={novelSectionIsAuto(s.id, novelConfig)} onClick={() => { setEditingNovelSection(s.id); setShowNovelSectionModal(true) }} />
                  ))}
                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12 }}>
                    <Button variant="secondary" onClick={() => setShowEditor(false)}>取消</Button>
                    <Button onClick={handleSaveTemplate}>💾 保存模板</Button>
                  </div>
                </div>
              </ScrollArea>
              <Modal isOpen={showNovelSectionModal} onClose={() => { setShowNovelSectionModal(false); setEditTagMode(false) }} title={editingNovelSection ? (NOVEL_SECTIONS.find(s => s.id === editingNovelSection)?.label || '') : ''} width={700}>
                {editingNovelSection && (
                  <div style={{ maxHeight: '65vh', overflowY: 'auto' }} className="custom-scrollbar">
                    {renderNovelSectionEditor(editingNovelSection)}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 12 }}>
                  <Button variant={editTagMode ? 'primary' : 'secondary'} size="sm" onClick={() => setEditTagMode(!editTagMode)}>{editTagMode ? '✓ 完成编辑' : '✎ 编辑标签'}</Button>
                  <Button variant="secondary" size="sm" onClick={() => { setShowNovelSectionModal(false); setEditTagMode(false) }}>关闭</Button>
                </div>
              </Modal>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
