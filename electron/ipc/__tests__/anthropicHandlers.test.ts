// H6: 增量 SSE 解析器验证（feedSSE）
// 修复点: 原 parseSSEStream 一次性解析 + CRLF（\r\n\r\n）分隔符丢失；
// 增量版支持流式喂入、跨 chunk 残行、注释行、多行 data。
import { describe, it, expect } from 'vitest'
import { feedSSE, type SSEEvent } from '../anthropicHandlers'

const EV1 = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}'
const EV2 = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"你好"}}'
const EV3 = 'event: message_stop\ndata: {"type":"message_stop"}'

describe('feedSSE (H6)', () => {
  it('完整文本一次喂入解析出全部事件', () => {
    const { events, rest } = feedSSE('', [EV1, EV2, EV3].join('\n\n') + '\n\n')
    expect(events.length).toBe(3)
    expect(events[0].type).toBe('message_start')
    expect((events[1].data as any).delta.text).toBe('你好')
    expect(events[2].type).toBe('message_stop')
    expect(rest).toBe('')
  })

  it('分块喂入跨 chunk 残行正确累积', () => {
    const text = [EV1, EV2, EV3].join('\n\n') + '\n\n'
    // 每 7 个字符切一块，模拟网络分片
    let buf = ''
    const all: SSEEvent[] = []
    for (let i = 0; i < text.length; i += 7) {
      const { events, rest } = feedSSE(buf, text.slice(i, i + 7))
      buf = rest
      all.push(...events)
    }
    const tail = feedSSE(buf, '')
    all.push(...tail.events)
    expect(all.length).toBe(3)
    expect(all.map(e => e.type)).toEqual(['message_start', 'content_block_delta', 'message_stop'])
  })

  it('CRLF 行尾（\r\n\r\n 分隔）正常解析——原实现会整段丢失', () => {
    const crlfText = [EV1, EV2].join('\r\n\r\n') + '\r\n\r\n'
    const { events, rest } = feedSSE('', crlfText)
    expect(events.length).toBe(2)
    expect(events[0].type).toBe('message_start')
    expect(events[1].type).toBe('content_block_delta')
    expect(rest).toBe('')
  })

  it('跳过注释行（: ping keep-alive）', () => {
    const text = ': ping\n\n' + [EV1, EV2].join('\n\n') + '\n\n'
    const { events } = feedSSE('', text)
    expect(events.length).toBe(2)
  })

  it('多行 data 行 join 后解析', () => {
    // SSE 规范: 同一 data 值跨多行，行间以 \n 拼接成完整 JSON
    const text = 'event: message_start\ndata: {"type":"message_start",\ndata: "note":"multi"}\n\n'
    const { events } = feedSSE('', text)
    expect(events.length).toBe(1)
    expect((events[0].data as any).type).toBe('message_start')
    expect((events[0].data as any).note).toBe('multi')
  })

  it('无法解析的 data 跳过，不抛异常', () => {
    const text = 'event: message_start\ndata: {invalid json}\n\n' + EV2 + '\n\n'
    const { events } = feedSSE('', text)
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('content_block_delta')
  })

  it('无 event: 行时回退到 JSON 的 type 字段', () => {
    const text = 'data: {"type":"message_stop"}\n\n'
    const { events } = feedSSE('', text)
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('message_stop')
  })

  it('未以 \\n\\n 结尾的最终事件：滞留 rest，冲刷（补终止空行）后解析（审查补强）', () => {
    const text = EV1 + '\n\n' + EV2 // EV2 无结尾空行（流关闭时末事件形态）
    const { events, rest } = feedSSE('', text)
    expect(events.length).toBe(1) // EV1 已解析
    expect(rest).toContain('content_block_delta') // EV2 滞留
    const tail = feedSSE(rest, '\n\n') // 主循环冲刷用补终止空行
    expect(tail.events.length).toBe(1)
    expect(tail.events[0].type).toBe('content_block_delta')
  })
})
