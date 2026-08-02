// ── Subagent Tools Tests (v15) ──
// 验证 analyze_file / edit_file_task 工具：subAgentUsage 透传、detail 截断、失败路径、
// executeSingleTool 集成（上报 + 契约过滤）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const runSubagentMock = vi.hoisted(() => vi.fn())

vi.mock('@/agent/subagent/SubagentService', () => ({
  runSubagent: (...args: unknown[]) => runSubagentMock(...args),
  SUBAGENT_TOOL_NAMES: new Set(['analyze_file', 'edit_file_task', 'verify_task', 'subagent_ask', 'kb_analyze']),
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
  // v14.3: 子代理快照收集器（v15 起 ToolExecContext 必填字段）
  const subagentSummaries: Array<{ tool: string; filePath: string; status: string; summary: string; detail: string; iteration: number }> = []
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
      subagentSummaries,
      store: {
        addToolExecution: vi.fn(),
        completeTool: vi.fn(),
        setStreamingText: vi.fn(),
        reportSubAgentUsage: (u: typeof SAMPLE_USAGE) => reported.push(u),
      },
    },
    reported,
    subagentSummaries,
  }
}

function getTool(name: string) {
  const t = subagentTools.find(t => t.schema.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

describe('analyze_file', () => {
  beforeEach(() => { runSubagentMock.mockReset() })

  it('成功：返回 subAgentUsage + detail 截断（>8000 字被切）+ 会话 key 透传', async () => {
    runSubagentMock.mockResolvedValue({
      success: true, text: '【要点】内容'.repeat(2000), toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const result = await getTool('analyze_file').executor(
      { file_path: '剑道长生/chapters/ch1.txt', question: '分析结构' },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'analyze_file', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.subAgentUsage).toEqual(SAMPLE_USAGE)
    expect((result.detail || '').length).toBeLessThanOrEqual(8000)
    // 任务消息包含文件路径与问题；会话 key 供 subagent_ask 追问复用
    expect(runSubagentMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'analyze',
      userMessage: expect.stringContaining('剑道长生/chapters/ch1.txt'),
      sessionKey: '剑道长生::剑道长生/chapters/ch1.txt',
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

  it('成功：任务消息含 file_path 与 instruction；detail 截断 4000', async () => {
    runSubagentMock.mockResolvedValue({
      success: true, text: '【修改前】a\n【修改后】b\n【修改位置】x'.repeat(500), toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const result = await getTool('edit_file_task').executor(
      { file_path: '剑道长生/chapters/ch1.txt', instruction: '把李狗蛋改成李守拙' },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'edit_file_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.subAgentUsage).toEqual(SAMPLE_USAGE)
    expect((result.detail || '').length).toBeLessThanOrEqual(4000)
    expect(runSubagentMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'edit',
      userMessage: expect.stringContaining('李狗蛋'),
      // v14.9: key 加 role 前缀——防覆盖同路径 analyze 会话（原共用 key 互相销毁）
      sessionKey: '剑道长生::edit::剑道长生/chapters/ch1.txt',
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

  it('v14.3: 子代理执行快照收集（tool/filePath/status/detail 截断 ≤1500/iteration）', async () => {
    runSubagentMock.mockResolvedValue({
      success: true, text: '【要点】详情'.repeat(500), toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const { ctx, subagentSummaries } = makeExecCtx()
    const tc: ToolCallRequest = {
      id: 't2', name: 'analyze_file', arguments: JSON.stringify({ file_path: '剑道长生/chapters/ch1.txt' }),
    }
    await executeSingleTool(tc, ctx as any)

    expect(subagentSummaries).toHaveLength(1)
    expect(subagentSummaries[0]).toMatchObject({
      tool: 'analyze_file',
      filePath: '剑道长生/chapters/ch1.txt',
      status: 'success',
      iteration: 1,
    })
    expect(subagentSummaries[0].detail.length).toBeLessThanOrEqual(1500)
  })

  it('v14.3: 子代理失败也收集快照（含失败原因）；参数校验失败不收集', async () => {
    // 子代理失败（usage 仍存在）→ 收集，status=error
    runSubagentMock.mockResolvedValue({
      success: false, text: '无法定位目标', toolCallSteps: [], usage: { ...SAMPLE_USAGE, calls: 1 },
    })
    const { ctx: ctx1, subagentSummaries: s1 } = makeExecCtx()
    await executeSingleTool(
      { id: 't3', name: 'edit_file_task', arguments: JSON.stringify({ file_path: 'a.txt', instruction: '改' }) },
      ctx1 as any,
    )
    expect(s1).toHaveLength(1)
    expect(s1[0]).toMatchObject({ tool: 'edit_file_task', status: 'error' })

    // 参数校验失败（无 usage）→ 不收集
    runSubagentMock.mockClear()
    const { ctx: ctx2, subagentSummaries: s2 } = makeExecCtx()
    await executeSingleTool(
      { id: 't4', name: 'verify_task', arguments: JSON.stringify({ file_paths: [], criteria: ['存在'] }) },
      ctx2 as any,
    )
    expect(s2).toHaveLength(0)
  })

  it('analyze_file 归类为只读并行工具（PARALLEL_READ_TOOLS），不进写段', () => {
    const calls: ToolCallRequest[] = [
      { id: 'a', name: 'analyze_file', arguments: '{}' },
      { id: 'b', name: 'read_file', arguments: '{}' },
      { id: 'c', name: 'create_file', arguments: '{}' },
    ]
    const { readOnlyCalls, writeCalls } = classifyToolCalls(calls)
    expect(writeCalls.map(c => c.name)).toEqual(['create_file'])
    // analyze_file 在 readOnly 分类（runtime 对 readOnly 段再按 PARALLEL_READ_TOOLS 并行分片）
    expect(readOnlyCalls.map(c => c.name)).toEqual(['analyze_file', 'read_file'])
  })
})

describe('verify_task', () => {
  beforeEach(() => { runSubagentMock.mockReset() })

  it('成功：任务消息含文件清单与验收标准；JSON 解析为结构化 detail + summary 未通过三态', async () => {
    runSubagentMock.mockResolvedValue({
      success: true,
      text: '{"passed": false, "items": [{"criterion": "角色卡包含姓名", "passed": true, "reason": "已包含"}, {"criterion": "角色卡包含性格字段", "passed": false, "reason": "缺少"}]}',
      toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const result = await getTool('verify_task').executor(
      { file_paths: ['剑道长生/characters/陆沉.yaml'], criteria: ['角色卡包含姓名', '角色卡包含性格字段'] },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.subAgentUsage).toEqual(SAMPLE_USAGE)
    expect(runSubagentMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'verify' }))
    // JSON 解析 → 结构化 detail（passed/items）
    const parsed = JSON.parse(result.detail || '')
    expect(parsed.passed).toBe(false)
    expect(parsed.items).toHaveLength(2)
    expect(parsed.items[1]).toMatchObject({ criterion: '角色卡包含性格字段', passed: false })
    // v14.3: summary 三态 — 未通过（运行时督促依据）
    expect(result.summary).toBe('验收未通过: 1/2 条标准未满足')
  })

  it('v14.3: 验收通过 → summary "验收通过"（闸门释放依据）', async () => {
    runSubagentMock.mockResolvedValue({
      success: true,
      text: '{"passed": true, "items": [{"criterion": "文件存在", "passed": true, "reason": "存在"}]}',
      toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const result = await getTool('verify_task').executor(
      { file_paths: ['a.md'], criteria: ['文件存在'] },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(result.summary).toBe('验收通过: 1 条标准全部满足')
  })

  it('子代理返回非 JSON 文本 → detail 原样保留 + summary 中性（不触发督促）', async () => {
    runSubagentMock.mockResolvedValue({
      success: true, text: '【总判定】通过\n【逐项】1. 文件存在: 通过', toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const result = await getTool('verify_task').executor(
      { file_paths: ['a.md'], criteria: ['文件存在'] },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.detail).toContain('【总判定】通过')
    expect(result.summary).toContain('验收完成')
  })

  it('参数校验：file_paths / criteria 为空直接 error，不调子代理', async () => {
    const r1 = await getTool('verify_task').executor(
      { file_paths: [], criteria: ['文件存在'] },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(r1.status).toBe('error')
    const r2 = await getTool('verify_task').executor(
      { file_paths: ['a.md'], criteria: [] },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(r2.status).toBe('error')
    expect(runSubagentMock).not.toHaveBeenCalled()
  })

  it('子代理失败：返回 error 状态', async () => {
    runSubagentMock.mockResolvedValue({
      success: false, text: '文件不存在', toolCallSteps: [], usage: { ...SAMPLE_USAGE, calls: 1 },
    })
    const result = await getTool('verify_task').executor(
      { file_paths: ['x.txt'], criteria: ['存在'] },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('error')
  })
})

describe('subagent_ask (v14.3)', () => {
  beforeEach(() => { runSubagentMock.mockReset() })

  it('成功：role=analyze + 会话 key + 追问消息（含"文件可能已修改"提醒）；detail 截断 8000', async () => {
    runSubagentMock.mockResolvedValue({
      success: true, text: '【结论】第2章开头…'.repeat(500), toolCallSteps: [], usage: SAMPLE_USAGE,
    })
    const result = await getTool('subagent_ask').executor(
      { file_path: '剑道长生/chapters/ch2.txt', question: '第2章开头主角在做什么？' },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'subagent_ask', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.subAgentUsage).toEqual(SAMPLE_USAGE)
    expect((result.detail || '').length).toBeLessThanOrEqual(8000)
    expect(runSubagentMock).toHaveBeenCalledWith(expect.objectContaining({
      role: 'analyze',
      sessionKey: '剑道长生::剑道长生/chapters/ch2.txt',
      userMessage: expect.stringContaining('追问: 第2章开头主角在做什么？'),
    }))
    expect(runSubagentMock.mock.calls[0][0].userMessage).toContain('文件可能已修改')
  })

  it('参数校验：缺 question 直接 error，不调子代理', async () => {
    const result = await getTool('subagent_ask').executor(
      { file_path: 'x.txt' },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'subagent_ask', signal: new AbortController().signal },
    )
    expect(result.status).toBe('error')
    expect(runSubagentMock).not.toHaveBeenCalled()
  })

  it('子代理失败：返回 error 状态', async () => {
    runSubagentMock.mockResolvedValue({
      success: false, text: '会话已失效', toolCallSteps: [], usage: { ...SAMPLE_USAGE, calls: 1 },
    })
    const result = await getTool('subagent_ask').executor(
      { file_path: 'x.txt', question: '细节' },
      { projectId: null, configId: 'test-config', callId: 'c1', toolName: 'subagent_ask', signal: new AbortController().signal },
    )
    expect(result.status).toBe('error')
  })
})

describe('verify_task JSON 解析 (v14.5.0)', () => {
  beforeEach(() => { runSubagentMock.mockReset() })

  const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0, calls: 0 }

  it('正文含嵌套 {} 与尾部散文 → 配对提取首个 JSON，passed 判定正确', async () => {
    runSubagentMock.mockResolvedValue({
      success: true,
      text: '验收报告 {"passed":false,"items":[{"name":"A","passed":false},{"name":"B","passed":true}]} 补充说明：注意对象 { 括号 } 不是 JSON。',
      toolCallSteps: [], usage: ZERO_USAGE,
    })
    const result = await getTool('verify_task').executor(
      { file_paths: ['剑道长生/x.md'], criteria: ['存在'] },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.summary).toContain('验收未通过')
    expect(String(result.detail)).toContain('"passed":false')
    expect(String(result.detail)).toContain('"name":"A"')
  })

  it('坏 JSON + 关键词"验收未通过" → 降级 passed=false（督促闭环保留）', async () => {
    runSubagentMock.mockResolvedValue({
      success: true,
      text: '验收未通过：文件缺失。{broken json 没有闭合',
      toolCallSteps: [], usage: ZERO_USAGE,
    })
    const result = await getTool('verify_task').executor(
      { file_paths: ['剑道长生/x.md'], criteria: ['存在'] },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.summary).toContain('验收未通过')
  })

  it('纯散文无关键词 → 中性"验收完成"', async () => {
    runSubagentMock.mockResolvedValue({
      success: true,
      text: '文件结构合理，内容完整。',
      toolCallSteps: [], usage: ZERO_USAGE,
    })
    const result = await getTool('verify_task').executor(
      { file_paths: ['剑道长生/x.md'], criteria: ['存在'] },
      { projectId: '剑道长生', configId: 'test-config', callId: 'c1', toolName: 'verify_task', signal: new AbortController().signal },
    )
    expect(result.status).toBe('success')
    expect(result.summary).toContain('验收完成')
  })
})

describe('executeSingleTool 超时 abort (v14.5.0)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const TIMEOUT_TOOL = 'analyze_file'  // PER_TOOL_TIMEOUT_MS 300s；fake timers 下即时推进

  it('子代理工具超时 → 传入 executor 的 signal 被 abort（不再孤儿运行）', async () => {
    let capturedSignal: AbortSignal | undefined
    const hanging = vi.fn(async (_args: Record<string, unknown>, c: { signal: AbortSignal }) => {
      capturedSignal = c.signal
      await new Promise(() => {})  // 永不结算
    })
    const tc: ToolCallRequest = { id: 'c1', name: TIMEOUT_TOOL, arguments: '{}' }
    const { ctx } = makeExecCtx()
    const execPromise = executeSingleTool(tc, { ...ctx, toolExecutor: hanging } as any)
    // 超时（300s fake）→ 返回 error + signal abort
    const done = vi.advanceTimersByTimeAsync(300_000).then(() => execPromise)
    await done
    expect(capturedSignal?.aborted).toBe(true)
    const toolStep = ctx.toolCallSteps[0]
    expect(toolStep.status).toBe('error')
    expect(toolStep.summary).toContain('执行超时')
  })

  it('非子代理工具超时 → signal 不被 abort（行为不变）', async () => {
    let capturedSignal: AbortSignal | undefined
    const hanging = vi.fn(async (_args: Record<string, unknown>, c: { signal: AbortSignal }) => {
      capturedSignal = c.signal
      await new Promise(() => {})  // 永不结算
    })
    const tc: ToolCallRequest = { id: 'c1', name: 'read_file', arguments: '{}' }
    const { ctx } = makeExecCtx()
    const execPromise = executeSingleTool(tc, { ...ctx, toolExecutor: hanging } as any)
    await vi.advanceTimersByTimeAsync(120_000).then(() => execPromise)
    expect(capturedSignal?.aborted).toBe(false)
  })

  it('超时落败后迟到 resolve 带 subAgentUsage → 照常补记（用量不丢失）', async () => {
    let resolveLate: ((v: any) => void) | undefined
    const late = vi.fn(async () => {
      await new Promise((res) => { resolveLate = res as (v: any) => void })
      return { status: 'success' as const, summary: '迟到成功', subAgentUsage: SAMPLE_USAGE }
    })
    const tc: ToolCallRequest = { id: 'c1', name: TIMEOUT_TOOL, arguments: '{}' }
    const { ctx, reported } = makeExecCtx()
    const execPromise = executeSingleTool(tc, { ...ctx, toolExecutor: late } as any)
    await vi.advanceTimersByTimeAsync(300_000).then(() => execPromise)
    expect(reported).toHaveLength(0)  // 超时结果无 usage → 未上报
    // 子代理"迟到"resolve → 补记
    resolveLate!({ status: 'success', summary: '迟到成功', subAgentUsage: SAMPLE_USAGE })
    await Promise.resolve()
    await Promise.resolve()
    expect(reported).toHaveLength(1)
    expect(reported[0]).toEqual(SAMPLE_USAGE)
  })
})
