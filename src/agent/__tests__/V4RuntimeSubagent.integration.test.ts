// ── V4 Runtime + Subagent Integration Tests (v15) ──
// 主 runtime + 真实 subagent 工具 + mock 子 adapter：
// subAgentUsage 累加、analyze_file 并行（PARALLEL_READ_TOOLS 分片 ≤3）、
// edit_file_task 计入 _hasWriteCall、isolatedStore 隔离、verify_task 验收。

import { describe, it, expect, vi } from 'vitest'

// ── Mocks（子 agent 的 API 与文件工具走 IPC 层）──

const subChatMock = vi.hoisted(() => vi.fn())
const subFileToolsMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/fileService', () => ({
  aiService: {
    chatWithTools: (...args: unknown[]) => subChatMock(...args),
    executeFileTools: (...args: unknown[]) => subFileToolsMock(...args),
    abortStream: vi.fn(),
  },
}))

vi.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({
      configs: [{ id: 'test-config', protocol: 'openai' }],
      activeConfigId: 'test-config',
    }),
  },
  useStore: { getState: () => ({ setFileEditNotify: vi.fn() }) },
}))

vi.mock('@/store/operationHistoryStore', () => ({
  useOpHistoryStore: { getState: () => ({ addEntry: vi.fn() }) },
}))

import { V4UnifiedRuntime } from '../runtime/V4UnifiedRuntime'
import { OpenAIAdapter } from '../runtime/adapters/OpenAIAdapter'
import { toolRegistry } from '../skills/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'
import { useAgentStore } from '../store/AgentStore'
import type { Message, ToolCallRequest, ToolResult, ToolExecutionContext } from '../state/types'
import type { OpenAIAIService as AIService } from '../runtime/adapters/OpenAIAdapter'

toolRegistry.registerAll(ALL_TOOLS)

function makeToolCall(id: string, name: string, args: Record<string, unknown>): ToolCallRequest {
  return { id, name, arguments: JSON.stringify(args) }
}

/** 子 agent 的 aiService.chatWithTools 响应（IPC 形状） */
function makeSubAIResponses(responses: Array<{ text?: string; toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }> }>) {
  let idx = 0
  subChatMock.mockImplementation(async () => {
    const r = responses[idx] ?? { text: '完成。' }
    idx++
    return {
      text: r.text ?? '',
      toolCalls: r.toolCalls ?? null,
      finishReason: r.toolCalls ? 'tool_calls' : 'stop',
      usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300, cached_tokens: 0, cost: 0 },
    }
  })
}

/** 子 agent 的文件工具（IPC mock） */
function makeSubFileTools() {
  subFileToolsMock.mockImplementation(async (calls: Array<{ callId: string; toolName: string; args: Record<string, unknown> }>) => {
    return calls.map(c => ({
      callId: c.callId,
      toolName: c.toolName,
      status: 'success',
      summary: `${c.toolName} 完成`,
      detail: c.toolName === 'read_file' ? '## 第1章\n古剑出土。'.repeat(30) : '',
    }))
  })
}

/** 主 runtime 的 mock AI */
function makeMainAI(responses: Array<{ text?: string; toolCalls?: ToolCallRequest[]; finishReason?: string }>) {
  let idx = 0
  const calls: Message[][] = []
  const svc: AIService = {
    chatWithTools: vi.fn(async (msgs: Message[]) => {
      calls.push([...msgs])
      const r = responses[idx] ?? { text: '完成。' }
      idx++
      return {
        text: r.text ?? '',
        toolCalls: r.toolCalls ?? null,
        finishReason: r.finishReason ?? (r.toolCalls ? 'tool_calls' : 'stop'),
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
      }
    }),
    abortStream: vi.fn(),
  }
  return { svc, calls, callCount: () => idx }
}

function makeMainRuntime(svc: AIService, overrides?: { maxIterations?: number }) {
  return new V4UnifiedRuntime({
    configId: 'test-config',
    projectId: 'test-project',
    maxIterations: overrides?.maxIterations ?? 10,
    abortSignal: new AbortController().signal,
    contextWindow: 128_000,
    skipAnalyze: true,
    skipSkillGate: true,
  }, new OpenAIAdapter(svc))
}

