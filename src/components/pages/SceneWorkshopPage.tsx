import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, useSettingsStore } from '@/store'
import { aiService, templateService } from '@/services/fileService'
import { sceneService } from '@/services/sceneService'
import { getStyleInjection } from '@/utils/styleInjector'
import { nanoid } from 'nanoid'
import GlassCard from '@/components/common/GlassCard'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { inputStyle } from '@/components/common/styles'
import type { Character } from '@/types/character'
import type { DetailedChapter } from '@/types/chapter'
import type { EroticSceneConfig, EroticSceneCharacter, NovelSceneConfig, ChapterSceneConfig, SceneTemplate } from '@/types/story'
import { SparklesIcon, TrashIcon, DocumentTextIcon, UserIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

// ====================== Constants ======================

const EROTIC_LOCATIONS = ['卧室','客厅','玄关','浴室','公园','天台','教室','地牢','办公室','野外','车内','厨房','阳台']
const EROTIC_TIMES = ['清晨','午间','傍晚','深夜','不限']
const ATMOSPHERES = ['温馨','羞辱','仪式感','日常平淡','紧迫','偷情','禁忌','悬疑','温情']
const PUBLICITIES = ['私密','半公开(有旁观者)','完全公开','偷窥视角']
const EROTIC_ROLES = ['dom','sub','switch','observer'] as const
const ROLE_LABELS: Record<string,string> = { dom:'主导', sub:'服从', switch:'Switch', observer:'旁观' }
const BODY_STATES = ['正常','发情','改造','退行','包茎','微型化','怀孕','哺乳期']
const KINKS_GROUPS = [
  ['捆绑约束','鞭打体罚','滴蜡','项圈牵引'],
  ['露出户外','公开羞辱','NTR绿帽','群交多人'],
  ['催眠洗脑','指令遥控','强制高潮','控制高潮'],
  ['道具玩具','角色扮演','宠物玩法','皮物'],
  ['排泄圣水','浣肠','乳汁','足侍奉'],
  ['口交深喉','肛交','乳交','手交'],
]
const OPENINGS = ['口交','舔阴','胸推','手交','亲吻','足侍奉','直接插入']
const POSES = ['正面','后入','骑乘','侧入','悬空','无偏好']
const RHYTHMS = ['九浅一深','连续深桩','缓抽猛插','磨碾','无偏好']
const CHANGES = ['单姿势到底','2-3次转换','每段切换']
const CLIMAXES = ['体内射精','体外','潮吹','多次高潮','控制延迟']
const AFTERMATHS = ['清理侍奉','温存','继续羞辱','丢弃入睡']
const SOUND_DENSITIES = ['稀疏','适量','密集','极密集']
const MOAN_STYLES = ['持续高亢','间歇婉转','哭喊破音','窒息失声','沉默忍耐']
const DEGRADE_LANGS = ['辱骂(骚货/母狗)','乞求(求主人/给我)','感谢(谢谢主人)','宣告(我是母狗/肉便器)','称赞(主人好棒/鸡巴好大)']
const BODY_FLUIDS = ['精液','爱液','汗液','乳汁','尿液','血液']
const BODY_FOCUS = ['胸','腿','脚','臀','腰','颈','手','眼','唇','发']
const TOUCH_TYPES = ['温度','湿度','压力','摩擦','振动']
const NARRATIVE_STYLES = ['沉浸式长镜','旁观式扫射','蒙太奇快切','慢镜头特写']
const TIME_STYLES = ['实时','压缩','拉长','倒叙']
const INTROSPECTION_LEVELS = ['无','低','中','高']
const EMOTION_TYPES = ['羞辱','快感','恐惧','温柔','支配','臣服','渴求','羞耻','爱慕','仇恨']
const INTENSITY_LEVELS = ['','暧昧','温存','标准','激烈','极限']
const POVS = ['第一人称男主','第一人称女主','第三人称']

const NOVEL_SCENE_TYPES = ['日常','战斗','对话','内心独白','过渡','高潮','无偏好']
const NOVEL_PURPOSES = ['推进剧情','展示角色','埋伏笔','回收伏笔','制造悬念','情感转折']
const NOVEL_CONFLICTS = ['人vs人','人vs社会','人vs自我','无冲突']
const NOVEL_WEATHERS = ['晴','雨','雪','风','阴','不限']
const NOVEL_SENSES = ['视觉','听觉','嗅觉','触觉','味觉']
const NOVEL_DIALOGUES = ['稀疏(10%)','适量(30%)','密集(60%)','纯对话']
const NOVEL_SUBTEXTS = ['直白','一般','话中有话','多层嵌套']
const NOVEL_SENTENCES = ['短句','中长句','长句','混合']
const NOVEL_DENSITIES = ['稀疏','适中','密集']
const NOVEL_GENRES: Record<string, string[]> = {
  '修仙': ['战斗描写','境界突破','法宝展示','丹药炼制'],
  '都市': ['职场场景','商圈社交','现代科技','消费细节'],
  '恋爱': ['暧昧互动','甜蜜日常','虐心转折','告白分手'],
  '古风': ['礼仪描写','称谓系统','古物细节','诗词引用'],
  '悬疑': ['线索铺设','红鲱鱼','信息揭露','反转设置'],
}

const DEFAULT_EROTIC: EroticSceneConfig = {
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
}

const DEFAULT_NOVEL: NovelSceneConfig = {
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
}

// ====================== Shared styles ======================

const mini: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', background: '#fff' }
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0, fontFamily: 'inherit' }
const sectionStyle: React.CSSProperties = { padding: 10, borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.03)' }
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6 }

