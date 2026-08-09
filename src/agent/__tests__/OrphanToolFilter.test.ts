// ── v16.0.2(F1): 孤儿 tool_result 协议层过滤 ──
// M11 跨 run 还原的 hist_ tool 消息（无前置 assistant.tool_calls）在 Anthropic 严格端点 400
// ——messagesToAnthropic 须转 text 块（不丢内容，保 ReadResultTracker 指纹）

import { describe, it, expect, vi } from 'vitest'
import { AnthropicAdapter } from '../runtime/adapters/AnthropicAdapter'
import type { Message } from '../state/types'

describe('AnthropicAdapter — F1 孤儿 tool_result 过滤', () => {
  it('孤儿 tool 消息（hist_ 前缀）→ 转为 text 块而非 tool_result（不 400 且内容可见）', async () => {
    let observed: any = null
    const svc = {
      chatAnthropicStream: async (params: any) => {
        observed = params.messages
        return { text: 'ok', toolUses: [], stopReason: 'end_turn' as const }
      },
      abortStream: () => {},
    }
    const adapter = new AnthropicAdapter(svc as any)
    // 模拟生产 UI 跨 run 注入：assistant（无 tool_calls）+ 还原的 hist_ tool 消息
    const msgs: Message[] = [
      { role: 'assistant', content: '上一轮', _toolResults: [{ tool: 'read_file', args: { file_path: 'a.md' }, content: '{}' }] },
      { role: 'tool', tool_call_id: 'hist_0_read_file', content: JSON.stringify({ status: 'success', summary: '读取成功', detail: '文件内容' }) },
      { role: 'user', content: '继续' },
    ]
    await adapter.callModel({ messages: msgs, tools: [], configId: 'cfg1', signal: new AbortController().signal })

    // 转换后：无 tool_result 块（孤儿），有 text 块（内容可见）
    const userMsgs = observed.filter((m: any) => m.role === 'user')
    expect(userMsgs.some((m: any) => m.content.some((b: any) => b.type === 'tool_result'))).toBe(false)
    const textBlocks = userMsgs.flatMap((m: any) => m.content.filter((b: any) => b.type === 'text'))
    expect(textBlocks.some((b: any) => b.text.includes('文件内容'))).toBe(true)
  })

  it('合法 tool_use + tool_result 配对 → 保留 tool_result 块', async () => {
    let observed: any = null
    const svc = {
      chatAnthropicStream: async (params: any) => {
        observed = params.messages
        return { text: 'ok', toolUses: [], stopReason: 'end_turn' as const }
      },
      abortStream: () => {},
    }
    const adapter = new AnthropicAdapter(svc as any)
    const msgs: Message[] = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'real1', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'real1', content: JSON.stringify({ status: 'success', summary: 'ok', detail: '内容' }) },
    ]
    await adapter.callModel({ messages: msgs, tools: [], configId: 'cfg1', signal: new AbortController().signal })

    const userMsgs = observed.filter((m: any) => m.role === 'user')
    expect(userMsgs.some((m: any) => m.content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === 'real1'))).toBe(true)
  })
})
