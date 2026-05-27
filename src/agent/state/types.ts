// ── Agent State Machine Types ──

export type AgentPhase =
  | 'IDLE'
  | 'THINKING'
  | 'ASSEMBLING_CONTEXT'
  | 'CALLING_API'
  | 'AWAITING_TOOLS'
  | 'EXECUTING'
  | 'AWAITING_APPROVAL'
  | 'REFLECTING'
  | 'RESPONDING'
  | 'ERROR'
  | 'ABORTED'

export interface StateTransition {
  from: AgentPhase
  to: AgentPhase
  guard?: (state: AgentState) => boolean
  effect?: (state: AgentState) => Promise<void>
}

export interface AgentState {
  phase: AgentPhase
  iteration: number
  maxIterations: number
  pendingToolCalls: ToolCallRequest[]
  errors: AgentError[]
  lastApiResponse: ApiResponse | null
  shouldContinue: boolean
}

export interface ToolCallRequest {
  id: string
  name: string
  arguments: string
}

export interface AgentError {
  phase: AgentPhase
  message: string
  recoverable: boolean
  timestamp: number
}

export interface ApiResponse {
  text: string
  toolCalls: ToolCallRequest[] | null
  finishReason: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number }
}

export const DEFAULT_MAX_ITERATIONS = 8
