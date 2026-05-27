import type { PacingTemplate, EventPattern, ProgressionRhythm, CharacterArchetype, EmotionCurve } from './storyTypes'
import type { StyleChapter, StyleProfile } from './style'

// ---- Novel Extraction System ----

export interface ExtractedCharacterRaw {
  name: string; aliases: string[]; role: string; traits: string[]
  appearance: string; action: string; newInfo: string
}

export interface ExtractedWorldElement {
  type: 'location' | 'faction' | 'rule' | 'history' | 'other'
  name: string; description: string; newInfo: string
}

export interface ExtractedItem {
  name: string; type: string; grade: string; owner: string
  ability: string; firstChapter: number; acquisitionMethod: string
}

export interface ExtractedPowerMention {
  term: string; context: string; inferredLevel: number
}

export interface ExtractedForeshadow {
  description: string; type: 'planted' | 'resolved'; relatedChapter?: number
}

export interface EroticExtractionData {
  characterRoles: { name: string; domSub: string; bodyState: string; kinks: string[]; shameLevel: string }[]
  sceneFlow: { phase: string; actions: string[]; bodyReactions: string[]; duration: string }[]
  techniques: { bodyFluids: string[]; touchFocus: string[]; soundStyle: string; moanDensity: string }
  powerDynamics: string
  degradationPatterns: string[]
}

export interface ChapterExtraction {
  chapterId: string; chapterNumber: number; chapterTitle: string; chapterContent: string
  chapterType: StyleChapter['chapterType']
  characters: ExtractedCharacterRaw[]; worldbuilding: ExtractedWorldElement[]
  items: ExtractedItem[]; powerSystem: ExtractedPowerMention[]
  chapterSummary: string; events: string[]
  foreshadowing: ExtractedForeshadow[]; emotionalTone: string
  erotic?: EroticExtractionData
  extractedAt: string
}

export interface AggregatedCharacter {
  name: string; aliases: string[]; role: string; traits: string[]
  appearance: string; background: string; arc: string
  firstChapter: number; lastChapter: number
  relationships: { target: string; type: string; evolution: string; chapters: number[] }[]
}

export interface AggregatedResult {
  characters: AggregatedCharacter[]
  worldbuilding: { locations: ExtractedWorldElement[]; factions: ExtractedWorldElement[]; rules: ExtractedWorldElement[]; history: string }
  items: ExtractedItem[]
  powerSystem: { name: string; levels: string[]; description: string }
  foreshadowing: { description: string; plantChapter: number; payoffChapter: number | null; status: 'planted' | 'resolved' }[]
  eroticStats?: {
    eroticChapterCount: number
    totalChapters: number
    mainEroticChars: string[]
    commonKinks: string[]
    commonFluids: string[]
    commonTouchFocus: string[]
    degradationPatterns: string[]
  }
}

export interface PlotStructure {
  acts: { name: string; chapters: number[]; summary: string }[]
  turningPoints: { chapter: number; type: string; desc: string }[]
  plotThreads: { name: string; type: string; chapters: number[] }[]
}

export interface GeneratedDetailedOutline {
  chapterNumber: number; title: string; summary: string
  charactersAppearing: string[]; keyEvents: string[]; emotionalTone: string
}

export interface GeneratedNovel {
  outline: string
  detailedOutlines: GeneratedDetailedOutline[]
  characters: { name: string; role: string; traits: string[]; background: string }[]
  worldbuilding: string
  powerSystem: { name: string; levels: string[]; description: string }
  generatedAt: string
}

export interface DetailGenResult {
  chapterNumber: number; title: string; summary: string
  charactersAppearing: string[]; levelChange: string; itemsUsed: string[]
  location: string; foreshadowingOps: string[]; keyEvents: string[]
  emotionalTone: string; eroticScene: string
}

export interface NovelExtraction {
  id: string; novelName: string; sourceFileName: string; novelType: string
  chapters: ChapterExtraction[]
  aggregated: AggregatedResult | null; plotStructure: PlotStructure | null
  styleProfile: StyleProfile | null; pacingTemplate: PacingTemplate | null
  eventPattern: EventPattern | null; progressionRhythm: ProgressionRhythm | null
  characterArchetype: CharacterArchetype | null; emotionCurve: EmotionCurve | null
  generatedNovel: GeneratedNovel | null
  outlineResults?: Record<string, string>
  detailsResults?: string
  detailGenResults?: DetailGenResult[]
  chapterContents?: Record<string, string>
  status: 'draft' | 'extracting' | 'aggregated' | 'completed'
  createdAt: string; updatedAt: string
}