function toggleArr(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
}

// ====================== Page Component ======================

export default function SceneWorkshopPage() {
  const navigate = useNavigate()
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
  const detailedChapters = useStore(s => s.detailedChapters)
  const characters = useStore(s => s.characters)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const styleAssignments = useSettingsStore(s => s.aiSettings.styleAssignments || {})

  const [projectPath, setProjectPath] = useState('')
  const [activeTab, setActiveTab] = useState<'erotic' | 'novel'>('erotic')
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [eroticConfig, setEroticConfig] = useState<EroticSceneConfig>(DEFAULT_EROTIC)
  const [novelConfig, setNovelConfig] = useState<NovelSceneConfig>(DEFAULT_NOVEL)
  const [savedConfigs, setSavedConfigs] = useState<Record<string, ChapterSceneConfig>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [previewText, setPreviewText] = useState('')
  const [templates, setTemplates] = useState<SceneTemplate[]>([])
  const [showSaveTpl, setShowSaveTpl] = useState(false)
  const [tplName, setTplName] = useState('')
  const [genreType, setGenreType] = useState('都市')

  // Route guard + load data
  useEffect(() => {
    if (!activeProjectId) { navigate('/'); return }
    const pp = `${projectsBasePath}/${activeProjectId}`
    setProjectPath(pp)
    // Load all saved scene configs
    setLoading(true)
    sceneService.listSceneConfigs(pp).then(configs => {
      const map: Record<string, ChapterSceneConfig> = {}
      configs.forEach(c => { map[c.chapterId] = c })
      setSavedConfigs(map)
    }).finally(() => setLoading(false))
  }, [activeProjectId, projectsBasePath])

  // Load templates
  useEffect(() => {
    templateService.list().then((t: unknown) => setTemplates(t as SceneTemplate[])).catch(() => {})
  }, [])

  // Load scene config when chapter changes
  useEffect(() => {
    if (!projectPath || !selectedChapterId) return
    sceneService.loadChapterSceneConfig(projectPath, selectedChapterId).then(config => {
      if (config) {
        if (config.eroticScene) setEroticConfig(config.eroticScene)
        else setEroticConfig(DEFAULT_EROTIC)
        if (config.novelScene) setNovelConfig(config.novelScene)
        else setNovelConfig(DEFAULT_NOVEL)
      } else {
        setEroticConfig(DEFAULT_EROTIC)
        setNovelConfig(DEFAULT_NOVEL)
      }
    })
  }, [projectPath, selectedChapterId])

  const selectedChapter = detailedChapters.find(c => c.id === selectedChapterId)
  const hasEroticSaved = selectedChapterId ? !!savedConfigs[selectedChapterId]?.eroticScene : false
  const hasNovelSaved = selectedChapterId ? !!savedConfigs[selectedChapterId]?.novelScene : false

  const handleSaveConfig = async () => {
    if (!projectPath || !selectedChapterId) return
    setSaving(true)
    const config: ChapterSceneConfig = {
      chapterId: selectedChapterId,
      chapterTitle: selectedChapter?.title || '',
      eroticScene: activeTab === 'erotic' ? eroticConfig : (savedConfigs[selectedChapterId]?.eroticScene || null),
      novelScene: activeTab === 'novel' ? novelConfig : (savedConfigs[selectedChapterId]?.novelScene || null),
      updatedAt: new Date().toISOString(),
    }
    // Merge: save current tab's config and preserve the other tab's config
    const existing = await sceneService.loadChapterSceneConfig(projectPath, selectedChapterId)
    const merged: ChapterSceneConfig = {
      chapterId: selectedChapterId,
      chapterTitle: selectedChapter?.title || '',
      eroticScene: activeTab === 'erotic' ? eroticConfig : (existing?.eroticScene || null),
      novelScene: activeTab === 'novel' ? novelConfig : (existing?.novelScene || null),
      updatedAt: new Date().toISOString(),
    }
    await sceneService.saveChapterSceneConfig(projectPath, merged)
    setSavedConfigs(prev => ({ ...prev, [selectedChapterId]: merged }))
    setSaving(false)
  }

  const buildEroticPrompt = async (): Promise<string> => {
    let p = ''
    const config = eroticConfig
    if (config.useStyleProfile && activeProjectId) {
      const inj = await getStyleInjection(activeProjectId, styleAssignments)
      if (inj) p += inj + '\n\n---\n\n'
    }
    if (config.useChapterOutline && selectedChapter?.description) {
      p += `【本章细纲】\n${selectedChapter.description}\n\n`
    }
    p += '【角色状态】\n'
    config.characters.forEach(c => { p += `- ${c.characterName}: ${ROLE_LABELS[c.role]}, ${c.bodyState}${c.customNote ? ', ' + c.customNote : ''}\n` })
    config.customCharacters.forEach(c => { p += `- ${c.name}: ${c.role}, ${c.bodyState}${c.note ? ', ' + c.note : ''}\n` })
    p += '\n'
    const loc = config.customLocation || config.location
    const tim = config.customTime || config.time
    const atm = config.customAtmosphere || config.atmosphere
    const pub = config.customPublicity || config.publicity
    p += `【场景】\n地点: ${loc} | 时间: ${tim} | 氛围: ${atm} | 公开度: ${pub}\n\n`
    if (config.selectedKinks.length > 0 || config.customKink) {
      p += '【玩法要求】\n'
      const kinks = config.selectedKinks.map(k => config.kinkIntensities[k] ? `${k}(${config.kinkIntensities[k]})` : k)
      if (config.customKink) kinks.push(config.customKink)
      p += kinks.join('、') + (config.kinkNote ? '。备注: ' + config.kinkNote : '') + '\n\n'
    }
    p += `【流程结构】\n`
    p += `开端前戏: ${config.opening.join('、')}\n`
    config.extraPhases.forEach(ph => { p += `${ph.name}: ${ph.desc}\n` })
    p += `主戏: ${config.mainPose}, ${config.mainRhythm}, ${config.poseChanges}\n`
    p += `高潮结束: ${config.climax.join('、')}\n`
    p += `事后收尾: ${config.aftermath.join('、')}\n\n`
    p += `【声音与语言】\n效果音密度: ${config.soundDensity} | 叫床风格: ${config.moanStyle} | 视角: ${config.narrativePOV}\n`
    if (config.degradeLangs.length > 0) p += `羞辱语言: ${config.degradeLangs.join('、')}\n`
    if (config.customInsults) p += `额外侮辱词: ${config.customInsults}\n`
    if (config.bannedWords) p += `禁用词(不得出现): ${config.bannedWords}\n`
    p += `\n【强度】${config.intensity}/5 | 字数目标: ${config.wordTarget}字\n`
    if (config.extraNote) p += `\n【额外要求】\n${config.extraNote}\n`
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

  const buildNovelPrompt = async (): Promise<string> => {
    let p = ''
    const config = novelConfig
    if (config.useStyleProfile && activeProjectId) {
      const inj = await getStyleInjection(activeProjectId, styleAssignments)
      if (inj) p += inj + '\n\n---\n\n'
    }
    if (config.useChapterOutline && selectedChapter?.description) p += `【本章细纲】\n${selectedChapter.description}\n\n`
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

  const handlePreview = async () => {
    if (!activeConfigId || !selectedChapterId) return
    setGenerating(true)
    setPreviewText('')
    try {
      const prompt = activeTab === 'erotic' ? await buildEroticPrompt() : await buildNovelPrompt()
      aiService.chatStream(
        [{ role: 'user' as const, content: prompt }], activeConfigId, activeProjectId || undefined,
        (data) => { setPreviewText(data.accumulated) },
        () => { setGenerating(false) },
        (err) => { setPreviewText('生成失败: ' + err.message); setGenerating(false) },
        (data) => { setPreviewText('生成取消: ' + data.message); setGenerating(false) },
      )
    } catch (err) { setGenerating(false); setPreviewText('生成失败: ' + (err as Error).message) }
  }

  const handleGenerateAndInsert = async () => {
    if (!activeConfigId || !selectedChapterId) return
    setGenerating(true)
    try {
      const prompt = activeTab === 'erotic' ? await buildEroticPrompt() : await buildNovelPrompt()
      const { text } = await aiService.chatWithUsage(
        [{ role: 'user' as const, content: prompt }], activeConfigId, activeProjectId || undefined,
      )
      setPreviewText(text)
      // Navigate to chapter writing with content ready to insert
      navigate(`/chapter/${selectedChapterId}`)
    } catch (err) { setGenerating(false); setPreviewText('生成失败: ' + (err as Error).message) }
  }

  const handleSaveTemplate = async () => {
    if (!tplName.trim()) return
    const config = activeTab === 'erotic' ? eroticConfig : novelConfig
    const tpl: SceneTemplate = { id: `tpl_${nanoid(6)}`, name: tplName, config: config as EroticSceneConfig, createdAt: new Date().toISOString() }
    await templateService.save(tpl)
    setTemplates(prev => [...prev, tpl])
    setShowSaveTpl(false); setTplName('')
  }

  const handleLoadTemplate = (tpl: SceneTemplate) => {
    if (activeTab === 'erotic') setEroticConfig(tpl.config)
    else setNovelConfig(tpl.config as unknown as NovelSceneConfig)
  }

  const handleDeleteTemplate = async (id: string) => {
    await templateService.delete(id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  // ====================== Render helpers ======================

  const renderEroticEditor = () => {
    const config = eroticConfig
    const set = setEroticConfig
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* 1. Characters */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>1. 角色配置</div>
          {config.characters.map(ch => (
            <div key={ch.characterId} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, minWidth: 50 }}>{ch.characterName}</span>
              <select value={ch.role} onChange={e => set({ ...config, characters: config.characters.map(c => c.characterId === ch.characterId ? { ...c, role: e.target.value as EroticSceneCharacter['role'] } : c) })} style={mini}>
                {EROTIC_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <select value={ch.bodyState} onChange={e => set({ ...config, characters: config.characters.map(c => c.characterId === ch.characterId ? { ...c, bodyState: e.target.value } : c) })} style={mini}>
                {BODY_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={ch.customNote} onChange={e => set({ ...config, characters: config.characters.map(c => c.characterId === ch.characterId ? { ...c, customNote: e.target.value } : c) })} placeholder="备注" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 80 }} />
              <button onClick={() => set({ ...config, characters: config.characters.filter(c => c.characterId !== ch.characterId) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 12, height: 12 }} /></button>
            </div>
          ))}
          {characters.filter(c => !config.characters.find(x => x.characterId === c.id)).length > 0 && (
            <details><summary style={{ fontSize: 10, color: '#7c3aed', cursor: 'pointer' }}>+ 添加角色</summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                {characters.filter(c => !config.characters.find(x => x.characterId === c.id)).map(c => (
                  <button key={c.id} onClick={() => set({ ...config, characters: [...config.characters, { characterId: c.id, characterName: c.name, role: 'sub' as const, bodyState: '发情', customNote: '' }] })} style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 10, cursor: 'pointer' }}>{c.name}</button>
                ))}
              </div>
            </details>
          )}
          <button onClick={() => set({ ...config, customCharacters: [...config.customCharacters, { name: '', role: 'sub', bodyState: '正常', note: '' }] })} style={{ ...linkBtn, fontSize: 10, marginTop: 4 }}>+ 自由角色</button>
        </div>

        {/* 2. Scene */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>2. 场景设置</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
            <div>地点: <select value={config.location} onChange={e => set({ ...config, location: e.target.value })} style={mini}>{EROTIC_LOCATIONS.map(l => <option key={l}>{l}</option>)}</select></div>
            <input value={config.customLocation} onChange={e => set({ ...config, customLocation: e.target.value })} placeholder="自定义地点" style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: '100%' }} />
            <div>时间: <select value={config.time} onChange={e => set({ ...config, time: e.target.value })} style={mini}>{EROTIC_TIMES.map(t => <option key={t}>{t}</option>)}</select></div>
            <input value={config.customTime} onChange={e => set({ ...config, customTime: e.target.value })} placeholder="自定义时间" style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10 }} />
            <div>氛围: <select value={config.atmosphere} onChange={e => set({ ...config, atmosphere: e.target.value })} style={mini}>{ATMOSPHERES.map(a => <option key={a}>{a}</option>)}</select></div>
            <input value={config.customAtmosphere} onChange={e => set({ ...config, customAtmosphere: e.target.value })} placeholder="自定义氛围" style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10 }} />
            <div>公开度: <select value={config.publicity} onChange={e => set({ ...config, publicity: e.target.value })} style={mini}>{PUBLICITIES.map(p => <option key={p}>{p}</option>)}</select></div>
            <input value={config.customPublicity} onChange={e => set({ ...config, customPublicity: e.target.value })} placeholder="自定义公开度" style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10 }} />
          </div>
        </div>

        {/* 3. Kinks */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>3. 玩法选择</div>
          {KINKS_GROUPS.map((g, i) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 2 }}>
              {g.map(k => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '1px 4px', borderRadius: 4, cursor: 'pointer', fontSize: 10, background: config.selectedKinks.includes(k) ? 'rgba(124,58,237,0.08)' : 'transparent', border: config.selectedKinks.includes(k) ? '1px solid rgba(124,58,237,0.2)' : '1px solid transparent' }}>
                  <input type="checkbox" checked={config.selectedKinks.includes(k)} onChange={() => set({ ...config, selectedKinks: config.selectedKinks.includes(k) ? config.selectedKinks.filter(x => x !== k) : [...config.selectedKinks, k] })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />{k}
                </label>
              ))}
            </div>
          ))}
          <input value={config.kinkNote} onChange={e => set({ ...config, kinkNote: e.target.value })} placeholder="玩法备注" style={{ ...inputStyle, marginTop: 3, fontSize: 10, padding: '3px 8px' }} />
          <input value={config.customKink} onChange={e => set({ ...config, customKink: e.target.value })} placeholder="自定义玩法..." style={{ ...inputStyle, marginTop: 3, fontSize: 10, padding: '3px 8px' }} />
        </div>

        {/* 4. Flow */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>4. 流程编排</div>
          <div style={{ fontSize: 10, marginBottom: 4 }}>
            开端前戏: {OPENINGS.map(o => (
              <label key={o} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.opening.includes(o)} onChange={() => set({ ...config, opening: toggleArr(config.opening, o) })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />{o}</label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, fontSize: 10, flexWrap: 'wrap' }}>
            姿势: <select value={config.mainPose} onChange={e => set({ ...config, mainPose: e.target.value })} style={mini}>{POSES.map(p => <option key={p}>{p}</option>)}</select>
            节奏: <select value={config.mainRhythm} onChange={e => set({ ...config, mainRhythm: e.target.value })} style={mini}>{RHYTHMS.map(r => <option key={r}>{r}</option>)}</select>
            转换: <select value={config.poseChanges} onChange={e => set({ ...config, poseChanges: e.target.value })} style={mini}>{CHANGES.map(c => <option key={c}>{c}</option>)}</select>
          </div>
          <div style={{ fontSize: 10, marginTop: 4 }}>高潮: {CLIMAXES.map(c => (
            <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.climax.includes(c)} onChange={() => set({ ...config, climax: toggleArr(config.climax, c) })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />{c}</label>
          ))}</div>
          <div style={{ fontSize: 10, marginTop: 2 }}>事后: {AFTERMATHS.map(a => (
            <label key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.aftermath.includes(a)} onChange={() => set({ ...config, aftermath: toggleArr(config.aftermath, a) })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />{a}</label>
          ))}</div>
        </div>

        {/* 5. Body focus */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>5. 身体焦点与技法</div>
          <div style={{ fontSize: 10, marginBottom: 2 }}>体液: {BODY_FLUIDS.map(f => (
            <label key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.customKink.includes(`体液:${f}`)} onChange={() => set({ ...config, customKink: config.customKink.includes(`体液:${f}`) ? config.customKink.replace(`体液:${f},`, '').replace(`体液:${f}`, '') : config.customKink + `体液:${f},` })} style={{ width: 10, height: 10, accentColor: '#ec4899' }} />{f}</label>
          ))}</div>
          <div style={{ fontSize: 10, marginBottom: 2 }}>身体: {BODY_FOCUS.map(p => (
            <label key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.customKink.includes(`焦点:${p}`)} onChange={() => set({ ...config, customKink: config.customKink.includes(`焦点:${p}`) ? config.customKink.replace(`焦点:${p},`, '').replace(`焦点:${p}`, '') : config.customKink + `焦点:${p},` })} style={{ width: 10, height: 10, accentColor: '#ec4899' }} />{p}</label>
          ))}</div>
          <div style={{ fontSize: 10 }}>触感: {TOUCH_TYPES.map(t => (
            <label key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.customKink.includes(`触感:${t}`)} onChange={() => set({ ...config, customKink: config.customKink.includes(`触感:${t}`) ? config.customKink.replace(`触感:${t},`, '').replace(`触感:${t}`, '') : config.customKink + `触感:${t},` })} style={{ width: 10, height: 10, accentColor: '#ec4899' }} />{t}</label>
          ))}</div>
        </div>

        {/* 6. Narrative */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>6. 叙事技法</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10 }}>
            风格: <select value={config.customKink.match(/风格:(\w+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/风格:\w+/, '') + `风格:${e.target.value}` })} style={mini}><option value="">--</option>{NARRATIVE_STYLES.map(s => <option key={s}>{s}</option>)}</select>
            时间: <select value={config.customKink.match(/时间:(\w+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/时间:\w+/, '') + `时间:${e.target.value}` })} style={mini}><option value="">--</option>{TIME_STYLES.map(t => <option key={t}>{t}</option>)}</select>
            内省: <select value={config.customKink.match(/内省:(\w+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/内省:\w+/, '') + `内省:${e.target.value}` })} style={mini}><option value="">--</option>{INTROSPECTION_LEVELS.map(l => <option key={l}>{l}</option>)}</select>
          </div>
          <input value={config.customKink.match(/锚点:([^,]+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/锚点:[^,]+/, '').replace(/,+/g, ',') + (e.target.value ? `锚点:${e.target.value}` : '') })} placeholder="感官锚点" style={{ ...inputStyle, marginTop: 3, fontSize: 10, padding: '3px 8px' }} />
        </div>

        {/* 7. Sound */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>7. 声音与语言</div>
          <div style={{ display: 'flex', gap: 6, fontSize: 10, flexWrap: 'wrap' }}>
            效果音: <select value={config.soundDensity} onChange={e => set({ ...config, soundDensity: e.target.value })} style={mini}>{SOUND_DENSITIES.map(s => <option key={s}>{s}</option>)}</select>
            叫床: <select value={config.moanStyle} onChange={e => set({ ...config, moanStyle: e.target.value })} style={mini}>{MOAN_STYLES.map(m => <option key={m}>{m}</option>)}</select>
          </div>
          <div style={{ fontSize: 10, marginTop: 4 }}>语言: {DEGRADE_LANGS.map(d => (
            <label key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.degradeLangs.includes(d)} onChange={() => set({ ...config, degradeLangs: toggleArr(config.degradeLangs, d) })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />{d}</label>
          ))}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
            <input value={config.customInsults} onChange={e => set({ ...config, customInsults: e.target.value })} placeholder="额外侮辱词" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, flex: 1 }} />
            <input value={config.bannedWords} onChange={e => set({ ...config, bannedWords: e.target.value })} placeholder="禁用词" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, flex: 1 }} />
          </div>
        </div>

        {/* 8. Emotion */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>8. 情绪与心理</div>
          <div style={{ display: 'flex', gap: 6, fontSize: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            主导: <select value={config.customKink.match(/情绪:(\w+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/情绪:\w+/, '') + `情绪:${e.target.value}` })} style={mini}><option value="">--</option>{EMOTION_TYPES.map(e => <option key={e}>{e}</option>)}</select>
            曲线: <input value={config.customKink.match(/曲线:([^,]+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/曲线:[^,]+/, '').replace(/,+/g, ',') + (e.target.value ? `曲线:${e.target.value}` : '') })} placeholder="起始→最高→结束" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 110 }} />
            触发词: <input value={config.customKink.match(/触发:([^,]+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/触发:[^,]+/, '').replace(/,+/g,',') + (e.target.value ? `触发:${e.target.value}` : '') })} placeholder="一说就崩溃的词" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 110 }} />
          </div>
        </div>

        {/* 9. Special */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>9. 特殊设定</div>
          <input value={config.customKink.match(/世界规则:([^,]+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/世界规则:[^,]+/, '').replace(/,+/g, ',') + (e.target.value ? `世界规则:${e.target.value}` : '') })} placeholder="世界规则" style={{ ...inputStyle, marginBottom: 3, fontSize: 10, padding: '3px 8px', display: 'block', width: '100%' }} />
          <input value={config.customKink.match(/道具:([^,]+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/道具:[^,]+/, '').replace(/,+/g, ',') + (e.target.value ? `道具:${e.target.value}` : '') })} placeholder="道具清单" style={{ ...inputStyle, marginBottom: 3, fontSize: 10, padding: '3px 8px', display: 'block', width: '100%' }} />
          <input value={config.customKink.match(/服装:([^,]+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/服装:[^,]+/, '').replace(/,+/g, ',') + (e.target.value ? `服装:${e.target.value}` : '') })} placeholder="服装清单" style={{ ...inputStyle, marginBottom: 3, fontSize: 10, padding: '3px 8px', display: 'block', width: '100%' }} />
          <input value={config.customKink.match(/物品:([^,]+)/)?.[1] || ''} onChange={e => set({ ...config, customKink: config.customKink.replace(/物品:[^,]+/, '').replace(/,+/g, ',') + (e.target.value ? `物品:${e.target.value}` : '') })} placeholder="地点物品" style={{ ...inputStyle, fontSize: 10, padding: '3px 8px', display: 'block', width: '100%' }} />
        </div>

        {/* 10. Intensity */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>10. 强度与篇幅</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 10 }}>
            <div>强度: {[1, 2, 3, 4, 5].map(i => (
              <label key={i} style={{ cursor: 'pointer', marginLeft: 2, fontWeight: config.intensity === i ? 700 : 400, color: config.intensity === i ? '#7c3aed' : '#6b5e54' }}>
                <input type="radio" name="intensity" checked={config.intensity === i} onChange={() => set({ ...config, intensity: i })} style={{ width: 10, height: 10, accentColor: '#7c3aed', marginRight: 1 }} />{INTENSITY_LEVELS[i]}
              </label>
            ))}</div>
            <div>字数: <input type="number" min={500} max={50000} step={100} value={config.wordTarget} onChange={e => set({ ...config, wordTarget: Math.max(500, parseInt(e.target.value) || 500) })} style={{ width: 60, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10 }} /></div>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}><input type="checkbox" checked={config.streamMode} onChange={e => set({ ...config, streamMode: e.target.checked })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />流式</label>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}><input type="checkbox" checked={config.replaceMode} onChange={e => set({ ...config, replaceMode: e.target.checked })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />替换</label>
            <div>视角: <select value={config.narrativePOV} onChange={e => set({ ...config, narrativePOV: e.target.value })} style={mini}>{POVS.map(p => <option key={p}>{p}</option>)}</select></div>
          </div>
        </div>

        {/* 11. Extra */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>11. 额外注入 & 模板</div>
          <input value={config.extraNote} onChange={e => set({ ...config, extraNote: e.target.value })} placeholder="额外备注" style={{ ...inputStyle, marginBottom: 4, fontSize: 10, padding: '3px 8px', display: 'block', width: '100%' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 10 }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}><input type="checkbox" checked={config.useStyleProfile} onChange={e => set({ ...config, useStyleProfile: e.target.checked })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />风格档案</label>
            {selectedChapter?.description && (
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}><input type="checkbox" checked={config.useChapterOutline} onChange={e => set({ ...config, useChapterOutline: e.target.checked })} style={{ width: 10, height: 10, accentColor: '#7c3aed' }} />细纲</label>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderNovelEditor = () => {
    const config = novelConfig
    const set = setNovelConfig
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* 1. Scene type */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>1. 场景类型与目的</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10, alignItems: 'center' }}>
            类型: <select value={config.sceneType} onChange={e => set({ ...config, sceneType: e.target.value })} style={mini}>{NOVEL_SCENE_TYPES.map(s => <option key={s}>{s}</option>)}</select>
            冲突: <select value={config.conflictType} onChange={e => set({ ...config, conflictType: e.target.value })} style={mini}>{NOVEL_CONFLICTS.map(c => <option key={c}>{c}</option>)}</select>
          </div>
          <div style={{ fontSize: 10, marginTop: 4 }}>
            目的: {NOVEL_PURPOSES.map(p => (
              <label key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.scenePurpose.includes(p)} onChange={() => set({ ...config, scenePurpose: toggleArr(config.scenePurpose, p) })} style={{ width: 10, height: 10, accentColor: '#3b82f6' }} />{p}</label>
            ))}
          </div>
        </div>

        {/* 2. Characters */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>2. 角色与视角</div>
          <div style={{ fontSize: 10, marginBottom: 4 }}>主视角: <select value={config.povCharacterId} onChange={e => { const ch = characters.find(c => c.id === e.target.value); set({ ...config, povCharacterId: e.target.value, povCharacterName: ch?.name || '' }) }} style={mini}><option value="">无</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          {config.characters.map((ch, i) => (
            <div key={ch.characterId} style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 600, minWidth: 45 }}>{ch.characterName}</span>
              <input value={ch.emotion} onChange={e => { const n = [...config.characters]; n[i] = { ...n[i], emotion: e.target.value }; set({ ...config, characters: n }) }} placeholder="情绪" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 70 }} />
              <button onClick={() => set({ ...config, characters: config.characters.filter(c => c.characterId !== ch.characterId) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4' }}><TrashIcon style={{ width: 10, height: 10 }} /></button>
            </div>
          ))}
          {characters.filter(c => !config.characters.find(x => x.characterId === c.id)).length > 0 && (
            <details><summary style={{ fontSize: 10, color: '#3b82f6', cursor: 'pointer' }}>+ 添加角色</summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                {characters.filter(c => !config.characters.find(x => x.characterId === c.id)).map(c => (
                  <button key={c.id} onClick={() => set({ ...config, characters: [...config.characters, { characterId: c.id, characterName: c.name, emotion: '' }] })} style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 10, cursor: 'pointer' }}>{c.name}</button>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* 3. Environment */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>3. 环境描写</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10 }}>
            <div>地点: <select value={config.location} onChange={e => set({ ...config, location: e.target.value })} style={mini}>{['卧室','客厅','书房','玄关','浴室','厨房','阳台','办公室','会议室','咖啡厅','餐厅','公园','街道','校园','医院','法院','野外','山顶','海边','自定义'].map(l => <option key={l}>{l}</option>)}</select></div>
            <input value={config.customLocation} onChange={e => set({ ...config, customLocation: e.target.value })} placeholder="自定义" style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10 }} />
            <div>天气: <select value={config.weather} onChange={e => set({ ...config, weather: e.target.value })} style={mini}>{NOVEL_WEATHERS.map(w => <option key={w}>{w}</option>)}</select></div>
            <div>时间: <select value={config.time} onChange={e => set({ ...config, time: e.target.value })} style={mini}>{['清晨','午间','傍晚','深夜','不限'].map(t => <option key={t}>{t}</option>)}</select></div>
            <div>氛围: <select value={config.atmosphere} onChange={e => set({ ...config, atmosphere: e.target.value })} style={mini}>{['温馨','紧张','悲伤','欢乐','恐惧','冷漠','愤怒','悬疑','不限'].map(a => <option key={a}>{a}</option>)}</select></div>
          </div>
          <div style={{ fontSize: 10, marginTop: 4 }}>感官: {NOVEL_SENSES.map(s => (
            <label key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6, cursor: 'pointer' }}><input type="checkbox" checked={config.senses.includes(s)} onChange={() => set({ ...config, senses: toggleArr(config.senses, s) })} style={{ width: 10, height: 10, accentColor: '#3b82f6' }} />{s}</label>
          ))}</div>
        </div>

        {/* 4. Genre */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>4. 类型专属</div>
          <div style={{ marginBottom: 4 }}>小说类型: <select value={genreType} onChange={e => { setGenreType(e.target.value); set({ ...config, genreElements: [] }) }} style={mini}>{Object.keys(NOVEL_GENRES).map(g => <option key={g}>{g}</option>)}</select></div>
          {NOVEL_GENRES[genreType]?.map(el => (
            <label key={el} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 8, cursor: 'pointer', fontSize: 10 }}>
              <input type="checkbox" checked={config.genreElements.includes(el)} onChange={() => set({ ...config, genreElements: toggleArr(config.genreElements, el) })} style={{ width: 10, height: 10, accentColor: '#3b82f6' }} />{el}
            </label>
          ))}
        </div>

        {/* 5. Dialogue */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>5. 对话与节奏</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10 }}>
            <div>对话: <select value={config.dialogueRatio} onChange={e => set({ ...config, dialogueRatio: e.target.value })} style={mini}>{NOVEL_DIALOGUES.map(d => <option key={d}>{d}</option>)}</select></div>
            <div>潜台词: <select value={config.subtextLevel} onChange={e => set({ ...config, subtextLevel: e.target.value })} style={mini}>{NOVEL_SUBTEXTS.map(s => <option key={s}>{s}</option>)}</select></div>
            <div>句式: <select value={config.sentenceStyle} onChange={e => set({ ...config, sentenceStyle: e.target.value })} style={mini}>{NOVEL_SENTENCES.map(s => <option key={s}>{s}</option>)}</select></div>
            <div>段落: <select value={config.paragraphDensity} onChange={e => set({ ...config, paragraphDensity: e.target.value })} style={mini}>{NOVEL_DENSITIES.map(d => <option key={d}>{d}</option>)}</select></div>
          </div>
        </div>

        {/* 6. Length */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>6. 篇幅与情绪</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 10 }}>
            字数: <input type="number" min={500} max={50000} step={100} value={config.wordTarget} onChange={e => set({ ...config, wordTarget: Math.max(500, parseInt(e.target.value) || 500) })} style={{ width: 55, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10 }} />
            视角: <select value={config.narrativePOV} onChange={e => set({ ...config, narrativePOV: e.target.value })} style={mini}>{['第一人称男主','第一人称女主','第三人称'].map(p => <option key={p}>{p}</option>)}</select>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 10, alignItems: 'center' }}>
            起始: <input value={config.emotionStart} onChange={e => set({ ...config, emotionStart: e.target.value })} placeholder="平静" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 60 }} />
            → 结尾: <input value={config.emotionEnd} onChange={e => set({ ...config, emotionEnd: e.target.value })} placeholder="暴怒" style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, width: 60 }} />
          </div>
          <div style={{ marginTop: 4 }}>
            <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, marginRight: 8 }}><input type="checkbox" checked={config.useStyleProfile} onChange={e => set({ ...config, useStyleProfile: e.target.checked })} style={{ width: 10, height: 10, accentColor: '#3b82f6' }} />风格</label>
            {selectedChapter?.description && <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10 }}><input type="checkbox" checked={config.useChapterOutline} onChange={e => set({ ...config, useChapterOutline: e.target.checked })} style={{ width: 10, height: 10, accentColor: '#3b82f6' }} />细纲</label>}
          </div>
          <input value={config.extraNote} onChange={e => set({ ...config, extraNote: e.target.value })} placeholder="额外备注" style={{ ...inputStyle, marginTop: 4, fontSize: 10, padding: '3px 8px', display: 'block', width: '100%' }} />
        </div>
      </div>
    )
  }

  // ====================== Main render ======================

  if (!activeProjectId) return null

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 14, color: '#9b8e84' }}>加载中...</p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', height: '100%' }}>
      {/* Left: Chapter list */}
      <div style={{ width: '18%', minWidth: 160, borderRight: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 14px 10px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>章节列表</h3>
          <span style={{ fontSize: 10, color: '#9b8e84' }}>{detailedChapters.length}章</span>
        </div>
        <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
          <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {detailedChapters.map((ch, idx) => {
              const hasConfig = !!savedConfigs[ch.id]
              return (
                <button
                  key={ch.id}
                  onClick={() => setSelectedChapterId(ch.id)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.04)',
                    background: selectedChapterId === ch.id ? 'rgba(124,58,237,0.06)' : '#fff',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                    transition: 'background 0.1s',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', minWidth: 28 }}>第{idx + 1}章</span>
                  <span style={{ fontSize: 11, color: '#2d2520', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title || '未命名'}</span>
                  {hasConfig && <CheckCircleIcon style={{ width: 12, height: 12, color: '#16a34a', flexShrink: 0 }} />}
                </button>
              )
            })}
            {detailedChapters.length === 0 && (
              <div style={{ textAlign: 'center', padding: 16, fontSize: 11, color: '#9b8e84' }}>暂无章节<br/>请先在细纲页创建章节</div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Center: Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520' }}>场景工坊</h2>
            {selectedChapter && (
              <span style={{ fontSize: 11, color: '#6b5e54' }}>
                当前: {selectedChapter.title || `第${(detailedChapters.findIndex(c => c.id === selectedChapterId) ?? 0) + 1}章`}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setActiveTab('erotic')} style={{
              padding: '6px 16px', borderRadius: '8px 0 0 8px', border: '1px solid rgba(0,0,0,0.08)',
              background: activeTab === 'erotic' ? '#7c3aed' : '#fff',
              color: activeTab === 'erotic' ? '#fff' : '#6b5e54', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>情色场景</button>
            <button onClick={() => setActiveTab('novel')} style={{
              padding: '6px 16px', borderRadius: '0 8px 8px 0', border: '1px solid rgba(0,0,0,0.08)',
              background: activeTab === 'novel' ? '#3b82f6' : '#fff',
              color: activeTab === 'novel' ? '#fff' : '#6b5e54', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>通用场景</button>
          </div>
        </div>

        {/* Editor body */}
        {!selectedChapterId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
            <DocumentTextIcon style={{ width: 40, height: 40, color: '#d4ccc4' }} />
            <p style={{ fontSize: 14, color: '#9b8e84' }}>请从左侧选择一个章节</p>
          </div>
        ) : (
          <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
            <div style={{ padding: 14 }}>
              {activeTab === 'erotic' ? renderEroticEditor() : renderNovelEditor()}
            </div>
          </ScrollArea>
        )}

        {/* Bottom action bar */}
        {selectedChapterId && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', background: 'rgba(255,255,255,0.5)' }}>
            <Button size="sm" onClick={handleSaveConfig} disabled={saving}>{saving ? '保存中...' : '保存配置'}</Button>

            {templates.length > 0 && (
              <select onChange={e => { const t = templates.find(t => t.id === e.target.value); if (t) handleLoadTemplate(t) }} defaultValue="" style={{ ...mini, fontSize: 11 }}>
                <option value="" disabled>加载模板</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}

            {!showSaveTpl ? (
              <button onClick={() => setShowSaveTpl(true)} style={linkBtn}>保存为模板</button>
            ) : (
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input value={tplName} onChange={e => setTplName(e.target.value)} placeholder="模板名" style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, width: 100 }} />
                <Button size="sm" onClick={handleSaveTemplate}>保存</Button>
                <button onClick={() => { setShowSaveTpl(false); setTplName('') }} style={{ ...linkBtn, color: '#9b8e84' }}>取消</button>
              </span>
            )}

            <div style={{ flex: 1 }} />

            <Button size="sm" variant="secondary" onClick={handlePreview} disabled={generating || !activeConfigId} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
              {generating ? '生成中...' : '预览生成'}
            </Button>
            <Button size="sm" onClick={handleGenerateAndInsert} disabled={generating || !activeConfigId}>
              生成并插入章节
            </Button>
          </div>
        )}

        {/* Template list */}
        {templates.length > 0 && (
          <div style={{ padding: '4px 20px 8px', borderTop: '1px solid rgba(0,0,0,0.02)', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#9b8e84', marginRight: 4 }}>模板:</span>
            {templates.map(t => (
              <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 6, background: 'rgba(124,58,237,0.06)', fontSize: 10 }}>
                {t.name}
                <button onClick={() => handleDeleteTemplate(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 0 }}><TrashIcon style={{ width: 10, height: 10 }} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right: Reference panel */}
      <div style={{ width: '18%', minWidth: 180, borderLeft: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.35)', display: 'flex', flexDirection: 'column' }}>
        {/* Chapter outline reference */}
        <div style={{ height: '50%', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 14px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <DocumentTextIcon style={{ width: 14, height: 14, color: '#7c3aed' }} />
            <h4 style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>本章细纲</h4>
          </div>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 14px 10px' }}>
            <div style={{ fontSize: 11, lineHeight: 1.7, color: '#4a3f38', whiteSpace: 'pre-wrap' }}>
              {selectedChapter?.description || (selectedChapterId ? '该章节暂无细纲描述' : '请选择章节')}
            </div>
          </ScrollArea>
        </div>

        {/* Character list */}
        <div style={{ height: '35%', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserIcon style={{ width: 14, height: 14, color: '#7c3aed' }} />
            <h4 style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>角色列表</h4>
            <span style={{ fontSize: 10, color: '#9b8e84' }}>{characters.length}个</span>
          </div>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 8px 8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {characters.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', fontSize: 10, borderRadius: 4 }}>
                  <span style={{ fontWeight: 600, color: '#2d2520' }}>{c.name || '未命名'}</span>
                  {c.role && <span style={{ color: '#9b8e84', fontSize: 9 }}>{c.role}</span>}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Preview area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 100 }}>
          <div style={{ padding: '10px 14px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <SparklesIcon style={{ width: 14, height: 14, color: '#7c3aed' }} />
            <h4 style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>预览</h4>
            {generating && <span style={{ fontSize: 10, color: '#f59e0b' }}>生成中...</span>}
          </div>
          <ScrollArea maxHeight="100%" style={{ flex: 1, padding: '0 10px 8px' }}>
            <div style={{ fontSize: 11, lineHeight: 1.7, color: '#4a3f38', whiteSpace: 'pre-wrap' }}>
              {previewText || (selectedChapterId ? '点击「预览生成」查看效果' : '请选择章节')}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
