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
  surrenderConfirmation: string
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
  }
  fullDescription: string
  excerpts: { text: string; note: string }[]
  analyzedAt: string
  analyzedChapterCount: number
}

// EMPTY values for initial state
export const EMPTY_CHAPTER_ANALYSIS: ChapterAnalysis = {
  sentenceStyle: '', vocabularyStyle: '', rhetoricStyle: '',
  rhythmStyle: '', dialogueStyle: '', moodStyle: '',
  perspectiveStyle: '', bodyLanguageStyle: '', sensoryStyle: '',
  tensionStyle: '', subtextStyle: '', descriptionPattern: null,
  corruptionArc: null, degradationRitual: null, narrativeVoice: null, sceneMechanics: null,
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
}

// Dimension metadata: key → {label, promptTemplate}
export const DIMENSION_META: Record<string, { label: string; category: string; prompt: string }> = {
  sentenceStyle:    { label: '句式', category: '基础文风', prompt: '"sentenceStyle": "长短句偏好+标点习惯+段落结构"' },
  vocabularyStyle:  { label: '词汇', category: '基础文风', prompt: '"vocabularyStyle": "书面/口语倾向+高频词类+成语频率"' },
  rhetoricStyle:    { label: '修辞', category: '基础文风', prompt: '"rhetoricStyle": "比喻/拟人/排比/通感使用习惯和密度"' },
  rhythmStyle:      { label: '节奏', category: '基础文风', prompt: '"rhythmStyle": "快慢段落交替模式+场景切换频率"' },
  dialogueStyle:    { label: '对话', category: '基础文风', prompt: '"dialogueStyle": "对白占比+语气风格+人物语言差异性"' },
  moodStyle:        { label: '氛围', category: '基础文风', prompt: '"moodStyle": "情绪基调+色调偏好(冷/暖/暗)"' },
  perspectiveStyle: { label: '视角', category: '进阶技法', prompt: '"perspectiveStyle": "第一/第三人称紧贴/全知+内心独白频率"' },
  bodyLanguageStyle:{ label: '身体', category: '进阶技法', prompt: '"bodyLanguageStyle": "生理反应追踪频率+部位描写偏好"' },
  sensoryStyle:     { label: '感官', category: '进阶技法', prompt: '"sensoryStyle": "视觉/听觉/嗅觉/触觉的比例分配"' },
  tensionStyle:     { label: '张力', category: '进阶技法', prompt: '"tensionStyle": "内心矛盾表现形式+欲望与压抑的拉扯方式"' },
  subtextStyle:     { label: '暗示', category: '进阶技法', prompt: '"subtextStyle": "留白/委婉/间接描写+不点破的信息传达方式"' },
  descriptionPattern:{ label: '描写结构', category: '进阶技法', prompt: '"descriptionPattern": {"bodyOrder":["头发","脸","胸"...],"sections":[{"part":"部位","sentenceCount":"1-2句","details":["细节"],"order":1}],"stockingDetail":"丝袜描写密度","characterVisualProfile":"角色视觉配置","detailFingerprints":["指纹细节"]}' },
  corruptionArc:    { label: '堕落弧线', category: '情色专属', prompt: '"corruptionArc": {"characterStates":[{"characterName":"角色名","currentState":"当前状态","originalState":"原始状态","progressionSteps":["阶梯步骤"]}],"overallTrajectory":"整体轨迹"}' },
  degradationRitual:{ label: '仪式剧本', category: '情色专属', prompt: '"degradationRitual": {"sceneTemplate":["场景→状态→惩罚→观众→升级→交媾→确认"],"punishmentTools":["工具"],"authorityEntryPattern":"权威入场","audienceInvolvement":"观众介入","surrenderConfirmation":"屈服确认句式"}' },
  narrativeVoice:   { label: '叙事声音', category: '情色专属', prompt: '"narrativeVoice": {"internalMonologueRatio":"内心独白占比","toneContrast":"极淫内容用极平淡语气写的反差","worldBuildingStyle":"世界观在性场景中插叙交代","routineCatalog":"日常流程编目句式","powerResignation":"面对不可抗力时的认命/转嫁/自我安慰"}' },
  sceneMechanics:   { label: '场景装置', category: '情色专属', prompt: '"sceneMechanics": {"sensoryCounterpoint":"性爱声音与机械/电子声音(刷卡嘀声/消息提示音/电话铃)的交织对位方式","symbolicTool":"权力交换的具体工具及其象征意义(如刷卡机=财富换快感)","recurringVisualFormula":"重复出现的视觉定型描写模板(如阿黑颜公式: 翻眼→吐舌→流涎→扭曲)"}' },
}

export interface StyleProjectMeta {
  id: string
  name: string
  sourceFileName: string
  chapterCount: number
  totalCharCount: number
  hasProfile: boolean
  createdAt: string
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
}

export function isForeshadowingEvent(e: StoryEvent): boolean {
  return e.type === 'foreshadowing' || e.type === 'payoff'
}
