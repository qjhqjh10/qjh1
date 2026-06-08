import { useState, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { aiService } from '@/services/fileService'
import Modal from './Modal'
import Button from './Button'
import ScrollArea from './ScrollArea'
import { inputStyle } from '@/components/common/styles'
import { getStyleInjection } from '@/utils/styleInjector'
import type { Character } from '@/types/character'
import type { NovelSceneConfig } from '@/types/story'
import { SparklesIcon, TrashIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean; onClose: () => void
  chapterId: string; currentContent: string; chapterDescription?: string
  initialConfig?: NovelSceneConfig
  onApply: (content: string) => void
  onGenStart?: () => void; onGenChunk?: (data: { charCount: number }) => void
  onGenDone?: () => void; onGenError?: (msg: string) => void
}

const SCENE_TYPES = ['日常','战斗','对话','内心独白','过渡','高潮','无偏好']
const PURPOSES = ['推进剧情','展示角色','埋伏笔','回收伏笔','制造悬念','情感转折']
const CONFLICTS = ['人vs人','人vs社会','人vs自我','无冲突']
const WEATHERS = ['晴','雨','雪','风','阴','不限']
const TIMES = ['清晨','午间','傍晚','深夜','不限']
const ATMOSPHERES = ['温馨','紧张','悲伤','欢乐','恐惧','冷漠','愤怒','悬疑','不限']
const SENSES = ['视觉','听觉','嗅觉','触觉','味觉']
const LOCATIONS = ['卧室','客厅','书房','玄关','浴室','厨房','阳台','办公室','会议室','咖啡厅','餐厅','公园','街道','校园','医院','法院','野外','山顶','海边','自定义']
const DIALOGUES = ['稀疏(10%)','适量(30%)','密集(60%)','纯对话']
const SUBTEXTS = ['直白','一般','话中有话','多层嵌套']
const SENTENCES = ['短句','中长句','长句','混合']
const DENSITIES = ['稀疏','适中','密集']
const POVS = ['第一人称男主','第一人称女主','第三人称']

const GENRE_ELEMENTS: Record<string, string[]> = {
  '修仙': ['战斗描写','境界突破','法宝展示','丹药炼制'],
  '都市': ['职场场景','商圈社交','现代科技','消费细节'],
  '恋爱': ['暧昧互动','甜蜜日常','虐心转折','告白分手'],
  '古风': ['礼仪描写','称谓系统','古物细节','诗词引用'],
  '悬疑': ['线索铺设','红鲱鱼','信息揭露','反转设置'],
}

const DEFAULT_CONFIG: NovelSceneConfig = {
  sceneType: '日常', scenePurpose: ['推进剧情'], conflictType: '无冲突',
  povCharacterId: '', povCharacterName: '',
  characters: [],
  location: '客厅', customLocation: '', weather: '不限', time: '不限', atmosphere: '不限',
  senses: ['视觉'],
  genreElements: [],
  dialogueRatio: '适量(30%)', subtextLevel: '一般', sentenceStyle: '混合', paragraphDensity: '适中',
  emotionStart: '', emotionEnd: '',
  wordTarget: 3000, narrativePOV: '第三人称',
  useStyleProfile: true, useChapterOutline: true, extraNote: '',
  narrativeStyle: '沉浸式长镜', timeCompression: '实时', introspection: '中',
  sensoryAnchors: '', dominantEmotion: '', emotionCurveInput: '', pacing: '渐进',
  props: '', appearance: '', bodyLanguage: '',
  foreshadowUse: '无', sceneTurningPoint: '',
  autoFields: {},
}

export default function NovelSceneModal({ isOpen, onClose, chapterId, currentContent, chapterDescription, initialConfig, onApply, onGenStart, onGenChunk, onGenDone, onGenError }: Props) {
  const activeProjectId = useStore(s => s.activeProjectId)
  const characters = useStore(s => s.characters)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const styleAssignments = useSettingsStore(s => s.aiSettings.styleAssignments || {})

  const [config, setConfig] = useState<NovelSceneConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [genreType, setGenreType] = useState('都市')

  useEffect(() => { if (isOpen) setConfig(initialConfig || DEFAULT_CONFIG) }, [isOpen])

  const addChar = (char: Character) => {
    if (config.characters.find(c => c.characterId === char.id)) return
    setConfig({ ...config, characters: [...config.characters, { characterId: char.id, characterName: char.name, emotion: '' }] })
  }
  const removeChar = (id: string) => setConfig({ ...config, characters: config.characters.filter(c => c.characterId !== id) })
  const toggleArr = (arr: string[], item: string) => arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]

  const buildPrompt = async () => {
    let p = ''
    if (config.useStyleProfile && activeProjectId) {
      const inj = await getStyleInjection(activeProjectId, styleAssignments)
      if (inj) p += inj + '\n\n---\n\n'
    }
    if (config.useChapterOutline && chapterDescription) p += `【本章细纲】\n${chapterDescription}\n\n`
    p += `【场景类型】${config.sceneType} | ${config.scenePurpose.join('、')} | ${config.conflictType}\n\n`
    if (config.povCharacterName) p += `【主视角】${config.povCharacterName}\n`
    if (config.characters.length > 0) {
      p += '【登场角色】\n'
      config.characters.forEach(c => p += `- ${c.characterName}(${c.emotion || '无特定情绪'})\n`)
      p += '\n'
    }
    const loc = config.customLocation || config.location
    p += `【环境】${loc} / ${config.weather} / ${config.time} / ${config.atmosphere} / 感官: ${config.senses.join('、')}\n\n`
    if (config.genreElements.length > 0) p += `【类型要素】${config.genreElements.join('、')}\n\n`
    p += `【对话节奏】对话${config.dialogueRatio} | 潜台词${config.subtextLevel} | ${config.sentenceStyle} | 段落${config.paragraphDensity}\n\n`
    p += `【篇幅】${config.wordTarget}字 | ${config.narrativePOV}`
    if (config.emotionStart && config.emotionEnd) p += ` | 情绪: ${config.emotionStart}→${config.emotionEnd}`
    p += '\n'
    if (config.extraNote) p += `\n【额外要求】\n${config.extraNote}\n`
    p += `\n根据以上设定写一章${config.narrativePOV}小说场景。`
    return p
  }

  const handleGenerate = async () => {
    if (!activeConfigId) return
    setLoading(true)
    try {
      const prompt = await buildPrompt()
      const stream = true
      if (stream) {
        onGenStart?.(); onClose()
        aiService.chatStream(
          [{ role: 'user' as const, content: prompt }], activeConfigId, activeProjectId || undefined,
          (data) => { const c = currentContent ? currentContent + '\n\n' + data.accumulated : data.accumulated; onApply(c); onGenChunk?.({ charCount: data.accumulated.length }) },
          () => { onGenDone?.(); setLoading(false) },
          (err) => { onGenError?.(err.message); setLoading(false) },
          (data) => { onGenError?.(data.message); setLoading(false) },
        )
      } else {
        const { text } = await aiService.chatWithUsage([{ role: 'user' as const, content: prompt }], activeConfigId, activeProjectId || undefined)
        const c = currentContent ? currentContent + '\n\n' + text : text
        onApply(c); setLoading(false); onClose()
      }
    } catch (err) { setLoading(false); onGenError?.((err as Error).message) }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="场景编排" width={720} draggable resizable>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ScrollArea maxHeight="60vh">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 8 }}>
            {/* 1. Scene type */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>1. 场景类型与目的</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
                类型: <select value={config.sceneType} onChange={e => setConfig({...config, sceneType: e.target.value})} style={mini}>{SCENE_TYPES.map(s => <option key={s}>{s}</option>)}</select>
                冲突: <select value={config.conflictType} onChange={e => setConfig({...config, conflictType: e.target.value})} style={mini}>{CONFLICTS.map(c => <option key={c}>{c}</option>)}</select>
              </div>
              <div style={{ fontSize: 11, marginTop: 6 }}>
                目的: {PURPOSES.map(p => (
                  <label key={p} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:8,cursor:'pointer' }}><input type="checkbox" checked={config.scenePurpose.includes(p)} onChange={() => setConfig({...config, scenePurpose: toggleArr(config.scenePurpose, p)})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />{p}</label>
                ))}
              </div>
            </div>

            {/* 2. Characters */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>2. 角色与视角</div>
              <div style={{ fontSize: 11, marginBottom: 6 }}>主视角: <select value={config.povCharacterId} onChange={e => {
                const ch = characters.find(c => c.id === e.target.value)
                setConfig({...config, povCharacterId: e.target.value, povCharacterName: ch?.name || ''})
              }} style={mini}><option value="">无</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              {config.characters.map((ch, i) => (
                <div key={ch.characterId} style={{ display:'flex',gap:4,alignItems:'center',marginBottom:4,flexWrap:'wrap' }}>
                  <span style={{ fontSize:11,fontWeight:600,minWidth:50 }}>{ch.characterName}</span>
                  <input value={ch.emotion} onChange={e => { const n = [...config.characters]; n[i] = {...n[i], emotion: e.target.value}; setConfig({...config, characters: n}) }} placeholder="情绪" style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,width:100 }} />
                  <button onClick={() => removeChar(ch.characterId)} style={{ background:'none',border:'none',cursor:'pointer',color:'#d4ccc4' }}><TrashIcon style={{ width:12,height:12 }} /></button>
                </div>
              ))}
              <details><summary style={{ fontSize:11,color:'#3b82f6',cursor:'pointer' }}>+ 添加角色</summary>
                <div style={{ display:'flex',flexWrap:'wrap',gap:4,marginTop:4 }}>
                  {characters.filter(c => !config.characters.find(x => x.characterId === c.id)).map(c => (
                    <button key={c.id} onClick={() => addChar(c)} style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',background:'#fff',fontSize:11,cursor:'pointer' }}>{c.name}</button>
                  ))}
                </div>
              </details>
            </div>

            {/* 3. Environment */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>3. 环境描写</div>
              <div style={{ display:'flex',gap:8,flexWrap:'wrap',fontSize:11,alignItems:'center' }}>
                地点: <select value={config.location} onChange={e => setConfig({...config, location: e.target.value})} style={mini}>{LOCATIONS.map(l => <option key={l}>{l}</option>)}</select>
                <input value={config.customLocation} onChange={e => setConfig({...config, customLocation: e.target.value})} placeholder="或自定义" style={{ padding:'2px 6px',borderRadius:4,border:'1px solid rgba(0,0,0,0.1)',fontSize:10,width:80 }} />
                天气: <select value={config.weather} onChange={e => setConfig({...config, weather: e.target.value})} style={mini}>{WEATHERS.map(w => <option key={w}>{w}</option>)}</select>
                时间: <select value={config.time} onChange={e => setConfig({...config, time: e.target.value})} style={mini}>{TIMES.map(t => <option key={t}>{t}</option>)}</select>
                氛围: <select value={config.atmosphere} onChange={e => setConfig({...config, atmosphere: e.target.value})} style={mini}>{ATMOSPHERES.map(a => <option key={a}>{a}</option>)}</select>
              </div>
              <div style={{ fontSize:11,marginTop:6 }}>
                感官: {SENSES.map(s => (
                  <label key={s} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:8,cursor:'pointer' }}><input type="checkbox" checked={config.senses.includes(s)} onChange={() => setConfig({...config, senses: toggleArr(config.senses, s)})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />{s}</label>
                ))}
              </div>
            </div>

            {/* 4. Genre elements */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>4. 类型专属</div>
              <div style={{ marginBottom: 6 }}>
                小说类型: <select value={genreType} onChange={e => { setGenreType(e.target.value); setConfig({...config, genreElements: []}) }} style={mini}>{Object.keys(GENRE_ELEMENTS).map(g => <option key={g}>{g}</option>)}</select>
              </div>
              {GENRE_ELEMENTS[genreType]?.map(el => (
                <label key={el} style={{ display:'inline-flex',alignItems:'center',gap:3,marginRight:10,cursor:'pointer',fontSize:11 }}>
                  <input type="checkbox" checked={config.genreElements.includes(el)} onChange={() => setConfig({...config, genreElements: toggleArr(config.genreElements, el)})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />{el}
                </label>
              ))}
            </div>

            {/* 5. Dialogue & rhythm */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>5. 对话与节奏</div>
              <div style={{ display:'flex',gap:8,flexWrap:'wrap',fontSize:11 }}>
                对话: <select value={config.dialogueRatio} onChange={e => setConfig({...config, dialogueRatio: e.target.value})} style={mini}>{DIALOGUES.map(d => <option key={d}>{d}</option>)}</select>
                潜台词: <select value={config.subtextLevel} onChange={e => setConfig({...config, subtextLevel: e.target.value})} style={mini}>{SUBTEXTS.map(s => <option key={s}>{s}</option>)}</select>
                句式: <select value={config.sentenceStyle} onChange={e => setConfig({...config, sentenceStyle: e.target.value})} style={mini}>{SENTENCES.map(s => <option key={s}>{s}</option>)}</select>
                段落: <select value={config.paragraphDensity} onChange={e => setConfig({...config, paragraphDensity: e.target.value})} style={mini}>{DENSITIES.map(d => <option key={d}>{d}</option>)}</select>
              </div>
            </div>

            {/* 6. Length & injection */}
            <div style={{ padding: 12, borderRadius: 12, background: '#faf9f8' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', marginBottom: 8 }}>6. 篇幅与注入</div>
              <div style={{ display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',fontSize:11 }}>
                字数: <input type="number" min={500} max={50000} step={100} value={config.wordTarget} onChange={e => setConfig({...config, wordTarget: Math.max(500, parseInt(e.target.value)||500)})} style={{ width:70,padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11 }} />
                视角: <select value={config.narrativePOV} onChange={e => setConfig({...config, narrativePOV: e.target.value})} style={mini}>{POVS.map(p => <option key={p}>{p}</option>)}</select>
              </div>
              <div style={{ display:'flex',gap:10,marginTop:6,fontSize:11,alignItems:'center' }}>
                情绪起始: <input value={config.emotionStart} onChange={e => setConfig({...config, emotionStart: e.target.value})} placeholder="如: 平静" style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,width:80 }} />
                → 结尾: <input value={config.emotionEnd} onChange={e => setConfig({...config, emotionEnd: e.target.value})} placeholder="如: 暴怒" style={{ padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,width:80 }} />
              </div>
              <div style={{ display:'flex',gap:10,marginTop:8,fontSize:11,alignItems:'center' }}>
                <label style={{ cursor:'pointer',display:'flex',alignItems:'center',gap:3 }}><input type="checkbox" checked={config.useStyleProfile} onChange={e => setConfig({...config, useStyleProfile: e.target.checked})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />风格档案</label>
                {chapterDescription && <label style={{ cursor:'pointer',display:'flex',alignItems:'center',gap:3 }}><input type="checkbox" checked={config.useChapterOutline} onChange={e => setConfig({...config, useChapterOutline: e.target.checked})} style={{ width:12,height:12,accentColor:'#3b82f6' }} />细纲</label>}
              </div>
              <input value={config.extraNote} onChange={e => setConfig({...config, extraNote: e.target.value})} placeholder="额外备注" style={{ ...inputStyle, marginTop:8, fontSize:11, padding:'4px 10px' }} />
            </div>
          </div>
        </ScrollArea>

        <div style={{ display:'flex',justifyContent:'flex-end',gap:8,paddingTop:8,borderTop:'1px solid #f0ece8' }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleGenerate} disabled={loading||!activeConfigId} icon={<SparklesIcon style={{ width:16,height:16 }} />}>
            {loading ? '生成中...' : '生成场景'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const mini: React.CSSProperties = { padding:'3px 8px',borderRadius:6,border:'1px solid rgba(0,0,0,0.1)',fontSize:11,cursor:'pointer',fontFamily:'inherit' }
