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
