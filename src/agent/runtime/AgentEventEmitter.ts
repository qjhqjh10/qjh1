import type { AgentPhase, AgentState, ToolCallRequest } from '../state/types'

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
  'permission:request': PermissionRequest
  'hook:blocked': { hookName: string; feedback: string; timestamp: number }
  'hook:passed': { hookName: string; passed: boolean; feedback: string; timestamp: number }
  'error': AgentErrorEvent
  'aborted': { timestamp: number }
  'run:start': { timestamp: number }
  'run:complete': { iterations: number; toolCalls: number; tokenUsage: number }
  'api:call': { promptTokens: number; completionTokens: number; totalTokens: number; timestamp: number }
  'plan:deviation': { toolName: string; args: Record<string, unknown>; plannedSteps: string[]; timestamp: number }
}

// ── Type-safe EventEmitter ──

type EventHandler<T> = (data: T) => void

export class AgentEventEmitter {
  private handlers = new Map<string, Set<EventHandler<unknown>>>()
  private aborted = false
  private paused = false
  private pendingEvents: Array<{ event: string; data: unknown }> = []
  private maxPendingEvents = 50

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
    // During abort: queue events (don't drop) unless it's abort/error signal
    if (this.aborted && event !== 'aborted' && event !== 'error') {
      if (this.pendingEvents.length < this.maxPendingEvents) {
        this.pendingEvents.push({ event, data })
      }
      return
    }
    // During pause: queue all events
    if (this.paused) {
      if (this.pendingEvents.length < this.maxPendingEvents) {
        this.pendingEvents.push({ event, data })
      }
      return
    }
    this.dispatchHandlers(event, data)
  }

  private dispatchHandlers<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
    this.handlers.get(event)?.forEach(h => {
      try { h(data) } catch (err) {
        console.error(`[AgentEventEmitter] Handler error for event "${event}":`, err)
        if (event !== 'error') {
          try {
            this.handlers.get('error')?.forEach(eh => {
              eh({ phase: 'EVENT', message: `事件处理器错误 (${event}): ${err instanceof Error ? err.message : 'Unknown'}`, recoverable: true, timestamp: Date.now() })
            })
          } catch { /* error handler itself failed */ }
        }
      }
    })
  }

  /** Pause event dispatch — events are queued, not dropped */
  pause(): void {
    this.paused = true
  }

  /** Resume from pause or abort — flushes queued events */
  resume(): void {
    this.aborted = false
    this.paused = false
    // Flush pending events
    const events = [...this.pendingEvents]
    this.pendingEvents = []
    for (const { event, data } of events) {
      try { this.dispatchHandlers(event as keyof AgentEventMap, data as AgentEventMap[keyof AgentEventMap]) } catch { /* defensive */ }
    }
  }

  abort(): void {
    this.aborted = true
    this.emit('aborted', { timestamp: Date.now() })
  }

  reset(): void {
    this.aborted = false
    this.paused = false
    this.pendingEvents = []
    this.handlers.clear()
  }

  get isAborted(): boolean { return this.aborted }
  get isPaused(): boolean { return this.paused }
  get pendingCount(): number { return this.pendingEvents.length }
}
