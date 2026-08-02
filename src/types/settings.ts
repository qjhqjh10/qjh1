/**
 * 模型配置 — 一个配置包含 Main 模型 + Image 图片模型 + Embedding 嵌入模型
 * AI写作助手使用 Main 模型进行对话和工具调用
 */
export interface ModelConfig {
  id: string
  name: string
  provider: string                // Main 默认提供商
  apiUrl: string                  // Main 默认 API 地址
  apiKey: string                  // Main 默认 API 密钥 (明文存储, v13.x 决策)
  encrypted?: boolean

  // ── 💪 Main 模型 ──
  model: string                   // 主力模型名 (如 deepseek-chat / gpt-4o)
  temperature: number
  maxTokens: number               // 0=使用模型默认最大值
  contextWindow?: number          // 上下文窗口大小 (如 128000)
  protocol?: 'openai' | 'anthropic'  // API 协议：openai (默认) 或 anthropic (流式 content blocks)
  enableThinking?: boolean          // v11.4: 启用 DeepSeek V4 深度推理 (thinking mode)
  reasoningEffort?: 'high' | 'max'  // v11.4: 推理强度 (默认 max，简单对话可降为 high)
  toolTemperature?: number          // v12.5.1: 工具执行轮温度上限 (默认 0.5，仅深度推理关闭时生效)
  nativeWebSearch?: boolean         // v14.8: 模型支持原生联网搜索（DeepSeek v4-flash 经 Responses API 服务端搜索）。勾选后 AI 写作助手自动停用软件内置联网搜索，保持单一联网通道
  mainProvider?: string
  mainApiUrl?: string
  mainApiKey?: string

  // ── Main 定价 ──
  inputPricePerM: number
  outputPricePerM: number
  cacheHitPricePerM: number
  mainCurrency?: 'USD' | 'CNY'

  // ── 🎨 Image 图片模型 ──
  imageModel: string              // 图片生成模型 (如 dall-e-3, 留空=禁用)
  imageProvider: string
  imageApiUrl: string
  imageApiKey: string
  imageEncrypted?: boolean
  imageInputPricePerM: number     // DALL-E按图计费，填每张价格
  imageOutputPricePerM: number

  // ── 📚 知识库 Embedding (不调用 API，本地计算) ──
  embeddingModel: string
  embeddingApiUrl?: string
  embeddingApiKey?: string

  currency: 'USD' | 'CNY'
}

export type PromptType = '角色' | '章节' | '续写' | '改写' | '摘要' | '审稿'

export interface PromptTemplate {
  id: string
  title: string
  type: PromptType
  content: string
  enabled: boolean
}

export const PROMPT_TYPES: PromptType[] = ['角色', '章节', '续写', '改写', '摘要', '审稿']

export const DEFAULT_MODEL_CONFIG: Omit<ModelConfig, 'id' | 'name'> = {
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  // Main
  model: 'gpt-4o',
  temperature: 1.0,  // v12.5.1: 创作温度升高到 1.0 — 深度推理关闭时保持创意自由度、工具执行轮由 toolTemperature 控制
  maxTokens: 0,
  contextWindow: 128000,
  protocol: 'openai' as const,
  enableThinking: true,             // v11.4: 默认启用深度推理
  reasoningEffort: 'max' as const,  // v11.4: 默认最大推理强度
  toolTemperature: 0.5,            // v12.5.1: 工具执行轮温度上限
  nativeWebSearch: false,          // v14.8: 默认不使用模型原生联网
  inputPricePerM: 2.50,
  outputPricePerM: 10.00,
  cacheHitPricePerM: 1.25,
  // Image
  imageModel: '',
  imageProvider: '',
  imageApiUrl: '',
  imageApiKey: '',
  imageInputPricePerM: 0,
  imageOutputPricePerM: 0,
  // Embedding
  embeddingModel: 'text-embedding-3-small',
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
  // 前文注入
  prevTextEnabled: boolean
  prevTextSourceChapterId: string   // 空=自动选 N-1
  prevTextSelectedContent: string   // 用户鼠标选中的原文
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
  streamMode: true,
  replaceMode: true,
  selectedSceneId: '',
  selectedStyleTemplateId: '',
  selectedCharacterIds: [],
  selectedSummaryIds: [],
  selectedKbFileIds: [],
  styleStrength: 'normal',
  prevTextEnabled: true,
  prevTextSourceChapterId: '',
  prevTextSelectedContent: '',
}

