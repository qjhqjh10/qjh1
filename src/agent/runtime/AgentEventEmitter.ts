import type { AgentPhase, AgentState, ToolCallRequest, ApiResponse, ThinkingPlan, VerificationReport } from '../state/types'

// ── Event Payloads ──

export interface ThinkingContext {
  intent: string
  steps: { tool: string; action: string }[]
  filesNeeded: string[]
  estimatedTokens: number
  timestamp: number
}

export interface ThinkingProgress {
  step: number
  totalSteps: number
  description: string
  timestamp: number
}

export interface ThinkingResult {
  plan: unknown
  tokenCost: number
}

export interface ToolProgressEvent {
  callId: string
  toolName: string
  phase: 'started' | 'validating' | 'executing' | 'done'
  progress?: number
  message?: string
  timestamp: number
}

export interface ToolResultEvent {
  callId: string
  toolName: string
  status: 'success' | 'error'
  summary: string
  detail?: string
  timestamp: number
}

export interface AssembledContext {
  systemMessageCount: number
  totalTokens: number
  domains: string[]
  timestamp: number
}

export interface ResponseChunk {
  text: string
  accumulated: string
  timestamp: number
}

export interface ResponseComplete {
  text: string
  usage?: ApiResponse['usage']
  timestamp: number
}

export interface PermissionRequest {
  toolName: string
  filePath?: string
  action: string
  risk: 'low' | 'medium' | 'high'
  timestamp: number
  resolve: (approved: boolean, feedback?: string) => void
}

export interface AgentErrorEvent {
  phase: string
  message: string
  recoverable: boolean
  timestamp: number
}

// ── Event Map ──

export interface AgentEventMap {
  'thinking:start': ThinkingContext
  'thinking:progress': ThinkingProgress
  'thinking:complete': ThinkingResult
  'context:assembled': AssembledContext
  'tool:started': ToolProgressEvent
  'tool:progress': ToolProgressEvent
  'tool:completed': ToolResultEvent
  'tool:failed': ToolResultEvent
  'response:streaming': ResponseChunk
  'response:complete': ResponseComplete
  'permission:request': PermissionRequest
  'hook:blocked': { hookName: string; feedback: string; timestamp: number }
  'hook:passed': { hookName: string; passed: boolean; feedback: string; timestamp: number }
  'agent:state': { from: AgentPhase; to: AgentPhase; state: AgentState }
  'error': AgentErrorEvent
  'aborted': { timestamp: number }
  'run:start': { timestamp: number }
  'run:complete': { iterations: number; toolCalls: number; tokenUsage: number }
  'api:call': { promptTokens: number; completionTokens: number; totalTokens: number; timestamp: number }
  'planning:start': { intent: string; timestamp: number }
  'plan:proposed': ThinkingPlan
  'plan:approved': { timestamp: number }
  'plan:rejected': { feedback: string; timestamp: number }
  'plan:deviation': { toolName: string; args: Record<string, unknown>; plannedSteps: string[]; timestamp: number }
  'plan:stepStart': { stepId: string; action: string }
  'plan:stepComplete': { stepId: string; action: string; summary: string }
  'verify:start': { stepCount: number; timestamp: number }
  'verify:stepResult': VerificationReport
  'verify:complete': { total: number; passed: number; failed: number }
}

// ── Type-safe EventEmitter ──

type EventHandler<T> = (data: T) => void

export class AgentEventEmitter {
  private handlers = new Map<string, Set<EventHandler<unknown>>>()
  private aborted = false

  on<K extends keyof AgentEventMap>(event: K, handler: EventHandler<AgentEventMap[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>)
    return () => {
      this.handlers.get(event)?.delete(handler as EventHandler<unknown>)
    }
  }

  emit<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
    if (this.aborted && event !== 'aborted' && event !== 'error') return
    this.handlers.get(event)?.forEach(h => {
      try { h(data) } catch { /* swallow handler errors */ }
    })
  }

  abort(): void {
    this.aborted = true
    this.emit('aborted', { timestamp: Date.now() })
  }

  reset(): void {
    this.aborted = false
    this.handlers.clear()
  }

  get isAborted(): boolean {
    return this.aborted
  }
}
