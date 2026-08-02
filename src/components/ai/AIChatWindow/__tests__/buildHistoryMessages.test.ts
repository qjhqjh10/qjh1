// ── buildHistoryMessages 单测 (v14.5.1) ──
// 验证两个审计修复:
//   ① 工具轮检测改用 toolCallSteps——生产会话消息只持久化 toolCallSteps（无 tool_calls），
//      原检测恒空 → "保留最近5轮工具调用"死代码、跨 run 工具记忆缺失
//   ② compressedSummary 摘要不再被过滤——作为 system 消息注入历史，模型可见压缩前决策

import { describe, it, expect } from 'vitest'
import { buildHistoryMessages } from '../utils'

type M = any

function user(id: string, content: string): M {
  return { id, role: 'user', content, timestamp: Date.now() }
}
function assistant(id: string, content: string, extra: Record<string, unknown> = {}): M {
  return { id, role: 'assistant', content, timestamp: Date.now(), ...extra }
}

describe('buildHistoryMessages — 工具轮检测 (①)', () => {
  it('toolCallSteps 消息被识别为工具轮：保留最近 5 轮完整，更早工具轮压缩为摘要', () => {
    // 7 个工具轮（user → assistant(toolCallSteps)）
    const msgs: M[] = []
    for (let i = 0; i < 7; i++) {
      msgs.push(user(`u${i}`, `请求 ${i}`))
      msgs.push(assistant(`a${i}`, `回复 ${i}`, {
        toolCallSteps: [
          { tool: 'create_file', status: i === 1 ? 'error' : 'success', summary: `建了文件${i}` },
        ],
      }))
    }
    const out = buildHistoryMessages(msgs)
    // 前 2 个工具轮（0,1）在保留区外 → 压缩摘要格式
    const compressed = out.filter(m => m.content?.includes('上轮已完成 1 个操作'))
    expect(compressed.length).toBe(2)
    // 第 1 轮的失败工具出现在摘要中（"让 AI 从错误中学习"材料可见）
    expect(compressed[1].content).toContain('✗ create_file')
    // 最近 5 轮完整保留（原文 + [上轮工具] 前缀）
    const preserved = out.filter(m => m.content?.includes('[上轮工具:'))
    expect(preserved.length).toBe(5)
    // 总数 = 摘要2 + 保留5×2 + 全部分离？检查结构：7 user + 7 assistant → 14 条消息
    expect(out.filter(m => m.role === 'user').length).toBe(7)
    expect(out.filter(m => m.role === 'assistant').length).toBe(7)
  })

  it('legacy 数据（带 tool_calls 与 tool 结果）仍完整保留', () => {
    const msgs: M[] = [
      user('u1', '看看文件'),
      assistant('a1', '', { tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{}' } }] }),
      { id: 't1', role: 'tool', tool_call_id: 'c1', content: '{"status":"success","summary":"ok"}' },
    ]
    const out = buildHistoryMessages(msgs)
    const asst = out.find(m => m.role === 'assistant')!
    expect(asst.tool_calls).toHaveLength(1)
    expect(out.some(m => m.role === 'tool' && m.tool_call_id === 'c1')).toBe(true)
  })

  it('toolsUsed-only 消息（无 toolCallSteps）不误判为工具轮，原文直通', () => {
    const msgs: M[] = [
      user('u1', '写点东西'),
      assistant('a1', '写完了', { toolsUsed: ['create_file'] }),
    ]
    const out = buildHistoryMessages(msgs)
    expect(out.find(m => m.role === 'assistant')?.content).toBe('写完了')
    // 无 toolCallSteps → 不加 [上轮工具:] 前缀
    expect(out.filter(m => m.content?.includes('[上轮工具:')).length).toBe(0)
  })
})

describe('buildHistoryMessages — 压缩摘要注入 (②)', () => {
  it('compressedSummary 消息作为 system 消息注入历史最前', () => {
    const msgs: M[] = [
      user('u1', '早期讨论设定'),
      assistant('a1', '设定完成'),
      { id: 'comp1', role: 'system', content: '压缩摘要：用户要写修仙文，主角叫陆沉，灵根破碎设定已定', compressedSummary: true, timestamp: Date.now() },
      user('u2', '继续写第一章'),
      assistant('a2', '开始写'),
    ]
    const out = buildHistoryMessages(msgs)
    const sys = out.filter(m => m.role === 'system')
    expect(sys.length).toBe(1)
    expect(sys[0].content).toContain('[对话压缩摘要]')
    expect(sys[0].content).toContain('陆沉')
    // 摘要位于历史最前（先于用户消息）
    expect(out.indexOf(sys[0])).toBeLessThan(out.findIndex(m => m.role === 'user'))
    // 压缩摘要消息本身不再重复出现在消息流
    expect(out.filter(m => m.content === '压缩摘要：用户要写修仙文，主角叫陆沉，灵根破碎设定已定')).toHaveLength(0)
  })

  it('welcome 与 displayOnly 消息被过滤', () => {
    const msgs: M[] = [
      { id: 'welcome_x', role: 'system', content: '欢迎' },
      { id: 'd1', role: 'assistant', content: '软件能力介绍', displayOnly: true },
      user('u1', '真正的问题'),
    ]
    const out = buildHistoryMessages(msgs)
    expect(out.length).toBe(1)
    expect(out[0].content).toBe('真正的问题')
  })
})

describe('buildHistoryMessages — 早期折叠', () => {
  it('超过 20 轮用户消息时折叠早期轮次为 [早期对话已折叠]', () => {
    const msgs: M[] = []
    for (let i = 0; i < 22; i++) {
      msgs.push(user(`u${i}`, `第${i}轮请求`))
      msgs.push(assistant(`a${i}`, `第${i}轮回复`))
    }
    const out = buildHistoryMessages(msgs)
    const sys = out.filter(m => m.role === 'system' && m.content?.includes('[早期对话已折叠]'))
    expect(sys.length).toBe(1)
    expect(sys[0].content).toContain('此前 2 轮的用户请求要点')
    expect(out.filter(m => m.role === 'user').length).toBe(20)
  })
})