// ── 多角色系统 (v13.0) ──
// 借鉴 SillyTavern 酒馆的角色卡片 + 群组架构

/** 角色卡片 — 借鉴酒馆 Character Card */
export interface CharacterCard {
  id: string
  name: string                    // 姓名
  identity: string                // 身份：男主/女主/男配/女配/反派/路人/自定义
  gender: '男' | '女'
  personality: string             // 性格/背景设定（酒馆 description + personality 合并）
  avatar: string                  // 头像文件路径 (空字符串=默认emoji)
  relationship: string            // 与用户/其他角色的关系
  isUser: boolean                 // true=用户扮演, false=AI扮演
  firstMessage?: string           // 开场白（借鉴酒馆 first_mes）
  exampleDialogue?: string        // 示例对话（借鉴酒馆 mes_example，帮助AI把握语气）
}

/** 角色模板 — 借鉴酒馆 Group + World Info */
export interface RoleTemplate {
  id: string
  name: string                    // 模板名称，如"双人写作"
  characters: CharacterCard[]     // 角色卡片列表（最少1个用户+1个AI角色）
  worldSetting: string            // 世界观背景（借鉴酒馆 World Info 常开条目）
  scenarioSetting: string         // 场景/对话补充设定
}

export const CHARACTER_IDENTITIES = ['男主', '女主', '男配', '女配', '反派', '路人', '自定义'] as const

/** 创建默认角色卡片 */
export function createDefaultCharacter(isUser: boolean, name: string, identity: string): CharacterCard {
  return {
    id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    identity,
    gender: '男',
    personality: isUser ? '' : '一位专业的写作助手，擅长文学创作与角色塑造。',
    avatar: '',
    relationship: isUser ? '' : '写作搭档',
    isUser,
    firstMessage: isUser ? undefined : '你好！我是你的写作助手，很高兴能与你一起创作。',
    exampleDialogue: '',
  }
}

/** 创建默认角色模板 */
export function createDefaultRoleTemplate(name?: string): RoleTemplate {
  return {
    id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: name || '双人写作',
    characters: [
      createDefaultCharacter(true, '写作者', '作者'),
      createDefaultCharacter(false, '写作助手', '助手'),
    ],
    worldSetting: '',
    scenarioSetting: '',
  }
}

// ── 知识库设置 (v13.x) ──

/** 单个场景的知识库注入参数 */
export interface KBSceneSettings {
  /** 语义检索片段数（默认 5） */
  searchTopK: number
  /** 全量注入降级时每文件最多字符（默认 5000） */
  fallbackPerFileMaxChars: number
  /** 全量注入降级时总字符上限（默认 10000） */
  fallbackTotalMaxChars: number
}

/**
 * 知识库设置 — 按场景分开配置：
 * - agent:     AI 写作助手（每轮语义检索 topK + 降级全量注入）
 * - generation: 章节生成 / 批量生成 / AI 生成角色（检索 maxChunks + 降级全量注入）
 */
export interface KBSettings {
  agent: KBSceneSettings
  generation: KBSceneSettings
}

export const DEFAULT_KB_SCENE: KBSceneSettings = {
  searchTopK: 5,
  fallbackPerFileMaxChars: 5000,
  fallbackTotalMaxChars: 10000,
}

