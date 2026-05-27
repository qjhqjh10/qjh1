import { describe, it, expect, beforeEach } from 'vitest'
import { SubAgentManager, SUB_AGENTS } from '../subagents/SubAgentManager'
import { ToolRegistry } from '../tools/ToolRegistry'
import type { ToolDefinition } from '../tools/ToolRegistry'

function makeReadTool(): ToolDefinition {
  return {
    schema: {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: 'path' } },
        required: ['file_path'],
      },
    },
    permission: 'AUTO',
    category: 'file',
    availableInPlanMode: true,
    executor: async () => ({ status: 'success', summary: 'File read successfully' }),
  }
}

function makeNoteTool(): ToolDefinition {
  return {
    schema: {
      name: 'write_note',
      description: 'Write a note',
      parameters: {
        type: 'object',
        properties: { note_name: { type: 'string', description: 'note name' }, content: { type: 'string', description: 'content' } },
        required: ['note_name', 'content'],
      },
    },
    permission: 'READ_ASK',
    category: 'note',
    availableInPlanMode: true,
    executor: async () => ({ status: 'success', summary: 'Note written' }),
  }
}

describe('SubAgentManager', () => {
  let registry: ToolRegistry
  let manager: SubAgentManager

  beforeEach(() => {
    registry = new ToolRegistry()
    registry.register(makeReadTool())
    registry.register(makeNoteTool())
    manager = new SubAgentManager(registry)
  })

  it('has 6 pre-built sub-agents', () => {
    expect(SUB_AGENTS).toHaveLength(6)
  })

  it('lists all agents', () => {
    const agents = manager.listAgents()
    expect(agents).toHaveLength(6)
  })

  it('can get agent by name', () => {
    const agent = manager.getAgent('chapter-planner')
    expect(agent).toBeDefined()
    expect(agent!.purpose).toContain('章节')
  })

  it('returns undefined for unknown agent', () => {
    expect(manager.getAgent('non-existent')).toBeUndefined()
  })

  it('can define custom agents', () => {
    manager.defineAgent({
      name: 'custom-agent',
      purpose: 'Custom analysis',
      toolNames: ['read_file', 'write_note'],
      contextProviderDomains: ['core-rules'],
      maxIterations: 2,
      systemPrompt: 'You are a custom agent.',
    })
    expect(manager.getAgent('custom-agent')).toBeDefined()
    expect(manager.listAgents()).toHaveLength(7)
  })

  it('overwrites existing agent with same name', () => {
    manager.defineAgent({
      name: 'chapter-planner',
      purpose: 'Updated purpose',
      toolNames: ['read_file'],
      contextProviderDomains: ['core-rules'],
      maxIterations: 1,
      systemPrompt: 'Updated prompt.',
    })
    const agent = manager.getAgent('chapter-planner')
    expect(agent!.purpose).toBe('Updated purpose')
    expect(agent!.maxIterations).toBe(1)
  })

  it('chapter-planner has correct tools', () => {
    const agent = manager.getAgent('chapter-planner')!
    expect(agent.toolNames).toContain('read_file')
    expect(agent.toolNames).toContain('write_note')
    expect(agent.toolNames).not.toContain('create_project')
  })

  it('style-analyzer has style-related tools', () => {
    const agent = manager.getAgent('style-analyzer')!
    expect(agent.toolNames).toContain('create_style_template')
    expect(agent.contextProviderDomains).toContain('style')
  })

  it('consistency-checker has search tools', () => {
    const agent = manager.getAgent('consistency-checker')!
    expect(agent.toolNames).toContain('search_content')
    expect(agent.toolNames).toContain('search_files')
  })

  it('scene-builder has template creation tools', () => {
    const agent = manager.getAgent('scene-builder')!
    expect(agent.toolNames).toContain('create_scene_template')
  })

  it('knowledge-curator has KB tools', () => {
    const agent = manager.getAgent('knowledge-curator')!
    expect(agent.toolNames).toContain('kb_list')
    expect(agent.toolNames).toContain('kb_create_file')
  })

  it('all agents have system prompts', () => {
    for (const agent of SUB_AGENTS) {
      expect(agent.systemPrompt.length).toBeGreaterThan(50)
    }
  })

  it('all agents have limited tool sets (not all tools)', () => {
    for (const agent of SUB_AGENTS) {
      expect(agent.toolNames.length).toBeLessThan(10) // focused, not all 26
    }
  })

  it('delegate returns error for unknown agent', async () => {
    const result = await manager.delegate('non-existent', 'test', 'cfg', null)
    expect(result.status).toBe('error')
    expect(result.summary).toContain('未找到')
  })
})
