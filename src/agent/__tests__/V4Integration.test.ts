// ── V4 Integration Smoke Tests ──
// Verifies the complete chain: Bridge → Runtime → Loop → Result

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { V4UnifiedRuntime } from '../runtime/V4UnifiedRuntime'
import { OpenAIAdapter } from '../runtime/adapters/OpenAIAdapter'
import { V4SecurityFence } from '../V4SecurityFence'
import { buildSystemPrompt, CORE_SYSTEM_PROMPT } from '../V4SystemPrompt'
import { toolRegistry } from '../skills/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'
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
    expect(CORE_SYSTEM_PROMPT).toContain('__FULL_REPLACE__')
    expect(CORE_SYSTEM_PROMPT).toContain('read_file')
    expect(CORE_SYSTEM_PROMPT).toContain('list_directory')
  })

  // v15.6: 大文件精准修改流程引导（先定位再精确读 + 去重提示理解）
  it('v15.6: 包含大文件精准修改流程与去重提示理解', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('大文件精准修改流程')
    expect(CORE_SYSTEM_PROMPT).toContain('search_content')
    expect(CORE_SYSTEM_PROMPT).toContain('offset, limit')
    expect(CORE_SYSTEM_PROMPT).toContain('已读取过该文件此范围')
    expect(CORE_SYSTEM_PROMPT).toContain('该文件已修改')
  })

  it('buildSystemPrompt v13.2.0: core + 写作规范手册引用 (瘦身至外部文件)', async () => {
    const prompt = await buildSystemPrompt()
    expect(prompt).toContain('青剑')
    expect(prompt).toContain('写作规范手册')
    // v13.2.0: 手册内容已移到 .aiharness/templates/writing-handbook/，此处仅剩引用索引
    expect(prompt).toContain('writing-handbook/outline.md')
    expect(prompt).toContain('writing-handbook/characters.md')
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

  it('external paths need no approval (v14.5.1 全自由模式)', () => {
    // Deep traversal → allowed, no approval
    const r1 = fence.check('read_file', { file_path: '../../../etc/passwd' })
    expect(r1.allowed).toBe(true)
    expect(r1.needsApproval).toBe(false)
    // Absolute non-system path → allowed, no approval
    const r2 = fence.check('read_file', { file_path: 'C:/Users/test/data.txt' })
    expect(r2.allowed).toBe(true)
    expect(r2.needsApproval).toBe(false)
  })

  it('requires approval only for remaining gated tools', () => {
    // delete_file 已 AUTO（自动备份兜底）
    const result = fence.check('delete_file', { file_path: 'chapters/ch3.txt' })
    expect(result.allowed).toBe(true)
    expect(result.needsApproval).toBe(false)
    // update_prompt 仍为 PROJECT_ASK
    const promptResult = fence.check('update_prompt', { title: 't', content: 'c' })
    expect(promptResult.allowed).toBe(true)
    expect(promptResult.needsApproval).toBe(true)
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
    const adapter = new OpenAIAdapter(ai)
    const runtime = new V4UnifiedRuntime({
      configId: 'test-config',
      projectId: null,
      maxIterations: 5,
      abortSignal: new AbortController().signal,
      skipAnalyze: true,
      skipSkillGate: true,
    }, adapter)
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
  // SKIP: 基础工具调用链路已由 V4AgentRuntime 集成测试覆盖
  it.skip('calls tools then responds', async () => {
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
    const adapter = new OpenAIAdapter(ai)
    const runtime = new V4UnifiedRuntime({
      configId: 'test-config',
      projectId: null,
      maxIterations: 5,
      abortSignal: new AbortController().signal,
      skipAnalyze: true,
      skipSkillGate: true,
    }, adapter)
    runtime.setToolExecutor(toolExecutor)
    runtime.setTools([])

    const result = await runtime.run({
      userMessage: '读大纲',
      attachments: [],
    })

    // v11.5.1: nudge/deadlock detection pushes "write now" after read-only tool,
    // causing extra API calls. The mock's question-text doesn't match _isAskingUser regex.
    expect(ai.chatWithTools).toHaveBeenCalledTimes(5)
    expect(toolExecutor).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toBe(1)
    expect(result.toolsUsed).toContain('read_file')
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
    expect(names.length).toBeGreaterThanOrEqual(25)  // v13.2.0: 27 tools
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
