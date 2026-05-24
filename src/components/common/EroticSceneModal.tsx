import { useState, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService, templateService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Modal from './Modal'
import Button from './Button'
import ScrollArea from './ScrollArea'
import { inputStyle } from '@/components/common/styles'
import { getStyleInjection } from '@/utils/styleInjector'
import type { Character } from '@/types/character'
import type { EroticSceneConfig, EroticSceneCharacter, SceneTemplate } from '@/types/story'
import { SparklesIcon, TrashIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean; onClose: () => void
  chapterId: string; currentContent: string; chapterDescription?: string
  initialConfig?: EroticSceneConfig
  onApply: (content: string) => void
  onGenStart?: () => void; onGenChunk?: (data: { charCount: number }) => void
  onGenDone?: () => void; onGenError?: (msg: string) => void
}

import {
  LOCATIONS, TIMES, ATMOSPHERES, PUBLICITIES,
  ROLES, ROLE_LABELS, BODY_STATES, KINKS_GROUPS,
  OPENINGS, POSES, RHYTHMS, CHANGES, CLIMAXES, AFTERMATHS,
  SOUND_DENSITIES, MOAN_STYLES, DEGRADE_LANGS,
} from './eroticSceneConstants'

const DEFAULT_CONFIG: EroticSceneConfig = {
  characters: [], location: '卧室', time: '深夜', atmosphere: '羞辱', publicity: '私密',
  selectedKinks: [], kinkNote: '',
  opening: ['口交'], mainPose: '无偏好', mainRhythm: '无偏好', poseChanges: '2-3次转换',
  climax: ['体内射精'], aftermath: ['清理侍奉'],
  soundDensity: '密集', moanStyle: '哭喊破音',
  degradeLangs: ['辱骂(骚货/母狗)','乞求(求主人/给我)'],
  intensity: 4, wordTarget: 3000, streamMode: true, replaceMode: true,
  useStyleProfile: true, useChapterOutline: true, extraNote: '',
  kinkIntensities: {}, customKink: '',
  customCharacters: [],
  customLocation: '', customTime: '', customAtmosphere: '', customPublicity: '',
  extraPhases: [],
  customInsults: '', bannedWords: '',
  narrativePOV: '第三人称',
  customPoses: [], customRhythms: [], customPOVs: '',
  customOpening: [], customClimax: [], customAftermath: [],
  customDegradeLangs: [],
  bodyFluidFocus: [], bodyPartFocus: [], tactileFocus: [],
  narrativeStyle: '沉浸式长镜', timeCompression: '实时', introspection: '中', sensoryAnchors: '',
  dominantEmotion: '', emotionCurveInput: '', triggerWords: '',
  worldRules: '', propList: '', costumeList: '',
  customExtraNotes: '', customEmotions: '', customCurves: '', customTriggers: '',
  customWorldRules: '', customPropLists: '', customCostumeLists: '',
  customPoseChanges: '', customSoundDensity: '', customMoanStyle: '',
  pacing: '渐进升温', bodyLanguage: '', consentDynamic: '明确同意', aftercareDetail: '温存安抚',
  autoFields: {},
}

export default function EroticSceneModal({ isOpen, onClose, chapterId, currentContent, chapterDescription, initialConfig, onApply, onGenStart, onGenChunk, onGenDone, onGenError }: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const characters = useStore(s => s.characters)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const styleAssignments = useSettingsStore(s => s.aiSettings.styleAssignments || {})

  const [config, setConfig] = useState<EroticSceneConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState<SceneTemplate[]>([])
  const [showSaveTpl, setShowSaveTpl] = useState(false)
  const [tplName, setTplName] = useState('')

  useEffect(() => { if (isOpen) { setConfig(initialConfig || DEFAULT_CONFIG); templateService.list().then(t => setTemplates(t || [])).catch(()=>{}) } }, [isOpen])

  const addCharacter = (char: Character) => {
    if (config.characters.find(c => c.characterId === char.id)) return
    setConfig({ ...config, characters: [...config.characters, { characterId: char.id, characterName: char.name, role: 'sub', bodyState: '发情', customNote: '' }] })
  }
  const removeChar = (id: string) => setConfig({ ...config, characters: config.characters.filter(c => c.characterId !== id) })
  const updateChar = (id: string, f: Partial<EroticSceneCharacter>) => setConfig({ ...config, characters: config.characters.map(c => c.characterId === id ? { ...c, ...f } : c) })
  const toggleKink = (k: string) => setConfig({ ...config, selectedKinks: config.selectedKinks.includes(k) ? config.selectedKinks.filter(x => x !== k) : [...config.selectedKinks, k] })
  const toggleArr = (arr: string[], item: string) => arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]

  const buildPrompt = async () => {
    let p = ''
    // Style profile
    if (config.useStyleProfile && activeProjectId) {
      const inj = await getStyleInjection(activeProjectId, styleAssignments)
      if (inj) p += inj + '\n\n---\n\n'
    }
    // Chapter outline
    if (config.useChapterOutline && chapterDescription) {
      p += `【本章细纲】\n${chapterDescription}\n\n`
    }
    // Characters
    p += '【角色状态】\n'
    config.characters.forEach(c => { p += `- ${c.characterName}: ${ROLE_LABELS[c.role]}, ${c.bodyState}${c.customNote ? ', ' + c.customNote : ''}\n` })
    config.customCharacters.forEach(c => { p += `- ${c.name}: ${c.role}, ${c.bodyState}${c.note ? ', ' + c.note : ''}\n` })
    p += '\n'
    // Scene (custom overrides preset)
    const loc = config.customLocation || config.location
    const tim = config.customTime || config.time
    const atm = config.customAtmosphere || config.atmosphere
    const pub = config.customPublicity || config.publicity
    p += `【场景】\n地点: ${loc} | 时间: ${tim} | 氛围: ${atm} | 公开度: ${pub}\n\n`
    // Kinks with intensities
    if (config.selectedKinks.length > 0 || config.customKink) {
      p += '【玩法要求】\n'
      const kinks = config.selectedKinks.map(k => config.kinkIntensities[k] ? `${k}(${config.kinkIntensities[k]})` : k)
      if (config.customKink) kinks.push(config.customKink)
      p += kinks.join('、') + (config.kinkNote ? '。备注: ' + config.kinkNote : '') + '\n\n'
    }
    // Flow + extra phases
    p += `【流程结构】\n`
    p += `开端前戏: ${config.opening.join('、')}\n`
    config.extraPhases.forEach(ph => { p += `${ph.name}: ${ph.desc}\n` })
    p += `主戏: ${config.mainPose}, ${config.mainRhythm}, ${config.poseChanges}\n`
    p += `高潮结束: ${config.climax.join('、')}\n`
    p += `事后收尾: ${config.aftermath.join('、')}\n\n`
    // Sound + language + custom insults + banned words
    p += `【声音与语言】\n效果音密度: ${config.soundDensity} | 叫床风格: ${config.moanStyle} | 视角: ${config.narrativePOV}\n`
    if (config.degradeLangs.length > 0) p += `羞辱语言: ${config.degradeLangs.join('、')}\n`
    if (config.customInsults) p += `额外侮辱词: ${config.customInsults}\n`
    if (config.bannedWords) p += `禁用词(不得出现): ${config.bannedWords}\n`
    p += `\n`
    p += `【强度】${config.intensity}/5 | 字数目标: ${config.wordTarget}字\n`
    if (config.extraNote) p += `\n【额外要求】\n${config.extraNote}\n`
    // Inject custom fields from customKink
    const extract = (pat: string) => config.customKink.match(new RegExp(`${pat}:([^,]+)`))?.[1]
    const bodyStuff = [extract('焦点'), extract('体液'), extract('触感')].filter(Boolean)
    if (bodyStuff.some(Boolean)) p += `\n【身体焦点】${bodyStuff.join('')}\n`
    const narrativeStuff = [extract('风格'), extract('时间'), extract('内省'), extract('锚点')].filter(Boolean)
    if (narrativeStuff.some(Boolean)) p += `\n【叙事技法】${narrativeStuff.join('')}\n`
    const emotionStuff = [extract('情绪'), extract('曲线'), extract('触发')].filter(Boolean)
    if (emotionStuff.some(Boolean)) p += `\n【情绪心理】${emotionStuff.join('')}\n`
    const specialStuff = [extract('世界规则'), extract('道具'), extract('服装'), extract('物品')].filter(Boolean)
    if (specialStuff.some(Boolean)) p += `\n【特殊设定】${specialStuff.join('')}\n`
    p += `\n根据以上设定写一章完整的${config.narrativePOV}情色小说场景。聚焦触感细节、体液描写、效果音、身体信号。`
    return p
  }

  const handleGenerate = async () => {
    if (!activeConfigId) return
    setLoading(true)
    try {
      const prompt = await buildPrompt()
      if (config.streamMode) {
        onGenStart?.(); onClose()
        aiService.chatStream(
          [{ role: 'user' as const, content: prompt }], activeConfigId, activeProjectId || undefined,
          (data) => { const c = config.replaceMode ? data.accumulated : (currentContent ? currentContent + '\n\n' + data.accumulated : data.accumulated); onApply(c); onGenChunk?.({ charCount: data.accumulated.length }) },
          () => { onGenDone?.(); setLoading(false) },
          (err) => { onGenError?.(err.message); setLoading(false) },
          (data) => { onGenError?.(data.message); setLoading(false) },
        )
      } else {
        const { text } = await aiService.chatWithUsage([{ role: 'user' as const, content: prompt }], activeConfigId, activeProjectId || undefined)
        const c = config.replaceMode ? text : (currentContent ? currentContent + '\n\n' + text : text)
        onApply(c); setLoading(false); onClose()
      }
    } catch (err) { setLoading(false); onGenError?.((err as Error).message) }
  }

  const handleSaveTemplate = async () => {
    if (!tplName.trim()) return
    const tpl = { id: `tpl_${nanoid(6)}`, name: tplName, type: '情色小说' as const, config, createdAt: new Date().toISOString() }
    await templateService.save(tpl)
    setTemplates(prev => [...prev, tpl])
    setShowSaveTpl(false); setTplName('')
  }

  const handleLoadTemplate = (tpl: SceneTemplate) => { setConfig(tpl.config as EroticSceneConfig) }

  const handleDeleteTemplate = async (id: string) => {
    await templateService.delete(id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="情色场景编排" width={720} draggable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ScrollArea maxHeight="60vh">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 8 }}>

            {/* 1. Characters */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>1. 角色配置</div>
              {config.characters.map(ch => (
                <div key={ch.characterId} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, minWidth: 60 }}>{ch.characterName}</span>
                  <select value={ch.role} onChange={e => updateChar(ch.characterId, { role: e.target.value as EroticSceneCharacter['role'] })} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <select value={ch.bodyState} onChange={e => updateChar(ch.characterId, { bodyState: e.target.value })} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }}>
                    {BODY_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input value={ch.customNote} onChange={e => updateChar(ch.characterId, { customNote: e.target.value })} placeholder="备注" style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, width: 100 }} />
                  <button onClick={() => removeChar(ch.characterId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 14, height: 14 }} /></button>
                </div>
              ))}
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 11, color: '#7c3aed', cursor: 'pointer' }}>+ 添加角色</summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {characters.filter(c => !config.characters.find(x => x.characterId === c.id)).map(c => (
                    <button key={c.id} onClick={() => addCharacter(c)} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 11, cursor: 'pointer' }}>{c.name}</button>
                  ))}
                </div>
              </details>
              {/* Free-text character slots */}
              {config.customCharacters.map((cc, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input value={cc.name} onChange={e => { const n = [...config.customCharacters]; n[i] = {...n[i], name: e.target.value}; setConfig({...config, customCharacters: n}) }} placeholder="角色名" style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, width: 80 }} />
                  <select value={cc.role} onChange={e => { const n = [...config.customCharacters]; n[i] = {...n[i], role: e.target.value}; setConfig({...config, customCharacters: n}) }} style={mini}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <input value={cc.bodyState} onChange={e => { const n = [...config.customCharacters]; n[i] = {...n[i], bodyState: e.target.value}; setConfig({...config, customCharacters: n}) }} placeholder="身体状态" style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, width: 80 }} />
                  <input value={cc.note} onChange={e => { const n = [...config.customCharacters]; n[i] = {...n[i], note: e.target.value}; setConfig({...config, customCharacters: n}) }} placeholder="备注" style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, width: 80 }} />
                  <button onClick={() => setConfig({...config, customCharacters: config.customCharacters.filter((_,j) => j !== i)})} style={{ background:'none', border:'none', cursor:'pointer', color:'#d4ccc4' }}><TrashIcon style={{ width:12, height:12 }} /></button>
                </div>
              ))}
              <button onClick={() => setConfig({...config, customCharacters: [...config.customCharacters, {name:'', role:'sub', bodyState:'正常', note:''}]})} style={{ ...linkBtn, fontSize: 10, marginTop: 4 }}>+ 自由角色描述</button>
            </div>

            {/* 2. Scene */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>2. 场景设置</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
                <div>地点: <select value={config.location} onChange={e => setConfig({ ...config, location: e.target.value })} style={mini}>{LOCATIONS.map(l => <option key={l}>{l}</option>)}</select></div>
                <input value={config.customLocation} onChange={e => setConfig({...config, customLocation: e.target.value})} placeholder="或自定义地点" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 100 }} />
                <div>时间: <select value={config.time} onChange={e => setConfig({ ...config, time: e.target.value })} style={mini}>{TIMES.map(t => <option key={t}>{t}</option>)}</select></div>
                <input value={config.customTime} onChange={e => setConfig({...config, customTime: e.target.value})} placeholder="或自定义" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 80 }} />
                <div>氛围: <select value={config.atmosphere} onChange={e => setConfig({ ...config, atmosphere: e.target.value })} style={mini}>{ATMOSPHERES.map(a => <option key={a}>{a}</option>)}</select></div>
                <input value={config.customAtmosphere} onChange={e => setConfig({...config, customAtmosphere: e.target.value})} placeholder="或自定义" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 80 }} />
                <div>公开度: <select value={config.publicity} onChange={e => setConfig({ ...config, publicity: e.target.value })} style={mini}>{PUBLICITIES.map(p => <option key={p}>{p}</option>)}</select></div>
                <input value={config.customPublicity} onChange={e => setConfig({...config, customPublicity: e.target.value})} placeholder="或自定义" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 80 }} />
              </div>
            </div>

            {/* 3. Kinks */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>3. 玩法选择</div>
              {KINKS_GROUPS.map((g, i) => (
                <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                  {g.map(k => (
                    <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: config.selectedKinks.includes(k) ? 'rgba(124,58,237,0.08)' : 'transparent', border: config.selectedKinks.includes(k) ? '1px solid rgba(124,58,237,0.2)' : '1px solid transparent' }}>
                      <input type="checkbox" checked={config.selectedKinks.includes(k)} onChange={() => toggleKink(k)} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />{k}
                      {config.selectedKinks.includes(k) && (
                        <select value={config.kinkIntensities[k] || ''} onChange={e => setConfig({...config, kinkIntensities: {...config.kinkIntensities, [k]: e.target.value}})} style={{ padding: '1px 2px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 9, width: 40 }} onClick={e2 => e2.stopPropagation()}>
                          <option value="">--</option>
                          <option value="轻度">轻度</option>
                          <option value="标准">标准</option>
                          <option value="极限">极限</option>
                        </select>
                      )}
                    </label>
                  ))}
                </div>
              ))}
              <input value={config.kinkNote} onChange={e => setConfig({ ...config, kinkNote: e.target.value })} placeholder="玩法备注" style={{ ...inputStyle, marginTop: 4, fontSize: 11, padding: '4px 10px' }} />
              <input value={config.customKink} onChange={e => setConfig({ ...config, customKink: e.target.value })} placeholder="自定义玩法..." style={{ ...inputStyle, marginTop: 4, fontSize: 11, padding: '4px 10px' }} />
            </div>

            {/* 4. Flow */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>4. 流程编排</div>
              <div style={{ fontSize: 11, marginBottom: 6 }}>
                开端前戏: {OPENINGS.map(o => (
                  <label key={o} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, cursor: 'pointer' }}><input type="checkbox" checked={config.opening.includes(o)} onChange={() => setConfig({ ...config, opening: toggleArr(config.opening, o) })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />{o}</label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                姿势: <select value={config.mainPose} onChange={e => setConfig({ ...config, mainPose: e.target.value })} style={mini}>{POSES.map(p => <option key={p}>{p}</option>)}</select>
                节奏: <select value={config.mainRhythm} onChange={e => setConfig({ ...config, mainRhythm: e.target.value })} style={mini}>{RHYTHMS.map(r => <option key={r}>{r}</option>)}</select>
                转换: <select value={config.poseChanges} onChange={e => setConfig({ ...config, poseChanges: e.target.value })} style={mini}>{CHANGES.map(c => <option key={c}>{c}</option>)}</select>
              </div>
              <div style={{ fontSize: 11, marginTop: 6 }}>
                高潮: {CLIMAXES.map(c => (
                  <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, cursor: 'pointer' }}><input type="checkbox" checked={config.climax.includes(c)} onChange={() => setConfig({ ...config, climax: toggleArr(config.climax, c) })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />{c}</label>
                ))}
              </div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                事后: {AFTERMATHS.map(a => (
                  <label key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, cursor: 'pointer' }}><input type="checkbox" checked={config.aftermath.includes(a)} onChange={() => setConfig({ ...config, aftermath: toggleArr(config.aftermath, a) })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />{a}</label>
                ))}
              </div>
              {/* Extra phases */}
              {config.extraPhases.map((ph, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                  <input value={ph.name} onChange={e => { const n = [...config.extraPhases]; n[i] = {...n[i], name: e.target.value}; setConfig({...config, extraPhases: n}) }} placeholder="阶段名" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 80 }} />
                  <input value={ph.desc} onChange={e => { const n = [...config.extraPhases]; n[i] = {...n[i], desc: e.target.value}; setConfig({...config, extraPhases: n}) }} placeholder="简述" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, flex: 1 }} />
                  <button onClick={() => setConfig({...config, extraPhases: config.extraPhases.filter((_,j) => j !== i)})} style={{ background:'none', border:'none', cursor:'pointer', color:'#d4ccc4' }}><TrashIcon style={{ width:10, height:10 }} /></button>
                </div>
              ))}
              {config.extraPhases.length < 2 && (
                <button onClick={() => setConfig({...config, extraPhases: [...config.extraPhases, {name:'', desc:''}]})} style={{ ...linkBtn, fontSize: 10, marginTop: 4 }}>+ 额外阶段</button>
              )}
            </div>

            {/* Body focus & technique */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>5. 身体焦点与技法</div>
              <div style={{ fontSize: 11, marginBottom: 4 }}>体液优先级: {['精液','爱液','汗液','乳汁','尿液','血液'].map(f => (
                <label key={f} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:8,cursor:'pointer' }}><input type="checkbox" checked={config.customKink.includes(`体液:${f}`)} onChange={() => setConfig({...config, customKink: config.customKink.includes(`体液:${f}`) ? config.customKink.replace(`体液:${f},`,'').replace(`体液:${f}`,'') : config.customKink + `体液:${f},`})} style={{ width:11,height:11,accentColor:'#ec4899' }} />{f}</label>
              ))}</div>
              <div style={{ fontSize: 11, marginBottom: 4 }}>身体焦点: {['胸','腿','脚','臀','腰','颈','手','眼','唇','发'].map(p => (
                <label key={p} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:8,cursor:'pointer' }}><input type="checkbox" checked={config.customKink.includes(`焦点:${p}`)} onChange={() => setConfig({...config, customKink: config.customKink.includes(`焦点:${p}`) ? config.customKink.replace(`焦点:${p},`,'').replace(`焦点:${p}`,'') : config.customKink + `焦点:${p},`})} style={{ width:11,height:11,accentColor:'#ec4899' }} />{p}</label>
              ))}</div>
              <div style={{ fontSize: 11 }}>触感优先: {['温度','湿度','压力','摩擦','振动'].map(t => (
                <label key={t} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:8,cursor:'pointer' }}><input type="checkbox" checked={config.customKink.includes(`触感:${t}`)} onChange={() => setConfig({...config, customKink: config.customKink.includes(`触感:${t}`) ? config.customKink.replace(`触感:${t},`,'').replace(`触感:${t}`,'') : config.customKink + `触感:${t},`})} style={{ width:11,height:11,accentColor:'#ec4899' }} />{t}</label>
              ))}</div>
            </div>

            {/* Narrative technique */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>6. 叙事技法</div>
              <div style={{ display:'flex',gap:8,flexWrap:'wrap',fontSize:11 }}>
                叙事风格: <select value={config.customKink.match(/风格:(\w+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/风格:\w+/,'') + `风格:${e.target.value}`})} style={mini}><option value="">--</option><option>沉浸式长镜</option><option>旁观式扫射</option><option>蒙太奇快切</option><option>慢镜头特写</option></select>
                时间: <select value={config.customKink.match(/时间:(\w+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/时间:\w+/,'') + `时间:${e.target.value}`})} style={mini}><option value="">--</option><option>实时</option><option>压缩</option><option>拉长</option><option>倒叙</option></select>
                内省: <select value={config.customKink.match(/内省:(\w+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/内省:\w+/,'') + `内省:${e.target.value}`})} style={mini}><option value="">--</option><option>无</option><option>低</option><option>中</option><option>高</option></select>
              </div>
              <input value={config.customKink.match(/锚点:([^,]+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/锚点:[^,]+/,'').replace(/,+/g,',') + (e.target.value ? `锚点:${e.target.value}` : '')})} placeholder="感官锚点(特定重复意象)" style={{ ...inputStyle, marginTop:4, fontSize:11, padding:'4px 10px' }} />
            </div>

            {/* 7. Sound */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>7. 声音与语言</div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, flexWrap: 'wrap' }}>
                效果音: <select value={config.soundDensity} onChange={e => setConfig({ ...config, soundDensity: e.target.value })} style={mini}>{SOUND_DENSITIES.map(s => <option key={s}>{s}</option>)}</select>
                叫床: <select value={config.moanStyle} onChange={e => setConfig({ ...config, moanStyle: e.target.value })} style={mini}>{MOAN_STYLES.map(m => <option key={m}>{m}</option>)}</select>
              </div>
              <div style={{ fontSize: 11, marginTop: 6 }}>
                语言: {DEGRADE_LANGS.map(d => (
                  <label key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, cursor: 'pointer' }}><input type="checkbox" checked={config.degradeLangs.includes(d)} onChange={() => setConfig({ ...config, degradeLangs: toggleArr(config.degradeLangs, d) })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />{d}</label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input value={config.customInsults} onChange={e => setConfig({...config, customInsults: e.target.value})} placeholder="额外侮辱词(逗号分隔)" style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, width: 160 }} />
                <input value={config.bannedWords} onChange={e => setConfig({...config, bannedWords: e.target.value})} placeholder="禁用词(逗号分隔)" style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, width: 160 }} />
              </div>
            </div>

            {/* 8. Emotion & psychology */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>8. 情绪与心理</div>
              <div style={{ display:'flex',gap:8,fontSize:11,alignItems:'center',flexWrap:'wrap' }}>
                主导: <select value={config.customKink.match(/情绪:(\w+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/情绪:\w+/,'') + `情绪:${e.target.value}`})} style={mini}><option value="">--</option><option>羞辱</option><option>快感</option><option>恐惧</option><option>温柔</option><option>支配</option><option>臣服</option><option>渴求</option><option>羞耻</option><option>爱慕</option><option>仇恨</option></select>
                曲线: <input value={config.customKink.match(/曲线:([^,]+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/曲线:[^,]+/,'').replace(/,+/g,',') + (e.target.value ? `曲线:${e.target.value}` : '')})} placeholder="起始→最高→结束" style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,width:140 }} />
                触发词: <input value={config.customKink.match(/触发:([^,]+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/触发:[^,]+/,'').replace(/,+/g,',') + (e.target.value ? `触发:${e.target.value}` : '')})} placeholder="一说就崩溃的词" style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,width:120 }} />
              </div>
            </div>

            {/* 9. Special settings */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>9. 特殊设定</div>
              <input value={config.customKink.match(/世界规则:([^,]+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/世界规则:[^,]+/,'').replace(/,+/g,',') + (e.target.value ? `世界规则:${e.target.value}` : '')})} placeholder="世界规则(如:高潮会发光)" style={{ ...inputStyle, marginBottom:6, fontSize:11, padding:'4px 10px' }} />
              <input value={config.customKink.match(/道具:([^,]+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/道具:[^,]+/,'').replace(/,+/g,',') + (e.target.value ? `道具:${e.target.value}` : '')})} placeholder="道具清单(逗号分隔)" style={{ ...inputStyle, marginBottom:6, fontSize:11, padding:'4px 10px' }} />
              <input value={config.customKink.match(/服装:([^,]+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/服装:[^,]+/,'').replace(/,+/g,',') + (e.target.value ? `服装:${e.target.value}` : '')})} placeholder="服装清单(逗号分隔)" style={{ ...inputStyle, marginBottom:6, fontSize:11, padding:'4px 10px' }} />
              <input value={config.customKink.match(/物品:([^,]+)/)?.[1] || ''} onChange={e => setConfig({...config, customKink: config.customKink.replace(/物品:[^,]+/,'').replace(/,+/g,',') + (e.target.value ? `物品:${e.target.value}` : '')})} placeholder="地点可用物品" style={{ ...inputStyle, fontSize:11, padding:'4px 10px' }} />
            </div>

            {/* 10. Intensity */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>10. 强度与篇幅</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
                <div>强度: {[1,2,3,4,5].map(i => (
                  <label key={i} style={{ cursor: 'pointer', marginLeft: 4, fontWeight: config.intensity === i ? 700 : 400, color: config.intensity === i ? '#7c3aed' : '#6b5e54' }}>
                    <input type="radio" name="intensity" checked={config.intensity === i} onChange={() => setConfig({ ...config, intensity: i })} style={{ width: 12, height: 12, accentColor: '#7c3aed', marginRight: 2 }} />{['','暧昧','温存','标准','激烈','极限'][i]}
                  </label>
                ))}</div>
                <div>字数: <input type="number" min={500} max={50000} step={100} value={config.wordTarget} onChange={e => setConfig({ ...config, wordTarget: Math.max(500, parseInt(e.target.value) || 500) })} style={{ width: 70, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11 }} /></div>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}><input type="checkbox" checked={config.streamMode} onChange={e => setConfig({ ...config, streamMode: e.target.checked })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />流式</label>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}><input type="checkbox" checked={config.replaceMode} onChange={e => setConfig({ ...config, replaceMode: e.target.checked })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />替换正文</label>
                <div>视角: <select value={config.narrativePOV} onChange={e => setConfig({...config, narrativePOV: e.target.value})} style={mini}>
                  <option>第一人称男主</option><option>第一人称女主</option><option>第三人称</option>
                </select></div>
              </div>
            </div>

            {/* 11. Extra + Templates */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>11. 额外注入 & 模板</div>
              <input value={config.extraNote} onChange={e => setConfig({ ...config, extraNote: e.target.value })} placeholder="额外备注（自由输入）" style={{ ...inputStyle, marginBottom: 8, fontSize: 11, padding: '4px 10px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}><input type="checkbox" checked={config.useStyleProfile} onChange={e => setConfig({ ...config, useStyleProfile: e.target.checked })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />注入风格档案</label>
                {chapterDescription && (
                  <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, marginLeft: 8 }}><input type="checkbox" checked={config.useChapterOutline} onChange={e => setConfig({ ...config, useChapterOutline: e.target.checked })} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />注入本章细纲</label>
                )}
                {templates.length > 0 && (
                  <select onChange={e => { const t = templates.find(t => t.id === e.target.value); if (t) handleLoadTemplate(t) }} defaultValue="" style={mini}>
                    <option value="" disabled>加载模板</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                {templates.map(t => (
                  <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.06)', fontSize: 10 }}>
                    {t.name}
                    <button onClick={() => handleDeleteTemplate(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 0 }}><TrashIcon style={{ width: 10, height: 10 }} /></button>
                  </span>
                ))}
                {!showSaveTpl ? (
                  <button onClick={() => setShowSaveTpl(true)} style={{ ...linkBtn, fontSize: 11 }}>💾 保存为模板</button>
                ) : (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <input value={tplName} onChange={e => setTplName(e.target.value)} placeholder="模板名" style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, width: 100 }} />
                    <Button size="sm" onClick={handleSaveTemplate}>保存</Button>
                    <button onClick={() => { setShowSaveTpl(false); setTplName('') }} style={{ ...linkBtn, fontSize: 11, color: '#9b8e84' }}>取消</button>
                  </span>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleGenerate} disabled={loading || !activeConfigId} icon={<SparklesIcon style={{ width: 16, height: 16 }} />}>
            {loading ? '生成中...' : '生成场景'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const mini: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0, fontFamily: 'inherit' }
