import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { templateService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import type { EroticSceneConfig, EroticSceneCharacter, NovelSceneConfig, SceneTemplate, SceneTemplateType } from '@/types/story'
import type { Character } from '@/types/character'
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
import { safeCSV, getSectionSummary, sectionIsAuto, novelSectionIsAuto, SectionCard, getNovelSectionSummary, NovelSectionCard, AutoField, CustomTagButton, CustomInput, NOVEL_SECTIONS } from "./helpers";


interface NovelSectionEditorProps {
  section: number;
  novelConfig: NovelSceneConfig;
  characters: Character[];
  novelGenreType: string;
  editTagMode: boolean;
  onUpdateConfig: (config: NovelSceneConfig) => void;
  onToggleAuto: (field: string, v: boolean) => void;
  onSetNovelGenreType: (type: string) => void;
}

export function NovelSectionEditor({ section, novelConfig, characters, novelGenreType, editTagMode, onUpdateConfig, onSetNovelGenreType, onToggleAuto }: NovelSectionEditorProps) {
    const nc = novelConfig
    const setNC = onUpdateConfig
    switch (section) {
      case 1: return (<AutoField field="sceneType" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
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
      case 2: return (<AutoField field="povCharacterId" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
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
      case 3: return (<AutoField field="location" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
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
      case 4: return (<AutoField field="genreElements" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
            <div>
          <div style={{ marginBottom: 6, fontSize: 11 }}>
            小说类型: <select value={novelGenreType} onChange={e => { onSetNovelGenreType(e.target.value); setNC({...nc, genreElements: []}) }} style={inputStyle}>{Object.keys(NOVEL_GENRE_ELEMENTS).map(g => <option key={g}>{g}</option>)}</select>
          </div>
          {NOVEL_GENRE_ELEMENTS[novelGenreType]?.map(el => (
            <label key={el} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:10,cursor:'pointer',fontSize:11 }}>
              <input type="checkbox" checked={nc.genreElements.includes(el)} onChange={() => setNC({...nc, genreElements: nc.genreElements.includes(el) ? nc.genreElements.filter(x => x !== el) : [...nc.genreElements, el]})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />{el}
            </label>
          ))}
        </div>
          </AutoField>)
      case 5: return (<AutoField field="dialogueRatio" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
            <div style={{ display:'flex',gap:8,flexWrap:'wrap',fontSize:11 }}>
          对话: <select value={nc.dialogueRatio} onChange={e => setNC({...nc, dialogueRatio: e.target.value})} style={inputStyle}>{NOVEL_DIALOGUES.map(d => <option key={d}>{d}</option>)}</select>
          潜台词: <select value={nc.subtextLevel} onChange={e => setNC({...nc, subtextLevel: e.target.value})} style={inputStyle}>{NOVEL_SUBTEXTS.map(s => <option key={s}>{s}</option>)}</select>
          句式: <select value={nc.sentenceStyle} onChange={e => setNC({...nc, sentenceStyle: e.target.value})} style={inputStyle}>{NOVEL_SENTENCES.map(s => <option key={s}>{s}</option>)}</select>
          段落: <select value={nc.paragraphDensity} onChange={e => setNC({...nc, paragraphDensity: e.target.value})} style={inputStyle}>{NOVEL_DENSITIES.map(d => <option key={d}>{d}</option>)}</select>
        </div>
          </AutoField>)
      case 6: return (<AutoField field="wordTarget" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
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
      case 7: return (<AutoField field="narrativeStyle" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
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
      case 8: return (<AutoField field="dominantEmotion" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
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
      case 9: return (<AutoField field="sensoryAnchors" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
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
      case 10: return (<AutoField field="foreshadowUse" autoFields={novelConfig.autoFields} onToggle={onToggleAuto}>
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
