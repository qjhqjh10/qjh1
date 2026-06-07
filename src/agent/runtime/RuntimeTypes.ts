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
  /** v11.5.1: Total cost in USD/CNY */
  cost: number
  phase: AgentPhase
  toolsUsed: string[]
  toolCallSteps: Array<{
    tool: string; status: string; summary: string
    durationMs: number; iteration: number
  }>
  contextBreakdown?: Array<{ domain: string; tokens: number }>
  iterationCount: number
  /** v9.5.3: Skill 任务完成进度 */
  skillProgress?: { completed: number; total: number }
  /** v9.7.0: 事后验证结果 */
  verification?: { scriptRan: boolean; checksPassed: number; checksFailed: number; errors: string[] }
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
    totalTokens: number
    domains: string[]
    breakdown?: Array<{ domain: string; tokens: number }>
  }>
}
