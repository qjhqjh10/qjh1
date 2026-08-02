// ── maybeInjectResume 纯函数测试 (v14.2.0) ──
// 跨 run 续跑注入: 检测上一条 assistant 消息的 taskProgress 中断未完成 → 追加 [续跑] 提示。
// v14.3: + maybeInjectSubagentSummaries（子代理快照注入）。
// v14.6.1: 注入 role 从 system 改为 user（Anthropic 顶层 system 远端问题）——断言同步更新。
// 纯函数，不依赖 React/store。

import { describe, it, expect } from 'vitest'
import { maybeInjectResume, maybeInjectSubagentSummaries } from '../utils'
import type { Message } from '@/components/ai/chatConstants'

function assistantMsg(overrides: Partial<Message> = {}): Message {
  return { id: 'a1', role: 'assistant', content: '完成了一部分', timestamp: Date.now(), ...overrides }
}

const RESUME_TP = {
  tasks: [
    { id: 1, desc: '写完整大纲', done: true },
    { id: 2, desc: '创建角色卡', done: false },
    { id: 3, desc: '生成第一章', done: false },
  ],
  allDone: false,
  interrupted: true,
}

describe('maybeInjectResume', () => {
  it('中断未完成 → 注入 [续跑] 消息，含进度与剩余任务', () => {
    const history = [{ role: 'user' as const, content: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章' }]
    const messages = [assistantMsg({ taskProgress: RESUME_TP })]

    const result = maybeInjectResume(history, messages)

    expect(result).toHaveLength(2)
    // v14.6.1: user role（Anthropic 顶层 system 远端修复）
    expect(result[1].role).toBe('user')
    expect(result[1].content).toContain('[续跑]')
    expect(result[1].content).toContain('1/3')
    expect(result[1].content).toContain('剩余: 2)创建角色卡；3)生成第一章')
    expect(result[1].content).toContain('不要重新开始')
  })

  it('正常完成（allDone=true）→ 不注入', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [assistantMsg({
      taskProgress: { tasks: RESUME_TP.tasks.map(t => ({ ...t, done: true })), allDone: true, interrupted: false },
    })]

    const result = maybeInjectResume(history, messages)
    expect(result).toBe(history)
    expect(result).toHaveLength(1)
  })

  it('interrupted=false（提问/正常收尾）→ 不注入', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [assistantMsg({ taskProgress: { ...RESUME_TP, interrupted: false } })]

    expect(maybeInjectResume(history, messages)).toBe(history)
  })

  it('无 taskProgress（旧消息/无清单）→ 不注入', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [assistantMsg({})]

    expect(maybeInjectResume(history, messages)).toBe(history)
  })

  it('无 assistant 消息 → 不注入', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    expect(maybeInjectResume(history, [])).toBe(history)
  })

  it('纯函数: 不改动入参 history/messages', () => {
    const history = [{ role: 'user' as const, content: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章' }]
    const messages = [assistantMsg({ taskProgress: RESUME_TP })]
    const historySnapshot = JSON.stringify(history)
    const messagesSnapshot = JSON.stringify(messages)

    maybeInjectResume(history, messages)

    expect(JSON.stringify(history)).toBe(historySnapshot)
    expect(JSON.stringify(messages)).toBe(messagesSnapshot)
  })

  it('全部任务已 done 但 allDone=false（边界）→ 按未完成处理注入', () => {
    // 防御性: 数据不一致时以 allDone 为准（宁错勿漏——宁可注入也不静默丢失剩余任务）
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [assistantMsg({
      taskProgress: { tasks: RESUME_TP.tasks.map(t => ({ ...t, done: true })), allDone: false, interrupted: true },
    })]

    expect(maybeInjectResume(history, messages)).toHaveLength(2)
  })
})

// ══════════════════════════════════════════════════════════════
// maybeInjectSubagentSummaries (v14.3): 子代理快照跨 run 注入
// ══════════════════════════════════════════════════════════════

describe('maybeInjectSubagentSummaries', () => {
  const SNAPSHOT = [
    { tool: 'analyze_file', filePath: '剑道长生/chapters/ch1.txt', status: 'success' as const, summary: '子代理分析完成: ch1.txt', detail: '【要点】古剑出土\n【结论】结构完整' },
    { tool: 'verify_task', filePath: 'x.md', status: 'error' as const, summary: '子代理追问失败: x.md', detail: '文件不存在' },
  ]

  it('最后一条 assistant 带快照 → 追加 1 条 [子代理快照] user 消息（含路径与摘要）', () => {
    const history = [{ role: 'user' as const, content: '1. 分析文件' }]
    const messages = [assistantMsg({ subagentSummaries: SNAPSHOT })]

    const result = maybeInjectSubagentSummaries(history, messages)

    expect(result).toHaveLength(2)
    // v14.6.1: user role（Anthropic 顶层 system 远端修复）
    expect(result[1].role).toBe('user')
    expect(result[1].content).toContain('[子代理快照]')
    expect(result[1].content).toContain('[analyze_file] 剑道长生/chapters/ch1.txt')
    expect(result[1].content).toContain('子代理分析完成')
    // error 快照带 ✗ 标记
    expect(result[1].content).toContain('✗')
  })

  it('超过 maxEntries 只取最近 N 条（默认 3）', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      tool: 'analyze_file' as const, filePath: `f${i}.txt`, status: 'success' as const,
      summary: `分析 ${i}`, detail: `细节 ${i}`,
    }))
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [assistantMsg({ subagentSummaries: many })]

    const result = maybeInjectSubagentSummaries(history, messages)
    expect(result[1].content).not.toContain('f0.txt')
    expect(result[1].content).toContain('f2.txt')
    expect(result[1].content).toContain('f4.txt')
  })

  it('detail 超 detailChars（默认 800）被截断；自定义 opts 生效', () => {
    const long = [{ tool: 'analyze_file' as const, filePath: 'big.txt', status: 'success' as const, summary: '分析', detail: '长'.repeat(1000) }]
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [assistantMsg({ subagentSummaries: long })]

    const result = maybeInjectSubagentSummaries(history, messages, { maxEntries: 1, detailChars: 100 })
    const content = String(result[1].content)
    expect(content).toContain('长'.repeat(100))
    expect(content).not.toContain('长'.repeat(101))
  })

  it('反向扫描：最后一条 assistant 无快照、上一条有 → 取上一条', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [
      assistantMsg({ id: 'a1', subagentSummaries: SNAPSHOT }),
      assistantMsg({ id: 'a2', content: '纯聊天回复' }),
    ]

    const result = maybeInjectSubagentSummaries(history, messages)
    expect(result).toHaveLength(2)
    expect(result[1].content).toContain('ch1.txt')
  })

  it('全无快照 → 原样返回 history（同一引用）', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [assistantMsg({}), assistantMsg({ content: '你好' })]

    const result = maybeInjectSubagentSummaries(history, messages)
    expect(result).toBe(history)
  })

  it('纯函数: 不改动入参 history/messages', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = [assistantMsg({ subagentSummaries: SNAPSHOT })]
    const historySnapshot = JSON.stringify(history)
    const messagesSnapshot = JSON.stringify(messages)

    maybeInjectSubagentSummaries(history, messages)

    expect(JSON.stringify(history)).toBe(historySnapshot)
    expect(JSON.stringify(messages)).toBe(messagesSnapshot)
  })
})
