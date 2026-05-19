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

export type CharacterRole = '男主' | '女主' | '男配' | '女配' | '反派' | '其他'

export interface CharacterAppearance {
  name: string
  role: CharacterRole
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
}

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

// ====================== Step 4-7 types ======================

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
  plotDirection?: string
  outlineMerge?: OutlineMergeData
  continuationOutline?: ContinuationOutline
  continuationPlan?: ContinuationPlan
  writtenChapters: ContinuationWrittenChapter[]
  styleTemplateId?: string
  status: 'imported' | 'analyzing' | 'analyzed' | 'outlining' | 'merged' | 'planned' | 'writing'
  createdAt: string
  updatedAt: string
}
