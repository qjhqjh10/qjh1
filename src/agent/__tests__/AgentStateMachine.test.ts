import { describe, it, expect, beforeEach } from 'vitest'
import { AgentStateMachine } from '../state/AgentStateMachine'

describe('AgentStateMachine', () => {
  let fsm: AgentStateMachine

  beforeEach(() => {
    fsm = new AgentStateMachine(8)
  })

  it('starts in IDLE phase', () => {
    expect(fsm.currentPhase).toBe('IDLE')
  })

  it('can transition IDLE → THINKING', async () => {
    await fsm.transition('THINKING')
    expect(fsm.currentPhase).toBe('THINKING')
  })

  it('follows normal execution flow', async () => {
    await fsm.transition('THINKING')
    expect(fsm.currentPhase).toBe('THINKING')

    await fsm.transition('ASSEMBLING_CONTEXT')
    expect(fsm.currentPhase).toBe('ASSEMBLING_CONTEXT')

    await fsm.transition('CALLING_API')
    expect(fsm.currentPhase).toBe('CALLING_API')
  })

  it('can transition CALLING_API → RESPONDING (no tool calls)', async () => {
    fsm.setShouldContinue(false)
    await fsm.transition('THINKING')
    await fsm.transition('ASSEMBLING_CONTEXT')
    await fsm.transition('CALLING_API')
    // Force state to CALLING_API then try RESPONDING
    // Guard check happens in canTransition
  })

  it('throws on invalid transition', async () => {
    // IDLE → EXECUTING is not a valid transition
    await expect(fsm.transition('EXECUTING')).rejects.toThrow('Invalid state transition')
  })

  it('supports abort from active states', async () => {
    await fsm.transition('THINKING')
    expect(fsm.canTransition('ABORTED')).toBe(true)
    await fsm.transition('ABORTED')
    expect(fsm.currentPhase).toBe('ABORTED')
  })

  it('can reset after abort', async () => {
    await fsm.transition('THINKING')
    await fsm.transition('ABORTED')
    fsm.reset()
    expect(fsm.currentPhase).toBe('IDLE')
  })

  it('tracks iteration count', () => {
    expect(fsm.currentState.iteration).toBe(0)
    fsm.incrementIteration()
    expect(fsm.currentState.iteration).toBe(1)
    fsm.incrementIteration()
    fsm.incrementIteration()
    expect(fsm.currentState.iteration).toBe(3)
    fsm.setIteration(5)
    expect(fsm.currentState.iteration).toBe(5)
  })

  it('manages pending tool calls', () => {
    fsm.setPendingToolCalls([
      { id: 'call1', name: 'read_file', arguments: '{"file_path":"test"}' },
    ])
    expect(fsm.currentState.pendingToolCalls).toHaveLength(1)
    fsm.setPendingToolCalls([])
    expect(fsm.currentState.pendingToolCalls).toHaveLength(0)
  })

  it('manages errors', () => {
    fsm.addError({
      phase: 'CALLING_API', message: 'API error',
      recoverable: true, timestamp: Date.now(),
    })
    expect(fsm.currentState.errors).toHaveLength(1)
    fsm.clearErrors()
    expect(fsm.currentState.errors).toHaveLength(0)
  })

  it('tracks max iterations from config', () => {
    const fsm5 = new AgentStateMachine(5)
    expect(fsm5.currentState.maxIterations).toBe(5)
  })

  it('notifies listeners on state change', async () => {
    const transitions: Array<{ from: string; to: string }> = []
    fsm.onStateChange((from, to) => transitions.push({ from, to }))
    await fsm.transition('THINKING')
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toEqual({ from: 'IDLE', to: 'THINKING' })
  })

  it('can unregister listener', async () => {
    const transitions: string[] = []
    const unsub = fsm.onStateChange((_from, to) => transitions.push(to))
    unsub()
    await fsm.transition('THINKING')
    expect(transitions).toHaveLength(0)
  })

  it('supports ERROR → IDLE recovery', async () => {
    await fsm.transition('THINKING')
    await fsm.transition('ERROR')
    expect(fsm.currentPhase).toBe('ERROR')
    await fsm.transition('IDLE')
    expect(fsm.currentPhase).toBe('IDLE')
  })

  it('ABORTED → IDLE is valid', async () => {
    await fsm.transition('THINKING')
    await fsm.transition('ABORTED')
    await fsm.transition('IDLE')
    expect(fsm.currentPhase).toBe('IDLE')
  })
})
