// ── maybeInjectResume 纯函数测试 (v14.2.0) ──
// 跨 run 续跑注入: 检测上一条 assistant 消息的 taskProgress 中断未完成 → 追加 [续跑] 提示。
// v14.3: + maybeInjectSubagentSummaries（子代理快照注入）。
// v14.6.1: 注入 role 从 system 改为 user（Anthropic 顶层 system 远端问题）——断言同步更新。
// v14.9: 增加"继续意图"门控——最后一条用户消息须含继续语义才注入（防旧清单劫持无关新请求）。
// 纯函数，不依赖 React/store。

import { describe, it, expect } from 'vitest'
import { maybeInjectResume, maybeInjectSubagentSummaries, hasResumeIntent, buildThinkingPlanFromRun, buildToolHintText } from '../utils'
import type { Message } from '@/components/ai/chatConstants'

function assistantMsg(overrides: Partial<Message> = {}): Message {
  return { id: 'a1', role: 'assistant', content: '完成了一部分', timestamp: Date.now(), ...overrides }
}

/** v14.9: 会话末尾追加新用户消息（真实场景：新请求在最后） */
function withUserMsg(msgs: Message[], content: string = '继续完成剩下的任务'): Message[] {
  return [...msgs, { id: 'u1', role: 'user', content, timestamp: Date.now() }]
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

describe('hasResumeIntent', () => {
  it('继续语义命中', () => {
    expect(hasResumeIntent('继续')).toBe(true)
    expect(hasResumeIntent('接着把剩下的写完')).toBe(true)
    expect(hasResumeIntent('把剩余任务做完')).toBe(true)
    expect(hasResumeIntent('上次中断了，继续完成')).toBe(true)
  })

  it('无关问题不命中（防劫持核心）', () => {
    expect(hasResumeIntent('帮我写一段短评')).toBe(false)
    expect(hasResumeIntent('检查第3章的剧情')).toBe(false)
    expect(hasResumeIntent('你好')).toBe(false)
    expect(hasResumeIntent('')).toBe(false)
    expect(hasResumeIntent(null)).toBe(false)
  })
})

describe('maybeInjectResume', () => {
  it('中断未完成 + 用户说继续 → 注入 [续跑] 消息，含进度与剩余任务', () => {
    const history = [{ role: 'user' as const, content: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章' }]
    const messages = withUserMsg([assistantMsg({ taskProgress: RESUME_TP })], '继续')

    const result = maybeInjectResume(history, messages)

    expect(result).toHaveLength(2)
    // v14.6.1: user role（Anthropic 顶层 system 远端修复）
    expect(result[1].role).toBe('user')
    expect(result[1].content).toContain('[续跑]')
    expect(result[1].content).toContain('1/3')
    expect(result[1].content).toContain('剩余: 2)创建角色卡；3)生成第一章')
    expect(result[1].content).toContain('不要重新开始')
  })

  it('v14.9: 中断未完成但用户问无关问题 → 不注入（旧清单不劫持新请求）', () => {
    const history = [{ role: 'user' as const, content: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章' }]
    const messages = withUserMsg([assistantMsg({ taskProgress: RESUME_TP })], '帮我写一段短评')

    const result = maybeInjectResume(history, messages)

    expect(result).toBe(history)
    expect(result).toHaveLength(1)
  })

  it('正常完成（allDone=true）→ 不注入', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = withUserMsg([assistantMsg({
      taskProgress: { tasks: RESUME_TP.tasks.map(t => ({ ...t, done: true })), allDone: true, interrupted: false },
    })], '继续')

    const result = maybeInjectResume(history, messages)
    expect(result).toBe(history)
    expect(result).toHaveLength(1)
  })

  it('interrupted=false（提问/正常收尾）→ 不注入', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = withUserMsg([assistantMsg({ taskProgress: { ...RESUME_TP, interrupted: false } })], '继续')

    expect(maybeInjectResume(history, messages)).toBe(history)
  })

  it('无 taskProgress（旧消息/无清单）→ 不注入', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = withUserMsg([assistantMsg({})], '继续')

    expect(maybeInjectResume(history, messages)).toBe(history)
  })

  it('无 assistant 消息 → 不注入', () => {
    const history = [{ role: 'user' as const, content: '任务' }]
    expect(maybeInjectResume(history, [])).toBe(history)
  })

  it('纯函数: 不改动入参 history/messages', () => {
    const history = [{ role: 'user' as const, content: '1. 写完整大纲 2. 创建角色卡 3. 生成第一章' }]
    const messages = withUserMsg([assistantMsg({ taskProgress: RESUME_TP })], '继续')
    const historySnapshot = JSON.stringify(history)
    const messagesSnapshot = JSON.stringify(messages)

    maybeInjectResume(history, messages)

    expect(JSON.stringify(history)).toBe(historySnapshot)
    expect(JSON.stringify(messages)).toBe(messagesSnapshot)
  })

  it('全部任务已 done 但 allDone=false（边界）→ 按未完成处理注入', () => {
    // 防御性: 数据不一致时以 allDone 为准（宁错勿漏——宁可注入也不静默丢失剩余任务）
    const history = [{ role: 'user' as const, content: '任务' }]
    const messages = withUserMsg([assistantMsg({
      taskProgress: { tasks: RESUME_TP.tasks.map(t => ({ ...t, done: true })), allDone: false, interrupted: true },
    })], '继续')

    expect(maybeInjectResume(history, messages)).toHaveLength(2)
  })
})

// ══════════════════════════════════════════════════════════════
// buildThinkingPlanFromRun (v14.9): 「执行计划」卡片数据源（从实际执行记录回溯）
// ══════════════════════════════════════════════════════════════

describe('buildThinkingPlanFromRun', () => {
  const RUN = {
    toolCallSteps: [
      { tool: 'read_file', status: 'success', summary: '已读取 1200 字符', arguments: '{"file_path":"剑道长生/outline/plot.md"}' },
      { tool: 'create_file', status: 'success', summary: '创建成功', arguments: '{"file_path":"剑道长生/characters/李狗蛋.md"}' },
    ],
  }

  it('有工具执行 → 生成计划（意图+步骤+文件去重）', () => {
    const plan = buildThinkingPlanFromRun(RUN as any, '请创建角色卡并读取大纲')
    expect(plan).toBeDefined()
    expect(plan!.steps).toHaveLength(2)
    expect(plan!.steps[0]).toMatchObject({ tool: 'read_file', action: '已读取 1200 字符' })
    expect(plan!.files).toContain('剑道长生/outline/plot.md')
    expect(plan!.files).toContain('剑道长生/characters/李狗蛋.md')
    expect(plan!.intent).toBe('请创建角色卡并读取大纲')
  })

  it('无工具调用（纯聊天）→ 返回 undefined（不显示面板）', () => {
    expect(buildThinkingPlanFromRun({ toolCallSteps: [] } as any, '你好')).toBeUndefined()
    expect(buildThinkingPlanFromRun({} as any, '你好')).toBeUndefined()
  })

  it('arguments 解析失败/无路径 → 跳过该步骤的文件提取', () => {
    const plan = buildThinkingPlanFromRun({
      toolCallSteps: [{ tool: 'tool_search', status: 'success', summary: '发现', arguments: '不是JSON{' }],
    } as any, 'x')
    expect(plan!.files).toEqual([])
    expect(plan!.steps).toHaveLength(1)
  })

  it('intent 截断 60 字符；文件上限 8 个', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      tool: 'read_file', status: 'success', summary: 's', arguments: JSON.stringify({ file_path: `f${i}.txt` }),
    }))
    const plan = buildThinkingPlanFromRun({ toolCallSteps: many } as any, '长'.repeat(100))
    expect(plan!.intent.length).toBe(60)
    expect(plan!.files.length).toBe(8)
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

// ── v15.3.0: buildToolHintText（#工具提示）──
describe('buildToolHintText（#工具提示注入）', () => {
  it('无工具返回空串', () => {
    expect(buildToolHintText([])).toBe('')
    expect(buildToolHintText(undefined as any)).toBe('')
  })

  it('单个工具生成软提示（非强制语义）', () => {
    const text = buildToolHintText(['create_file'])
    expect(text).toContain('[工具提示:')
    expect(text).toContain('#create_file')
    expect(text).toContain('仅供参考，非强制')  // 软提示措辞：不强制、不限制
    expect(text).toContain('也可使用其他工具')
  })

  it('多工具并列显示', () => {
    const text = buildToolHintText(['read_file', 'edit_file', 'kb_search'])
    expect(text).toContain('#read_file #edit_file #kb_search')
  })

  it('防御性：去重 + 过滤非法工具名（含空格/大写/符号）', () => {
    const text = buildToolHintText(['read_file', 'read_file', 'Create File', 'bad#name', 'normal_tool'])
    expect(text).toContain('#read_file')
    expect(text).not.toContain('Create')
    expect(text).not.toContain('bad#name')
    expect(text).toContain('#normal_tool')
  })
})
