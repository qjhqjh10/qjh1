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
  contextWindow?: number
  systemPrompt: string
  reasoningEffort?: 'min' | 'low' | 'medium' | 'high' | 'max'
  inputPricePerM: number
  outputPricePerM: number
  cacheHitPricePerM: number
  currency: 'USD' | 'CNY'
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
  contextWindow: 128000,
  systemPrompt: '你是一位专业的小说写作助手，擅长文学创作、角色塑造和情节设计。请根据用户的需求提供高质量的写作建议和内容。',
  inputPricePerM: 2.50,
  outputPricePerM: 10.00,
  cacheHitPricePerM: 1.25,
  currency: 'USD',
}

export type ContextPriority = 'balanced' | 'kb-first' | 'model-first'

export interface OutlineTabToggles {
  plot: boolean
  worldbuilding: boolean
  characters: boolean
  items: boolean
  locations: boolean
  factions: boolean
  powerSystem: boolean
  foreshadowing: boolean
  emotion: boolean
  plotThreads: boolean
}

export interface DetailedOutlineToggles {
  plotOverview: boolean
  chapterCharacters: boolean
  location: boolean
  keyEvents: boolean
  eroticContent: boolean
}

export interface ChapterGenSettings {
  outlineTabs: OutlineTabToggles
  detailedOutlineFields: DetailedOutlineToggles
  wordTarget: number
  streamMode: boolean
  replaceMode: boolean
  selectedSceneId: string
  selectedStyleTemplateId: string
  selectedCharacterIds: string[]
  selectedSummaryIds: string[]
  styleStrength: 'light' | 'normal' | 'strong'
  selectedKbFileIds: string[]
}

export const DEFAULT_OUTLINE_TABS: OutlineTabToggles = {
  plot: true,
  worldbuilding: true,
  characters: true,
  items: false,
  locations: false,
  factions: false,
  powerSystem: false,
  foreshadowing: false,
  emotion: false,
  plotThreads: false,
}

export const DEFAULT_DETAILED_OUTLINE_TOGGLES: DetailedOutlineToggles = {
  plotOverview: true,
  chapterCharacters: true,
  location: true,
  keyEvents: true,
  eroticContent: false,
}

export const DEFAULT_CHAPTER_GEN: ChapterGenSettings = {
  outlineTabs: { ...DEFAULT_OUTLINE_TABS },
  detailedOutlineFields: { ...DEFAULT_DETAILED_OUTLINE_TOGGLES },
  wordTarget: 4000,
  streamMode: false,
  replaceMode: true,
  selectedSceneId: '',
  selectedStyleTemplateId: '',
  selectedCharacterIds: [],
  selectedSummaryIds: [],
  selectedKbFileIds: [],
  styleStrength: 'normal',
}

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
  styleAssignments: Record<string, string>  // targetProjectId → styleProjectId
  workMode: 'plan' | 'action'               // Plan=只读分析 Action=全部工具
  userAvatar: string                         // 用户头像 base64 data URI (空字符串=默认emoji)
  assistantAvatar: string                    // AI助手头像 base64 data URI (空字符串=默认emoji)
  chapterGen: ChapterGenSettings
  showWelcome: boolean                        // 是否显示新会话欢迎信息
  maxHistory: number                          // 对话历史保留条数 (10-500)
  toolRetentionRounds: number                 // 工具结果跨轮保留轮数 (0-10)
  rulesRefreshInterval: number                // 核心规则复述间隔 (0-100, 0=不重复)
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
  styleAssignments: {},
  workMode: 'action',
  userAvatar: '',
  assistantAvatar: '',
  chapterGen: DEFAULT_CHAPTER_GEN,
  showWelcome: true,
  maxHistory: 100,
  toolRetentionRounds: 3,
  rulesRefreshInterval: 31,
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
  theme: 'light' | 'dark'
}

export interface ProviderPreset { name: string; label: string; apiUrl: string }

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: 'deepseek', label: 'DeepSeek（深度求索）', apiUrl: 'https://api.deepseek.com' },
  { name: 'openai', label: 'OpenAI', apiUrl: 'https://api.openai.com/v1' },
  { name: 'azure', label: 'Azure OpenAI', apiUrl: 'https://YOUR-RESOURCE.openai.azure.com' },
  { name: 'anthropic', label: 'Anthropic（Claude）', apiUrl: 'https://api.anthropic.com' },
  { name: 'zhipu', label: '智谱AI（GLM）', apiUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: 'qwen', label: '通义千问（阿里云）', apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: 'moonshot', label: 'Moonshot（月之暗面）', apiUrl: 'https://api.moonshot.cn/v1' },
  { name: 'baidu', label: '百度文心一言', apiUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop' },
  { name: 'siliconflow', label: '硅基流动（SiliconFlow）', apiUrl: 'https://api.siliconflow.cn/v1' },
  { name: 'local', label: '本地模型（Ollama/LocalAI）', apiUrl: 'http://localhost:11434/v1' },
]

