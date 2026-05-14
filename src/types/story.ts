// ---- Story Map System ----

export interface StoryEvent {
  id: string
  type: 'event' | 'foreshadowing' | 'payoff'
  timeLabel: string
  chapterId: string
  chapterOrder: number
  chapterTitle: string
  characters: string[]
  location: string
  summary: string
  quote: string
  source: 'ai' | 'manual'
  createdAt: string
}

export interface StoryLink {
  id: string
  sourceEventId: string
  targetEventId: string
  type: 'foreshadowing' | 'causality' | 'reference'
  note: string
}

export interface CharacterSnapshot {
  characterId: string
  characterName: string
  chapterId: string
  chapterOrder: number
  chapterTitle: string
  traits: Record<string, string>
}

// ---- Emotions ----

export interface ChapterEmotion {
  chapterId: string
  chapterOrder: number
  chapterTitle: string
  scores: {
    tension: number
    warmth: number
    sadness: number
    excitement: number
    lightness: number
  }
  summary: string
}

// ---- Character Presence ----

export interface CharacterPresence {
  chapterId: string; chapterOrder: number; chapterTitle: string
  characters: {
    characterId: string; characterName: string
    mentionCount: number
    role: 'primary' | 'secondary' | 'mentioned'
  }[]
}

// ---- Chapter Rhythm ----

export interface ChapterRhythm {
  chapterId: string; chapterOrder: number; chapterTitle: string
  metrics: {
    dialogueRatio: number
    descriptionRatio: number
    actionRatio: number
    paceScore: number
    infoDensity: number
    wordCount: number
  }
}

// ---- Plotlines ----

export interface Plotline {
  id: string; name: string; color: string; description: string; order: number
}

export interface ChapterPlotline {
  chapterId: string; chapterOrder: number; chapterTitle: string
  plotlines: {
    plotlineId: string; plotlineName: string
    intensity: number
  }[]
}

// ---- POV ----

export interface ChapterPOV {
  chapterId: string; chapterOrder: number; chapterTitle: string
  primaryPOV: { characterId: string; characterName: string }
  secondaryFocalPoints: { characterId: string; characterName: string }[]
  povType: 'first' | 'third-close' | 'third-omniscient' | 'mixed'
  hasHeadHopping: boolean
  note: string
}

// ---- Character Growth ----

export interface GrowthTrack {
  id: string; label: string; icon: string; order: number
}

export interface GrowthEntry {
  id: string
  characterId: string; characterName: string
  chapterId: string; chapterOrder: number; chapterTitle: string
  trackId: string; trackLabel: string
  value: string
  change: 'new' | 'upgrade' | 'downgrade' | 'lost' | 'same'
  note: string
  source: 'ai' | 'manual'
  createdAt: string
}

// ---- Style Workshop ----

export interface BodySection {
  part: string
  sentenceCount: string
  details: string[]
  order: number
}

export interface DescriptionPattern {
  bodyOrder: string[]
  sections: BodySection[]
  stockingDetail: string
  characterVisualProfile: string
  detailFingerprints: string[]
}

export interface CorruptionArc {
  characterStates: {
    characterName: string
    currentState: string
    originalState: string
    progressionSteps: string[]
  }[]
  overallTrajectory: string
}

export interface DegradationRitual {
  sceneTemplate: string[]
  punishmentTools: string[]
  authorityEntryPattern: string
  audienceInvolvement: string
  chorusPattern: string           // 齐声浪叫句式与叙事功能
  surrenderConfirmation: string
  sensoryCounterpoint: string     // (原sceneMechanics) 声音/视觉对位
  symbolicTool: string            // (原sceneMechanics) 象征工具
  recurringVisualFormula: string  // (原sceneMechanics) 视觉定型
}

export interface NarrativeVoice {
  internalMonologueRatio: string
  toneContrast: string
  worldBuildingStyle: string
  routineCatalog: string
  powerResignation: string
}

export interface SceneMechanics {
  sensoryCounterpoint: string
  symbolicTool: string
  recurringVisualFormula: string
}

export interface SomaticTension {
  bodyCondition: string
  anatomicalPrecision: string
  orchestrationPattern: string
  powerAnxiety: string
}

export interface IdentityDissolution {
  preExistingIdentity: string
  replacementIdentity: string
  selfGaslightingPattern: string
  competitiveAbasement: string
  correctionFrame: string
  hierarchyStructure: string   // 多人之间的等级层级声明方式
}

