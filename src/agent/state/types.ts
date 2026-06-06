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
}

export interface ToolExecutionContext {
  projectId: string | null
  configId: string
  callId: string
  toolName: string
  signal: AbortSignal
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

export const DEFAULT_MAX_ITERATIONS = 60
