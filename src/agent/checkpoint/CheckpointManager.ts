import type { AgentState } from '../state/types'
import type { Message } from '../runtime/AgentRuntime'

export interface AgentCheckpoint {
  id: string
  sessionId: string
  timestamp: number
  iteration: number
  phase: string
  messages: Message[]
  state: AgentState
  tokenUsage: number
  reason: string
}

export class CheckpointManager {
  private checkpoints: AgentCheckpoint[] = []
  private maxCheckpoints: number

  constructor(maxCheckpoints = 50) {
    this.maxCheckpoints = maxCheckpoints
  }

  async save(
    sessionId: string, state: AgentState, messages: Message[],
    tokenUsage: number, reason: string,
  ): Promise<AgentCheckpoint> {
    const ckpt: AgentCheckpoint = {
      id: `ckpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId, timestamp: Date.now(),
      iteration: state.iteration, phase: state.phase,
      messages: messages.map(m => ({ ...m })), // shallow copy
      state: { ...state, pendingToolCalls: [...state.pendingToolCalls], errors: [...state.errors] },
      tokenUsage, reason,
    }
    this.checkpoints.push(ckpt)
    await this.prune()
    return ckpt
  }

  async latest(sessionId: string): Promise<AgentCheckpoint | null> {
    const sessionCkpts = this.checkpoints.filter(c => c.sessionId === sessionId)
    if (sessionCkpts.length === 0) return null
    return sessionCkpts.reduce((a, b) => a.timestamp > b.timestamp ? a : b)
  }

  async list(sessionId: string): Promise<AgentCheckpoint[]> {
    return this.checkpoints
      .filter(c => c.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  async restore(checkpoint: AgentCheckpoint): Promise<void> {
    // State restoration is handled by AgentStateMachine.restoreState()
    // Messages are returned for the runtime to reset messagesForApi
  }

  async prune(): Promise<void> {
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints.sort((a, b) => a.timestamp - b.timestamp)
      const toRemove = this.checkpoints.length - this.maxCheckpoints
      this.checkpoints = this.checkpoints.slice(toRemove)
    }
  }

  clear(): void {
    this.checkpoints = []
  }

  get count(): number { return this.checkpoints.length }
}