export interface ShameVoyeurLoop {
  triggerPattern: string       // 触发机制: 看见/听见所爱之人被侵犯
  excitementResponse: string   // 兴奋反应: 身体硬了/呼吸急促
  shameLayer: string           // 羞耻层: 自责/无地自容
  feedbackAmplification: string // 反馈放大: 羞耻→更强兴奋→更羞耻的闭环
}

export interface ChapterAnalysis {
  sentenceStyle: string
  vocabularyStyle: string
  rhetoricStyle: string
  rhythmStyle: string
  dialogueStyle: string
  moodStyle: string
  perspectiveStyle: string     // 视角距离
  bodyLanguageStyle: string    // 生理反应/身体描写
  sensoryStyle: string         // 感官侧重
  tensionStyle: string         // 心理张力/冲突手法
  subtextStyle: string         // 暗示/留白技巧
  descriptionPattern: DescriptionPattern | null  // 描写结构模板
  corruptionArc: CorruptionArc | null           // 堕落弧线
  degradationRitual: DegradationRitual | null    // 仪式剧本
  narrativeVoice: NarrativeVoice | null           // 叙事声音
  sceneMechanics: SceneMechanics | null            // 场景装置
  somaticTension: SomaticTension | null            // 躯体状态
  identityDissolution: IdentityDissolution | null  // 身份溶解
  shameVoyeurLoop: ShameVoyeurLoop | null          // 心理循环
  excerpt: string
  excerptNote: string
  analyzedAt: string
}

export interface StyleChapter {
  id: string
  title: string
  chapterNumber: number
  chapterType: 'chapter' | 'prologue' | 'epilogue' | 'sideStory' | 'afterword'
  content: string
  charCount: number
  analyzed: boolean
  analysis: ChapterAnalysis | null
}

export interface StyleProfile {
  features: {
    sentenceStyle: string
    vocabularyStyle: string
    rhetoricStyle: string
    rhythmStyle: string
    dialogueStyle: string
    moodStyle: string
    perspectiveStyle: string
    bodyLanguageStyle: string
    sensoryStyle: string
    tensionStyle: string
    subtextStyle: string
    descriptionPattern: DescriptionPattern | null
    corruptionArc: CorruptionArc | null
    degradationRitual: DegradationRitual | null
    narrativeVoice: NarrativeVoice | null
    sceneMechanics: SceneMechanics | null
    somaticTension: SomaticTension | null
    identityDissolution: IdentityDissolution | null
    shameVoyeurLoop: ShameVoyeurLoop | null
  }
  fullDescription: string
  excerpts: { text: string; note: string }[]
  analyzedAt: string
  analyzedChapterCount: number
}

// ---- Erotic Scene Builder ----

export interface EroticSceneCharacter {
  characterId: string; characterName: string
  role: 'dom' | 'sub' | 'switch' | 'observer'
  bodyState: string; customNote: string
}

export interface EroticSceneConfig {
  characters: EroticSceneCharacter[]
  location: string; time: string; atmosphere: string; publicity: string
  selectedKinks: string[]; kinkNote: string
  opening: string[]; mainPose: string; mainRhythm: string; poseChanges: string
  climax: string[]; aftermath: string[]
  soundDensity: string; moanStyle: string
  degradeLangs: string[]
  intensity: number; wordTarget: number; streamMode: boolean; replaceMode: boolean
  useStyleProfile: boolean; useChapterOutline: boolean; extraNote: string
  kinkIntensities: Record<string,string>; customKink: string
  customCharacters: {name:string, role:string, bodyState:string, note:string}[]
  customLocation: string; customTime: string; customAtmosphere: string; customPublicity: string
  extraPhases: {name:string, desc:string}[]
  customInsults: string; bannedWords: string
  narrativePOV: string
}

export interface SceneTemplate {
  id: string; name: string; config: EroticSceneConfig; createdAt: string
}

// ---- Novel Scene Builder ----

export interface NovelSceneConfig {
  sceneType: string; scenePurpose: string[]; conflictType: string
  povCharacterId: string; povCharacterName: string
  characters: { characterId: string; characterName: string; emotion: string }[]
  location: string; customLocation: string; weather: string; time: string; atmosphere: string
  senses: string[]
  genreElements: string[]
  dialogueRatio: string; subtextLevel: string; sentenceStyle: string; paragraphDensity: string
  emotionStart: string; emotionEnd: string
  wordTarget: number; narrativePOV: string
  useStyleProfile: boolean; useChapterOutline: boolean; extraNote: string
}

