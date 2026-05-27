import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry, ToolDefinition } from '../tools/ToolRegistry'

function makeTool(name: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    schema: {
      name,
      description: `Test tool: ${name}`,
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: 'path' } },
        required: ['file_path'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async (args) => ({
      status: 'success',
      summary: `Executed ${name}: ${JSON.stringify(args)}`,
    }),
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  it('starts empty', () => {
    expect(registry.count()).toBe(0)
    expect(registry.getNames()).toEqual([])
  })

  it('registers a tool', () => {
    registry.register(makeTool('test_tool'))
    expect(registry.count()).toBe(1)
    expect(registry.has('test_tool')).toBe(true)
    expect(registry.get('test_tool')).toBeDefined()
  })

  it('registers multiple tools via registerAll', () => {
    registry.registerAll([
      makeTool('tool_a'),
      makeTool('tool_b'),
      makeTool('tool_c'),
    ])
    expect(registry.count()).toBe(3)
  })

  it('returns undefined for unknown tool', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('generates OpenAI function calling schemas', () => {
    registry.register(makeTool('read_file'))
    registry.register(makeTool('list_directory'))
    const schemas = registry.getAllSchemas()
    expect(schemas).toHaveLength(2)
    expect(schemas[0].type).toBe('function')
    expect(schemas[0].function.name).toBeTruthy()
  })

  it('filters schemas by workMode (plan vs action)', () => {
    registry.register(makeTool('read_ok', { availableInPlanMode: true }))
    registry.register(makeTool('write_blocked', { availableInPlanMode: false }))

    const planSchemas = registry.getFilteredSchemas('plan')
    expect(planSchemas).toHaveLength(1)
    expect(planSchemas[0].function.name).toBe('read_ok')

    const actionSchemas = registry.getFilteredSchemas('action')
    expect(actionSchemas).toHaveLength(2)
  })

  it('filters schemas by enabled tool names', () => {
    registry.registerAll([
      makeTool('tool_a'),
      makeTool('tool_b'),
      makeTool('tool_c'),
    ])
    const filtered = registry.getFilteredSchemas('action', new Set(['tool_a', 'tool_c']))
    expect(filtered).toHaveLength(2)
    const names = filtered.map(s => s.function.name)
    expect(names).toContain('tool_a')
    expect(names).toContain('tool_c')
    expect(names).not.toContain('tool_b')
  })

  it('executes a tool and returns result', async () => {
    registry.register(makeTool('add_numbers', {
      executor: async (args) => ({
        status: 'success',
        summary: `Sum: ${(args.a as number) + (args.b as number)}`,
      }),
    }))
    const result = await registry.execute('add_numbers', { a: 3, b: 4 }, {
      projectId: null, configId: 'test', callId: 'c1', toolName: 'test', signal: new AbortController().signal,
    })
    expect(result.status).toBe('success')
    expect(result.summary).toBe('Sum: 7')
  })

  it('returns error for unknown tool', async () => {
    const result = await registry.execute('unknown', {}, {
      projectId: null, configId: 'test', callId: 'c1', toolName: 'test', signal: new AbortController().signal,
    })
    expect(result.status).toBe('error')
    expect(result.summary).toContain('未知工具')
  })

  it('identifies dangerous tools', () => {
    registry.register(makeTool('read_file', { permission: 'AUTO' }))
    registry.register(makeTool('create_file', { permission: 'DANGEROUS_ASK' }))

    expect(registry.isDangerous('read_file')).toBe(false)
    expect(registry.isDangerous('create_file')).toBe(true)
  })

  it('identifies tools needing approval', () => {
    registry.register(makeTool('read', { permission: 'AUTO' }))
    registry.register(makeTool('edit', { permission: 'PROJECT_ASK' }))
    registry.register(makeTool('create', { permission: 'DANGEROUS_ASK' }))

    expect(registry.needsApproval('read')).toBe(false)
    expect(registry.needsApproval('edit')).toBe(true)
    expect(registry.needsApproval('create')).toBe(true)
  })
})
