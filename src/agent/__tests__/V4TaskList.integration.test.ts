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
    expect(calls.length).toBe(7)  // v14.2.1: +1 验收提示轮（6 轮执行 + 提示后收尾 1 轮）
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
    expect(result.iterationCount).toBe(5)  // v14.2.1: +1 验收提示轮（写完 3/3 → 注入提示 → 模型再答收尾）
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
    expect(result.iterationCount).toBe(5)  // v14.2.1: +1 验收提示轮（写完后再答"完成" → 注入提示 → 再答收尾）
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

// ══════════════════════════════════════════════════════════════
// 跨 run 续跑 (v14.2.0): taskProgress 快照 — 中断未完成 → 可续跑
// ══════════════════════════════════════════════════════════════

describe('Task List: 跨 run 续跑 (taskProgress 快照)', () => {
  it('T13 迭代耗尽中断: 任务未全部完成 → interrupted=true, allDone=false, 进度如实', async () => {
    // maxIterations=4: 写任务1 → 进度声明1 → 写任务2 → 进度声明2 → 耗尽（任务3未做）
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '已完成1项，继续' },
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '已完成2项，继续' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 4 })
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章',
      attachments: [],
    })

    expect(result.taskProgress).toBeDefined()
    expect(result.taskProgress!.allDone).toBe(false)
    expect(result.taskProgress!.interrupted).toBe(true)
    expect(result.taskProgress!.tasks).toHaveLength(3)
    expect(result.taskProgress!.tasks[0]).toMatchObject({ id: 1, done: true })
    expect(result.taskProgress!.tasks[1]).toMatchObject({ id: 2, done: true })
    expect(result.taskProgress!.tasks[2]).toMatchObject({ id: 3, done: false })
  })

  it('T14 正常完成: 清单全部完成 → allDone=true, interrupted=false（不续跑）', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '全部完成' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡',
      attachments: [],
    })

    expect(result.taskProgress).toBeDefined()
    expect(result.taskProgress!.allDone).toBe(true)
    expect(result.taskProgress!.interrupted).toBe(false)
    expect(result.taskProgress!.tasks.every(t => t.done)).toBe(true)
  })

  it('T15 用户中止: abort → interrupted=true（可续跑）', async () => {
    const ac = new AbortController()
    const { svc } = makeMockAI([])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { abortSignal: ac.signal })
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    ac.abort()  // 运行前中止
    const result = await runtime.run({
      userMessage: '1. 创建角色卡 2. 写第一章',
      attachments: [],
    })

    expect(result.success).toBe(false)
    expect(result.taskProgress).toBeDefined()
    expect(result.taskProgress!.interrupted).toBe(true)
    expect(result.taskProgress!.allDone).toBe(false)
  })

  it('T16 无任务清单（聊天）: taskProgress 不返回', async () => {
    const { svc } = makeMockAI([{ text: '你好呀，有什么可以帮你？' }])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({ userMessage: '你好', attachments: [] })

    expect(result.taskProgress).toBeUndefined()
  })

  it('T17 API 失败中断: 非瞬态错误 → interrupted=true', async () => {
    const { svc } = makeMockAI([])
    ;(svc.chatWithTools as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('invalid api key'))  // 非瞬态 → 无 2s 重试等待
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 创建角色卡 2. 写第一章',
      attachments: [],
    })

    expect(result.success).toBe(true)  // abortSignal 未中止 → success 保持（phase DONE，文本为错误信息）
    expect(result.taskProgress).toBeDefined()
    expect(result.taskProgress!.interrupted).toBe(true)
    expect(result.taskProgress!.allDone).toBe(false)
  })

  it('T18 清单模式向用户提问 break: interrupted=false（等用户回答，不触发续跑注入）', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '剩下的任务还继续吗？' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 创建角色卡 2. 写第一章',
      attachments: [],
    })

    expect(result.taskProgress).toBeDefined()
    expect(result.taskProgress!.allDone).toBe(false)
    expect(result.taskProgress!.interrupted).toBe(false)  // 提问 break → 不标记中断
  })

  it('T23 v14.5.0 续跑恢复清单: resumeTaskProgress → [当前任务] 注入与清单门控恢复', async () => {
    // run1: 迭代耗尽中断（任务1完成，2/3 未做）
    const { svc: svc1 } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '第1项完成。' },
    ])
    const runtime1 = makeRuntime(new OpenAIAdapter(svc1), { maxIterations: 2 })
    const { executor: ex1 } = makeTrackedExecutor()
    runtime1.setToolExecutor(ex1)
    runtime1.setTools(toolRegistry.getCompactSchemas())
    const result1 = await runtime1.run({ userMessage: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章', attachments: [] })
    expect(result1.truncated).toBe(true)
    expect(result1.taskProgress?.tasks[0].done).toBe(true)
    const tp = result1.taskProgress!

    // run2: 用户发"继续"（无编号任务）→ 从快照恢复清单
    const { svc: svc2, calls: calls2 } = makeMockAI([
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '任务2/3完成' },
      { text: '全部完成' },
    ])
    const runtime2 = makeRuntime(new OpenAIAdapter(svc2))
    const { executor: ex2, callCount: cc2 } = makeTrackedExecutor()
    runtime2.setToolExecutor(ex2)
    runtime2.setTools(toolRegistry.getCompactSchemas())
    const result2 = await runtime2.run({
      userMessage: '继续',
      attachments: [],
      resumeTaskProgress: tp,
    })

    expect(result2.success).toBe(true)
    // 清单已恢复: 轮次消息含 [当前任务] system 注入（无 resumeTaskProgress 时不会出现）
    expect(calls2.some(msgs => msgs.some(m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[当前任务]')))).toBe(true)
    // 恢复的进度: 任务1 已 done → "任务2/3完成" 置位任务2 → 全部完成后 allDone
    expect(result2.taskProgress?.allDone).toBe(true)
    expect(cc2()).toBe(1)
  })

  it('T24 v14.9 续跑闸门修复: resume 后模型口头声明全部完成但未写文件 → 不 cleanExit，持续督促', async () => {
    // 原缺陷: "继续"消息无任务关键词 → _userRequestedFileOp=false → "说完成但没写"闸门被禁用
    // → 仅声明进度即可 cleanExit，剩余任务静默丢弃
    const tp = {
      tasks: [
        { id: 1, desc: '写完整大纲', done: true },
        { id: 2, desc: '创建角色卡', done: false },
        { id: 3, desc: '生成第一章', done: false },
      ],
      allDone: false,
      interrupted: true,
    }
    const { svc: svc2, calls: calls2 } = makeMockAI([
      { text: '已完成3项。' },  // 口头声明全部完成（progress 解析置位全部任务），零工具调用
    ])
    const runtime2 = makeRuntime(new OpenAIAdapter(svc2), { maxIterations: 3 })
    const { executor: ex2 } = makeTrackedExecutor()
    runtime2.setToolExecutor(ex2)
    runtime2.setTools(toolRegistry.getCompactSchemas())
    const result2 = await runtime2.run({
      userMessage: '继续',
      attachments: [],
      resumeTaskProgress: tp,
    })

    // 闸门生效: 声明轮后没有 cleanExit（原缺陷下 calls=1 即退出），继续 nudge 直到迭代耗尽
    expect(calls2.length).toBeGreaterThanOrEqual(2)
    expect(result2.truncated).toBe(true)
    // 督促消息明确要求写证据（"说完成但没写"闸门文案；v14.9(C3) 文案改为"没有实际写入任何文件"）
    expect(calls2[1].some(m => typeof m.content === 'string' && m.content.includes('没有实际写入任何文件'))).toBe(true)
  })

  it('T25 v14.9 部分声明漏网修复: "前三项都完成了"（前N项形态）不触发全局完成', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('1')] },
      { text: '前三项都完成了。' },  // 原缺陷: PARTIAL_DONE_RE 只覆盖"第N"形态 → GLOBAL `都.*完成` 命中 → markAllDone
      { text: '', toolCalls: [CREATE('2')] },
      { text: '全部完成' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章 4. 创建笔记',
      attachments: [],
    })

    expect(callCount()).toBe(2)  // 部分声明轮未提前收尾（原缺陷下只有 1 次写入）
    expect(result.taskProgress?.allDone).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('T26 v16.0.1(S5) 否定完成句排除: "还没都完成" 不触发全局完成，继续执行', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('1')] },
      { text: '任务还没都完成，继续。' },  // 原缺陷: GLOBAL `都.*完成` 命中 → markAllDone
      { text: '', toolCalls: [CREATE('2')] },
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

    expect(callCount()).toBe(2)  // 否定句轮未提前收尾
    expect(result.taskProgress?.allDone).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('T27 v16.0.1(S5) 这N项形态: "这2项都完成了" 不触发全局完成，继续执行', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('1')] },
      { text: '这2项都完成了，继续做剩下的。' },  // 原缺陷: PARTIAL 无"这N项"形态 → GLOBAL 命中 → markAllDone
      { text: '', toolCalls: [CREATE('2')] },
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

    expect(callCount()).toBe(2)  // 部分声明轮未提前收尾
    expect(result.taskProgress?.allDone).toBe(true)
  })

  it('T28 v16.0.2(D-1): "都完成了" 正面收尾语不被 NEG 误拦 → 正常 markAllDone 收尾', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('1')] },
      { text: '都完成了。' },  // 原缺陷：NEG 第二备选 `都(?:还|仍|未)?(?:没)?` 组合爆炸 →
      // "都完成了"（无否定修饰）被当否定句 → markAllDone 被拒 → 落入剩余任务 nudge
      { text: '完成。' },  // 验收提示轮后模型确认完成 → break（修复后流程）
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章 4. 创建笔记',
      attachments: [],
    })

    // "都完成了"（写过后 + GLOBAL 命中 + NEG=0）→ markAllDone → allTasksDone
    // → 验收提示（一次）→ 模型确认完成 → break
    // 原缺陷：被 NEG 拦截 → markAllDone 不置位 → 剩余任务 nudge → 反复 nudge 至 maxIterations
    expect(callCount()).toBe(1)  // CREATE('1') 后即收尾（第 2 条 CREATE('2') 不存在于 mock）
    expect(result.taskProgress?.allDone).toBe(true)
    expect(result.success).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(3)  // 工具轮 + 都完成了轮 + 确认轮
  })
})

