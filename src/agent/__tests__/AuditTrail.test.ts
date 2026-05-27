import { describe, it, expect, beforeEach } from 'vitest'
import { AuditTrail } from '../audit/AuditTrail'

describe('AuditTrail', () => {
  let trail: AuditTrail

  beforeEach(() => {
    trail = new AuditTrail()
    trail.startSession('test-session')
  })

  it('starts with a session:start event', () => {
    const events = trail.getEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('session:start')
    expect(events[0].sessionId).toBe('test-session')
  })

  it('records state transitions', () => {
    trail.recordStateTransition('IDLE', 'THINKING')
    trail.recordStateTransition('THINKING', 'CALLING_API')
    expect(trail.getEvents()).toHaveLength(3)
  })

  it('records tool calls with truncated content', () => {
    trail.recordToolCall('write_note', { content: 'x'.repeat(2000) })
    const events = trail.getEvents()
    const toolCall = events.find(e => e.event === 'tool:call')
    expect(toolCall).toBeDefined()
    expect((toolCall!.data.args as Record<string, unknown>).content).toContain('chars')
  })

  it('records tool results', () => {
    trail.recordToolResult('read_file', 'success', 'File read')
    const events = trail.getEvents()
    expect(events.find(e => e.event === 'tool:result')).toBeDefined()
  })

  it('records hook results with truncated feedback', () => {
    trail.recordHookResult('test-hook', true, 'x'.repeat(500))
    const events = trail.getEvents()
    const hookEvent = events.find(e => e.event === 'hook:result')
    expect(hookEvent).toBeDefined()
    expect((hookEvent!.data.feedback as string).length).toBeLessThanOrEqual(200)
  })

  it('records permission decisions', () => {
    trail.recordPermissionDecision('create_file', 'deny', 'Policy blocked')
    const events = trail.getEvents()
    const perm = events.find(e => e.event === 'permission:decision')
    expect(perm).toBeDefined()
    expect(perm!.data.effect).toBe('deny')
  })

  it('records API calls', () => {
    trail.recordApiCall(5000, 2000)
    expect(trail.getEvents()).toHaveLength(2)
  })

  it('exports to JSONL format', () => {
    trail.recordStateTransition('IDLE', 'THINKING')
    const jsonl = trail.toJSONL()
    expect(jsonl.split('\n')).toHaveLength(2)
    expect(typeof JSON.parse(jsonl.split('\n')[0])).toBe('object')
  })

  it('replay returns all events', () => {
    trail.recordStateTransition('IDLE', 'THINKING')
    trail.recordToolCall('read_file', { file_path: 'test.md' })
    expect(trail.replay()).toHaveLength(3)
  })
})
