import type { AgentState, AgentPhase, StateTransition, ApiResponse } from './types'
import { DEFAULT_MAX_ITERATIONS } from './types'

export type StateChangeListener = (from: AgentPhase, to: AgentPhase, state: AgentState) => void

export class AgentStateMachine {
  private _state: AgentState
  private transitions: StateTransition[]
  private listeners: Set<StateChangeListener> = new Set()

  constructor(maxIterations: number = DEFAULT_MAX_ITERATIONS) {
    this._state = {
      phase: 'IDLE',
      iteration: 0,
      maxIterations,
      pendingToolCalls: [],
      errors: [],
      lastApiResponse: null,
      shouldContinue: true,
    }
    this.transitions = this.buildTransitions()
  }

  get currentState(): Readonly<AgentState> {
    return this._state
  }

  get currentPhase(): AgentPhase {
    return this._state.phase
  }

  // ── Transition Graph ──

  private buildTransitions(): StateTransition[] {
    return [
      // Startup
      { from: 'IDLE', to: 'THINKING' },

      // Normal flow
      { from: 'THINKING', to: 'ASSEMBLING_CONTEXT' },
      { from: 'ASSEMBLING_CONTEXT', to: 'CALLING_API' },
      { from: 'CALLING_API', to: 'AWAITING_TOOLS' },
      { from: 'CALLING_API', to: 'RESPONDING' },       // no tool calls

      // Approval gate: check before executing
      { from: 'AWAITING_TOOLS', to: 'AWAITING_APPROVAL' },
      { from: 'AWAITING_TOOLS', to: 'EXECUTING' },

      // Execution
      { from: 'EXECUTING', to: 'REFLECTING', guard: (s) => s.pendingToolCalls.length === 0 },

      // Approval resolution
      { from: 'AWAITING_APPROVAL', to: 'EXECUTING' },   // approved
      { from: 'AWAITING_APPROVAL', to: 'REFLECTING' },  // denied

      // Reflection → loop or respond
      {
        from: 'REFLECTING', to: 'CALLING_API',
        guard: (s) => s.shouldContinue && s.iteration < s.maxIterations,
      },
      {
        from: 'REFLECTING', to: 'RESPONDING',
        guard: (s) => !s.shouldContinue || s.iteration >= s.maxIterations,
      },

      // Terminal states
      { from: 'RESPONDING', to: 'IDLE' },

      // Error recovery (from any active state)
      { from: 'THINKING', to: 'ERROR' },
      { from: 'ASSEMBLING_CONTEXT', to: 'ERROR' },
      { from: 'CALLING_API', to: 'ERROR' },
      { from: 'EXECUTING', to: 'ERROR' },
      { from: 'AWAITING_TOOLS', to: 'ERROR' },
      { from: 'AWAITING_APPROVAL', to: 'ERROR' },
      { from: 'REFLECTING', to: 'ERROR' },
      { from: 'RESPONDING', to: 'ERROR' },
      { from: 'ERROR', to: 'IDLE' },
      { from: 'ERROR', to: 'CALLING_API', guard: (s) => s.iteration < s.maxIterations },

      // Abort from any active state
      { from: 'THINKING', to: 'ABORTED' },
      { from: 'ASSEMBLING_CONTEXT', to: 'ABORTED' },
      { from: 'CALLING_API', to: 'ABORTED' },
      { from: 'EXECUTING', to: 'ABORTED' },
      { from: 'REFLECTING', to: 'ABORTED' },
      { from: 'RESPONDING', to: 'ABORTED' },
      { from: 'ABORTED', to: 'IDLE' },
    ]
  }

  // ── Transition Logic ──

  canTransition(to: AgentPhase): boolean {
    const valid = this.transitions.filter(t => t.from === this._state.phase && t.to === to)
    if (valid.length === 0) return false
    return valid.every(t => !t.guard || t.guard(this._state))
  }

  async transition(to: AgentPhase): Promise<void> {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid state transition: ${this._state.phase} → ${to}`)
    }

    const match = this.transitions.find(
      t => t.from === this._state.phase && t.to === to && (!t.guard || t.guard(this._state))
    )
    const from = this._state.phase
    this._state.phase = to

    if (match?.effect) {
      await match.effect(this._state)
    }

    this.notifyListeners(from, to)
  }

  // ── State Mutations (called by AgentRuntime) ──

  setIteration(n: number): void {
    this._state.iteration = n
  }

  incrementIteration(): void {
    this._state.iteration++
  }

  setPendingToolCalls(calls: AgentState['pendingToolCalls']): void {
    this._state.pendingToolCalls = calls
  }

  addError(error: AgentState['errors'][number]): void {
    this._state.errors.push(error)
  }

  clearErrors(): void {
    this._state.errors = []
  }

  setApiResponse(response: ApiResponse | null): void {
    this._state.lastApiResponse = response
  }

  setShouldContinue(v: boolean): void {
    this._state.shouldContinue = v
  }

  reset(): void {
    this._state = {
      phase: 'IDLE',
      iteration: 0,
      maxIterations: this._state.maxIterations,
      pendingToolCalls: [],
      errors: [],
      lastApiResponse: null,
      shouldContinue: true,
    }
  }

  // ── Listener Management ──

  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notifyListeners(from: AgentPhase, to: AgentPhase): void {
    for (const l of this.listeners) {
      try { l(from, to, { ...this._state }) } catch { /* ignore listener errors */ }
    }
  }
}
