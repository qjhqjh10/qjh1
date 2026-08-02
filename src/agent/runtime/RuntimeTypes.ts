// ── Shared Runtime Types ──
// Extracted from V4AgentRuntime.ts / V4AnthropicRuntime.ts (previously duplicated).
// Single source of truth for config, input/output, and DI function signatures.

import type {
  AgentPhase,
  ToolCallRequest,
  ToolResult,
  ToolExecutionContext,
  Message,
} from '../state/types'
import type { AuditTrail } from '../audit/AuditTrail'

// ── Config ──

export interface V4AgentConfig {
  configId: string
  projectId: string | null
  maxIterations: number
  abortSignal: AbortSignal
  contextWindow?: number
  /** v10.0.0: 跳过 ANALYZE 阶段强制文本分析。默认 false。 */
  skipAnalyze?: boolean
  /** v10.0.0: 跳过 Skill Gate（测试 mock 用）。默认 false。 */
  skipSkillGate?: boolean
  /** v12.5.1: 创作温度 — 深度推理关闭时创作轮使用 (默认 1.0) */
  temperature?: number
  /** v12.5.1: 工具执行轮温度上限 — 深度推理关闭时执行轮使用 (默认 0.5) */
  toolTemperature?: number
  /** v15: 无头运行（子 agent）— 跳过共享 AgentStore 与诊断日志，避免污染主 agent 的 UI 状态与熔断器 */
  isolatedStore?: boolean
  /** v14 批处理: 审计接线 — 每轮 API 调用后 recordApiCall（含 cost/model），供会话统计聚合 */
  auditTrail?: AuditTrail
  /** v14 批处理: 当前模型名（审计 api:call 事件记录用） */
  model?: string
}

export interface V4AgentRunInput {
  userMessage: string
  attachments: Array<{ type: string; name: string; content: string }>
  /** v14.5.0: 跨 run 续跑 — 上次中断的任务清单进度快照（interrupted && !allDone 时传入，
   * 新消息不含编号任务时据此恢复清单与进度，保证"未清空不接受完成"门控在续跑场景仍生效） */
  resumeTaskProgress?: TaskProgress
  /** v14.6.1: 工具开关 — false 时本轮 tools 传空数组（模型只能纯文本对话，无法调用工具） */
  toolsEnabled?: boolean
}

export interface V4AgentRunResult {
  success: boolean
  text: string
  toolCalls: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  /** v11.5.1: Cache hit tokens from API (DeepSeek prompt caching) */
  cacheHitTokens: number
  /** v11.7.0: Cache creation tokens (first round — still charged, at creation price) */
  cacheCreationTokens: number
  /** v11.5.1: Total cost in USD/CNY */
  cost: number
  phase: AgentPhase
  toolsUsed: string[]
  toolCallSteps: Array<{
    tool: string; status: string; summary: string
    durationMs: number; iteration: number
    arguments?: string
    matchedTools?: string[]  // v13.2.0: tool_search 返回的匹配工具名
  }>
  contextBreakdown?: Array<{ domain: string; tokens: number }>
  /** v13.2.0: 下一次 API 请求的预估上下文 token 数（含 system/history/工具结果等） */
  estimatedContextTokens?: number
  iterationCount: number
  /** v15: 子 agent 委托任务用量（独立上下文窗口，主/子分开统计；不并入 totalTokens） */
  subAgentUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cacheHitTokens: number
    cacheCreationTokens: number
    cost: number
    calls: number
  }
  /** v14.2.0: 任务清单进度快照（仅本次 run 提取了任务清单时返回；用于跨 run 续跑持久化） */
  taskProgress?: TaskProgress
  /** v14.3: 子代理执行结果快照（仅实际委托过子代理时返回；供 UI 持久化 + 跨 run 注入复用） */
  subagentSummaries?: SubagentSummary[]
  /** v14.3.1: 运行被中断（迭代耗尽/超时/API失败/abort）且工作未完成 — 无论有无任务清单都返回；
   * 子代理据此判定"部分完成"（success 可能仍为 true，不能当作完整结果） */
  truncated?: boolean
  /** v14.6.1: 本次 run 的推理链（DeepSeek thinking / Anthropic thinkingBlocks 累计）——
   * 供 UI 持久化到 assistant 消息显示"思考过程"折叠面板（原面板读取恒 undefined 的死 UI） */
  reasoningContent?: string
  /** v14.8: 本轮预注入的知识库文件 id（跨 run 去重——随 assistant 消息持久化，
   * 下轮经 SendOptions.excludeKbFileIds 排除，避免同一文件跨 run 反复注入） */
  kbInjectedFileIds?: string[]
}

// ── v14.3: 子代理执行结果快照（跨 run 复用） ──

export interface SubagentSummary {
  /** 委托工具名：analyze_file | edit_file_task | verify_task | subagent_ask */
  tool: string
  /** 目标文件路径（从工具 args 提取，可空串） */
  filePath: string
  status: 'success' | 'error'
  summary: string
  /** 收集时已截断（SUBAGENT_SUMMARY_DETAIL_CHARS = 1500），供跨 run 注入引用 */
  detail: string
  /** 执行轮次 */
  iteration: number
}

// ── v14.2.0: 跨 run 续跑 — 任务清单进度快照 ──

export interface TaskProgressItem {
  id: number
  desc: string
  done: boolean
}

export interface TaskProgress {
  tasks: TaskProgressItem[]
  /** 全部任务已完成（true = 正常收尾，无需续跑） */
  allDone: boolean
  /** 运行被中断（用户中止/超时/API 失败/迭代耗尽），任务未全部完成 → 可续跑 */
  interrupted: boolean
}

// ── Dependency Contracts ──

export interface ToolExecutorFn {
  (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>
}

export interface ContextAssemblerFn {
  (
    userMessage: string,
    history: Message[],
    projectId: string | null,
  ): Promise<{
    systemMessages: Array<{ role: 'system'; content: string }>
    /** v13.x: KB/Web 搜索结果 — 注入消息体而非 system 块 */
    searchContext?: string
    /** v14.8: 本轮预注入的知识库文件 id（runtime 存实例 → execCtx → kb_search 排除 + run 结果跨 run 持久化） */
    injectedKbFileIds?: string[]
    totalTokens: number
    domains: string[]
    breakdown?: Array<{ domain: string; tokens: number }>
  }>
}
