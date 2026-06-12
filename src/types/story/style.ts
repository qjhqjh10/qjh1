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
  chorusPattern: string
  surrenderConfirmation: string
  sensoryCounterpoint: string
  symbolicTool: string
  recurringVisualFormula: string
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
  hierarchyStructure: string
}

export interface ShameVoyeurLoop {
  triggerPattern: string
  excitementResponse: string
  shameLayer: string
  feedbackAmplification: string
}

export interface CategorizedVocab {
  sexBody: string[]           // 性器官/体液
  roleIdentity: string[]      // 角色/身份
  actionTechnique: string[]   // 动作/技法
  sceneCostume: string[]      // 场景/装扮
  moanOnomatopoeia: string[]  // 叫床/淫叫
}

export interface DimAnalysis {
  description: string
  examples: string[]
  writingRules: string[]
  vocabularyList: string[]
  categorizedVocab?: CategorizedVocab  // AI pre-categorized vocab (v12.7+)
}

export interface ChapterAnalysis {
  sentenceStyle?: string
  vocabularyStyle?: string
  rhetoricStyle?: string
  rhythmStyle?: string
  dialogueStyle?: string
  moodStyle?: string
  perspectiveStyle?: string
  bodyLanguageStyle?: string
  sensoryStyle?: string
  tensionStyle?: string
  subtextStyle?: string
  descriptionPattern: DescriptionPattern | null
  corruptionArc: CorruptionArc | null
  degradationRitual: DegradationRitual | null
  narrativeVoice: NarrativeVoice | null
  sceneMechanics: SceneMechanics | null
  somaticTension: SomaticTension | null
  identityDissolution: IdentityDissolution | null
  shameVoyeurLoop: ShameVoyeurLoop | null
  excerpt: string
  excerptNote: string
  analyzedAt: string
  dimAnalyses?: Record<string, DimAnalysis>
  categorizedVocab?: CategorizedVocab
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
    sentenceStyle?: string
    vocabularyStyle?: string
    rhetoricStyle?: string
    rhythmStyle?: string
    dialogueStyle?: string
    moodStyle?: string
    perspectiveStyle?: string
    bodyLanguageStyle?: string
    sensoryStyle?: string
    tensionStyle?: string
    subtextStyle?: string
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
  dimAnalyses?: Record<string, DimAnalysis>
  categorizedVocab?: CategorizedVocab
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