export const DEFAULT_PROMPTS: PromptTemplate[] = [
  {
    id: 'default_chapter',
    title: '默认章节模板',
    type: '章节',
    content: '根据以上设定和细纲，写出一章完整的小说正文。注意人物性格一致性，对话符合角色身份，描写生动具体，情节推进自然。\n\n格式要求：每个自然段之间必须用空行分隔（两个换行），段落不宜过长（3-8行）。角色切换、场景转换时必须另起一段。禁止全文一堆到底。',
    enabled: true,
  },
  {
    id: 'default_chapter_erotic',
    title: '情色章节模板',
    type: '章节',
    content: '根据以上设定和细纲，写出一章包含完整情色场景的小说正文。要求：\n1. 权力关系在性爱互动中通过对话、动作、心理活动充分展现\n2. 角色身体状态随性爱进程逐步变化（从紧张/抗拒到失控/沉沦）\n3. 性爱流程完整：挑逗→前戏→渐进→主戏→高潮→余韵，每阶段有具体的动作描写和身体反应\n4. 运用感官描写：体液、触感、声音（呼吸/呻吟/哭喊）、视觉（身体姿态/表情）\n5. 羞耻与兴奋的心理交替循环：触发→兴奋→羞耻→反馈放大→更深的沉沦\n6. 剧情与情色有机融合，情色场景推动角色关系和情节发展，不为写情色而写情色\n7. 文笔保持原作水准，情色描写有文学性而非低俗\n8. 正文用空行分隔自然段，段落长度自由，禁止全文一堆到底',
    enabled: false,
  },
  {
    id: 'default_character',
    title: '默认角色模板',
    type: '角色',
    content: '请根据以下信息生成一个完整的角色设定。包括：姓名、性别、年龄、身份/职业、外貌描写、性格特征（至少3个）、特殊能力（如有）、背景故事、与其他角色的关系。',
    enabled: true,
  },
  {
    id: 'default_outline',
    title: '默认大纲模板',
    type: '大纲',
    content: '请根据以下设定生成一份小说大纲。包括：故事主线（起因-发展-转折-高潮-结局）、主要角色弧线、世界观核心设定、关键事件节点。',
    enabled: false,
  },
  {
    id: 'default_summary',
    title: '默认摘要模板',
    type: '摘要',
    content: '请用简洁的语言总结以下章节内容的核心情节、人物发展和关键转折点。',
    enabled: true,
  },
  {
    id: 'default_worldbuilding',
    title: '默认世界观模板',
    type: '世界观',
    content: '你是一位专业的世界观设定设计师，擅长构建小说中的世界观体系。请帮助作者完善世界背景设定，包括但不限于：地理环境、政治体制、社会结构、魔法/科技体系、历史背景、文化习俗等。设定应逻辑自洽、细节丰富，并能服务于故事主线。',
    enabled: true,
  },
  {
    id: 'default_detailed_outline',
    title: '默认细纲模板',
    type: '细纲',
    content: '你是一位专业的小说结构规划师，擅长设计章节级别的详细写作大纲。请帮助作者规划章节内容，包括：本章核心情节、场景设置、人物出场安排、关键对话节点、情感发展和节奏控制。细纲应具体可执行，每项内容应有明确的写作目标。',
    enabled: true,
  },
  {
    id: 'default_polish',
    title: '默认润色模板',
    type: '润色',
    content: '请润色以下文字，优化表达、修正语病、提升文采，但保持原意不变。',
    enabled: true,
  },
  {
    id: 'default_continue',
    title: '默认续写模板',
    type: '续写',
    content: '请根据以下内容自然续写，保持风格一致。注意保持人物性格、叙事节奏和语言风格的连贯性。',
    enabled: true,
  },
  {
    id: 'default_review',
    title: '默认审稿模板',
    type: '审稿',
    content: `你是专业文学编辑，请对以下章节进行审稿。请从以下角度分析，并在评论结束后务必附上评分摘要：

1. 节奏 — 情节推进是否合理，有无拖沓或仓促
2. 对白 — 人物对话是否符合角色特点，是否自然
3. 描写 — 场景、动作、心理描写是否生动
4. 情节一致性 — 与前文设定是否存在矛盾

请按以下格式输出评分摘要（放在审稿末尾）：

--- 评分摘要 ---
总分: X/10
节奏: X/10 | <一句话评价>
对白: X/10 | <一句话评价>
描写: X/10 | <一句话评价>
情节一致性: X/10 | <一句话评价>`,
    enabled: true,
  },
]

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  sidebarFontSize: '14px',
  cardTitleFontSize: '16px',
  buttonFontSize: '15px',
  editorFontSize: '16px',
  toolbarFontSize: '12px',
  theme: 'light',
}
