import { describe, it, expect } from 'vitest'
import { ThinkingEngine } from '../thinking/ThinkingEngine'

describe('ThinkingEngine', () => {
  const engine = new ThinkingEngine()
  const availableTools = new Set(['read_file', 'write_note', 'edit_file', 'create_file'])

  it('parses JSON thinking plan from code block', () => {
    const text = '```thinking\n{"intent":"读取大纲并修改","steps":[{"tool":"read_file","action":"读取大纲"},{"tool":"edit_file","action":"修改大纲"}]}\n```'
    const plan = engine.parseFromResponse(text)
    expect(plan).not.toBeNull()
    expect(plan!.intent).toBe('读取大纲并修改')
    expect(plan!.steps).toHaveLength(2)
    expect(plan!.steps[0].tool).toBe('read_file')
    expect(plan!.steps[1].tool).toBe('edit_file')
  })

  it('parses markdown thinking plan (fallback)', () => {
    const text = '[思考计划]1. read_file: 读取大纲文件\n2. edit_file: 修改大纲内容[/思考计划]'
    const plan = engine.parseFromResponse(text)
    expect(plan).not.toBeNull()
    expect(plan!.steps).toHaveLength(2)
    expect(plan!.steps[0].tool).toBe('read_file')
  })

  it('returns null for text without thinking plan', () => {
    const text = '这是一个普通回复，没有思考计划。'
    expect(engine.parseFromResponse(text)).toBeNull()
  })

  it('validates tools against available set', () => {
    const plan = {
      intent: 'test',
      steps: [
        { id: '1', tool: 'read_file', action: 'read', args: {}, expectedOutcome: '', status: 'pending' as const, retryCount: 0 },
        { id: '2', tool: 'unknown_tool', action: 'unknown', args: {}, expectedOutcome: '', status: 'pending' as const, retryCount: 0 },
      ],
      estimatedTokens: 0,
      dependencies: [],
    }
    const result = engine.validate(plan, availableTools)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('unknown_tool')
  })

  it('validates successfully when all tools available', () => {
    const plan = {
      intent: 'test',
      steps: [
        { id: '1', tool: 'read_file', action: 'read', args: {}, expectedOutcome: '', status: 'pending' as const, retryCount: 0 },
      ],
      estimatedTokens: 0,
      dependencies: [],
    }
    expect(engine.validate(plan, availableTools).valid).toBe(true)
  })

  it('tracks progress', () => {
    const plan = {
      intent: 'test',
      steps: [
        { id: '1', tool: 'read_file', action: 'step 1', args: {}, expectedOutcome: '', status: 'completed' as const, retryCount: 0 },
        { id: '2', tool: 'edit_file', action: 'step 2', args: {}, expectedOutcome: '', status: 'in_progress' as const, retryCount: 0 },
        { id: '3', tool: 'write_note', action: 'step 3', args: {}, expectedOutcome: '', status: 'pending' as const, retryCount: 0 },
        { id: '4', tool: 'edit_file', action: 'step 4', args: {}, expectedOutcome: '', status: 'failed' as const, retryCount: 1 },
      ],
      estimatedTokens: 100,
      dependencies: [],
    }
    const progress = engine.trackProgress(plan)
    expect(progress.totalSteps).toBe(4)
    expect(progress.completed).toBe(1)
    expect(progress.failed).toBe(1)
    expect(progress.pending).toBe(2)
    expect(progress.percentComplete).toBe(25)
    expect(progress.currentStep?.id).toBe('2')
  })

  it('generates system inject from plan', () => {
    const plan = {
      intent: '创建角色文件',
      steps: [
        { id: '1', tool: 'read_file', action: '查看已有角色', args: {}, expectedOutcome: '', status: 'pending' as const, retryCount: 0 },
        { id: '2', tool: 'create_file', action: '创建新角色', args: {}, expectedOutcome: '', status: 'pending' as const, retryCount: 0 },
      ],
      estimatedTokens: 0,
      dependencies: [],
    }
    const inject = engine.generateSystemInject(plan)
    expect(inject).toContain('创建角色文件')
    expect(inject).toContain('read_file')
    expect(inject).toContain('create_file')
  })
})
