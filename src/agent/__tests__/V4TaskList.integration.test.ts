// ── V4 Task List Integration Tests (v14.1.0) ──
// 验证任务清单运行时状态: 完成检测对照清单、剩余任务 nudge、继续性文本检测。
// 复用 V4AgentRuntime.integration.test.ts 的 mock 模式（makeTrackedExecutor/makeMockAI/makeRuntime）。
// 测试 RUNTIME 内部逻辑，不依赖模型行为。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { V4UnifiedRuntime } from '../runtime/V4UnifiedRuntime'
import { OpenAIAdapter } from '../runtime/adapters/OpenAIAdapter'
import { toolRegistry } from '../skills/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'
import type { Message, ToolCallRequest, ToolResult, ToolExecutionContext } from '../state/types'
import type { OpenAIAIService as AIService } from '../runtime/adapters/OpenAIAdapter'

// ── Setup ──
toolRegistry.registerAll(ALL_TOOLS)

function makeToolCall(id: string, name: string, args: Record<string, unknown>): ToolCallRequest {
  return { id, name, arguments: JSON.stringify(args) }
}

/** Minimal tool executor that records calls and returns canned responses */
function makeTrackedExecutor(responses?: Record<string, ToolResult>) {
  const calls: Array<{ name: string; args: Record<string, unknown>; timestamp: number }> = []
  const executor = vi.fn(async (args: Record<string, unknown>, ctx: ToolExecutionContext) => {
    calls.push({ name: ctx.toolName, args, timestamp: Date.now() })
    if (responses?.[ctx.toolName]) return responses[ctx.toolName]
    return { status: 'success' as const, summary: `${ctx.toolName} 完成`, detail: `${ctx.toolName} 执行成功` }
  })
  return { executor, calls, callCount: () => calls.length, toolNames: () => calls.map(c => c.name) }
}

/** Mock AI service with sequential canned responses */
function makeMockAI(responses: Array<{
  text?: string
  toolCalls?: ToolCallRequest[]
  finishReason?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}>) {
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
        usage: r.usage ?? { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
      }
    }),
    abortStream: vi.fn(),
  }
  return { svc, calls, callCount: () => idx }
}

/** Build a fresh runtime with default test config */
function makeRuntime(adapter: OpenAIAdapter, overrides?: {
  maxIterations?: number
  abortSignal?: AbortSignal
  contextWindow?: number
}) {
  return new V4UnifiedRuntime({
    configId: 'test-config',
    projectId: 'test-project',
    maxIterations: overrides?.maxIterations ?? 10,
    abortSignal: overrides?.abortSignal ?? new AbortController().signal,
    contextWindow: overrides?.contextWindow ?? 128_000,
    skipAnalyze: true,
    skipSkillGate: true,
  }, adapter)
}

const CREATE = (id: string) => makeToolCall(id, 'create_file', { file_path: `test-project/outline/task${id}.md` })

// ══════════════════════════════════════════════════════════════
// 任务清单: 完成检测对照清单（现象 B 修复）
// ══════════════════════════════════════════════════════════════

