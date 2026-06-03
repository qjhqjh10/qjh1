// ── V4 Integration Smoke Tests ──
// Verifies the complete chain: Bridge → Runtime → Loop → Result

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { V4AgentRuntime } from '../V4AgentRuntime'
import { V4SecurityFence } from '../V4SecurityFence'
import { buildSystemPrompt, selectDomainModules, CORE_SYSTEM_PROMPT, CHARACTER_DOMAIN_MODULE, CHAPTER_DOMAIN_MODULE, STYLE_DOMAIN_MODULE } from '../V4SystemPrompt'
import { toolRegistry } from '../tools/ToolRegistry'
import { ALL_TOOLS } from '../tools/definitions'
import type { Message, ToolCallRequest } from '../state/types'

// ── Test setup ──

// Register tools once
toolRegistry.registerAll(ALL_TOOLS)

function makeMockAIService(responses: Array<{ text: string; toolCalls?: ToolCallRequest[] }>) {
  let callIndex = 0
  return {
    chatWithTools: vi.fn(async (_msgs: Message[], _cid: string, _pid?: string, _tools?: unknown[]) => {
      const resp = responses[callIndex] || { text: '完成。' }
      callIndex++
      return {
        text: resp.text || '',
        toolCalls: resp.toolCalls || null,
        finishReason: resp.toolCalls ? 'tool_calls' : 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0 },
      }
    }),
    abortStream: vi.fn(),
  }
}

function makeMockToolExecutor(responses: Record<string, { status: 'success' | 'error'; summary: string }>) {
  return vi.fn(async (args: Record<string, unknown>, _ctx: any) => {
    const key = JSON.stringify(args)
    if (responses[key]) return responses[key]
    return { status: 'success' as const, summary: '操作完成' }
  })
}

// ── Tests ──

describe('V4 System Prompt', () => {
  it('core prompt is not empty and has key sections', () => {
    expect(CORE_SYSTEM_PROMPT.length).toBeGreaterThan(100)
    expect(CORE_SYSTEM_PROMPT).toContain('青剑')
    expect(CORE_SYSTEM_PROMPT).toContain('铁律')
    expect(CORE_SYSTEM_PROMPT).toContain('规则')
    expect(CORE_SYSTEM_PROMPT).toContain('list_directory')
  })

  it('selectDomainModules picks relevant modules', () => {
    expect(selectDomainModules('创建角色张三')).toContain(CHARACTER_DOMAIN_MODULE)
    expect(selectDomainModules('写第3章正文')).toContain(CHAPTER_DOMAIN_MODULE)
    expect(selectDomainModules('分析风格')).toContain(STYLE_DOMAIN_MODULE)
    expect(selectDomainModules('你好')).toEqual([])
  })

  it('buildSystemPrompt combines core + modules', () => {
    const prompt = buildSystemPrompt([
      CHARACTER_DOMAIN_MODULE,
    ], '测试项目', '测试上下文')
    expect(prompt).toContain('青剑')
    expect(prompt).toContain('角色操作')
    expect(prompt).toContain('测试项目')
    expect(prompt).toContain('测试上下文')
  })
})

describe('V4 Security Fence', () => {
  let fence: V4SecurityFence

  beforeEach(() => {
    fence = new V4SecurityFence('test-project')
  })

  it('allows normal relative paths', () => {
    const result = fence.check('read_file', { file_path: 'outline/plot.md' })
    expect(result.allowed).toBe(true)
    expect(result.needsApproval).toBe(false)
  })

  it('blocks system paths', () => {
    // System paths still hard-blocked
    expect(fence.check('read_file', { file_path: 'C:/Windows/system32/test.txt' }).allowed).toBe(false)
    expect(fence.check('read_file', { file_path: '/etc/passwd' }).allowed).toBe(false)
  })

  it('external paths require approval', () => {
    // Deep traversal → needs approval (fence warns before IPC resolution)
    const r1 = fence.check('read_file', { file_path: '../../../etc/passwd' })
    expect(r1.allowed).toBe(true)
    expect(r1.needsApproval).toBe(true)
    // Absolute non-system path → needs approval
    const r2 = fence.check('read_file', { file_path: 'C:/Users/test/data.txt' })
    expect(r2.allowed).toBe(true)
    expect(r2.needsApproval).toBe(true)
  })

  it('requires approval for dangerous tools', () => {
    const result = fence.check('delete_file', { file_path: 'chapters/ch3.txt' })
    expect(result.allowed).toBe(true)
    expect(result.needsApproval).toBe(true)
  })

  it('validates JSON format for .json files', () => {
    const result = fence.check('create_file', { file_path: 'characters/test.json', content: '{invalid}' })
    expect(result.allowed).toBe(false)
  })

  it('allows valid JSON', () => {
    const result = fence.check('create_file', { file_path: 'characters/test.json', content: '{"name":"test"}' })
    expect(result.allowed).toBe(true)
  })
})

describe('V4 Agent Runtime (chat mode)', () => {
  it('returns text directly when AI responds without tools', async () => {
    const ai = makeMockAIService([{ text: '你好！有什么可以帮你的？' }])
    const runtime = new V4AgentRuntime({
      configId: 'test-config',
      projectId: null,
      maxIterations: 5,
      abortSignal: new AbortController().signal,
    })
    runtime.setAIService(ai)
    runtime.setToolExecutor(makeMockToolExecutor({}))
    runtime.setTools([])

    const result = await runtime.run({
      userMessage: '你好',
      attachments: [],
    })

    expect(result.text).toBe('你好！有什么可以帮你的？')
    expect(result.toolCalls).toBe(0)
    expect(result.success).toBe(true)
    expect(ai.chatWithTools).toHaveBeenCalledTimes(1)
  })
})

describe('V4 Agent Runtime (task mode)', () => {
  it('calls tools then responds', async () => {
    const ai = makeMockAIService([
      {
        text: '让我读一下文件',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{"file_path":"outline/plot.md"}' }],
      },
      { text: '文件内容显示故事在第三章达到高潮。需要我帮你写第三章吗？' },
    ])
    const toolExecutor = makeMockToolExecutor({
      '{"file_path":"outline/plot.md"}': { status: 'success', summary: '读取成功' },
    })
    const runtime = new V4AgentRuntime({
      configId: 'test-config',
      projectId: null,
      maxIterations: 5,
      abortSignal: new AbortController().signal,
    })
    runtime.setAIService(ai)
    runtime.setToolExecutor(toolExecutor)
    runtime.setTools([])

    const result = await runtime.run({
      userMessage: '读大纲',
      attachments: [],
    })

    expect(ai.chatWithTools).toHaveBeenCalledTimes(2)
    expect(toolExecutor).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toBe(1)
    expect(result.toolsUsed).toContain('read_file')
    expect(result.text).toContain('高潮')
  })
})

describe('Tool Registry', () => {
  it('has all tools registered', () => {
    const names = toolRegistry.getNames()
    expect(names).toContain('read_file')
    expect(names).toContain('create_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('delete_file')
    expect(names).toContain('list_directory')
    expect(names).toContain('search_content')
    expect(names.length).toBeGreaterThanOrEqual(29)
  })

  it('executes a tool and returns result', async () => {
    const result = await toolRegistry.execute('list_directory', { dir_path: 'test' }, {
      projectId: null,
      configId: 'test',
      callId: 'test',
      toolName: 'list_directory',
      signal: new AbortController().signal,
    })
    expect(result.status).toBeDefined()
  })
})
