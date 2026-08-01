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
}

export interface V4AgentRunInput {
  userMessage: string
  attachments: Array<{ type: string; name: string; content: string }>
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
    totalTokens: number
    domains: string[]
    breakdown?: Array<{ domain: string; tokens: number }>
  }>
}
