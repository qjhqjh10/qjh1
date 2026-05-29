import { describe, it, expect, beforeEach } from 'vitest'
import { PolicyEngine } from '../permissions/PolicyEngine'

describe('PolicyEngine', () => {
  let engine: PolicyEngine

  beforeEach(() => {
    engine = new PolicyEngine()
  })

  it('defaults to deny when no policies loaded', () => {
    const result = engine.evaluate('read_file', { file_path: 'test.md' })
    expect(result.effect).toBe('deny')
    expect(result.matchedPolicy).toBeNull()
  })

  it('allows when explicit allow policy matches', () => {
    engine.load([{ id: 'allow-read', effect: 'allow', toolName: 'read_file' }])
    expect(engine.evaluate('read_file').effect).toBe('allow')
  })

  it('explicit deny overrides allow', () => {
    engine.load([
      { id: 'allow-all', effect: 'allow', toolName: '*' },
      { id: 'deny-delete', effect: 'deny', toolName: 'delete_file' },
    ])
    expect(engine.evaluate('delete_file').effect).toBe('deny')
    expect(engine.evaluate('read_file').effect).toBe('allow')
  })

  it('evaluation order: explicit deny > explicit allow > default deny', () => {
    engine.load([
      { id: 'allow-write', effect: 'allow', toolName: 'write_note' },
      { id: 'deny-all-notes', effect: 'deny', toolName: 'write_note', pathPattern: '**/secret/**' },
    ])
    // write_note with no secret path = allow
    expect(engine.evaluate('write_note', { file_path: 'notes/test.md' }).effect).toBe('allow')
  })

  it('glob matches tool names', () => {
    engine.load([{ id: 'allow-all', effect: 'allow', toolName: '*' }])
    expect(engine.evaluate('read_file').effect).toBe('allow')
    expect(engine.evaluate('unknown_tool_xyz').effect).toBe('allow')
  })

  it('ask effect returns requiresUserApproval', () => {
    engine.load([{ id: 'ask-create', effect: 'ask', toolName: 'create_file' }])
    const result = engine.evaluate('create_file')
    expect(result.effect).toBe('ask')
    expect(result.requiresUserApproval).toBe(true)
  })

  it('infers operation type from tool name', () => {
    // read operations
    const r1 = engine.evaluate('read_file')
    expect(r1.effect).toBe('deny')
    // write operations
    engine.load([{ id: 'allow-write', effect: 'allow', toolName: 'create_file', operation: 'write' }])
    expect(engine.evaluate('create_file').effect).toBe('allow')
    expect(engine.evaluate('read_file').effect).toBe('deny') // read ≠ write
  })

  it('reports matched policy ID', () => {
    engine.load([{ id: 'my-policy', effect: 'allow', toolName: 'read_file' }])
    expect(engine.evaluate('read_file').matchedPolicy).toBe('my-policy')
  })

  it('empty policies = all deny', () => {
    engine.load([])
    expect(engine.evaluate('read_file').effect).toBe('deny')
  })

  it('getPolicies returns loaded policies', () => {
    engine.load([{ id: 'p1', effect: 'allow', toolName: 'read_file' }])
    expect(engine.getPolicies()).toHaveLength(1)
  })

  // ── defaultEffect ──

  it('setDefaultEffect(allow) changes default to allow', () => {
    engine.setDefaultEffect('allow')
    expect(engine.evaluate('read_file').effect).toBe('allow')
  })

  it('explicit deny still overrides defaultEffect=allow', () => {
    engine.setDefaultEffect('allow')
    engine.load([{ id: 'deny-read', effect: 'deny', toolName: 'read_file' }])
    expect(engine.evaluate('read_file').effect).toBe('deny')
  })

  // ── conditions (workMode) ──

  it('skips policy when workMode condition does not match', () => {
    engine.load([{ id: 'plan-only', effect: 'allow', toolName: 'read_file', conditions: { workMode: 'plan' } }])
    engine.setWorkMode('action')
    expect(engine.evaluate('read_file').effect).toBe('deny')
  })

  it('applies policy when workMode condition matches', () => {
    engine.load([{ id: 'plan-only', effect: 'allow', toolName: 'read_file', conditions: { workMode: 'plan' } }])
    engine.setWorkMode('plan')
    expect(engine.evaluate('read_file').effect).toBe('allow')
  })

  it('applies policy when no conditions specified', () => {
    engine.load([{ id: 'always', effect: 'allow', toolName: 'read_file' }])
    engine.setWorkMode('action')
    expect(engine.evaluate('read_file').effect).toBe('allow')
  })

  // ── inferOperation: edit_file is write ──

  it('classifies edit_file as write operation', () => {
    engine.load([{ id: 'deny-write', effect: 'deny', toolName: '*', operation: 'write' }])
    expect(engine.evaluate('edit_file', { file_path: 'test.md' }).effect).toBe('deny')
    expect(engine.evaluate('rename_file', { file_path: 'test.md' }).effect).toBe('deny')
    expect(engine.evaluate('append_note', { file_path: 'notes/test.md' }).effect).toBe('deny')
  })

  it('classifies read_file as read operation', () => {
    engine.load([{ id: 'deny-read', effect: 'deny', toolName: '*', operation: 'read' }])
    expect(engine.evaluate('read_file').effect).toBe('deny')
    expect(engine.evaluate('edit_file').effect).toBe('deny') // fallback: not read → default deny
  })

  // ── matchGlob: regex metachar escaping ──

  it('matchGlob escapes dots in path patterns', () => {
    engine.load([{ id: 'allow-v1', effect: 'allow', toolName: 'read_file', pathPattern: 'notes/v1.0/**' }])
    expect(engine.evaluate('read_file', { file_path: 'notes/v1.0/test.md' }).effect).toBe('allow')
    // dot should NOT match arbitrary char
    expect(engine.evaluate('read_file', { file_path: 'notes/v1X0/test.md' }).effect).toBe('deny')
  })

  it('matchGlob handles ** wildcard correctly', () => {
    engine.load([{ id: 'allow-deep', effect: 'allow', toolName: 'read_file', pathPattern: 'notes/**' }])
    expect(engine.evaluate('read_file', { file_path: 'notes/a/b/c.md' }).effect).toBe('allow')
    expect(engine.evaluate('read_file', { file_path: 'other/test.md' }).effect).toBe('deny')
  })
})