export const DEFAULT_KB_SETTINGS: KBSettings = {
  agent: { ...DEFAULT_KB_SCENE },
  generation: { ...DEFAULT_KB_SCENE },
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
  customRoles: { id: string; name: string; prompt: string }[]   // @deprecated v13.0 — 迁移到 roleTemplates
  styleAssignments: Record<string, string>  // targetProjectId → styleProjectId
  workMode: 'plan' | 'action'               // Plan=只读分析 Action=全部工具
  userAvatar: string                         // @deprecated v13.0 — 迁移到角色卡片头像
  assistantAvatar: string                    // @deprecated v13.0 — 迁移到角色卡片头像
  chapterGen: ChapterGenSettings
  showWelcome: boolean                        // 是否显示新会话欢迎信息
  useAgent: boolean                            // 启用 Agent 模式（替代旧 handleSend）
  // v13.0: 多角色系统
  roleTemplates: RoleTemplate[]               // 角色模板列表
  activeRoleTemplateId: string                // 当前激活的角色模板ID
  kbSettings: KBSettings                       // v13.x: 知识库设置
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
  useAgent: false,
  customRoles: [
    { id: 'role-expert', name: '小说创作专家', prompt: '你是一位专业的小说写作助手，擅长文学创作、角色塑造和情节设计。主动探索项目素材，大胆创作，果断使用 create_file。不确定时先读文件再动手，但不要停留在询问阶段。' },
    { id: 'role-editor', name: '文学编辑', prompt: '你是一位资深的文学编辑，擅长发现作品中的问题并提出建设性的修改意见。先 read_file 审读作品，从结构、语言、人物、节奏等角度输出分析。修改时用 edit_file 精确替换，而非全量重写。' },
    { id: 'role-partner', name: '写作伙伴', prompt: '你是一位热情的写作伙伴，像朋友一样与作者交流想法，提供灵感碰撞和轻松愉快的创作陪伴。多提问、多鼓励，帮助作者理清思路。只在用户明确要求时才操作文件——你的首要任务是激发灵感，而非代笔。' },
  ],
  // v13.0: 多角色系统 — 默认一个"双人写作"模板
  roleTemplates: [],
  activeRoleTemplateId: '',
  kbSettings: { ...DEFAULT_KB_SETTINGS },
}

export type ThemeId = 'warm-purple' | 'cyberpunk' | 'steampunk' | 'british' | 'ink-wash' | 'neon-dark'

export interface DisplaySettings {
  sidebarFontSize: string
  cardTitleFontSize: string
  buttonFontSize: string
  editorFontSize: string
  toolbarFontSize: string
  theme: ThemeId
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
  { name: 'lmstudio', label: 'LM Studio（本地）', apiUrl: 'http://localhost:1234/v1' },
  { name: 'local', label: '本地模型（Ollama/LocalAI）', apiUrl: 'http://localhost:11434/v1' },
]

/** 图片模型专用服务商 — 仅列出支持 OpenAI Images API（/v1/images/generations）的服务商 */
export const IMAGE_PROVIDER_PRESETS: ProviderPreset[] = [
  { name: 'openai', label: 'OpenAI（DALL-E 2/3）', apiUrl: 'https://api.openai.com/v1' },
  { name: 'azure', label: 'Azure OpenAI（DALL-E）', apiUrl: 'https://YOUR-RESOURCE.openai.azure.com' },
  { name: 'siliconflow', label: '硅基流动（FLUX / SD）', apiUrl: 'https://api.siliconflow.cn/v1' },
  { name: 'together', label: 'Together AI（FLUX / SDXL）', apiUrl: 'https://api.together.xyz/v1' },
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
    id: 'default_summary',
    title: '默认摘要模板',
    type: '摘要',
    content: '请用简洁的语言总结以下章节内容的核心情节、人物发展和关键转折点。',
    enabled: true,
  },
  {
    id: 'default_polish',
    title: '轻度润色模板',
    type: '改写',
    content: '请润色以下文字，优化表达、修正语病、提升文采，但保持原意不变，不增删内容。',
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
    id: 'default_rewrite',
    title: '默认改写模板',
    type: '改写',
    content: '请改写以下文字，在保持原意和风格不变的前提下，优化表达、丰富细节、提升文采。改写后的内容应与原文风格一致但表达更出色。',
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
  theme: 'warm-purple',
}