// Per-chapter scene configuration (saved to projects/{project}/scenes/{chapterId}.json)
export interface ChapterSceneConfig {
  chapterId: string
  chapterTitle: string
  eroticScene: EroticSceneConfig | null
  novelScene: NovelSceneConfig | null
  updatedAt: string
}

// EMPTY values for initial state
export const EMPTY_CHAPTER_ANALYSIS: ChapterAnalysis = {
  sentenceStyle: '', vocabularyStyle: '', rhetoricStyle: '',
  rhythmStyle: '', dialogueStyle: '', moodStyle: '',
  perspectiveStyle: '', bodyLanguageStyle: '', sensoryStyle: '',
  tensionStyle: '', subtextStyle: '', descriptionPattern: null,
  corruptionArc: null, degradationRitual: null, narrativeVoice: null, sceneMechanics: null, somaticTension: null, identityDissolution: null, shameVoyeurLoop: null,
  excerpt: '', excerptNote: '', analyzedAt: '',
}

export interface StyleProject {
  id: string
  name: string
  sourceFileName: string
  chapters: StyleChapter[]
  profile: StyleProfile | null
  createdAt: string
  totalCharCount: number
  enabledDimensions: string[]
  novelType: string
}

export interface StyleProjectMeta {
  id: string; name: string; sourceFileName: string
  chapterCount: number; totalCharCount: number; hasProfile: boolean
  createdAt: string; novelType: string
}

export const NOVEL_TYPES = ['通用','都市','修仙','恋爱','古风','悬疑','情色']

export const NOVEL_TYPE_DIMS: Record<string, string[]> = {
  '通用': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern'],
  '都市': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','socialRealism'],
  '修仙': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','cultivationCombat'],
  '恋爱': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','romanceArc'],
  '古风': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','archaicStyle'],
  '悬疑': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','suspensePacing'],
  '情色': ['sentenceStyle','vocabularyStyle','rhetoricStyle','rhythmStyle','dialogueStyle','moodStyle','perspectiveStyle','bodyLanguageStyle','sensoryStyle','tensionStyle','descriptionPattern','corruptionArc','degradationRitual','narrativeVoice','shameVoyeurLoop'],
}

