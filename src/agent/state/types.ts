// ── Agent State Types (V4 Simplified) ──
// Reduced from V3's 13-phase FSM to 4 essential phases.
// Removed: VerificationReport, StateTransition, planPhase, executionPlan fields.
// Added: Message, ToolResult, ToolExecutionContext (extracted from old AgentRuntime).
// Kept: ThinkingPlan, ThinkingStep (used by ContractExecutor).

// ── Phase (v10.0.0: 三阶段状态机 ANALYZE→EXECUTE→VERIFY) ──

export type AgentPhase = 'IDLE' | 'ANALYZE' | 'EXECUTE' | 'VERIFY' | 'WAITING_APPROVAL' | 'DONE' | 'ERROR' | 'ABORTED'

// ── Messages ──

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
