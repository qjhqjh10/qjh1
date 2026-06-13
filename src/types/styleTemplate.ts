import type { DimAnalysis } from './story'
import type { CategorizedVocab } from './story/style'

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
  categorizedVocab?: CategorizedVocab
  source: 'ai-generated' | 'manual'
  sourceProjectId?: string
  createdAt: string
  updatedAt: string

  // === v12.11.0: 用户自定义字段 ===

  /** 直接编辑 tone（优先级高于 AI 填充的 tone 字段） */
  toneEditable?: {
    word: string
    description: string
    attitude: string
  }

  /** 直接编辑 fullDescription（优先级高于 AI 填充的 fullDescription） */
  fullDescriptionEditable?: string

  /** 复杂维度结构化数据（YAML 文本块，反序列化后注入 features.*） */
  complexData?: {
    descriptionPattern?: string
    corruptionArc?: string
    degradationRitual?: string
    narrativeVoice?: string
    shameVoyeurLoop?: string
  }

  /** v12.12.0: 绑定的规则模板 ID（空 = 使用硬编码默认规则） */
  ruleTemplateId?: string
}

/** v12.12.0: Prompt 规则模板 — 控制 buildStylePrompt 中 8 组硬编码段落的文本 */
export interface RuleTemplate {
  id: string
  name: string
  description: string
  type: 'erotic' | 'general'
  isSystem: boolean
  sections: {
    '感官与尺度': string
    '防范与比例': string
    '情色密度体系': string
    '语言技法': string
    '叫床与节奏': string
    '心理与叙事': string
    '身体描写规则': string
    '质量检查': string
  }
  createdAt: string
  updatedAt: string
}

// 每种小说类型的专属维度映射
export const TYPE_EXTRA_DIMS: Record<string, string[]> = {
  '普通小说': [],
  '情色小说': ['corruptionArc', 'degradationRitual', 'narrativeVoice', 'shameVoyeurLoop', 'costumeStyle'],
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
    categorizedVocab: { sexBody: [], roleIdentity: [], actionTechnique: [], sceneCostume: [], moanOnomatopoeia: [] },
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
