// ── Skill System Types v1 ──
// 技能系统核心类型定义。
// 设计原则：
//   1. Skill 封装多步工具链，对外暴露为单个高级操作
//   2. Skill 和 Tool 共存，模型可自行选择用 Skill 还是原子 Tool
//   3. 扩展接口留好：任何实现 SkillSource 的外部系统都可以注入技能

// ═══════════════════════════════════════════════════
//  工具相关（自包含，不依赖旧 tools/）
// ═══════════════════════════════════════════════════

export interface ToolResult {
  status: 'success' | 'error' | 'pending_confirm'
  summary: string
  detail?: string
}

export interface ToolExecutionContext {
  projectId: string | null
  configId: string
  callId: string
  toolName: string
  signal: AbortSignal
}

export interface ToolDefinition {
  schema: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string; properties?: Record<string, { type: string }> } }>
      required: string[]
    }
  }
  permission: 'AUTO' | 'READ_ASK' | 'PROJECT_ASK' | 'DANGEROUS_ASK'
  category: 'file' | 'kb' | 'note' | 'image' | 'template' | 'project' | 'prompt' | 'harness' | 'http' | 'browser' | 'shell' | 'lsp'
  availableInPlanMode: boolean
  executor: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>
}

// ═══════════════════════════════════════════════════
//  技能相关（核心）
// ═══════════════════════════════════════════════════

export type SkillCategory =
  | 'character'       // 角色管理
  | 'outline'         // 大纲创作
  | 'chapter'         // 章节创作
  | 'style'           // 风格模板
  | 'scene'           // 场景模板
  | 'knowledge'       // 知识库
  | 'note'            // 笔记
  | 'project'         // 项目管理
  | 'review'          // 审稿/审查
  | 'continuation'    // 续写
  | 'imitation'       // 仿写
  | 'general'         // 通用

/** 技能工作流中的单个步骤 */
export interface SkillStep {
  order: number
  tool: string                      // 工具名（字符串引用）
  purpose: string                   // 这一步的目的（注入提示词）
  argsTemplate: Record<string, string>  // 参数模板，${field} 从用户输入提取
  optional: boolean
  condition?: string                // 条件表达式，满足才执行
  /** v9.5.3: 前置条件 — 如果指定的文件不存在，自动跳过此步骤 */
  precondition?: {
    type: 'file_exists' | 'file_not_empty'
    path: string                    // 支持 ${projectId} ${n} ${prevChapter} 模板变量
  }
}

/** 技能工作流 */
export interface SkillWorkflow {
  description: string               // 自然语言描述，注入提示词教模型
  steps: SkillStep[]                // 推荐步骤
  maxIterations?: number            // 覆盖默认最大迭代数
}

/** 输入字段定义 */
export interface SkillInputField {
  name: string
  description?: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  required: boolean
  extractFrom?: string              // 从用户消息中提取的正则
  defaultValue?: unknown
  enumValues?: string[]
}

/** 输入提取 Schema */
export interface SkillInputSchema {
  fields: SkillInputField[]
  extractionHint: string            // 注入提示词，教模型如何提取参数
}

/** 质量检查规则 */
export interface QualityCheck {
  id: string
  description: string               // 检查什么
  severity: 'error' | 'warn'
  check: string                     // 自然语言检查规则（注入提示词）
}

/** 技能示例 */
export interface SkillExample {
  userInput: string                 // 用户可能说的话
  skillOutput: string               // 期望的技能响应
  toolCallsExpected: string[]       // 期望调用的工具
}

/** 技能来源标识 */
export type SkillSourceType = 'builtin' | 'file' | 'plugin'

/** 技能元数据 */
export interface SkillMetadata {
  version: string
  author: string
  source: SkillSourceType
  sourcePath?: string               // 文件路径（file 来源）
  pluginId?: string                 // 插件 ID（plugin 来源）
  enabled: boolean
  priority: number                  // 优先级，越高越先匹配
  createdAt: string
  updatedAt: string
}

/** 技能定义（完整） */
export interface SkillDefinition {
  id: string
  name: string
  description: string
  triggerPatterns: string[]         // 触发模式
  category: SkillCategory
  workflow: SkillWorkflow
  qualityChecks: QualityCheck[]
  inputSchema: SkillInputSchema
  examples: SkillExample[]
  metadata: SkillMetadata
}

// ═══════════════════════════════════════════════════
//  扩展接口（Claude Code 风格）
// ═══════════════════════════════════════════════════

/** 技能来源接口 —— 任何实现了这个接口的系统都可以注入技能 */
export interface SkillSource {
  /** 唯一标识 */
  readonly id: string
  /** 来源类型 */
  readonly type: SkillSourceType
  /** 来源描述 */
  readonly description: string

  /** 发现所有技能 */
  discover(): Promise<SkillDefinition[]>

  /** 加载单个技能 */
  load(skillId: string): Promise<SkillDefinition | null>

  /** 重新加载（热更新） */
  reload(): Promise<SkillDefinition[]>

  /** 检查技能是否存在 */
  has(skillId: string): Promise<boolean>

  /** 获取技能数量 */
  count(): Promise<number>
}

/** 技能匹配结果 */
export interface SkillMatch {
  skill: SkillDefinition
  confidence: number                // 0-1，匹配度
  matchedPatterns: string[]         // 命中了哪些触发词
  extractedFields: Record<string, unknown>  // 从用户消息中提取的字段
}

/** 技能执行结果 */
export interface SkillExecutionResult {
  success: boolean
  skillId: string
  skillName: string
  stepsExecuted: number
  stepsFailed: number
  qualityChecksPassed: number
  qualityChecksFailed: number
  errors: string[]
  warnings: string[]
  output: ToolResult
  durationMs: number
}

// ═══════════════════════════════════════════════════
//  提示词生成
// ═══════════════════════════════════════════════════

/** 技能系统注入提示词的上下文 */
export interface SkillPromptContext {
  userMessage: string
  projectId: string | null
  activePage: string
}

/** 技能系统生成的提示词片段 */
export interface SkillPromptFragment {
  skillId: string
  skillName: string
  promptText: string                // 注入到系统提示词的文本
  priority: number
  matched: boolean                  // 是否匹配到用户意图
  confidence: number
}

// ═══════════════════════════════════════════════════
//  Runtime 执行相关
// ═══════════════════════════════════════════════════

/** 质量检查执行结果 */
export interface QualityCheckResult {
  checkId: string
  description: string
  passed: boolean
  message: string
}

/** Runtime 中活跃的 Skill 执行上下文 */
export interface ActiveSkillContext {
  skillId: string
  currentStep: number
  completedSteps: Set<number>
  extractedFields: Record<string, unknown>
  retryCount: number               // 单步骤最多重试 3 次
  /** v9.5.3: 已确认缺失的文件路径集合。前置条件检查时自动跳过这些文件的步骤。 */
  missingFiles: Set<string>
}

/** 质量检查评估器 — 可选的代码级校验 */
export type QualityCheckEvaluator = (
  args: Record<string, unknown>,
  result: ToolResult,
  extractedFields: Record<string, unknown>,
) => QualityCheckResult