describe('V4Runtime + Subagent', () => {
  it('主 run 调 analyze_file → 子 agent 用量累加到 subAgentUsage', async () => {
    makeSubAIResponses([
      { toolCalls: [{ id: 's1', function: { name: 'read_file', arguments: '{"file_path":"test-project/chapters/ch1.txt"}' } }] },
      { text: '【要点】古剑出土\n【结论】结构完整' },
    ])
    makeSubFileTools()

    const { svc } = makeMainAI([
      { toolCalls: [makeToolCall('m1', 'analyze_file', { file_path: 'test-project/chapters/ch1.txt', question: '分析结构' })] },
      { text: '全部完成' },
    ])
    const runtime = makeMainRuntime(svc)
    // 走真实工具注册表（analyze_file 真实 executor → 真实 runSubagent → mock 的子 API）
    runtime.setToolExecutor(async (args, ctx) => toolRegistry.execute(ctx.toolName, args, ctx))
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我分析大文件的结构',
      attachments: [],
    })

    expect(result.success).toBe(true)
    // 子 agent 跑了 2 轮（read → 总结）
    expect(result.subAgentUsage).toBeDefined()
    expect(result.subAgentUsage!.calls).toBe(2)
    expect(result.subAgentUsage!.promptTokens).toBe(400)
    expect(result.subAgentUsage!.completionTokens).toBe(200)
    // 子 agent 用量不并入主 totalTokens（主 2 轮 × 300 = 600）
    expect(result.totalTokens).toBe(600)
  })

  it('同轮两个 analyze_file 并行执行（PARALLEL_READ_TOOLS），都完成且用量累加', async () => {
    makeSubAIResponses([{ text: '【要点】文件A' }, { text: '【要点】文件B' }])
    makeSubFileTools()

    const { svc } = makeMainAI([
      {
        toolCalls: [
          makeToolCall('m1', 'analyze_file', { file_path: 'a.txt' }),
          makeToolCall('m2', 'analyze_file', { file_path: 'b.txt' }),
        ],
      },
      { text: '全部完成' },
    ])
    const runtime = makeMainRuntime(svc)
    runtime.setToolExecutor(async (args, ctx) => toolRegistry.execute(ctx.toolName, args, ctx))
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '分析两个文件',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.subAgentUsage!.calls).toBe(2)
    // 两个 analyze_file 都执行了
    const analyzeSteps = result.toolCallSteps.filter(s => s.tool === 'analyze_file')
    expect(analyzeSteps).toHaveLength(2)
    expect(analyzeSteps.every(s => s.status === 'success')).toBe(true)
  })

  it('同轮 4 个 analyze_file 并发上限 ≤3（分两批 3+1），全部完成', async () => {
    // 记录每次子 API 调用的时间窗（40ms 延迟）→ 验证第一批 3 个并行、第 4 个在批后启动
    const timings: Array<{ start: number; end: number; hint: string }> = []
    subChatMock.mockImplementation(async (...args: any[]) => {
      const start = Date.now()
      await new Promise(r => setTimeout(r, 40))
      const lastMsg = args[0]?.messages?.[args[0].messages.length - 1]
      timings.push({ start, end: Date.now(), hint: String(lastMsg?.content || '').slice(0, 40) })
      return {
        text: '【要点】ok', toolCalls: null, finishReason: 'stop',
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300, cached_tokens: 0, cost: 0 },
      }
    })
    makeSubFileTools()

    const { svc } = makeMainAI([
      {
        toolCalls: [
          makeToolCall('m1', 'analyze_file', { file_path: 'a.txt' }),
          makeToolCall('m2', 'analyze_file', { file_path: 'b.txt' }),
          makeToolCall('m3', 'analyze_file', { file_path: 'c.txt' }),
          makeToolCall('m4', 'analyze_file', { file_path: 'd.txt' }),
        ],
      },
      { text: '全部完成' },
    ])
    const runtime = makeMainRuntime(svc)
    runtime.setToolExecutor(async (args, ctx) => toolRegistry.execute(ctx.toolName, args, ctx))
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({ userMessage: '分析四个文件', attachments: [] })

    expect(result.success).toBe(true)
    expect(timings).toHaveLength(4)
    // 第 1 与第 3 个时间窗重叠 → 第一批（前 3 个）并行执行
    expect(timings[2].start).toBeLessThan(timings[0].end)
    // 第 4 个在第一批全部结束后才启动 → 分批（并发上限 3）
    const firstBatchMaxEnd = Math.max(...timings.slice(0, 3).map(t => t.end))
    expect(timings[3].start).toBeGreaterThanOrEqual(firstBatchMaxEnd)
    // 4 个 analyze_file 全部成功
    const analyzeSteps = result.toolCallSteps.filter(s => s.tool === 'analyze_file')
    expect(analyzeSteps).toHaveLength(4)
    expect(analyzeSteps.every(s => s.status === 'success')).toBe(true)
    expect(result.subAgentUsage!.calls).toBe(4)
  })

  it('主 run 调 verify_task → 子代理返回 JSON 验收报告，工具步骤成功', async () => {
    makeSubAIResponses([
      { text: '{"passed": true, "items": [{"criterion": "文件存在", "passed": true, "reason": "已存在"}]}' },
    ])
    makeSubFileTools()

    const { svc } = makeMainAI([
      { toolCalls: [makeToolCall('m1', 'verify_task', { file_paths: ['test-project/chapters/ch1.txt'], criteria: ['文件存在且非空'] })] },
      { text: '全部完成' },
    ])
    const runtime = makeMainRuntime(svc)
    runtime.setToolExecutor(async (args, ctx) => toolRegistry.execute(ctx.toolName, args, ctx))
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({ userMessage: '验收产物文件', attachments: [] })

    expect(result.success).toBe(true)
    const verifySteps = result.toolCallSteps.filter(s => s.tool === 'verify_task')
    expect(verifySteps).toHaveLength(1)
    expect(verifySteps[0].status).toBe('success')
    expect(result.subAgentUsage!.calls).toBe(1)
  })

  it('edit_file_task 后模型说"完成"被接受（_hasWriteCall 计入，无 nudge 死循环）', async () => {
    // 子 agent：第一轮调 edit_file 工具（真实修改），第二轮输出修改报告
    makeSubAIResponses([
      { toolCalls: [{ id: 's1', function: { name: 'edit_file', arguments: '{"file_path":"test-project/chapters/ch1.txt","old_string":"李狗蛋","new_string":"李守拙"}' } }] },
      { text: '【修改前】李狗蛋\n【修改后】李守拙\n【修改位置】ch1.txt' },
    ])
    makeSubFileTools()

    const { svc } = makeMainAI([
      { toolCalls: [makeToolCall('m1', 'edit_file_task', { file_path: 'test-project/chapters/ch1.txt', instruction: '把李狗蛋改成李守拙' })] },
      { text: '任务完成。' },
    ])
    const runtime = makeMainRuntime(svc)
    runtime.setToolExecutor(async (args, ctx) => toolRegistry.execute(ctx.toolName, args, ctx))
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我改这个文件',
      attachments: [],
    })

    expect(result.success).toBe(true)
    // 2 轮结束（无 nudge 追加轮次）
    expect(result.iterationCount).toBe(2)
    // 子 agent 内部 2 轮（edit_file 工具轮 + 修改报告文本轮）
    expect(result.subAgentUsage!.calls).toBe(2)
  })

  it('子 agent 运行不污染共享 AgentStore（isolatedStore）', async () => {
    makeSubAIResponses([{ text: '【要点】ok' }])
    makeSubFileTools()

    const { svc } = makeMainAI([
      { toolCalls: [makeToolCall('m1', 'analyze_file', { file_path: 'a.txt' })] },
      { text: '全部完成' },
    ])
    const runtime = makeMainRuntime(svc)
    runtime.setToolExecutor(async (args, ctx) => toolRegistry.execute(ctx.toolName, args, ctx))
    runtime.setTools(toolRegistry.getCompactSchemas())

    const runStateBefore = JSON.stringify(useAgentStore.getState().run)
    const healthBefore = JSON.stringify(useAgentStore.getState().health)

    const result = await runtime.run({
      userMessage: '分析文件',
      attachments: [],
    })

    expect(result.success).toBe(true)
    // 主 agent run 结束后 store 状态正常收尾（子 agent 嵌套 run 未破坏）
    expect(JSON.stringify(useAgentStore.getState().health)).toBe(healthBefore)
    expect(useAgentStore.getState().run.isRunning).toBe(false)
    // 主 agent 结束会清空 activeTools（子 agent 的 isolatedStore 未写入）
    expect(typeof useAgentStore.getState().run.activeTools).toBe('object')
    expect(Object.keys(useAgentStore.getState().run.activeTools)).toHaveLength(0)
  })
})
