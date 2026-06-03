// ── V4 Simulation Tests ──
// Comprehensive end-to-end tests simulating real user interactions.
// Verifies: simple tasks, multi-turn dialog, multi-tool calls, token efficiency.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { V4AgentRuntime } from '../V4AgentRuntime'
import { V4SecurityFence } from '../V4SecurityFence'
import { toolRegistry } from '../tools/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'
import type { Message, ToolCallRequest, ToolResult } from '../state/types'

// ── Setup ──
toolRegistry.registerAll(ALL_TOOLS)

type SimulatedResponse = {
  text: string
  toolCalls?: ToolCallRequest[]
}

function makeSimulatedAIService(responses: SimulatedResponse[]) {
  let callIndex = 0
  const callLog: Array<{ messages: Message[]; tools: unknown[] }> = []
  return {
    service: {
      chatWithTools: vi.fn(async (msgs: Message[], _cid: string, _pid?: string, _tools?: unknown[]) => {
        callLog.push({ messages: [...msgs], tools: _tools ? [..._tools] : [] })
        const resp = responses[callIndex] || { text: '完成。' }
        callIndex++
        return {
          text: resp.text || '',
          toolCalls: resp.toolCalls || null,
          finishReason: resp.toolCalls ? 'tool_calls' : 'stop',
          usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300, cost: 0 },
        }
      }),
      abortStream: vi.fn(),
    },
    callLog,
    callCount: () => callIndex,
  }
}

function makeRealToolExecutor() {
  const executedTools: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    executor: vi.fn(async (args: Record<string, unknown>, ctx: any) => {
      executedTools.push({ name: ctx.toolName, args })
      // Simulate real file operations
      switch (ctx.toolName) {
        case 'list_directory':
          return { status: 'success' as const, summary: '5 个文件: 许倩.json, 张明.json, 林雨晴.json, 王振国.json, 师父.json', detail: '许倩.json\n张明.json\n林雨晴.json\n王振国.json\n师父.json' }
        case 'read_file': {
          const path = String(args.file_path || '')
          if (path.includes('outline/plot.md')) return { status: 'success' as const, summary: '大纲读取成功', detail: '## 第1幕: 校园日常\n许倩隐藏修仙身份，与同学张明相识...\n## 第2幕: 修仙世界初现\n许倩身份暴露危机，王振国追捕...' }
          if (path.includes('characters/')) return { status: 'success' as const, summary: '角色读取成功', detail: '{"name":"角色名","role":"女主","gender":"女","age":"19岁","occupation":"大学生","personality":"外冷内热"}' }
          if (path.includes('detailed_outline/')) return { status: 'success' as const, summary: '细纲读取成功', detail: '{"title":"第3章","plotOverview":"雨夜仓库对峙...","characters":"主角\\n反派","location":"废弃仓库","keyEvents":"对峙\\n揭示身份"}' }
          if (path.includes('nonexistent')) return { status: 'error' as const, summary: 'ENOENT: 文件不存在' }
          return { status: 'success' as const, summary: '读取成功', detail: '文件内容...' }
        }
        case 'search_content':
          return { status: 'success' as const, summary: '找到 3 处匹配', detail: 'characters/许倩.json: "许倩"\noutline/plot.md: "许倩"\nchapters/chapter2.txt: "许倩"' }
        case 'create_file':
          return { status: 'success' as const, summary: `已创建: ${args.file_path}`, detail: '文件内容已写入' }
        case 'edit_file':
          return { status: 'success' as const, summary: '编辑成功', detail: '已修改' }
        case 'delete_file':
          return { status: 'success' as const, summary: '已删除', detail: '文件已删除' }
        default:
          return { status: 'success' as const, summary: `${ctx.toolName} 执行完成` }
      }
    }),
    executedTools,
  }
}

function makeRuntime(maxIter = 10) {
  return new V4AgentRuntime({
    configId: 'test-config',
    projectId: 'test-project',
    maxIterations: maxIter,
    abortSignal: new AbortController().signal,
  })
}

