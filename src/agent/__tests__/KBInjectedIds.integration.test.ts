// ── KB 注入 id 全链路集成测试（v14.8） ──
// 覆盖审查修复（P0）：BridgeContextBuilder 返回 injectedKbFileIds →
// ContextAssemblerFn → runtime 实例字段 → execCtx → kb_search 的 ctx.kbInjectedFileIds →
// run 结果 kbInjectedFileIds 持久化。此前字段名不一致（injectedFileIds）导致全链路静默失效，
// builder 单测无法覆盖此集成点。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { V4UnifiedRuntime } from '../runtime/V4UnifiedRuntime'
import { OpenAIAdapter } from '../runtime/adapters/OpenAIAdapter'
import type { ContextAssemblerFn, ToolExecutorFn } from '../runtime/RuntimeTypes'
import type { Message, ToolCallRequest, ToolResult, ToolExecutionContext } from '../state/types'

// ── Mock 服务（镜像 V4AgentRuntime.integration.test.ts 的 makeMockAI 模式）──

function makeMockAI(responses: Array<{
  text?: string
  toolCalls?: ToolCallRequest[]
  finishReason?: string
}>) {
  let idx = 0
  const svc = {
    chatWithTools: vi.fn(async (msgs: Message[]) => {
      const r = responses[idx] ?? { text: '完成。' }
      idx++
      return {
        text: r.text ?? '',
        toolCalls: r.toolCalls ?? null,
        finishReason: r.finishReason ?? (r.toolCalls ? 'tool_calls' : 'stop'),
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }
    }),
    abortStream: vi.fn(),
  }
  return svc
}

describe('KB 注入 id 全链路', () => {
  const toolCtxs: ToolExecutionContext[] = []
  let executor: ToolExecutorFn
  let assembler: ContextAssemblerFn

  beforeEach(() => {
    toolCtxs.length = 0
    executor = vi.fn(async (_args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
      toolCtxs.push(ctx)
      return { status: 'success', summary: '工具完成', detail: 'ok' }
    })
    assembler = async () => ({
      systemMessages: [{ role: 'system', content: '核心规则' }],
      searchContext: '',
      // 模拟 BridgeContextBuilder.buildContext 的返回（字段名与 RuntimeTypes 严格一致）
      injectedKbFileIds: ['fileA', 'fileB'],
      totalTokens: 100,
      domains: [],
    })
  })

  it('run 结果携带 kbInjectedFileIds（跨 run 去重持久化数据源）', async () => {
    const svc = makeMockAI([
      { text: '我先查一下知识库。', toolCalls: [{ id: 'c1', name: 'kb_search', arguments: '{"query":"x"}' }] },
      { text: '完成。' },
    ])
    const runtime = new V4UnifiedRuntime({
      configId: 'cfg', projectId: 'p1', maxIterations: 5,
      abortSignal: new AbortController().signal, skipAnalyze: true, skipSkillGate: true,
    }, new OpenAIAdapter(svc))
    runtime.setContextAssembler(assembler)
    runtime.setToolExecutor(executor)
    const result = await runtime.run({ userMessage: '查一下修炼体系', attachments: [] })
    expect(result.kbInjectedFileIds).toEqual(['fileA', 'fileB'])
  })

  it('kb_search 工具执行时 ctx.kbInjectedFileIds 收到本轮注入 id（排除集）', async () => {
    const svc = makeMockAI([
      { text: '', toolCalls: [{ id: 'c1', name: 'kb_search', arguments: '{"query":"x"}' }] },
      { text: '完成。' },
    ])
    const runtime = new V4UnifiedRuntime({
      configId: 'cfg', projectId: 'p1', maxIterations: 5,
      abortSignal: new AbortController().signal, skipAnalyze: true, skipSkillGate: true,
    }, new OpenAIAdapter(svc))
    runtime.setContextAssembler(assembler)
    runtime.setToolExecutor(executor)
    await runtime.run({ userMessage: '查一下', attachments: [] })
    expect(toolCtxs.length).toBeGreaterThan(0)
    const kbCtx = toolCtxs.find(c => c.toolName === 'kb_search')
    expect(kbCtx?.kbInjectedFileIds).toEqual(['fileA', 'fileB'])
  })

  it('未注入 KB 时 execCtx 恒空数组（子代理场景语义：kb_search 不排除 → 全库检索）', async () => {
    const svc = makeMockAI([
      { text: '', toolCalls: [{ id: 'c1', name: 'kb_search', arguments: '{"query":"x"}' }] },
      { text: '完成。' },
    ])
    const runtime = new V4UnifiedRuntime({
      configId: 'cfg', projectId: 'p1', maxIterations: 5,
      abortSignal: new AbortController().signal, skipAnalyze: true, skipSkillGate: true,
    }, new OpenAIAdapter(svc))
    runtime.setContextAssembler(async () => ({
      systemMessages: [], searchContext: '', totalTokens: 0, domains: [],
    }))
    runtime.setToolExecutor(executor)
    const result = await runtime.run({ userMessage: '查一下', attachments: [] })
    // run 结果不带字段（length=0 不展开）；execCtx 恒为数组——kbTools 按 length>0 判定，空数组不排除
    expect(result.kbInjectedFileIds).toBeUndefined()
    const kbCtx = toolCtxs.find(c => c.toolName === 'kb_search')
    expect(kbCtx?.kbInjectedFileIds).toEqual([])
  })
})