// ══════════════════════════════════════════════════════════════
// 部分声明门控 (v14.5.0): "第N项完成/任务X/Y完成" 等不触发全局完成
// ══════════════════════════════════════════════════════════════

describe('Task List: 部分声明门控 (v14.5.0)', () => {
  it('T20 部分声明矩阵: 第3项完成/任务2/3完成/已完成4项 → 不 markAllDone，任务照常执行', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('1')] },
      { text: '第3项完成。' },
      { text: '', toolCalls: [CREATE('2')] },
      { text: '任务2/3完成' },
      { text: '', toolCalls: [CREATE('3')] },
      { text: '已完成4项，继续' },
      { text: '', toolCalls: [CREATE('c4')] },
      { text: '全部完成' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter)
    const { executor, callCount } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章 4. 创建笔记',
      attachments: [],
    })

    expect(result.success).toBe(true)
    // 四个写工具全部执行——部分声明未触发提前收尾（旧实现此断言会失败: 第3项完成即 markAllDone）
    expect(callCount()).toBe(4)
    // 未在部分声明轮 break
    expect(calls.length).toBeGreaterThan(6)
    expect(result.taskProgress?.allDone).toBe(true)
  })

  it('T21 全局声明正常触发: "任务完成。" → markAllDone 收尾', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('1')] },
      { text: '任务完成。' },
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

    expect(callCount()).toBe(1)
    expect(result.taskProgress?.allDone).toBe(true)
  })

  it('T22 "已完成 3/6 项"（带空格）不触发全局完成', async () => {
    const { svc } = makeMockAI([
      { text: '', toolCalls: [CREATE('1')] },
      { text: '已完成 3/6 项，继续' },
      { text: '', toolCalls: [CREATE('2')] },
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

    expect(callCount()).toBe(2)
    expect(result.taskProgress?.allDone).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════
// 验收提示注入 (v14.2.1): 清单完成且写过文件 → 提示一次（不强制）
// ══════════════════════════════════════════════════════════════

describe('Task List: 验收提示注入', () => {
  it('T19 清单完成且写过文件 → 注入一次 [验收提示]；模型再次说完成直接收尾', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '全部完成' },   // 触发验收提示 → continue
      { text: '全部完成' },   // 提示已注入 → break
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.iterationCount).toBe(4)
    // 验收提示在第三轮注入（该轮调用快照在注入前，故 calls[2]=0）；
    // 第四轮快照可见 1 条，且不重复注入（_verifyHintInjected 已置位）
    const hintPerCall = calls.map(msgs =>
      msgs.filter(m => typeof m.content === 'string' && m.content.startsWith('[验收提示]')).length)
    expect(hintPerCall).toEqual([0, 0, 0, 1])
    const hintMsg = calls[3].find(m => typeof m.content === 'string' && m.content.startsWith('[验收提示]')) as Message | undefined
    expect(hintMsg?.content).toContain('verify_task')
  })

  it('T20 清单完成但未写文件（"完成"声明无写入）→ 走自愈 nudge，不注入验收提示', async () => {
    const { svc, calls } = makeMockAI([
      { text: '全部完成' },          // 没写 → 自愈 nudge（"没写"）
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [CREATE('c2')] },
      { text: '全部完成' },          // 写过后完成 → 注入验收提示
      { text: '全部完成' },          // 提示已注入 → break
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor } = makeTrackedExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '1. 写完整大纲 2. 创建角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    // 自愈 nudge 轮（前 3 轮调用快照）不含验收提示；验收提示在第四轮注入、第五轮快照可见一次
    const hintCalls = calls.map(msgs =>
      msgs.filter(m => typeof m.content === 'string' && m.content.startsWith('[验收提示]')).length)
    expect(hintCalls[0]).toBe(0)
    expect(hintCalls[1]).toBe(0)
    expect(hintCalls[2]).toBe(0)
    expect(hintCalls[3]).toBe(0)
    expect(hintCalls[4]).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════
// 验收失败督促闸门 (v14.3): verify 未通过 → 完成声明被拦截 + 有界督促
// ══════════════════════════════════════════════════════════════

describe('Task List: 验收失败督促闸门 (v14.3)', () => {
  /** 按调用次序返回 verify 响应（默认先失败后通过；可传自定义序列）的 tracked executor */
  function makeVerifyExecutor(responses?: Array<{ status: 'success'; summary: string; detail: string }>) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    let verifyIdx = 0
    const seq = responses ?? [
      { status: 'success' as const, summary: '验收未通过: 1/2 条标准未满足', detail: '{"passed": false, "items": [{"criterion": "存在", "passed": true}, {"criterion": "性格字段", "passed": false}]}' },
      { status: 'success' as const, summary: '验收通过: 2 条标准全部满足', detail: '{"passed": true, "items": []}' },
    ]
    const executor = vi.fn(async (args: Record<string, unknown>, ctx: ToolExecutionContext) => {
      calls.push({ name: ctx.toolName, args })
      if (ctx.toolName === 'verify_task') return seq[Math.min(verifyIdx++, seq.length - 1)]
      return { status: 'success' as const, summary: `${ctx.toolName} 完成`, detail: `${ctx.toolName} 执行成功` }
    })
    return { executor, calls, verifyCount: () => calls.filter(c => c.name === 'verify_task').length }
  }

  /** 最后一条 API 快照中累积的 [验收督促] 条数（督促消息随 messagesForApi 累积，等价于注入次数） */
  function nudgeInLastCall(calls: Message[][]): number {
    const last = calls[calls.length - 1] ?? []
    return last.filter(m => typeof m.content === 'string' && m.content.startsWith('[验收督促]')).length
  }

  // 注意：任务描述必须含任务动词字符（门控 3："验收"不含 → 用"补齐"）——保证任务清单提取成功
  const TASK_MSG = '1. 创建角色卡 2. 补齐验收产物'

  it('T21 失败→督促→修复→复验通过：完成声明被拦截一次，验收通过后正常收尾', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [makeToolCall('v1', 'verify_task', { file_paths: ['x.md'], criteria: ['存在', '性格字段'] })] },
      { text: '全部完成' },            // 验收未通过 → 闸门拦截 + 督促 1
      { text: '', toolCalls: [makeToolCall('e1', 'edit_file', { file_path: 'x.md' })] },
      { text: '', toolCalls: [makeToolCall('v2', 'verify_task', { file_paths: ['x.md'], criteria: ['存在', '性格字段'] })] },
      { text: '全部完成' },            // 验收通过 → 无督促 → 清单完成 → 验收提示
      { text: '全部完成' },            // 提示已注入 → break
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor, verifyCount } = makeVerifyExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: TASK_MSG,
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(verifyCount()).toBe(2)
    expect(result.iterationCount).toBe(7)
    // [验收督促] 注入 1 次（督促后的第一个快照 call3 可见 1 条；最终快照累积仍 1 条）
    expect(nudgeInLastCall(calls)).toBe(1)
    expect(calls[3].filter(m => typeof m.content === 'string' && m.content.startsWith('[验收督促]'))).toHaveLength(1)
    // 最终上下文含验收通过 summary（闸门释放）
    const lastMsgs = calls[calls.length - 1]
    expect(lastMsgs.some(m => typeof m.content === 'string' && m.content.includes('验收通过: 2 条标准全部满足'))).toBe(true)
  })

  it('T22 有界放行：模型不修复反复说"全部完成" → 督促 2 次后放行（不触顶 maxIterations）', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [makeToolCall('v1', 'verify_task', { file_paths: ['x.md'], criteria: ['存在'] })] },
      { text: '全部完成' },            // 督促 1（rounds=1）
      { text: '全部完成' },            // 督促 2（rounds=2）
      { text: '全部完成' },            // rounds=2 不 <2 → 放行 → 清单完成 → 验收提示
      { text: '全部完成' },            // break
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor } = makeVerifyExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: TASK_MSG,
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.iterationCount).toBe(6)
    expect(nudgeInLastCall(calls)).toBe(2)
    // 未触顶（有界放行而非迭代耗尽）
    expect(result.iterationCount).toBeLessThan(10)
  })

  it('T23 验收通过 → 完成声明直接接受（无督促消息）', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [makeToolCall('v1', 'verify_task', { file_paths: ['x.md'], criteria: ['存在'] })] },
      { text: '全部完成' },            // 通过 → 无督促 → 验收提示
      { text: '全部完成' },            // break
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor } = makeVerifyExecutor([
      { status: 'success', summary: '验收通过: 1 条标准全部满足', detail: '{"passed": true, "items": []}' },
    ])
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: TASK_MSG,
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.iterationCount).toBe(4)
    expect(nudgeInLastCall(calls)).toBe(0)
  })

  it('T24 无任务清单场景：验收未通过 + 完成声明 → 同样有界督促', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [makeToolCall('v1', 'verify_task', { file_paths: ['x.md'], criteria: ['存在'] })] },
      { text: '全部完成' },            // 督促 1
      { text: '全部完成' },            // 督促 2
      { text: '全部完成' },            // 放行 → 无清单分支 break
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor } = makeVerifyExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我创建并验收角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.iterationCount).toBe(5)
    expect(nudgeInLastCall(calls)).toBe(2)
  })

  it('T25 问句守卫：验收未通过但模型提问（"全部完成了吗？"）→ 不督促，break 等用户回答', async () => {
    const { svc, calls } = makeMockAI([
      { text: '', toolCalls: [CREATE('c1')] },
      { text: '', toolCalls: [makeToolCall('v1', 'verify_task', { file_paths: ['x.md'], criteria: ['存在'] })] },
      { text: '全部完成了吗？' },
    ])
    const adapter = new OpenAIAdapter(svc)
    const runtime = makeRuntime(adapter, { maxIterations: 10 })
    const { executor } = makeVerifyExecutor()
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getCompactSchemas())

    const result = await runtime.run({
      userMessage: '帮我创建并验收角色卡',
      attachments: [],
    })

    expect(result.success).toBe(true)
    expect(result.iterationCount).toBe(3)
    expect(nudgeInLastCall(calls)).toBe(0)
  })
})
