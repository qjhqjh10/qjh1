// ── Agent State Types (V4 Simplified) ──
// Reduced from V3's 13-phase FSM to 4 essential phases.
// Removed: VerificationReport, StateTransition, planPhase, executionPlan fields.
// Added: Message, ToolResult, ToolExecutionContext (extracted from old AgentRuntime).
// Kept: ThinkingPlan, ThinkingStep (used by ContractExecutor).

// ── Phase (v10.0.0: 三阶段状态机 ANALYZE→EXECUTE→VERIFY) ──

export type AgentPhase = 'IDLE' | 'ANALYZE' | 'EXECUTE' | 'VERIFY' | 'WAITING_APPROVAL' | 'DONE' | 'ERROR' | 'ABORTED'

// ── Messages ──

// ⚠️ agent 层 Message——与 src/components/ai/chat/types.ts 的 UI 层 Message 是【刻意分开】
// 的两个接口，不要合并！分开原因（2026-08-11 审计结论）：
//   1. 职责不同：本接口是【runtime/适配器协议消息】（tool_calls/tool_call_id/thinkingBlocks/
//      serverToolBlocks/_toolResults 等协议字段，供 Anthropic/OpenAI/Responses 转换与历史重建）；
//      UI 层接口是【聊天窗口展示消息】（id/timestamp/usage/insertion/sources/thinkingPlan 等
//      展示与交互字段）。
//   2. 演变方向不同：协议层随供应商 API 变化（如 serverToolBlocks），UI 层随界面交互变化——
//      合并后任一侧加字段都会污染另一侧。
// 同步约定：跨层消息构造点 buildHistoryMessages（AIChatWindow/utils.ts）负责双向字段映射，
// 协议相关字段变更时同步检查该函数；不要在本接口补 UI 展示字段，反之亦然。

export interface Message {
  role: string
  content: string
  tool_calls?: unknown[]
  tool_call_id?: string
  reasoning_content?: string
  /** v11.5.1: Anthropic extended thinking blocks — must be preserved across multi-turn conversations */
  thinkingBlocks?: Array<{ thinking: string; signature: string }>
  /** v15.5: 服务端工具块（server_tool_use / web_search_tool_result）——
   * DeepSeek Anthropic 端点原生联网多轮回传必需 */
  serverToolBlocks?: Array<Record<string, unknown>>
  /** v16.0.1(审计 M11): 工具结果（跨 run 去重重建数据源）——生产 UI 不持久化 tool_calls，
   * buildHistoryMessages 还原为 role:'tool' 消息，ReadResultTracker.rebuildFromHistory 据此重建 */
  _toolResults?: Array<{ tool: string; args: Record<string, unknown>; content: string }>
}

// ── Tool Calls ──

export interface ToolCallRequest {
  id: string
  name: string
  arguments: string
}

export interface ToolResult {
  status: 'success' | 'error' | 'pending_confirm'
  summary: string
  detail?: string
  confirmArgs?: Record<string, unknown>
  matchedTools?: string[]  // v13.2.0: tool_search 返回的匹配工具名
  /** v15: 工具内部委托子 agent 的用量（analyze_file/edit_file_task） */
  subAgentUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cacheHitTokens: number
    cacheCreationTokens: number
    cost: number
    calls: number
  }
}

export interface ToolExecutionContext {
  projectId: string | null
  configId: string
  callId: string
  toolName: string
  signal: AbortSignal
  /** v14.8: 本轮已预注入上下文的知识库文件 id（kb_search 排除集；与 skills/types.ts 副本保持同步） */
  kbInjectedFileIds?: string[]
}

// ── API ──

export interface ApiResponse {
  text: string
  toolCalls: ToolCallRequest[] | null
  finishReason: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost?: number }
}

// ── Plan (kept for ContractExecutor compatibility) ──

export interface ThinkingStep {
  id: string
  tool: string
  action: string
  args: Record<string, unknown>
  expectedOutcome: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  retryCount: number
  approvalStatus: 'pending' | 'approved' | 'rejected'
  userFeedback?: string
}

export interface ThinkingPlan {
  intent: string
  steps: ThinkingStep[]
  neededTools: string[]
  estimatedTokens: number
  dependencies: number[][]
}

// ── Agent State ──

export interface AgentState {
  phase: AgentPhase
  iteration: number
  maxIterations: number
  errors: AgentError[]
}

export interface AgentError {
  phase: AgentPhase
  message: string
  recoverable: boolean
  timestamp: number
}

export const DEFAULT_MAX_ITERATIONS = 30  // v11.5.1: 60→30