describe('Task List: 完成检测对照清单', () => {
  it('T1 现象B回归: 写1项后说"已完成1项，继续完成剩余任务" → 不break，继续到全部完成', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '已完成1项，继续完成剩余任务' },
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '已完成2项，继续完成剩余任务' },
      { text: '', toolCalls: [CREATE('c3')] },
      { text: '全部完成' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(callCount()).toBe(3)  // 三个任务全部执行
    // 第 2 次 API 调用（"已完成1项"文本轮）后应注入剩余任务 nudge，未提前结束
    expect(calls.length).toBe(6)
    // 某轮 messages 中包含任务状态注入
    const hasTaskStatus = calls.some(msgs => msgs.some(m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[当前任务]')))
    expect(hasTaskStatus).toBe(true)
    expect(result.iterationCount).toBeLessThanOrEqual(7)
  })

  it('T3 声明式进度: 6任务只完成4项后反复声称 → 剩余任务nudge注入，不无限循环', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '', toolCalls: [CREATE('c3')] },
      { text: '', toolCalls: [CREATE('c4')] },
      { text: '已完成4/6' },
      { text: '已完成4/6' },
      { text: '已完成4/6' },
      { text: '已完成4/6' },
      { text: '已完成4/6' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 8 })
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章 4. 填充世界观 5. 追加摘要 6. 保存笔记',
      attachments: [],
    })

    // 不无限循环: 触顶 maxIterations 结束
    expect(result.iterationCount).toBe(8)
    expect(result.success).toBe(true)
  })

  it('T7 清单模式+问句"剩下的还继续吗？" → break 等用户回答（不 nudge 死循环）', async () => {
    const { svc } = makeMockAI([
      { text: '已完成1项，剩下的还继续吗？' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.iterationCount).toBe(1)
  })

  it('T8 全完成接受: "已完成3/3" → break', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '', toolCalls: [CREATE('c3')] },
      { text: '已完成3/3' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(callCount()).toBe(3)
    expect(result.iterationCount).toBe(4)
  })

  it('T9 说"全部完成"但从未写 → 自愈"没写"nudge，不 break，直到真实执行', async () => {
    const { svc } = makeMockAI([
      { text: '全部完成' },
      { text: '全部完成' },
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '全部完成' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(callCount()).toBe(1)
    expect(result.iterationCount).toBe(4)
  })
})

// ══════════════════════════════════════════════════════════════
// 单任务回归: 行为与旧版等价
// ══════════════════════════════════════════════════════════════

describe('Task List: 单任务回归（无清单）', () => {
  it('T4 写过后"完成。" → 立即 break（与旧 L426 行为等价）', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '任务完成。' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我创建角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(callCount()).toBe(1)
    expect(result.iterationCount).toBe(2)
  })

  it('T5 写过后"接下来还要做X" → 不 break，注入继续性 nudge（现象A/B修复）', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '角色卡已创建，接下来还要更新大纲' },
      { text: '全部完成' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我创建角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(callCount()).toBe(1)
    expect(result.iterationCount).toBe(3)
    // 继续性 nudge 在文本轮响应后注入 → 出现在第 3 次 API 调用的 messages 中
    const nudgeInjected = calls[2]?.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('接下来'))
    expect(nudgeInjected).toBe(true)
  })

  it('T2 写过后读文件+继续性过渡语 → 不提前 break，继续执行到完成（现象A回归）', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [makeToolCall('r1', 'read_file', { file_path: 'test-project/chapters/ch1.txt' })] },
      { text: '', toolCalls: [makeToolCall('e1', 'edit_file', { file_path: 'test-project/chapters/ch1.txt' })] },
      { text: '已经改好第1章，接下来继续检查第2章' },
      { text: '', toolCalls: [makeToolCall('r2', 'read_file', { file_path: 'test-project/chapters/ch2.txt' })] },
      { text: '', toolCalls: [makeToolCall('e2', 'edit_file', { file_path: 'test-project/chapters/ch2.txt' })] },
      { text: '全部完成' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我检查第3章并润色',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(callCount()).toBe(4)  // 2 读 + 2 写全部执行，中途未停
    expect(result.iterationCount).toBe(6)
  })

  it('T12 分支1B: 分析型请求读文件后输出短文本 → break（不再被自愈阶梯误 nudge）', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [makeToolCall('r1', 'read_file', { file_path: 'test-project/chapters/ch1.txt' })] },
      { text: '第3章节奏偏慢，主角出场太晚。' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '检查一下第3章有什么问题',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.iterationCount).toBe(2)
    expect(result.text).toContain('节奏')
  })

  it('T6 非文件操作长文本（分析/讨论）→ break（原行为保留）', async () => {
    const longText = '这是一段超过两百字的分析文本。'.repeat(15)
    const { svc } = makeMockAI([
      { text: '', toolCalls: [makeToolCall('r1', 'read_file', { file_path: 'test-project/outline/plot.md' })] },
      { text: longText },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我分析一下这段大纲的结构',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.iterationCount).toBe(2)
  })

  it('T11 写过后"都搞定了呀"（TRUST_DONE）→ accept break', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '都搞定了呀' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我创建角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(callCount()).toBe(1)
    expect(result.iterationCount).toBe(2)
  })
})

// ══════════════════════════════════════════════════════════════
// 压缩交互: 任务状态注入抗压缩
// ══════════════════════════════════════════════════════════════

describe('Task List: 压缩交互', () => {
  it('T10 极小 contextWindow 触发压缩后，末尾仍有 [当前任务] 注入', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '已完成1项' },
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '全部完成' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { contextWindow: 1500, maxIterations: 8 })
    const { executor } = makeTrackedExecutor({
      create_file: { status: 'success', summary: '创建完成', detail: 'A'.repeat(3000) },  // 大结果触发压缩
    })
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    // 最后一次 API 调用的 messages 末尾应有 [当前任务]（替换式注入在压缩后仍生效）
    const lastMsgs = calls[calls.length - 1]
    const taskStatus = lastMsgs.filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[当前任务]'))
    expect(taskStatus.length).toBeGreaterThan(0)
  })
})