// Dimension metadata: key → {label, promptTemplate}
export const DIMENSION_META: Record<string, { label: string; category: string; prompt: string }> = {
  sentenceStyle:    { label: '句式', category: '基础文风', prompt: '"sentenceStyle": "长短句偏好+标点习惯+段落结构"' },
  vocabularyStyle:  { label: '词汇', category: '基础文风', prompt: '"vocabularyStyle": "书面/口语倾向+高频词类+成语频率"' },
  rhetoricStyle:    { label: '修辞暗示', category: '基础文风', prompt: '"rhetoricStyle": "比喻/拟人/排比/通感使用习惯+留白/委婉/间接描写技巧"' },
  rhythmStyle:      { label: '节奏结构', category: '基础文风', prompt: '"rhythmStyle": "快慢段落交替+场景切换频率+是否存在双线/多线平行交叉剪辑"' },
  dialogueStyle:    { label: '对话', category: '基础文风', prompt: '"dialogueStyle": "对白占比+语气风格+人物语言差异性"' },
  moodStyle:        { label: '氛围', category: '基础文风', prompt: '"moodStyle": "情绪基调+色调偏好(冷/暖/暗)"' },
  perspectiveStyle: { label: '视角', category: '进阶技法', prompt: '"perspectiveStyle": "第一/第三人称紧贴/全知+内心独白频率"' },
  bodyLanguageStyle:{ label: '身体描写', category: '进阶技法', prompt: '"bodyLanguageStyle": "生理反应追踪频率+部位描写+解剖精度+身体特殊状态(退行/变异/微型化)及权力焦虑+触感六维(温度:烫温凉冰/湿度:干燥-泥泞/质地:软嫩-粗糙-颗粒-倒钩/压力:紧致箍紧-松垮松弛-异物撑开/摩擦:磨碾-刮擦-蠕动绞紧-震动/腔道内部:阴道褶皱-菊穴紧箍-喉穴收缩-子宫吮吸-口腔包裹)+插入描写(进入方式/角度/深度/节奏模式:九浅一深或连续深桩/每次行程)+性交姿势(名称+转换频率+主导权+身体空间形态:趴跪躺骑抱悬空)+快感信号系统(身体信号/面部信号:翻眼流涎吐舌阿黑颜/声音信号)"' },
  sensoryStyle:     { label: '感官', category: '进阶技法', prompt: '"sensoryStyle": "五感比例+效果音词表(列出所有重复拟声词及其对应场景+是否封闭词表+每段密度)+体液分类(种类:精液/爱液/尿液/汗液/乳汁/血液/肠液+每种浓稠度/颜色/气味/温度/分泌量+角色间转移方式)+体液叙事功能(高潮标记:射精量=快感强度/羞耻强化:失禁=彻底羞耻/身份确认:吞咽精液=归属仪式/视觉冲击:精液满脸从鼻子喷出/梯度张力:从湿润→喷泉的过程追踪)"' },
  tensionStyle:     { label: '心理张力', category: '进阶技法', prompt: '"tensionStyle": "内心矛盾表现形式+欲望与压抑的拉扯方式+羞耻-窥视情绪循环(触发→兴奋→羞耻→反馈放大)"' },
  descriptionPattern:{ label: '描写结构', category: '进阶技法', prompt: '"descriptionPattern": {"dressingProcess":"服装描写顺序: 先写穿了什么(情趣内衣/女仆装/丝袜/高跟鞋/项圈/乳环)→再写如何脱下(撕开/褪下/卷起/裸露)→再写脱到什么程度(半裸/全裸/只露某部位)→由谁脱(自脱/被脱/互相脱)","bodyOrder":["出场描写扫描顺序"],"sections":[{"part":"部位","sentenceCount":"1-2句","details":["细节"],"order":1}],"stockingDetail":"丝袜描写密度","characterVisualProfile":"角色视觉配置","detailFingerprints":["指纹细节"]}' },
  corruptionArc:    { label: '人物演变', category: '情色专属', prompt: '"corruptionArc": {"characterStates":[{"characterName":"角色名","currentState":"当前状态","originalState":"原始状态","progressionSteps":["阶梯步骤"]}],"overallTrajectory":"整体堕落轨迹","identityDissolution":{"旧身份":"...","新身份":"...","自我合理化":"...","竞相自贬":"...","管教框架":"..."},"hierarchyStructure":"多人之间的等级层级声明方式(谁高于谁/如何反复重述)"}' },
  degradationRitual:{ label: '场景机制', category: '情色专属', prompt: '"degradationRitual": {"sceneTemplate":["场景→状态→惩罚→观众→升级→交媾→确认"],"punishmentTools":["工具"],"authorityEntryPattern":"权威入场","orgasmTemplate":"高潮描写的固定步骤(预警信号→快感积累→极限突破→射精/潮吹→痉挛→翻白眼→失神)","phraseTaxonomy":{"begging":["乞求句式","如求主人操我"],"gratitude":["感谢句式","如谢谢主人"],"insults":["固定侮辱词表","如母狗/肉便器/精壶/飞机杯/骚货/贱婢"]},"kinkTaxonomy":{"SM":"捆绑/鞭打/滴蜡/项圈/狗链","露出":"户外/公开/偷窥视角","NTR":"绿帽/换妻/多人+窥视+羞辱","催眠":"心灵操控+主动服从","道具":"跳蛋/振动棒/假阳具/乳夹/肛塞","排泄":"圣水/黄金/浣肠"},"audienceInvolvement":"观众介入","chorusPattern":"齐声浪叫句式(固定模板/内容模板/叙事功能/触发位置)","surrenderConfirmation":"屈服确认句式","sensoryCounterpoint":"声音/视觉对位","symbolicTool":"象征工具","recurringVisualFormula":"视觉定型模板(如阿黑颜公式:翻眼→吐舌→流涎→扭曲)"}' },
  narrativeVoice:   { label: '叙事声音', category: '情色专属', prompt: '"narrativeVoice": {"internalMonologueRatio":"内心独白占比","toneContrast":"极淫内容用极平淡语气写的反差","worldBuildingStyle":"世界观在性场景中插叙交代","routineCatalog":"日常流程编目句式","powerResignation":"面对不可抗力时的认命/转嫁/自我安慰"}' },
  shameVoyeurLoop:  { label: '心理循环', category: '情色专属', prompt: '"shameVoyeurLoop": {"triggerPattern":"羞耻-窥视触发机制(看见/听见所爱之人被侵犯)","excitementResponse":"兴奋的身体反应","shameLayer":"羞耻层的自我谴责","feedbackAmplification":"羞耻→更强兴奋→更羞耻的闭环放大方式"}' },
  // Genre-specific
  socialRealism:   { label: '社会现实', category: '类型专属', prompt: '"socialRealism": "阶层标记(消费品/居住地/出行方式的描写密度)+口语自然度(方言/流行语/脏话)+行业术语使用"' },
  cultivationCombat:{ label: '修炼战斗', category: '类型专属', prompt: '"cultivationCombat": "招式命名规律+战斗节奏(快攻/拉锯/一招定胜负)+境界突破的仪式感描写+法宝丹药的描写密度和命名规则"' },
  romanceArc:      { label: '感情发展', category: '类型专属', prompt: '"romanceArc": "关系阶段模板(相遇→暧昧→确认→挫折→和解)+甜虐节奏比例+第三人/误会的作用方式"' },
  archaicStyle:    { label: '古风文言', category: '类型专属', prompt: '"archaicStyle": "文言白话比+称谓系统(古称/敬语/谦称/官职称呼)+功夫招式命名的文学风格+内力/轻功的描写模式"' },
  suspensePacing:  { label: '悬疑节奏', category: '类型专属', prompt: '"suspensePacing": "伏笔密度(每章几处)+红鲱鱼虚假线索使用+信息揭露节奏(逐步揭示/倒叙/最后一章爆发)+误导和反转频率"' },
}

