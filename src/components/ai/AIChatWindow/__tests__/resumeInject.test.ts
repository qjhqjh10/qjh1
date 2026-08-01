// ── maybeInjectResume 纯函数测试 (v14.2.0) ──
// 跨 run 续跑注入: 检测上一条 assistant 消息的 taskProgress 中断未完成 → 追加 [续跑] system 提示。
// 纯函数，不依赖 React/store。

import { describe, it, expect } from 'vitest'
import { maybeInjectResume } from '../utils'
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
    expect(result[1].role).toBe('system')
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
