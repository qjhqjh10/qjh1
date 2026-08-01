import { describe, it, expect } from 'vitest'
import { ContextCompressor } from '../context/ContextCompressor'
import type { Message } from '../state/types'

function makeToolMsg(summary: string, detail: string): Message {
  return { role: 'tool', tool_call_id: 't1', content: JSON.stringify({ status: 'success', summary, detail }) }
}

describe('ContextCompressor', () => {
  const comp = new ContextCompressor(1000) // tiny window for testing

  it('estimates Chinese text correctly', () => {
    const tokens = comp.estimateTokens('你好世界')
    expect(tokens).toBeGreaterThan(1)
    expect(tokens).toBeLessThan(5)
  })

  it('estimates English text correctly', () => {
    const tokens = comp.estimateTokens('hello world this is a test')
    expect(tokens).toBeGreaterThan(3)
  })

  it('returns none stage below 70%', () => {
    expect(comp.getStage(500)).toBe('none')
  })

  it('returns strip_detail at 70%', () => {
    expect(comp.getStage(720)).toBe('strip_detail')
  })

  it('returns summarize_pairs at 80%', () => {
    expect(comp.getStage(820)).toBe('summarize_pairs')
  })

  it('returns collapse_early at 90%', () => {
    expect(comp.getStage(920)).toBe('collapse_early')
  })

  it('strip_detail: keeps status+summary, removes detail', () => {
    const msgs: Message[] = [makeToolMsg('读取成功', '非常长的文件内容'.repeat(100))]
    const result = comp.compress(msgs, 800) // 80% → strip
    const parsed = JSON.parse(result[0].content)
    expect(parsed.status).toBe('success')
    expect(parsed.summary).toBe('读取成功')
    // Detail should be stripped — only status + summary remain
    expect(Object.keys(parsed).length).toBeLessThanOrEqual(3) // status, summary, (possibly note)
    expect(parsed.status).toBe('success')
  })

  it('summarize_pairs: compresses oldest user/assistant pair', () => {
    const msgs: Message[] = [
      { role: 'user', content: '帮我写第3章' },
      { role: 'assistant', content: '好的，让我先了解一下...' },
      { role: 'user', content: '继续' },
      { role: 'assistant', content: '正在创作...' },
    ]
    const result = comp.compress(msgs, 850) // 85% → summarize
    // First user message should be replaced with system summary
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('已压缩')
  })

  it('collapse_early: keeps system + last 5 non-system messages', () => {
    const msgs: Message[] = [
      { role: 'system', content: '系统提示词' },
      ...Array.from({ length: 15 }, (_, i) => ({ role: i % 2 === 0 ? 'user' as const : 'assistant' as const, content: `消息${i}` })),
    ]
    const result = comp.compress(msgs, 950) // 95% → collapse
    // Should have system + collapse summary + last 5
    expect(result.length).toBeLessThan(msgs.length)
    expect(result.some(m => m.content.includes('已压缩'))).toBe(true)
  })

  it('collapse: preserves recent messages for task continuity', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'old1' }, { role: 'assistant', content: 'old1' },
      { role: 'user', content: 'old2' }, { role: 'assistant', content: 'old2' },
      { role: 'user', content: 'old3' }, { role: 'assistant', content: 'old3' },
      { role: 'user', content: 'CURRENT TASK' }, { role: 'assistant', content: 'working...' },
    ]
    const result = comp.compress(msgs, 950)
    // "CURRENT TASK" should be in the preserved messages
    expect(result.some(m => m.content === 'CURRENT TASK')).toBe(true)
  })

  it('1M context thresholds are correct', () => {
    const real = new ContextCompressor(1_000_000)
    expect(real.getStage(600_000)).toBe('none')
    expect(real.getStage(720_000)).toBe('strip_detail')
    expect(real.getStage(820_000)).toBe('summarize_pairs')
    expect(real.getStage(920_000)).toBe('collapse_early')
    expect(real.needsCompression(600_000)).toBe(false)
    expect(real.needsCompression(750_000)).toBe(true)
  })

  // ── H3: 工具轮整段压缩，不产生孤儿 tool 消息 ──

  it('summarize_pairs: 工具轮整段删除，无孤立 tool 消息', () => {
    const msgs: Message[] = [
      { role: 'user', content: '帮我写第三章' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ status: 'success', summary: '读取成功', detail: '内容' }) },
      { role: 'assistant', content: '好的，这是第三章内容……' },
      { role: 'user', content: '继续' },
      { role: 'assistant', content: '正在创作……' },
    ]
    const result = comp.compress(msgs, 850) // 85% → summarize

    // 压缩后: system 摘要 + 第二段完整保留
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('已压缩')
    // 摘要含 assistant 正文（而非空 tool_calls 消息）
    expect(result[0].content).toContain('好的，这是第三章内容')
    // 无孤立 tool 消息（tool 消息必须紧跟其 assistant(tool_calls) 之后）
    for (let i = 0; i < result.length; i++) {
      if (result[i].role === 'tool') {
        const prev = result[i - 1]
        expect(prev.role).toBe('assistant')
        expect(Array.isArray(prev.tool_calls)).toBe(true)
      }
    }
    // 最近轮次保留
    expect(result.some(m => m.content === '正在创作……')).toBe(true)
  })

  it('summarize_pairs: 段尾是 tool 消息（aborted 轮）不残留孤儿', () => {
    const msgs: Message[] = [
      { role: 'user', content: '读文件' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ status: 'success', summary: 'ok', detail: 'd' }) },
      { role: 'user', content: '再读' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c2', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c2', content: JSON.stringify({ status: 'success', summary: 'ok', detail: 'd' }) },
      { role: 'user', content: '写正文' },
      { role: 'assistant', content: '正文来了' },
    ]
    const result = comp.compress(msgs, 850)
    // 压缩后不存在 role==='tool' 的孤儿消息
    for (const m of result) {
      if (m.role === 'tool') {
        const idx = result.indexOf(m)
        const prev = result[idx - 1]
        expect(prev.role).toBe('assistant')
        expect(Array.isArray(prev.tool_calls)).toBe(true)
      }
    }
    expect(result.some(m => m.content === '正文来了')).toBe(true)
  })

  it('summarize_pairs: 无 assistant 文本段省略 AI 行（不把用户内容标成 AI 回复，审查修正）', () => {
    const msgs: Message[] = [
      { role: 'user', content: '读文件' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ status: 'success', summary: 'ok', detail: 'd' }) },
      { role: 'user', content: '写正文' },
      { role: 'assistant', content: '正文来了' },
    ]
    const result = comp.compress(msgs, 850)
    expect(result[0].content).toContain('用户: "读文件"')
    expect(result[0].content).not.toContain('→ AI: "读文件"') // 不再误标
    expect(result.some(m => m.content === '正文来了')).toBe(true)
  })

  it('summarize_pairs: 连续 user 消息（无 assistant）段安全压缩', () => {
    const msgs: Message[] = [
      { role: 'user', content: '第一问' },
      { role: 'user', content: '补充信息' },
      { role: 'assistant', content: '回答' },
      { role: 'user', content: '最近的问题' },
      { role: 'assistant', content: '最近的回答' },
    ]
    const result = comp.compress(msgs, 850)
    // 不抛异常，且摘要存在；最近轮次保留
    expect(result[0].role).toBe('system')
    expect(result.some(m => m.content === '最近的回答')).toBe(true)
  })
})