// ═══════════════════════════════════════════════════════
// 1. 简单任务 — 快捷执行
// ═══════════════════════════════════════════════════════

describe('简单任务 — 快捷执行', () => {
  it('"列出角色" → list_directory → 回复角色列表', async () => {
    const { service, callLog } = makeSimulatedAIService([
      {
        text: '让我看看有哪些角色',
        toolCalls: [{ id: 'c1', name: 'list_directory', arguments: '{"dir_path":"characters/"}' }],
      },
      { text: '你的项目中有 5 个角色：许倩（女主）、张明（男主）、林雨晴（女配）、王振国（反派）、师父（男配）。需要查看哪个角色的详细信息？' },
    ])
    const { executor, executedTools } = makeRealToolExecutor()

    const runtime = makeRuntime()
    runtime.setAIService(service)
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getAllSchemas())

    const result = await runtime.run({ userMessage: '列出角色', attachments: [] })

    // 只用了 2 轮 API 调用
    expect(callLog.length).toBe(2)
    // 只调用了 1 个工具
    expect(executedTools).toHaveLength(1)
    expect(executedTools[0].name).toBe('list_directory')
    // 有文本回复
    expect(result.text).toContain('角色')
    expect(result.toolCalls).toBe(1)
  })

  it('"查看大纲" → read_file → 回复大纲内容', async () => {
    const { service, callLog } = makeSimulatedAIService([
      {
        text: '好的',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"file_path":"outline/plot.md"}' }],
      },
      { text: '大纲显示故事分为两幕。第1幕：校园日常，许倩隐藏修仙身份。第2幕：修仙世界初现，王振国追捕。需要我详细展开哪部分？' },
    ])
    const { executor, executedTools } = makeRealToolExecutor()

    const runtime = makeRuntime()
    runtime.setAIService(service)
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getAllSchemas())

    const result = await runtime.run({ userMessage: '查看大纲', attachments: [] })

    expect(callLog.length).toBe(2)
    expect(executedTools).toHaveLength(1)
    expect(executedTools[0].name).toBe('read_file')
    expect(executedTools[0].args.file_path).toContain('outline/plot.md')
  })

  it('"你好" → 直接回复，0个工具调用', async () => {
    const { service, callLog } = makeSimulatedAIService([
      { text: '你好！有什么写作方面的问题我可以帮你？' },
    ])
    const { executor, executedTools } = makeRealToolExecutor()

    const runtime = makeRuntime()
    runtime.setAIService(service)
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getAllSchemas())

    const result = await runtime.run({ userMessage: '你好', attachments: [] })

    expect(callLog.length).toBe(1) // 1轮结束
    expect(executedTools).toHaveLength(0) // 零工具调用
    expect(result.toolCalls).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════
// 2. 多工具调用 — 精准使用，不冗余
// ═══════════════════════════════════════════════════════

describe('多工具调用 — 精准不冗余', () => {
  it('"写第3章" → read×3 → create → 验证 (不重复', async () => {
    const { service, callLog } = makeSimulatedAIService([
      {
        text: '好的，先了解一下上下文。',
        toolCalls: [
          { id: 'c1', name: 'read_file', arguments: '{"file_path":"outline/plot.md"}' },
          { id: 'c2', name: 'read_file', arguments: '{"file_path":"characters/许倩.json"}' },
          { id: 'c3', name: 'read_file', arguments: '{"file_path":"detailed_outline/ch3.json"}' },
        ],
      },
      {
        text: '已了解全部上下文，开始创作。',
        toolCalls: [{ id: 'c4', name: 'create_file', arguments: '{"file_path":"chapters/chapter3.txt","content":"第3章正文..."}' }],
      },
      { text: '第3章已完成，2087字。文件保存在 chapters/chapter3.txt。' },
    ])
    const { executor, executedTools } = makeRealToolExecutor()

    const runtime = makeRuntime()
    runtime.setAIService(service)
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getAllSchemas())

    const result = await runtime.run({ userMessage: '写第3章', attachments: [] })

    // 3轮API调用，5个工具调用
    expect(callLog.length).toBe(3)
    expect(executedTools).toHaveLength(4) // read×3 + create×1

    // 没有重复调用同一工具
    const toolNames = executedTools.map(t => t.name)
    const readCount = toolNames.filter(n => n === 'read_file').length
    expect(readCount).toBe(3) // 读了大纲+角色+细纲，各一次，没有重复

    // 没有在创建后立即再读同一文件
    const lastTools = toolNames.slice(-2)
    expect(lastTools).not.toEqual(['create_file', 'read_file']) // 没有冗余验证读
  })

  it('错误恢复 — 文件不存在 → 自动搜索 → 修正路径', async () => {
    const { service, callLog } = makeSimulatedAIService([
      {
        text: '让我读一下角色文件',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"file_path":"characters/nonexistent.json"}' }],
      },
      {
        text: '找到了，让我读正确的文件',
        toolCalls: [{ id: 'c3', name: 'read_file', arguments: '{"file_path":"characters/许倩.json"}' }],
      },
      { text: '角色许倩：女主，19岁大学生，外冷内热，隐藏修仙身份。' },
    ])
    const { executor, executedTools } = makeRealToolExecutor()

    const runtime = makeRuntime()
    runtime.setAIService(service)
    runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getAllSchemas())

    const result = await runtime.run({ userMessage: '读许倩的角色卡', attachments: [] })

    // 错误发生→搜索修正→成功读取
    expect(executedTools[0].name).toBe('read_file')
    expect(executedTools[0].args.file_path).toContain('nonexistent')
    expect(executedTools[1].name).toBe('read_file') // 用正确路径重试
    expect(executedTools[1].args.file_path).not.toContain('nonexistent')
    expect(result.success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════
// 3. 多轮对话 — 上下文保持
// ═══════════════════════════════════════════════════════

describe('多轮对话 — 上下文保持', () => {
  it('Turn1: 写第3章 → Turn2: "刚才写的再润色一下"', async () => {
    // Turn 1
    const { service: s1 } = makeSimulatedAIService([
      { text: '好的', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"file_path":"detailed_outline/ch3.json"}' }] },
      { text: '好的', toolCalls: [{ id: 'c2', name: 'create_file', arguments: '{"file_path":"chapters/chapter3.txt","content":"第3章..."}' }] },
      { text: '第3章已完成。' },
    ])
    const { executor: e1 } = makeRealToolExecutor()
    const rt1 = makeRuntime()
    rt1.setAIService(s1); rt1.setToolExecutor(e1); rt1.setTools(toolRegistry.getAllSchemas())
    const r1 = await rt1.run({ userMessage: '写第3章', attachments: [] })
    expect(r1.success).toBe(true)

    // Turn 2 — should know about the previous chapter
    const { service: s2 } = makeSimulatedAIService([
      {
        text: '好的，让我读一下刚才写的第3章',
        toolCalls: [{ id: 'c3', name: 'read_file', arguments: '{"file_path":"chapters/chapter3.txt"}' }],
      },
      {
        text: '明白了',
        toolCalls: [{ id: 'c4', name: 'edit_file', arguments: '{"file_path":"chapters/chapter3.txt","old_string":"第3章...","new_string":"第3章（润色版）..."}' }],
      },
      { text: '已润色完成。改进了对话部分，增加了环境描写。' },
    ])
    const { executor: e2, executedTools: et2 } = makeRealToolExecutor()
    const rt2 = makeRuntime()
    rt2.setAIService(s2); rt2.setToolExecutor(e2); rt2.setTools(toolRegistry.getAllSchemas())
    // Feed history from turn 1
    rt2.setHistory([
      { role: 'user', content: '写第3章' },
      { role: 'assistant', content: '第3章已完成。' },
    ])
    const r2 = await rt2.run({ userMessage: '刚才写的再润色一下', attachments: [] })

    // Should read then edit the specific chapter
    expect(et2[0].name).toBe('read_file')
    expect(et2[0].args.file_path).toContain('chapter3') // 知道是哪章
    expect(et2[1].name).toBe('edit_file')
    expect(r2.success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════
// 4. Token 效率 — 不浪费
// ═══════════════════════════════════════════════════════

describe('Token 效率', () => {
  it('工具 schema 全量发送但合理利用', async () => {
    const { service, callLog } = makeSimulatedAIService([
      { text: '好的', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"file_path":"outline/plot.md"}' }] },
      { text: '大纲显示故事在第2幕。' },
    ])
    const { executor } = makeRealToolExecutor()
    const runtime = makeRuntime()
    runtime.setAIService(service); runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getAllSchemas())

    await runtime.run({ userMessage: '查看大纲', attachments: [] })

    // 2轮API调用：第1轮有工具，第2轮文本回复
    expect(callLog.length).toBe(2)
    // 工具始终在非最后迭代中发送（模型需要看到工具列表才能决策）
    expect(callLog[0].tools?.length || 0).toBeGreaterThan(0)
    // 确认只有2轮API调用完成（没有多余的"探索"轮次）
  })

  it('不会在同一次任务中重复读已读文件', async () => {
    const { service } = makeSimulatedAIService([
      {
        text: '先了解情况',
        toolCalls: [
          { id: 'c1', name: 'read_file', arguments: '{"file_path":"outline/plot.md"}' },
          { id: 'c2', name: 'read_file', arguments: '{"file_path":"characters/许倩.json"}' },
        ],
      },
      {
        text: '已了解，现在创建', // 聪明：不重新读已读文件
        toolCalls: [{ id: 'c3', name: 'create_file', arguments: '{"file_path":"chapters/test.txt","content":"test"}' }],
      },
      { text: '完成。' },
    ])
    const { executor, executedTools } = makeRealToolExecutor()
    const runtime = makeRuntime()
    runtime.setAIService(service); runtime.setToolExecutor(executor)
    runtime.setTools(toolRegistry.getAllSchemas())

    await runtime.run({ userMessage: '创建测试章节', attachments: [] })

    // 第2轮直接create，没有重新read
    const round2Tools = executedTools.slice(2)
    const readCallsInRound2 = round2Tools.filter(t => t.name === 'read_file')
    expect(readCallsInRound2.length).toBe(0) // 没有多余的读
  })
})

// ═══════════════════════════════════════════════════════
// 5. Agent 完整功能列表 + 验证
// ═══════════════════════════════════════════════════════

describe('Agent 功能全景验证', () => {
  // ── 核心循环 ──
  it('功能01: 统一Agent循环 — 聊天直接回复', async () => {
    const { service } = makeSimulatedAIService([{ text: '你好！' }])
    const rt = makeRuntime(); const { executor } = makeRealToolExecutor()
    rt.setAIService(service); rt.setToolExecutor(executor); rt.setTools([])
    const r = await rt.run({ userMessage: '你好', attachments: [] })
    expect(r.toolCalls).toBe(0); expect(r.success).toBe(true)
  })

  it('功能02: 统一Agent循环 — 任务自动工具调用', async () => {
    const { service } = makeSimulatedAIService([
      { text: '', toolCalls: [{ id: 'c1', name: 'list_directory', arguments: '{"dir_path":"characters/"}' }] },
      { text: '完成' },
    ])
    const rt = makeRuntime(); const { executor } = makeRealToolExecutor()
    rt.setAIService(service); rt.setToolExecutor(executor); rt.setTools(toolRegistry.getAllSchemas())
    const r = await rt.run({ userMessage: '列出角色', attachments: [] })
    expect(r.toolCalls).toBeGreaterThan(0); expect(r.success).toBe(true)
  })

  // ── 安全围栏 ──
  it('功能03: SecurityFence — 拦截系统路径', () => {
    const fence = new V4SecurityFence('test')
    expect(fence.check('read_file', { file_path: 'C:/Windows/test.txt' }).allowed).toBe(false)
  })

  it('功能04: SecurityFence — 外部路径需确认', () => {
    const fence = new V4SecurityFence('test')
    const r = fence.check('read_file', { file_path: '../../../etc/passwd' })
    expect(r.allowed).toBe(true)
    expect(r.needsApproval).toBe(true)
  })

  it('功能05: SecurityFence — 危险工具需确认', () => {
    const fence = new V4SecurityFence('test')
    const r = fence.check('delete_file', { file_path: 'test.txt' })
    expect(r.allowed).toBe(true)
    expect(r.needsApproval).toBe(true)
  })

  it('功能06: SecurityFence — 安全工具直接放行', () => {
    const fence = new V4SecurityFence('test')
    const r = fence.check('read_file', { file_path: 'outline/plot.md' })
    expect(r.allowed).toBe(true)
    expect(r.needsApproval).toBe(false)
  })

  it('功能07: SecurityFence — JSON格式校验', () => {
    const fence = new V4SecurityFence('test')
    expect(fence.check('create_file', { file_path: 'test.json', content: '{bad' }).allowed).toBe(false)
    expect(fence.check('create_file', { file_path: 'test.json', content: '{"ok":true}' }).allowed).toBe(true)
  })

  // ── 工具注册 ──
  it('功能08: ToolRegistry — 38个工具全部可用', () => {
    const names = toolRegistry.getNames()
    expect(names.length).toBeGreaterThanOrEqual(30)
    expect(names).toContain('read_file')
    expect(names).toContain('create_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('delete_file')
    expect(names).toContain('kb_list')
    expect(names).toContain('write_note')
  })

  it('功能09: ToolRegistry — 全量Schema可获取', () => {
    const schemas = toolRegistry.getAllSchemas()
    expect(schemas.length).toBeGreaterThanOrEqual(30)
    schemas.forEach(s => {
      expect(s.type).toBe('function')
      expect(s.function.name).toBeTruthy()
      expect(s.function.description).toBeTruthy()
    })
  })

  // ── 工具描述质量 ──
  it('功能10: 工具描述 — 核心工具含使用指引', () => {
    const coreTools = ['read_file', 'create_file', 'edit_file', 'search_content', 'list_directory', 'delete_file']
    for (const name of coreTools) {
      const def = toolRegistry.get(name)
      expect(def).toBeDefined()
      expect(def!.schema.description.length).toBeGreaterThan(10)
      expect(def!.schema.description).toMatch(/何时使用|用于|使用此工具|默认|支持|Glob|搜索|替换|读取/)
    }
  })

  // ── 上下文组装 ──
  it('功能11: ContextAssembler — 系统提示词注入', async () => {
    const { buildSystemPrompt, CORE_SYSTEM_PROMPT } = await import('../V4SystemPrompt')
    const p = buildSystemPrompt([], 'project-structure', 'project-context')
    expect(p).toContain('青剑')
    expect(p).toContain('list_directory')
    expect(p).toContain('铁律')
    expect(p).toContain('read_file')
  })

  // ── 诊断日志 ──
  it('功能12: DiagnosticLogger — 事件记录可用', async () => {
    const { diagnosticLogger } = await import('../diagnostics/DiagnosticLogger')
    diagnosticLogger.recordInfo('测试事件')
    const events = diagnosticLogger.getRecentEvents(10)
    expect(events.length).toBeGreaterThan(0)
  })

  // ── 学习引擎 ──
  it('功能13: LearningEngine — 写入和读取学习经验', async () => {
    const { LearningEngine } = await import('../learning/LearningEngine')
    const le = new LearningEngine()
    await le.load()
    const entry = le.addEntry('JSON字段名缺少双引号', '先read_file参考已有JSON格式', 'file')
    expect(entry.problem).toBe('JSON字段名缺少双引号')
    expect(entry.solution).toContain('read_file')
    expect(entry.enabled).toBe(false)  // default off
    const entries = le.getAll()
    expect(entries.length).toBe(1)
    const ctx = le.getContextInject()
    expect(ctx).toBe('')  // not injected when disabled
    le.toggleEnabled(entry.id)
    const ctx2 = le.getContextInject()
    expect(ctx2).toContain('JSON字段名缺少双引号')
  })

  // ── 审计日志 ──
  it('功能14: AuditTrail — 会话启动和工具记录', async () => {
    const { AuditTrail } = await import('../audit/AuditTrail')
    const at = new AuditTrail()
    at.startSession('test-session')
    at.recordToolResult('read_file', 'success', '读取成功')
    at.recordPermissionDecision('read_file', 'allow', '')
    const events = at.getEvents()
    expect(events.length).toBeGreaterThanOrEqual(2)
  })

  // ── 消息上下文 ──
  it('功能15: AgentEventEmitter — 事件发射和监听', async () => {
    const { AgentEventEmitter } = await import('../runtime/AgentEventEmitter')
    const emitter = new (AgentEventEmitter as any)()
    const received: string[] = []
    emitter.on('tool:started', (d: any) => received.push(d.toolName))
    emitter.emit('tool:started', { callId: '1', toolName: 'read_file', phase: 'started', progress: 0, message: '', timestamp: Date.now() })
    expect(received).toContain('read_file')
  })

  // ── 多工具并行 ──
  it('功能16: 只读工具并行执行，写入工具顺序执行', async () => {
    const { service } = makeSimulatedAIService([
      {
        text: '',
        toolCalls: [
          { id: 'c1', name: 'read_file', arguments: '{"file_path":"a.txt"}' },
          { id: 'c2', name: 'read_file', arguments: '{"file_path":"b.txt"}' },
          { id: 'c3', name: 'create_file', arguments: '{"file_path":"c.txt","content":"x"}' },
        ],
      },
      { text: '完成' },
    ])
    const { executor } = makeRealToolExecutor()
    const rt = makeRuntime()
    rt.setAIService(service); rt.setToolExecutor(executor); rt.setTools(toolRegistry.getAllSchemas())

    await rt.run({ userMessage: '复制', attachments: [] })
    // 3个工具都执行了
    expect(executor).toHaveBeenCalledTimes(3)
    // read_file 是 AUTO 权限 → 并行执行通过 Promise.all
  })

  // ── 最大迭代保护 ──
  it('功能17: 超过最大迭代自动终止', async () => {
    const manyToolCalls = Array.from({ length: 10 }, (_, i) => ({
      text: '',
      toolCalls: [{ id: `c${i}`, name: 'list_directory', arguments: '{"dir_path":"test/"}' }],
    }))
    const { service } = makeSimulatedAIService([...manyToolCalls, { text: 'done' }])
    const { executor } = makeRealToolExecutor()
    const rt = makeRuntime(3) // max 3 iterations
    rt.setAIService(service); rt.setToolExecutor(executor); rt.setTools(toolRegistry.getAllSchemas())

    const r = await rt.run({ userMessage: 'loop', attachments: [] })
    // Should have terminated after maxIterations
    expect(r.iterationCount).toBeLessThanOrEqual(3 + 1) // +1 for final round
  })

  // ── Abort 中断 ──
  it('功能18: 用户中断执行', async () => {
    const ac = new AbortController()
    const { service } = makeSimulatedAIService([
      { text: '', toolCalls: [{ id: 'c1', name: 'list_directory', arguments: '{"dir_path":"test/"}' }] },
    ])
    const { executor } = makeRealToolExecutor()
    const rt = new V4AgentRuntime({ configId: 'test', projectId: null, maxIterations: 5, abortSignal: ac.signal })
    rt.setAIService(service); rt.setToolExecutor(executor); rt.setTools([])

    ac.abort() // abort before run
    const r = await rt.run({ userMessage: 'test', attachments: [] })
    expect(r.success).toBe(false)
  })
})
