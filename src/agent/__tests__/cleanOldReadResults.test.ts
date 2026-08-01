// H1: cleanOldReadResults 压缩验证
// 工具结果消息无 toolName 字段（ContractExecutor 过滤后仅 status/summary/detail），
// 需从 assistant tool_calls 建立 id→工具名映射判断 read_file。
import { describe, it, expect } from 'vitest'
import { cleanOldReadResults } from '../runtime/V4UnifiedRuntime'
import type { Message } from '../state/types'

const FULL_FILE = '文件内容'.repeat(500) // 远超 200 字

function makeReadFileToolMsg(callId: string, detail: string): Message {
  return {
    role: 'tool',
    tool_call_id: callId,
    content: JSON.stringify({ status: 'success', summary: '读取成功', detail }),
  }
}

function makeWriteToolMsg(callId: string): Message {
  return { role: 'tool', tool_call_id: callId, content: JSON.stringify({ status: 'success', summary: '已创建' }) }
}

/** v14.3: analyze_file 子代理结果轮（detail 为结构化分析摘要） */
function analyzeRound(round: number): Message[] {
  const callId = `acall_${round}`
  return [
    { role: 'user', content: `第${round}轮分析请求` },
    { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: callId, function: { name: 'analyze_file', arguments: '{}' } }] },
    makeReadFileToolMsg(callId, '【要点】子代理分析结论'.repeat(300)),
  ]
}

/** 构造一轮历史: user + assistant(tool_calls 形状一) + tool 结果 */
function oneRound(round: number, asstShape: 'runtime' | 'adapter' = 'runtime'): Message[] {
  const callId = `call_${round}`
  const tc = asstShape === 'runtime'
    ? { type: 'function' as const, id: callId, function: { name: 'read_file', arguments: '{}' } }
    : { id: callId, name: 'read_file', arguments: '{}' }
  return [
    { role: 'user', content: `第${round}轮请求` },
    { role: 'assistant', content: '', tool_calls: [tc] },
    makeReadFileToolMsg(callId, FULL_FILE),
  ]
}

describe('cleanOldReadResults (H1)', () => {
  it('超过 5 轮的 read_file 结果被压缩，最近 5 轮保持完整', () => {
    // 7 轮历史 → 前 2 轮应被压缩，后 5 轮不动
    const history: Message[] = []
    for (let r = 1; r <= 7; r++) history.push(...oneRound(r))

    const result = cleanOldReadResults(history)

    // 前 2 轮的 tool 消息被压缩
    const toolMsgs = result.filter(m => m.role === 'tool')
    expect(toolMsgs.length).toBe(7)
    const firstTool = JSON.parse(toolMsgs[0].content as string)
    expect(firstTool.detail).toContain('已压缩')
    expect(firstTool.detail).toContain('预览:')
    // 压缩后不再包含全文
    expect(firstTool.detail).not.toContain(FULL_FILE)
    // 第 6、7 轮（最近 2 轮）保持完整
    const lastTool = JSON.parse(toolMsgs[6].content as string)
    expect(lastTool.detail).toBe(FULL_FILE)
  })

  it('恰好 5 轮历史全部保持完整', () => {
    const history: Message[] = []
    for (let r = 1; r <= 5; r++) history.push(...oneRound(r))
    const result = cleanOldReadResults(history)
    for (const m of result.filter(m => m.role === 'tool')) {
      const parsed = JSON.parse(m.content as string)
      expect(parsed.detail).toBe(FULL_FILE)
    }
  })

  it('非 read_file 工具结果不压缩', () => {
    const history: Message[] = [
      { role: 'user', content: '创建文件' },
      { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'c1', function: { name: 'create_file', arguments: '{}' } }] },
      makeWriteToolMsg('c1'),
      ...oneRound(2),
      ...oneRound(3),
      ...oneRound(4),
      ...oneRound(5),
      ...oneRound(6),
      ...oneRound(7),
    ]
    const result = cleanOldReadResults(history)
    const writeTool = result.find(m => m.role === 'tool' && m.tool_call_id === 'c1')!
    const parsed = JSON.parse(writeTool.content as string)
    expect(parsed.summary).toBe('已创建') // 原样保留
    expect(parsed.detail).toBeUndefined()
  })

  it('AnthropicAdapter 形状（{id,name}）同样能识别 read_file', () => {
    const history: Message[] = []
    for (let r = 1; r <= 6; r++) history.push(...oneRound(r, 'adapter'))
    const result = cleanOldReadResults(history)
    const firstTool = JSON.parse(result.filter(m => m.role === 'tool')[0].content as string)
    expect(firstTool.detail).toContain('已压缩')
  })

  it('tool_call_id 无对应 assistant 映射时安全降级不压缩', () => {
    // 历史被裁剪: 只剩 tool 结果没有 assistant
    const history: Message[] = [
      { role: 'user', content: '旧请求' },
      { role: 'tool', tool_call_id: 'orphan_1', content: JSON.stringify({ status: 'success', summary: 's', detail: FULL_FILE }) },
    ]
    const result = cleanOldReadResults(history)
    expect(result[1].content).toContain(FULL_FILE) // 原样保留
  })

  it('非 JSON 内容的 tool 消息走纯文本截断分支（审查补强）', () => {
    const history: Message[] = [
      { role: 'user', content: '旧请求' },
      { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'c1', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '纯文本' + '很长'.repeat(200) },
      ...oneRound(2), ...oneRound(3), ...oneRound(4), ...oneRound(5), ...oneRound(6), ...oneRound(7),
    ]
    const result = cleanOldReadResults(history)
    const first = result.find(m => m.role === 'tool' && m.tool_call_id === 'c1')!
    expect(String(first.content)).toContain('已压缩')
    expect(String(first.content)).toContain('预览:')
    expect(String(first.content)).not.toContain('很长'.repeat(200))
  })

  it('v14.3: 超过 5 轮的 analyze_file 结果同样被压缩，最近 5 轮完整；create_file 不压缩', () => {
    const history: Message[] = []
    for (let r = 1; r <= 7; r++) history.push(...analyzeRound(r))
    history.push(
      { role: 'user', content: '创建' },
      { role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'w1', function: { name: 'create_file', arguments: '{}' } }] },
      makeWriteToolMsg('w1'),
    )

    const result = cleanOldReadResults(history)

    const toolMsgs = result.filter(m => m.role === 'tool')
    expect(toolMsgs).toHaveLength(8)
    // 前 2 轮 analyze_file 被压缩
    const firstAnalyze = JSON.parse(toolMsgs[0].content as string)
    expect(firstAnalyze.detail).toContain('已压缩')
    expect(firstAnalyze.detail).toContain('预览:')
    expect(firstAnalyze.detail).not.toContain('【要点】子代理分析结论'.repeat(300))
    // 最近 2 轮 analyze_file 完整
    const lastAnalyze = JSON.parse(toolMsgs[6].content as string)
    expect(lastAnalyze.detail).toContain('【要点】子代理分析结论')
    // create_file 不压缩
    const writeTool = result.find(m => m.role === 'tool' && m.tool_call_id === 'w1')!
    expect(JSON.parse(writeTool.content as string).summary).toBe('已创建')
  })

  it('空历史返回空数组', () => {
    expect(cleanOldReadResults([])).toEqual([])
  })
})
