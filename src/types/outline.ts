export interface OutlineItem {
  id: string
  name: string
  type: string
  grade?: string
  ability?: string
  owner?: string
  description?: string
}

export interface OutlineLocation {
  id: string
  name: string
  description: string
  type?: string
}

export interface OutlineFaction {
  id: string
  name: string
  description: string
  type?: string
}

export interface PowerLevel {
  name: string
  description: string
}

export interface PowerSystem {
  name: string
  levels: PowerLevel[]
  description: string
}

export interface EmotionSegment {
  chapterStart: number
  chapterEnd: number
  dominantEmotion: string
}

export interface EmotionData {
  segments: EmotionSegment[]
}

export interface OutlineItemsData {
  items: OutlineItem[]
}

export interface OutlineLocationsData {
  locations: OutlineLocation[]
}

export interface OutlineFactionsData {
  factions: OutlineFaction[]
}

export interface OutlineContentData {
  content: string
  updatedAt: string
}

export interface WorldbuildingContentData {
  content: string
  updatedAt: string
}
