import type { CharacterRole } from './character'

export interface PowerSystemMention {
  name: string
  levels: string
  detail: string
}

export interface ItemMention {
  name: string
  type: string
  ability: string
  owner: string
}

export interface FactionMention {
  name: string
  type: string
  detail: string
}

export interface LocationMention {
  name: string
  type: string
  detail: string
}

export type { CharacterRole }

export interface CharacterAppearance {
  name: string
  role: CharacterRole
  importance: number
  action: string
  newInfo: string
}

export interface ContinuationChapterAnalysis {
  charactersAppeared: CharacterAppearance[]
  plotEvents: string[]
  foreshadowingPlanted: string[]
  foreshadowingResolved: string[]
  worldbuildingRevealed: string[]
  powerSystemMentions: PowerSystemMention[]
  itemsMentioned: ItemMention[]
  factionsMentioned: FactionMention[]
  locationsMentioned: LocationMention[]
  emotionalTone: string
  timelinePosition: string
  chapterRole: 'setup' | 'development' | 'climax' | 'resolution' | 'transition'
  unresolvedQuestions: string[]
  // 快照数据（用于跨章节冲突检测）
  characterSnapshots: CharacterSnapshot[]
  itemSnapshots: ItemSnapshot[]
  factionSnapshots: FactionSnapshot[]
  locationSnapshots: LocationSnapshot[]
}

export interface CharacterSnapshot { name: string; alive: boolean; powerLevel: string; location: string }
export interface ItemSnapshot { name: string; status: '完好' | '损坏' | '丢失' | '传承' | '毁灭'; owner: string }
export interface FactionSnapshot { name: string; status: '活跃' | '削弱' | '覆灭' | '转型'; leader: string }
export interface LocationSnapshot { name: string; status: '存在' | '毁灭' | '废弃'; significance: string }

export interface ContinuationChapter {
  chapterNumber: number
  title: string
  content: string
  wordCount: number
  analysis?: ContinuationChapterAnalysis
}

export interface CharacterArcTracking {
  name: string
  role: CharacterRole
  importance: number
  firstAppearance: number
  lastAppearance: number
  arcType: 'growth' | 'fall' | 'flat' | 'redemption' | 'corruption' | 'unknown'
  chapters: { chapter: number; state: string; change: string }[]
  currentState: string
  unresolved: boolean
  predictedDirection: string
  personality: string
  relationships: string
}

// ⚠️ ForeshadowItem2 vs story/storyTypes.ts 的 ForeshadowItem（2026-08-11 审计结论）：
// 两者是【同概念的双形状】——ForeshadowItem2（续写分析用，chapter 数字编号）与
// ForeshadowItem（大纲/故事线用，chapterId 字符串引用）。字段语义不同（plantedChapter:
// number vs plantChapterId: string），分属续写与大纲两套数据模型，【刻意分开，不要合并】。
// 若未来两套模型统一，需同时迁移 continuation 分析管线与大纲结构化数据，勿只改类型。
export interface ForeshadowItem2 {
  id: string
  description: string
  plantedChapter: number
  resolvedChapter?: number
  resolved: boolean
  predictedResolution: string
}

export interface TimelineEvent {
  chapter: number
  event: string
  type: 'main' | 'sub' | 'character' | 'worldbuilding'
}

export interface StoryUnderstanding {
  characterArcs: CharacterArcTracking[]
  mainPlot: string
  subPlots: string[]
  foreshadowingChain: ForeshadowItem2[]
  worldRules: string[]
  powerSystemFinal: { name: string; levels: string; description: string }
  keyItemsFinal: { name: string; type: string; ability: string; owner: string; status: string }[]
  factionsFinal: { name: string; type: string; status: string; relationships: string }[]
  locationsFinal: { name: string; type: string; significance: string }[]
  foreshadowingUnresolved: { description: string; plantedChapter: number; predictedResolution: string }[]
  timeline: TimelineEvent[]
  unresolvedQuestions: string[]
  storyStructure: 'threeAct' | 'fiveAct' | 'episodic' | 'other'
  currentStage: string
  continuationSuggestions: string[]
}

export interface ContinuationOutline {
  structure: string
  estimatedChapters: number
  acts: { name: string; chapterRange: string; summary: string; keyEvents: string[] }[]
  majorTurningPoints: { name: string; chapter: number; description: string }[]
  ending: { type: 'happy' | 'tragic' | 'open' | 'bittersweet'; description: string }
}

