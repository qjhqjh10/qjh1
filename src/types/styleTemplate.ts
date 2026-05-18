import type { DimAnalysis } from './story'

export interface StyleTemplate {
  id: string
  name: string
  type: '情色小说' | '普通小说'
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

export function createEmptyTemplate(type: '情色小说' | '普通小说'): StyleTemplate {
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
