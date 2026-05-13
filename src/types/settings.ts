export interface ModelConfig {
  id: string
  name: string
  provider: string
  apiUrl: string
  apiKey: string
  model: string
  embeddingModel: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  inputPricePerM: number
  outputPricePerM: number
  cacheHitPricePerM: number
}

export type PromptType = '灵感' | '世界观' | '角色' | '大纲' | '细纲' | '章节' | '润色' | '续写' | '摘要' | '审稿'

export interface PromptTemplate {
  id: string
  title: string
  type: PromptType
  content: string
  enabled: boolean
}

export const PROMPT_TYPES: PromptType[] = ['灵感', '世界观', '角色', '大纲', '细纲', '章节', '润色', '续写', '摘要', '审稿']

export const DEFAULT_MODEL_CONFIG: Omit<ModelConfig, 'id' | 'name'> = {
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  embeddingModel: 'text-embedding-3-small',
  temperature: 0.8,
  maxTokens: 0,
  systemPrompt: '你是一位专业的小说写作助手，擅长文学创作、角色塑造和情节设计。请根据用户的需求提供高质量的写作建议和内容。',
  inputPricePerM: 2.50,
  outputPricePerM: 10.00,
  cacheHitPricePerM: 1.25,
}

export type ContextPriority = 'balanced' | 'kb-first' | 'model-first'

export interface AIAssistantSettings {
  defaultRole: string
  responseStyle: 'concise' | 'normal' | 'detailed'
  autoApply: boolean
  webSearchDefault: boolean
  searchResultCount: number
  safeSearch: 'strict' | 'moderate' | 'off'
  prioritySites: { id: string; url: string; description: string; category: string }[]
  monthlyBudget: number
  budgetWarning: boolean
  contextPriority: ContextPriority
  kbFileSelections: Record<string, string[]>
  customRoles: { id: string; name: string; prompt: string }[]
}

export const DEFAULT_AI_SETTINGS: AIAssistantSettings = {
  defaultRole: 'role-expert',
  responseStyle: 'normal',
  autoApply: false,
  webSearchDefault: false,
  searchResultCount: 5,
  safeSearch: 'moderate',
  prioritySites: [],
  monthlyBudget: 0,
  budgetWarning: false,
  contextPriority: 'balanced',
  kbFileSelections: {},
  customRoles: [
    { id: 'role-expert', name: '小说创作专家', prompt: '你是一位专业的小说写作助手，擅长文学创作、角色塑造和情节设计。请根据用户的需求提供高质量的写作建议和内容。' },
    { id: 'role-editor', name: '文学编辑', prompt: '你是一位资深的文学编辑，擅长发现作品中的问题并提出建设性的修改意见。请从结构、语言、人物、节奏等角度进行分析。' },
    { id: 'role-partner', name: '写作伙伴', prompt: '你是一位热情的写作伙伴，像朋友一样与作者交流想法，提供灵感碰撞和轻松愉快的创作陪伴。' },
  ],
}

export interface DisplaySettings {
  sidebarFontSize: string
  cardTitleFontSize: string
  buttonFontSize: string
  editorFontSize: string
  toolbarFontSize: string
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  sidebarFontSize: '14px',
  cardTitleFontSize: '16px',
  buttonFontSize: '15px',
  editorFontSize: '16px',
  toolbarFontSize: '12px',
}