export const GENRE_TRACK_PRESETS: Record<string, Omit<GrowthTrack, 'id' | 'order'>[]> = {
  '仙侠/玄幻': [
    { label: '等级境界', icon: '📊' }, { label: '功法技能', icon: '⚔️' },
    { label: '装备道具', icon: '🎒' }, { label: '身份地位', icon: '👑' },
    { label: '所在位置', icon: '📍' },
  ],
  '都市/现实': [
    { label: '职业发展', icon: '💼' }, { label: '资产财富', icon: '💰' },
    { label: '社交圈层', icon: '👥' }, { label: '感情状态', icon: '❤️' },
    { label: '所在位置', icon: '📍' },
  ],
  '恋爱/言情': [
    { label: '感情阶段', icon: '💕' }, { label: '好感度', icon: '📈' },
    { label: '关系确认', icon: '💍' }, { label: '情敌动态', icon: '⚡' },
    { label: '重要事件', icon: '🎯' },
  ],
  '悬疑/推理': [
    { label: '调查进度', icon: '🔍' }, { label: '线索收集', icon: '🧩' },
    { label: '嫌疑人圈', icon: '👤' }, { label: '真相揭露', icon: '💡' },
    { label: '危险等级', icon: '⚠️' },
  ],
  '科幻': [
    { label: '科技等级', icon: '🔬' }, { label: '装备升级', icon: '🛠️' },
    { label: '组织地位', icon: '🏛️' }, { label: '星际位置', icon: '🌍' },
    { label: '基因/改造', icon: '🧬' },
  ],
  '后宫': [
    { label: '后宫人数', icon: '👥' }, { label: '好感度', icon: '📈' },
    { label: '攻略进度', icon: '🎯' }, { label: '修罗场', icon: '💢' },
    { label: '关系阶段', icon: '💕' },
  ],
  '自定义': [
    { label: '新维度', icon: '📌' },
  ],
}

export const DEFAULT_GROWTH_TRACKS = GENRE_TRACK_PRESETS['仙侠/玄幻']

// ---- Unified Graph ----

export interface StoryGraph {
  events: StoryEvent[]
  links: StoryLink[]
  snapshots: CharacterSnapshot[]
  emotions: ChapterEmotion[]
  presences: CharacterPresence[]
  rhythms: ChapterRhythm[]
  plotlines: Plotline[]
  chapterPlotlines: ChapterPlotline[]
  povs: ChapterPOV[]
  growthTracks: GrowthTrack[]
  growthEntries: GrowthEntry[]
  generatedAt: string
  scannedChapterIds: string[]
  scannedChapterHashes: Record<string, number>
  novelType: string
}

export function isForeshadowingEvent(e: StoryEvent): boolean {
  return e.type === 'foreshadowing' || e.type === 'payoff'
}
