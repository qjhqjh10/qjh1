import type { DimAnalysis } from './story'

export type StyleTemplateType = '普通小说' | '情色小说' | '都市小说' | '修仙小说' | '武侠小说' | '恋爱小说' | '古风小说' | '悬疑小说' | '历史小说' | '科幻小说' | '穿越小说' | '玄幻小说' | '奇幻小说' | '灵异小说' | '游戏小说' | '末世小说' | '轻小说'

export interface StyleTemplate {
  id: string
  name: string
  type: StyleTemplateType
  worldType: string
  description: string
  fullDescription: string
  dimensions: Record<string, DimAnalysis>
  vocabularyList: string[]
  writingRules: string[]
  tone: { word: string; description: string; attitude: string }
  source: 'ai-generated' | 'manual'
  sourceProjectId?: string
  createdAt: string
  updatedAt: string
}

// 每种小说类型的专属维度映射
export const TYPE_EXTRA_DIMS: Record<string, string[]> = {
  '普通小说': [],
  '情色小说': ['corruptionArc', 'degradationRitual', 'narrativeVoice', 'shameVoyeurLoop'],
  '都市小说': ['socialRealism'],
  '修仙小说': ['cultivationCombat'],
  '武侠小说': ['cultivationCombat', 'archaicStyle'],
  '恋爱小说': ['romanceArc'],
  '古风小说': ['archaicStyle'],
  '悬疑小说': ['suspensePacing'],
  '历史小说': ['socialRealism', 'archaicStyle'],
  '科幻小说': ['socialRealism'],
  '穿越小说': ['socialRealism', 'cultivationCombat'],
  '玄幻小说': ['cultivationCombat', 'archaicStyle'],
  '奇幻小说': ['cultivationCombat', 'socialRealism'],
  '灵异小说': ['suspensePacing'],
  '游戏小说': ['suspensePacing'],
  '末世小说': ['socialRealism', 'suspensePacing'],
  '轻小说': [],
}

// 基础维度（17个，所有类型共用）
export const BASE_DIMS = [
  'narrativeTone', 'sentenceStyle', 'vocabularyStyle', 'rhetoricStyle',
  'rhythmStyle', 'dialogueStyle', 'moodStyle',
  'perspectiveStyle', 'bodyLanguageStyle', 'sensoryStyle',
  'tensionStyle', 'descriptionPattern',
  'compoundWordPattern', 'onomatopoeiaSystem', 'sensoryPackFormula',
  'bodyMindBetrayal', 'humiliationTemplate',
]

export function getTemplateDims(type: string): string[] {
  return [...BASE_DIMS, ...(TYPE_EXTRA_DIMS[type] || [])]
}

export function createEmptyTemplate(type: StyleTemplateType): StyleTemplate {
  return {
    id: '',
    name: '',
    type,
    worldType: '',
    description: '',
    fullDescription: '',
    dimensions: {},
    vocabularyList: [],
    writingRules: [],
    tone: { word: '', description: '', attitude: '' },
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
