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
  customPoses: string[]; customRhythms: string[]; customPOVs: string
  customOpening: string[]; customClimax: string[]; customAftermath: string[]
  customDegradeLangs: string[]
  bodyFluidFocus: string[]; bodyPartFocus: string[]; tactileFocus: string[]
  narrativeStyle: string; timeCompression: string; introspection: string; sensoryAnchors: string
  dominantEmotion: string; emotionCurveInput: string; triggerWords: string
  worldRules: string; propList: string; costumeList: string
  customExtraNotes: string; customEmotions: string; customCurves: string; customTriggers: string
  customWorldRules: string; customPropLists: string; customCostumeLists: string
  customPoseChanges: string; customSoundDensity: string; customMoanStyle: string
  pacing: string; bodyLanguage: string; consentDynamic: string; aftercareDetail: string
  autoFields: Record<string, boolean>
}

export type SceneTemplateType = '普通小说' | '情色小说' | '都市小说' | '修仙小说' | '武侠小说' | '恋爱小说' | '古风小说' | '悬疑小说' | '历史小说' | '科幻小说' | '穿越小说'

export interface SceneTemplate {
  id: string; name: string; type: SceneTemplateType; config: EroticSceneConfig | NovelSceneConfig; createdAt: string
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
  narrativeStyle: string; timeCompression: string; introspection: string
  sensoryAnchors: string
  dominantEmotion: string; emotionCurveInput: string; pacing: string
  props: string; appearance: string; bodyLanguage: string
  foreshadowUse: string; sceneTurningPoint: string
  autoFields: Record<string, boolean>
}

// Per-chapter scene configuration
export interface ChapterSceneConfig {
  chapterId: string
  chapterTitle: string
  eroticScene: EroticSceneConfig | null
  novelScene: NovelSceneConfig | null
  updatedAt: string
}
