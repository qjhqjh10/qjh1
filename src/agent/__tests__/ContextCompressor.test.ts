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

  // ── v14 批处理: strip_detail 最近轮保护（不截断尾部 2 轮的 tool detail）──

  function makePairRound(userText: string, detail: string, callId: string): Message[] {
    return [
      { role: 'user', content: userText },
      { role: 'assistant', content: '', tool_calls: [{ id: callId, function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: callId, content: JSON.stringify({ status: 'success', summary: `读取${callId}`, detail }) },
    ]
  }

  it('strip_detail: 保护最近 2 轮 — 旧轮 detail 截断、最近轮完整保留', () => {
    const LONG = 'X'.repeat(1000)
    const msgs: Message[] = [
      ...makePairRound('第一轮', LONG, 'c1'),
      ...makePairRound('第二轮', LONG, 'c2'),
      ...makePairRound('第三轮', LONG, 'c3'),
    ]
    const result = comp.compress(msgs, 750) // 75% → strip_detail
    expect(result.length).toBe(msgs.length) // 只截 detail，不删消息

    const toolDetails = result.filter(m => m.role === 'tool').map(m => JSON.parse(m.content).detail as string)
    // 旧轮（c1）被截断
    expect(toolDetails[0].length).toBeLessThan(300)
    expect(toolDetails[0].endsWith('…')).toBe(true)
    // 最近 2 轮（c2/c3）完整保留
    expect(toolDetails[1]).toBe(LONG)
    expect(toolDetails[2]).toBe(LONG)
  })

  it('strip_detail: 单轮大文件场景全保护（保护优先于压缩收益）', () => {
    const LONG = 'X'.repeat(1000)
    const msgs = makePairRound('大文件', LONG, 'c1')
    const result = comp.compress(msgs, 750)
    expect(JSON.parse(result[2].content).detail).toBe(LONG) // 不足 2 轮 → 全保护
  })

  it('strip_detail: 保护后无孤儿 tool 消息（配对保持完整）', () => {
    const LONG = 'Y'.repeat(1000)
    const msgs: Message[] = [
      ...makePairRound('第一轮', LONG, 'c1'),
      ...makePairRound('第二轮', LONG, 'c2'),
    ]
    const result = comp.compress(msgs, 750)
    for (let i = 0; i < result.length; i++) {
      if (result[i].role === 'tool') {
        const prev = result[i - 1]
        expect(prev.role).toBe('assistant')
        expect(Array.isArray(prev.tool_calls)).toBe(true)
      }
    }
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

// ── v15.3.1: 阈值参数化 + 链式深度压缩 ──
describe('ContextCompressor v15.3.1（参数化阈值 + compressDeep）', () => {
  it('自定义阈值：85% strip / 90% summarize / 95% collapse', () => {
    const c = new ContextCompressor(1000, { thresholds: { strip: 0.85, summarize: 0.9, collapse: 0.95 } })
    expect(c.getStage(800)).toBe('none')
    expect(c.getStage(860)).toBe('strip_detail')
    expect(c.getStage(910)).toBe('summarize_pairs')
    expect(c.getStage(960)).toBe('collapse_early')
  })

  it('shouldDeepCompress：达到 deepAt 返回 true（主 agent 85% 链式触发）', () => {
    const c = new ContextCompressor(1000, { thresholds: { strip: 0.85, summarize: 0.9, collapse: 0.95 }, deepAt: 0.85 })
    expect(c.shouldDeepCompress(840)).toBe(false)
    expect(c.shouldDeepCompress(850)).toBe(true)
    expect(c.shouldDeepCompress(900)).toBe(true)
    // 不设 deepAt → 恒 false（子 agent 渐进压缩）
    const noDeep = new ContextCompressor(1000)
    expect(noDeep.shouldDeepCompress(999)).toBe(false)
  })

  it('compressDeep：链式一次到底（strip → 摘要 → 折叠），显著减少消息数', () => {
    const c = new ContextCompressor(1000, { deepAt: 0.85 })
    // 构造 10 轮对话（user + assistant + tool 结果）
    const msgs: Message[] = [
      { role: 'system', content: '核心规则' },
    ]
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: 'user', content: `第${i}轮问题${'很长的内容'.repeat(30)}` })
      msgs.push({ role: 'assistant', content: `第${i}轮回答${'也很长的内容'.repeat(30)}` })
      msgs.push(makeToolMsg(`工具${i}`, '非常长的工具详情'.repeat(50)))
    }
    const result = c.compressDeep(msgs, 880)  // 88% ≥ deepAt 85%
    expect(result.length).toBeLessThan(msgs.length)
    // 保留 system + 压缩摘要 + 最近若干条（collapse_early 保护最近 5 条消息）
    expect(result[0].role).toBe('system')
    const kept = result.filter(m => m.role === 'user').length
    expect(kept).toBeLessThanOrEqual(2)  // 早期轮次已被摘要/折叠
  })

  it('compressDeep 在未达阈值时原样返回', () => {
    const c = new ContextCompressor(1000, { deepAt: 0.85 })
    const msgs: Message[] = [{ role: 'user', content: '你好' }]
    expect(c.compressDeep(msgs, 500)).toBe(msgs)
  })
})

// ── v16.0.1: 审计修复（M2 首条 user 保护 / M3 单 user strip 生效）──
describe('ContextCompressor v16.0.1（M2/M3）', () => {
  it('M2: collapseEarly 首条 user 保留 400 字（原截断 80 字丢核心需求）', () => {
    const c = new ContextCompressor(1000, { deepAt: 0.85 })
    const longRequest = '用户原始长请求' + '这是核心需求内容'.repeat(60)  // >400 字
    const msgs: Message[] = [
      { role: 'system', content: '核心规则' },
      // 前面 3 轮短对话（会被折叠掉）
      { role: 'user', content: '早期问题1' },
      { role: 'assistant', content: '早期回答1' },
      { role: 'user', content: '早期问题2' },
      { role: 'assistant', content: '早期回答2' },
      { role: 'user', content: '早期问题3' },
      { role: 'assistant', content: '早期回答3' },
      // 长请求（折叠区的最后一条 user——摘要取折叠区末 3 条 user）
      { role: 'user', content: longRequest },
      { role: 'assistant', content: '回答' },
      // 后续轮次（受 keepLast=5 保护不折叠）
      { role: 'user', content: '后续问题1' },
      { role: 'assistant', content: '后续回答1' },
      { role: 'user', content: '后续问题2' },
      { role: 'assistant', content: '后续回答2' },
    ]
    const result = c.compressDeep(msgs, 900)
    const summary = result.find(m => m.role === 'system' && String(m.content).startsWith('[上下文已压缩]'))
    expect(summary).toBeDefined()
    // v16.0.2(C-1 修正): 实测折叠区 = [早期3轮(摘要system), 长请求user, 回答assistant] 折叠前结构
    //（strip/summarize 先执行）→ userMsgs.slice(-3) 取到最后 2 条 user = [长请求, 后续问题1]
    // → 摘要含 400 字截断的长请求（原注释声称"末 3 条 = [早期3, 长请求, 后续1]"与真实语义错位）
    // 原实现截 80 字只到"用户原始长请求这是核心需求内容这是核心需求内容这是核心…"（80 字）
    // 400 字截断 → 摘要显著更长且含完整开头
    expect(String(summary!.content)).toContain('用户原始长请求')
    expect(String(summary!.content).length).toBeGreaterThan(200)
    // 长请求完整开头保留（400 字截断包含"这是核心需求内容"重复段）
    expect(String(summary!.content)).toContain('这是核心需求内容'.repeat(3))
  })

  it('M3: 单 user 多工具轮 → strip_detail 仍生效（原 getRecentBoundary 返回 0 全保护空转）', () => {
    const c = new ContextCompressor(1000)
    const LONG = 'X'.repeat(1000)
    const msgs: Message[] = [
      { role: 'user', content: '读文件' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ status: 'success', summary: '读取', detail: LONG }) },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c2', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c2', content: JSON.stringify({ status: 'success', summary: '读取2', detail: LONG }) },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c3', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c3', content: JSON.stringify({ status: 'success', summary: '读取3', detail: LONG }) },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c4', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c4', content: JSON.stringify({ status: 'success', summary: '读取4', detail: LONG }) },
    ]
    const result = c.compress(msgs, 750)  // 75% → strip_detail
    const details = result.filter(m => m.role === 'tool').map(m => JSON.parse(String(m.content)).detail as string | undefined)
    // 最近 2 条 tool detail 保留（protectRounds=2，>200 字不截断），更早的截断到 200 字
    expect(details[0]!.length).toBeLessThanOrEqual(201)  // c1 被截（原：boundary=0 全保护 → 1000 字完整）
    expect(details[1]!.length).toBeLessThanOrEqual(201)  // c2 被截
    expect(details[2]).toBe(LONG)       // c3 完整
    expect(details[3]).toBe(LONG)       // c4 完整
  })
})
