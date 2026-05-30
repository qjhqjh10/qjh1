// ── Agent State Machine Types ──

export type AgentPhase =
  | 'IDLE'
  | 'THINKING'
  | 'ASSEMBLING_CONTEXT'
  | 'CALLING_API'
  | 'AWAITING_TOOLS'
  | 'PLANNING'
  | 'EXECUTING'
  | 'AWAITING_APPROVAL'
  | 'REFLECTING'
  | 'VERIFYING'
  | 'RESPONDING'
  | 'ERROR'
  | 'ABORTED'

export interface StateTransition {
  from: AgentPhase
  to: AgentPhase
  guard?: (state: AgentState) => boolean
  effect?: (state: AgentState) => Promise<void>
}

export interface VerificationReport {
  planStepId: string
  expectedOutcome: string
  actualOutcome: string
  status: 'passed' | 'failed' | 'skipped'
  discrepancy?: string
}

export interface AgentState {
  phase: AgentPhase
  iteration: number
  maxIterations: number
  pendingToolCalls: ToolCallRequest[]
  errors: AgentError[]
  lastApiResponse: ApiResponse | null
  shouldContinue: boolean
  executionPlan: ThinkingPlan | null
  planPhase: 'none' | 'generating' | 'awaiting_approval' | 'approved' | 'rejected'
  verificationReports: VerificationReport[]
}

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
  neededTools: string[]       // AI-declared tool names needed for execution
  estimatedTokens: number
  dependencies: number[][]
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

export const DEFAULT_MAX_ITERATIONS = 20
