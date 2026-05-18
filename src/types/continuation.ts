export interface ContinuationChapterAnalysis {
  charactersAppeared: { name: string; action: string; newInfo: string }[]
  plotEvents: string[]
  foreshadowingPlanted: string[]
  foreshadowingResolved: string[]
  worldbuildingRevealed: string[]
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
  firstAppearance: number
  lastAppearance: number
  arcType: 'growth' | 'fall' | 'flat' | 'redemption' | 'corruption' | 'unknown'
  chapters: { chapter: number; state: string; change: string }[]
  currentState: string
  unresolved: boolean
  predictedDirection: string
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

export interface InferredOutline {
  structure: string
  currentStage: string
  estimatedTotalChapters: number
  remainingChapters: number
  acts: { name: string; chapterRange: string; summary: string }[]
  keyTurningPoints: { name: string; chapter: number; description: string }[]
}

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
  continuationOutline?: ContinuationOutline
  continuationPlan?: ContinuationPlan
  writtenChapters: ContinuationWrittenChapter[]
  styleTemplateId?: string
  status: 'imported' | 'analyzing' | 'analyzed' | 'planning' | 'planned' | 'writing'
  createdAt: string
  updatedAt: string
}
