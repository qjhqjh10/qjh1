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
} from '../sceneWorkshopConstants'
import type { EditorType } from '../sceneWorkshopConstants'

export function safeCSV(v: unknown): string {
  if (Array.isArray(v)) return (v as string[]).join(',')
  return (v as string) || ''
}

export function getSectionSummary(section: number, config: EroticSceneConfig): string {
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
export function sectionIsAuto(section: number, cfg: EroticSceneConfig): boolean {
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
export function novelSectionIsAuto(section: number, cfg: NovelSceneConfig): boolean {
  const fields = NOVEL_SECTION_FIELDS[section]
  if (!fields) return false
  return fields.every(f => cfg.autoFields[f])
}

export function SectionCard({ id, label, summary, isAuto, onClick }: { id: number; label: string; summary: string; isAuto?: boolean; onClick: () => void }) {
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

export const NOVEL_SECTIONS = [
  { id: 1, label: '1. 场景类型与目的' }, { id: 2, label: '2. 角色与视角' }, { id: 3, label: '3. 环境描写' },
  { id: 4, label: '4. 类型专属' }, { id: 5, label: '5. 对话与节奏' }, { id: 6, label: '6. 篇幅与注入' },
  { id: 7, label: '7. 叙事技法' }, { id: 8, label: '8. 情绪设计' }, { id: 9, label: '9. 感官与细节' },
  { id: 10, label: '10. 伏笔与转折' },
]

export function getNovelSectionSummary(section: number, config: NovelSceneConfig): string {
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

export function NovelSectionCard({ id, label, summary, isAuto, onClick }: { id: number; label: string; summary: string; isAuto?: boolean; onClick: () => void }) {
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


export function AutoField({ field, autoFields, onToggle, children }: { field: string; autoFields: Record<string, boolean>; onToggle: (field: string, v: boolean) => void; children: React.ReactNode }) {
  const isAuto = !!autoFields[field]
  return (
    <div style={{ position: 'relative' }}>
      {isAuto && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', borderRadius: 8, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#8b5cf6', fontWeight: 600, pointerEvents: 'none' }}>AI 自动</div>}
      <div style={{ opacity: isAuto ? 0.35 : 1, pointerEvents: isAuto ? 'none' : 'auto' }}>{children}</div>
      <button onClick={() => onToggle(field, !isAuto)} title={isAuto ? '切换为手动' : '切换为AI自动'} style={{ position: 'absolute', top: 0, right: 0, background: isAuto ? 'rgba(139,92,246,0.12)' : 'rgba(0,0,0,0.03)', border: isAuto ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(0,0,0,0.06)', borderRadius: 6, cursor: 'pointer', padding: '2px 5px', fontSize: 10, color: isAuto ? '#7c3aed' : '#9b8e84', zIndex: 2, lineHeight: 1 }}>{isAuto ? '🤖✓' : '🤖'}</button>
    </div>
  )
}

export function CustomTagButton({ label, selected, onToggle, onRemove, editMode }: { label: string; selected: boolean; onToggle: () => void; onRemove: () => void; editMode?: boolean }) {
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

export function CustomInput({ label, values, onAdd, onRemove, hideDisplay }: { label?: string; values: string[]; onAdd: (v: string) => void; onRemove: (v: string) => void; hideDisplay?: boolean }) {
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