// ====================== Outline Merge (Step 5) ======================

export interface OutlineMergeCharacter {
  name: string
  role: CharacterRole
  originalStatus: string
  newStatus: string
  arc: string
  ending: string
}

export interface OutlineMergeItem {
  name: string
  type: string
  ability: string
  owner: string
  previousStatus: string
  newStatus: string
  newAbility: string
}

export interface OutlineMergeFaction {
  name: string
  type: string
  previousStatus: string
  newStatus: string
  agenda: string
}

export interface OutlineMergeLocation {
  name: string
  type: string
  description: string
  significance: string
}

export interface OutlineMergePowerSystem {
  name: string
  originalLevels: string
  newLevels: string
  newRules: string
}

export interface OutlineMergeForeshadowing {
  description: string
  plantChapter: string
  predictedResolution: string
}

export interface OutlineMergeThread {
  name: string
  type: 'main' | 'sub' | 'hidden'
  description: string
}

export interface OutlineMergeData {
  basicSettingUpdate: string
  newWorldRules: string[]
  existingWorldRules: string[]
  characters: OutlineMergeCharacter[]
  items: OutlineMergeItem[]
  factions: OutlineMergeFaction[]
  newLocations: OutlineMergeLocation[]
  powerSystem: OutlineMergePowerSystem[]
  newForeshadowing: OutlineMergeForeshadowing[]
  newPlotThreads: OutlineMergeThread[]
}

// ====================== Plot Direction (Step 4) ======================

export interface PlotDirectionSegment {
  id: string
  content: string
  label: string
  generatedAt: string
}

// ====================== Step 5-7 types ======================

export interface ContinuationChapterPlan {
  relativeChapterNumber: number
  order: number
  tentativeTitle: string
  plotPoints: string[]
  characterFocus: string[]
  foreshadowToResolve: string[]
  foreshadowToPlant: string[]
  wordTarget: number
}

export interface ContinuationPlan {
  estimatedRemainingChapters: number
  chapterPlans: ContinuationChapterPlan[]
  overallDirection: string
  majorTwists: string[]
  endingType: 'happy' | 'tragic' | 'open' | 'bittersweet' | 'undetermined'
}

export interface ContinuationWrittenChapter {
  chapterNumber: number
  title: string
  content: string
  plan: ContinuationChapterPlan
  generatedAt: string
}

export interface ContinuationProject {
  id: string
  name: string
  sourceFileName: string
  sourceChapters: ContinuationChapter[]
  storyUnderstanding?: StoryUnderstanding
  plotDirection?: PlotDirectionSegment[]
  outlineMerge?: OutlineMergeData
  continuationOutline?: ContinuationOutline
  continuationPlan?: ContinuationPlan
  writtenChapters: ContinuationWrittenChapter[]
  styleTemplateId?: string
  status: 'imported' | 'analyzing' | 'analyzed' | 'outlining' | 'merged' | 'planned' | 'writing'
  createdAt: string
  updatedAt: string
}

// 续写分析维度定义
export const CONTINUATION_DIMS = [
  { key: 'charactersAppeared', label: '出场角色', category: '基础' },
  { key: 'plotEvents', label: '关键事件', category: '基础' },
  { key: 'foreshadowingPlanted', label: '新埋伏笔', category: '伏笔' },
  { key: 'foreshadowingResolved', label: '回收伏笔', category: '伏笔' },
  { key: 'worldbuildingRevealed', label: '世界观信息', category: '基础' },
  { key: 'powerSystemMentions', label: '等级体系', category: '进阶' },
  { key: 'itemsMentioned', label: '道具提及', category: '进阶' },
  { key: 'factionsMentioned', label: '势力提及', category: '进阶' },
  { key: 'locationsMentioned', label: '地点提及', category: '基础' },
  { key: 'emotionalTone', label: '情绪基调', category: '基础' },
  { key: 'timelinePosition', label: '时间线定位', category: '进阶' },
  { key: 'chapterRole', label: '章节角色', category: '基础' },
  { key: 'unresolvedQuestions', label: '未解问题', category: '进阶' },
] as const

export type ContinuationDimKey = (typeof CONTINUATION_DIMS)[number]['key']
