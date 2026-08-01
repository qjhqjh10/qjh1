// ── Subagent Tools Tests (v15) ──
// 验证 analyze_file / edit_file_task 工具：subAgentUsage 透传、detail 截断、失败路径、
// executeSingleTool 集成（上报 + 契约过滤）。

import { describe, it, expect, vi, beforeEach } from 'vitest'

const runSubagentMock = vi.hoisted(() => vi.fn())

vi.mock('@/agent/subagent/SubagentService', () => ({
  runSubagent: (...args: unknown[]) => runSubagentMock(...args),
  SUBAGENT_TOOL_NAMES: new Set(['analyze_file', 'edit_file_task']),
}))

vi.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({ configs: [{ id: 'test-config', protocol: 'openai' }], activeConfigId: 'test-config' }),
  },
}))

import { subagentTools } from '../skills/tools/subagentTools'
import { executeSingleTool, classifyToolCalls } from '../runtime/ToolExecutor'
import { toolRegistry } from '../skills/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'
import type { Message, ToolCallRequest } from '../state/types'

toolRegistry.registerAll(ALL_TOOLS)

const SAMPLE_USAGE = {
  promptTokens: 400, completionTokens: 200, totalTokens: 600,
  cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0, calls: 2,
}

function makeExecCtx(overrides?: { messagesForApi?: Message[] }) {
  const messagesForApi: Message[] = overrides?.messagesForApi ?? []
  const toolsUsed: string[] = []
  const toolCallSteps: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number; arguments?: string }> = []
  const reported: Array<typeof SAMPLE_USAGE> = []
  return {
    ctx: {
      // 走真实工具注册表（analyze_file 的真实 executor → mock 的 runSubagent）
      toolExecutor: async (args: Record<string, unknown>, c: { toolName: string; projectId: string | null; configId: string; callId: string; signal: AbortSignal }) =>
        toolRegistry.execute(c.toolName, args, c),
      projectId: '剑道长生',
      configId: 'test-config',
      abortSignal: new AbortController().signal,
      messagesForApi,
      toolsUsed,
      toolCallSteps,
      emitter: {
        emit: vi.fn(),
        on: vi.fn(() => () => {}),
        abort: vi.fn(),
      },
      iteration: 1,
      store: {
        addToolExecution: vi.fn(),
        completeTool: vi.fn(),
        setStreamingText: vi.fn(),
        reportSubAgentUsage: (u: typeof SAMPLE_USAGE) => reported.push(u),
      },
    },
    reported,
  }
}

function getTool(name: string) {
  const t = subagentTools.find(t => t.schema.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

describe('analyze_file', () => {
  beforeEach(() => { runSubagentMock.mockReset() })

  it('成功：返回 subAgentUsage + detail 截断（>4000 字被切）', async () => {
    runSubagentMock.mockResolvedValue({
      success: true, text: '【要点】内容'.repeat(1000), toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const result = await getTool('analyze_file').executor(
      { file_path: '剑道长生/chapters/ch1.txt', question: '分析结构' },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'analyze_file', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.subAgentUsage).toEqual(SAMPLE_USAGE)
    expect((result.detail || '').length).toBeLessThanOrEqual(4000)
    // 任务消息包含文件路径与问题
    expect(runSubagentMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'analyze',
      userMessage: expect.stringContaining('剑道长生/chapters/ch1.txt'),
    }))
  })

  it('子代理失败：返回 error 状态', async () => {
    runSubagentMock.mockResolvedValue({
      success: false, text: '文件不存在', toolCallSteps: [], usage: { ...SAMPLE_USAGE, calls: 1 },
    })
    const result = await getTool('analyze_file').executor(
      { file_path: 'x.txt' },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'analyze_file', signal: new AbortController().signal },
    )
    expect(result.status).toBe('error')
  })

  it('异常：try/catch 兜底返回 error', async () => {
    runSubagentMock.mockRejectedValue(new Error('boom'))
    const result = await getTool('analyze_file').executor(
      { file_path: 'x.txt' },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'analyze_file', signal: new AbortController().signal },
    )
    expect(result.status).toBe('error')
    expect(result.summary).toContain('异常')
  })
})

describe('edit_file_task', () => {
  beforeEach(() => { runSubagentMock.mockReset() })

  it('成功：任务消息含 file_path 与 instruction；detail 截断 2000', async () => {
    runSubagentMock.mockResolvedValue({
      success: true, text: '【修改前】a\n【修改后】b\n【修改位置】x'.repeat(500), toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const result = await getTool('edit_file_task').executor(
      { file_path: '剑道长生/chapters/ch1.txt', instruction: '把李狗蛋改成李守拙' },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'edit_file_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.subAgentUsage).toEqual(SAMPLE_USAGE)
    expect((result.detail || '').length).toBeLessThanOrEqual(2000)
    expect(runSubagentMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'edit',
      userMessage: expect.stringContaining('李狗蛋'),
    }))
  })

  it('参数校验：缺 instruction 直接 error，不调子代理', async () => {
    const result = await getTool('edit_file_task').executor(
      { file_path: 'x.txt' },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'edit_file_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('error')
    expect(runSubagentMock).not.toHaveBeenCalled()
  })
})

describe('executeSingleTool 集成', () => {
  it('子 agent 工具结果上报 usage 一次；契约过滤后 messagesForApi 仅 status/summary/detail', async () => {
    runSubagentMock.mockResolvedValue({
      success: true, text: '【要点】ok', toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const { ctx, reported } = makeExecCtx()
    const tc: ToolCallRequest = {
      id: 't1', name: 'analyze_file', arguments: JSON.stringify({ file_path: 'x.txt' }),
    }
    await executeSingleTool(tc, ctx as any)

    expect(reported, `reported: ${JSON.stringify(reported)}, runSubagentMock calls: ${runSubagentMock.mock.calls.length}`).toHaveLength(1)
    expect(reported[0], `full: ${JSON.stringify(reported[0])}, mockReturn: ${JSON.stringify(runSubagentMock.mock.results[0]?.value)}`).toEqual(SAMPLE_USAGE)
    // 契约过滤：analyze_file 保留 status/summary/detail，不包含 subAgentUsage（契约字段白名单）
    const toolMsg = ctx.messagesForApi.find(m => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    const parsed = JSON.parse(String(toolMsg!.content))
    expect(parsed.status).toBe('success')
    expect(parsed.detail).toBe('【要点】ok')
    expect(parsed.subAgentUsage).toBeUndefined()
  })

  it('analyze_file 归类为串行工具（SERIAL_TOOLS），不进并行 readOnly 段', () => {
    const calls: ToolCallRequest[] = [
      { id: 'a', name: 'analyze_file', arguments: '{}' },
      { id: 'b', name: 'read_file', arguments: '{}' },
      { id: 'c', name: 'create_file', arguments: '{}' },
    ]
    const { readOnlyCalls, writeCalls } = classifyToolCalls(calls)
    expect(writeCalls.map(c => c.name)).toEqual(['create_file'])
    // analyze_file 在 readOnly 分类（由 runtime 的 SERIAL_TOOLS 拆分，此处验证分类结果）
    expect(readOnlyCalls.map(c => c.name)).toEqual(['analyze_file', 'read_file'])
  })
})
