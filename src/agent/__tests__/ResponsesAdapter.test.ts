// ── ResponsesAdapter 单测（v14.8） ──
// 验证：callModel 请求参数接线（tools/temperature/source/requestId）、usage 归一化、
// reasoningContent/aborted 透传、signal→abortStream 接线、toolCalls 归一化。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResponsesAdapter } from '../runtime/adapters/ResponsesAdapter'
import type { Message } from '../state/types'

function makeMessages(): Message[] {
  return [{ role: 'user', content: '你好' }]
}

describe('ResponsesAdapter', () => {
  let service: ReturnType<typeof mockService>
  let adapter: ResponsesAdapter
  const abortStream = vi.fn()

  function mockService(overrides: Record<string, unknown> = {}) {
    return {
      responsesChat: vi.fn(async (
        _msgs: unknown[], _cid: string, _pid: string | undefined,
        _tools: unknown[] | undefined, _temp: number | undefined, _src: string | undefined, _rid: string | undefined,
      ) => ({
        text: '回复文本',
        toolCalls: null,
        finishReason: 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 60, cost: 0.01 },
        ...overrides,
      })),
      abortStream,
    }
  }

  beforeEach(() => {
    abortStream.mockClear()
    service = mockService()
    adapter = new ResponsesAdapter(service)
  })

  it('callModel 透传 messages/tools/temperature 与 requestId、source 默认 main', async () => {
    const signal = new AbortController().signal
    const resp = await adapter.callModel({
      messages: makeMessages(),
      tools: [{ type: 'function', function: { name: 'read_file' } }],
      configId: 'cfg1',
      projectId: 'p1',
      signal,
      temperature: 0.8,
    })
    expect(service.responsesChat).toHaveBeenCalledTimes(1)
    const [msgs, cid, pid, tools, temp, source, requestId] = service.responsesChat.mock.calls[0]
    expect(msgs).toEqual(makeMessages())
    expect(cid).toBe('cfg1')
    expect(pid).toBe('p1')
    expect(tools).toHaveLength(1)
    expect(temp).toBe(0.8)
    expect(source).toBe('main')
    expect(typeof requestId).toBe('string')
    expect(requestId!.startsWith('req_')).toBe(true)
    expect(resp.text).toBe('回复文本')
    expect(resp.usage).toEqual({
      inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheHitTokens: 60, cost: 0.01,
    })
  })

  it('子代理构造传 source=subagent', async () => {
    const subAdapter = new ResponsesAdapter(service, 'subagent')
    await subAdapter.callModel({ messages: makeMessages(), tools: [], configId: 'c', signal: new AbortController().signal })
    expect(service.responsesChat.mock.calls[0][5]).toBe('subagent')
  })

  it('toolCalls 归一化为 {id,name,arguments}，reasoningContent/aborted 透传', async () => {
    service = mockService({
      toolCalls: [{ id: 'call_1', name: 'kb_search', arguments: '{"query":"x"}' }],
      reasoning_content: '推理中',
      aborted: true,
    })
    adapter = new ResponsesAdapter(service)
    const resp = await adapter.callModel({ messages: makeMessages(), tools: [], configId: 'c', signal: new AbortController().signal })
    expect(resp.toolCalls).toEqual([{ id: 'call_1', name: 'kb_search', arguments: '{"query":"x"}' }])
    expect(resp.reasoningContent).toBe('推理中')
    expect(resp.aborted).toBe(true)
  })

  it('signal 中止 → abortStream(requestId) 精确中止', async () => {
    const ctrl = new AbortController()
    const promise = adapter.callModel({ messages: makeMessages(), tools: [], configId: 'c', signal: ctrl.signal })
    ctrl.abort()
    await promise
    expect(abortStream).toHaveBeenCalledTimes(1)
    const rid = service.responsesChat.mock.calls[0][6]
    expect(abortStream).toHaveBeenCalledWith(rid)
  })

  it('abortStream() 中止当前在途请求', async () => {
    const signal = new AbortController().signal
    await adapter.callModel({ messages: makeMessages(), tools: [], configId: 'c', signal })
    adapter.abortStream()
    expect(abortStream).toHaveBeenCalledWith(service.responsesChat.mock.calls[0][6])
  })
})
