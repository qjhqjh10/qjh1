// ── Subagent Service Tests (v15) ──
// 验证子 agent 工厂：schema 过滤、isolatedStore 隔离、usage 统计、abort 传播。
// 子 agent 的文件工具走 IPC（fileService），必须 mock。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore } from '../store/AgentStore'

// ── Mocks（vi.mock 工厂 hoisted，必须用 vi.hoisted 定义变量）──

const { chatWithToolsMock, executeFileToolsMock } = vi.hoisted(() => ({
  chatWithToolsMock: vi.fn(),
  executeFileToolsMock: vi.fn(),
}))

vi.mock('@/services/fileService', () => ({
  aiService: {
    chatWithTools: (...args: unknown[]) => chatWithToolsMock(...args),
    executeFileTools: (...args: unknown[]) => executeFileToolsMock(...args),
    abortStream: vi.fn(),
  },
}))

vi.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({
      configs: [{ id: 'test-config', protocol: 'openai' }],
      activeConfigId: 'test-config',
    }),
  },
  useStore: { getState: () => ({ setFileEditNotify: vi.fn() }) },
}))

vi.mock('@/store/operationHistoryStore', () => ({
  useOpHistoryStore: { getState: () => ({ addEntry: vi.fn() }) },
}))

import { runSubagent, ANALYZE_TOOL_NAMES, EDIT_TOOL_NAMES } from '../subagent/SubagentService'
import { toolRegistry } from '../skills/ToolRegistry'
import { ALL_TOOLS } from '../skills/tools'

// ── Setup ──
toolRegistry.registerAll(ALL_TOOLS)

/** 模拟 aiService.chatWithTools 的响应序列（IPC 形状：toolCalls 含 function.name） */
function makeAIResponses(responses: Array<{ text?: string; toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }> }>) {
  let idx = 0
  chatWithToolsMock.mockImplementation(async () => {
    const r = responses[idx] ?? { text: '完成。' }
    idx++
    return {
      text: r.text ?? '',
      toolCalls: r.toolCalls ?? null,
      finishReason: r.toolCalls ? 'tool_calls' : 'stop',
      usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300, cached_tokens: 0, cost: 0 },
    }
  })
}

/** 模拟文件工具 IPC */
function makeFileTools() {
  executeFileToolsMock.mockImplementation(async (calls: Array<{ callId?: string; toolName: string; args: Record<string, unknown> }>) => {
    return calls.map(c => {
      if (c.toolName === 'read_file') {
        return { callId: c.callId ?? 'x', toolName: c.toolName, status: 'success', summary: '读取成功', detail: '## 第1章\n古剑出土，主角陆沉觉醒。'.repeat(50) }
      }
      if (c.toolName === 'search_content') {
        return { callId: c.callId ?? 'x', toolName: c.toolName, status: 'success', summary: '找到 2 处匹配', detail: '第1章: 古剑\n第3章: 古剑' }
      }
      return { callId: c.callId ?? 'x', toolName: c.toolName, status: 'success', summary: `${c.toolName} 完成`, detail: '' }
    })
  })
}

describe('runSubagent', () => {
  beforeEach(() => {
    chatWithToolsMock.mockReset()
    executeFileToolsMock.mockReset()
    makeFileTools()
  })

  it('analyze 角色：两轮（read → 总结），返回文本与 usage', async () => {
    makeAIResponses([
      { toolCalls: [{ id: 'r1', function: { name: 'read_file', arguments: '{"file_path":"剑道长生/chapters/ch1.txt"}' } }] },
      { text: '【要点】古剑出土\n【引用位置】第1章\n【结论】结构完整' },
    ])
    const result = await runSubagent({
      role: 'analyze',
      projectId: '剑道长生',
      configId: 'test-config',
      userMessage: '任务文件: 剑道长生/chapters/ch1.txt\n分析问题: 输出结构摘要',
    })

    expect(result.success, `subagent text: ${result.text.slice(0, 300)}`).toBe(true)
    expect(result.text).toContain('【要点】')
    expect(result.usage.promptTokens).toBe(400)   // 2 轮 × 200
    expect(result.usage.completionTokens).toBe(200)
    expect(result.usage.totalTokens).toBe(600)
    expect(result.usage.calls).toBe(2)
  })

  it('子 runtime 收到过滤后的 schema：含 ANALYZE_TOOL_NAMES（含 find_files）、不含 subagent 委托工具', async () => {
    makeAIResponses([{ text: '完成' }])
    await runSubagent({
      role: 'analyze',
      projectId: null,
      configId: 'test-config',
      userMessage: '任务文件: x.txt',
    })

    const toolsArg = chatWithToolsMock.mock.calls[0]?.[3] as Array<{ function?: { name?: string } }> | undefined
    expect(toolsArg).toBeDefined()
    const names = (toolsArg || []).map(t => t.function?.name).filter(Boolean)
    // 只读工具集（find_files 已加入：条件审批 + IPC containment 保证子 agent 只能软件内定位）
    expect(names.sort()).toEqual([...ANALYZE_TOOL_NAMES].sort())
    expect(names).toContain('find_files')
    // 无递归委托工具
    expect(names).not.toContain('analyze_file')
    expect(names).not.toContain('edit_file_task')
    expect(names).not.toContain('verify_task')
  })

  it('verify 角色（v14.2.1）：只读工具集 + 验收提示词，输出 JSON 报告', async () => {
    makeAIResponses([{ text: '{"passed": false, "items": [{"criterion": "文件存在", "passed": false, "reason": "不存在"}]}' }])
    const result = await runSubagent({
      role: 'verify',
      projectId: null,
      configId: 'test-config',
      userMessage: '验收文件清单:\n- x.txt\n\n验收标准清单:\n1. 文件存在且非空',
    })

    expect(result.success).toBe(true)
    // 工具集 = 只读（复用 ANALYZE_TOOL_NAMES，不含写工具）
    const toolsArg = chatWithToolsMock.mock.calls[0]?.[3] as Array<{ function?: { name?: string } }> | undefined
    const names = (toolsArg || []).map(t => t.function?.name).filter(Boolean)
    expect(names.sort()).toEqual([...ANALYZE_TOOL_NAMES].sort())
    expect(names).not.toContain('create_file')
    // system 提示词为验收提示词（含"验收"与 JSON 输出要求）
    const sysMsg = chatWithToolsMock.mock.calls[0]?.[0]?.find((m: { role?: string }) => m.role === 'system')
    expect(String(sysMsg?.content || '')).toContain('验收')
    expect(String(sysMsg?.content || '')).toContain('JSON')
    // 输出 JSON 报告原样返回
    expect(result.text).toContain('"passed": false')
  })

  it('edit 角色：工具集含写工具（create_file/edit_file/batch_replace），不含 delete/rename', async () => {
    makeAIResponses([{ text: '完成' }])
    await runSubagent({
      role: 'edit',
      projectId: null,
      configId: 'test-config',
      userMessage: '任务文件: x.txt\n修改指令: 改一下',
    })

    const toolsArg = chatWithToolsMock.mock.calls[0]?.[3] as Array<{ function?: { name?: string } }> | undefined
    const names = (toolsArg || []).map(t => t.function?.name).filter(Boolean)
    expect(names.sort()).toEqual([...EDIT_TOOL_NAMES].sort())
    expect(names).not.toContain('delete_file')
    expect(names).not.toContain('rename_file')
  })

  it('isolatedStore：run 前后共享 AgentStore 状态不变（不污染主 agent UI/熔断）', async () => {
    makeAIResponses([{ text: '完成' }])
    const before = JSON.stringify(useAgentStore.getState().run)
    const circuitBefore = JSON.stringify(useAgentStore.getState().health)

    await runSubagent({
      role: 'analyze',
      projectId: null,
      configId: 'test-config',
      userMessage: '任务文件: x.txt',
    })

    expect(JSON.stringify(useAgentStore.getState().run)).toBe(before)
    expect(JSON.stringify(useAgentStore.getState().health)).toBe(circuitBefore)
  })

  it('abort 传播：调用前 abort → 不调 API，直接返回失败', async () => {
    const controller = new AbortController()
    controller.abort()  // 调用前已 abort
    const result = await runSubagent({
      role: 'analyze',
      projectId: null,
      configId: 'test-config',
      userMessage: '任务文件: x.txt',
      signal: controller.signal,
    })
    expect(result.success).toBe(false)
    expect(chatWithToolsMock).not.toHaveBeenCalled()
  })

  it('v14.3: 失败轨迹回传 — 子代理内部错误步骤拼入 text（最近 2 条）', async () => {
    // 第一轮：read_file 失败（error 步骤进 toolCallSteps）
    executeFileToolsMock.mockImplementation(async (calls: Array<{ callId?: string; toolName: string; args: Record<string, unknown> }>) => {
      return calls.map(c => c.toolName === 'read_file'
        ? { callId: c.callId ?? 'x', toolName: c.toolName, status: 'error', summary: '文件不存在', detail: '' }
        : { callId: c.callId ?? 'x', toolName: c.toolName, status: 'success', summary: 'ok', detail: '' })
    })
    const controller = new AbortController()
    // 第二轮 API 调用前触发 abort → runtime 检测中断 → success=false（含第一轮的 error 步骤）
    let calls = 0
    chatWithToolsMock.mockImplementation(async () => {
      calls++
      if (calls === 2) controller.abort()
      return {
        text: calls === 1 ? '' : '中断',
        toolCalls: calls === 1 ? [{ id: 'r1', function: { name: 'read_file', arguments: '{"file_path":"x.txt"}' } }] : null,
        finishReason: calls === 1 ? 'tool_calls' : 'stop',
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300, cached_tokens: 0, cost: 0 },
      }
    })

    const result = await runSubagent({
      role: 'analyze',
      projectId: null,
      configId: 'test-config',
      userMessage: '任务文件: x.txt',
      signal: controller.signal,
    })
    expect(result.success).toBe(false)
    expect(result.text).toContain('[子代理失败摘要]')
    expect(result.text).toContain('read_file')
    expect(result.text).toContain('文件不存在')
  })
})

describe('subagent 会话池 (v14.3)', () => {
  beforeEach(() => {
    chatWithToolsMock.mockReset()
    executeFileToolsMock.mockReset()
    makeFileTools()
  })

  it('同 sessionKey 复用：追问时历史注入（含上轮任务消息），无需重新读取', async () => {
    // 每个 run 单轮（直接输出文本）→ mock.calls 索引 = run 序号
    makeAIResponses([{ text: '完成。' }])

    await runSubagent({
      role: 'analyze',
      projectId: '剑道长生',
      configId: 'test-config',
      userMessage: '任务文件: 剑道长生/chapters/ch1.txt\n分析问题: 第一次分析结构',
      sessionKey: '剑道长生::剑道长生/chapters/ch1.txt',
    })
    expect(chatWithToolsMock).toHaveBeenCalledTimes(1)

    await runSubagent({
      role: 'analyze',
      projectId: '剑道长生',
      configId: 'test-config',
      userMessage: '追问: 第2章细节',
      sessionKey: '剑道长生::剑道长生/chapters/ch1.txt',
    })
    expect(chatWithToolsMock).toHaveBeenCalledTimes(2)

    const secondRunMessages = chatWithToolsMock.mock.calls[1]?.[0] as Array<{ role?: string; content?: string }>
    const joined = (secondRunMessages || []).map(m => String(m.content || '')).join('\n')
    // 历史注入：上轮任务消息存在
    expect(joined).toContain('第一次分析结构')
    // 新追问消息存在
    expect(joined).toContain('追问: 第2章细节')
  })

  it('v14.5.0 角色不符不复用：edit 会话被 analyze 追问 → 全新分析（无旧历史）', async () => {
    // edit 角色子代理：先调普通写工具 edit_file（调 edit_file_task 会递归嵌套子代理，不可用于测试）→ 文本收尾
    makeAIResponses([
      { toolCalls: [{ id: 'e1', function: { name: 'edit_file', arguments: '{"file_path":"剑道长生/chapters/ch1.txt","old_string":"a","new_string":"b"}' } }] },
      { text: '完成。' },
    ])
    // 第一次：edit_file_task 角色建立会话
    await runSubagent({
      role: 'edit',
      projectId: '剑道长生',
      configId: 'test-config',
      userMessage: '任务文件: 剑道长生/chapters/ch1.txt\n修改指令: 改错别字',
      sessionKey: '剑道长生::剑道长生/chapters/ch1.txt',
    })
    expect(chatWithToolsMock).toHaveBeenCalledTimes(2)

    // 第二次：analyze 角色追问同一 key → 角色不符 → 不复用（全新分析）
    await runSubagent({
      role: 'analyze',
      projectId: '剑道长生',
      configId: 'test-config',
      userMessage: '追问: 结构细节',
      sessionKey: '剑道长生::剑道长生/chapters/ch1.txt',
    })
    expect(chatWithToolsMock).toHaveBeenCalledTimes(3)
    const secondRunMessages = chatWithToolsMock.mock.calls[2]?.[0] as Array<{ role?: string; content?: string }>
    const joined = (secondRunMessages || []).map(m => String(m.content || '')).join('\n')
    // 无 edit 会话的任务消息（角色不符 → 全新分析）
    expect(joined).not.toContain('修改指令')
    // 新追问消息存在
    expect(joined).toContain('追问: 结构细节')
  })

  it('LRU 淘汰：超过 MAX_SESSIONS(8) 后最旧会话被淘汰，再追问退化为全新分析', async () => {
    makeAIResponses([{ text: '完成。' }])
    // 连续 9 个不同会话填满 8 槽（第 1 个最旧，将被淘汰）
    for (let i = 1; i <= 9; i++) {
      await runSubagent({
        role: 'analyze',
        projectId: 'p',
        configId: 'test-config',
        userMessage: `任务文件: p/f${i}.txt\n分析问题: 第${i}次`,
        sessionKey: `p::p/f${i}.txt`,
      })
    }
    expect(chatWithToolsMock).toHaveBeenCalledTimes(9)

    // 追问第 1 个（已被淘汰）→ 全新分析：messages 不含旧历史
    await runSubagent({
      role: 'analyze',
      projectId: 'p',
      configId: 'test-config',
      userMessage: '追问: 第1次细节',
      sessionKey: 'p::p/f1.txt',
    })
    const tenthMessages = chatWithToolsMock.mock.calls[9]?.[0] as Array<{ role?: string; content?: string }>
    const joined = (tenthMessages || []).map(m => String(m.content || '')).join('\n')
    // 已淘汰 → 无历史任务消息（注意：用户消息自身含"第1次"，须断言历史消息特征而非子串）
    expect(joined).not.toContain('任务文件: p/f1.txt')
    expect(joined).not.toContain('分析问题: 第1次')
    expect(joined).toContain('追问: 第1次细节')
  })

  it('字符预算：超长历史被裁剪（保留首条任务 + 尾部），追问上下文有界', async () => {
    // read_file 返回 3 万字符 → 历史超 MAX_SESSION_CHARS(20000)
    executeFileToolsMock.mockImplementation(async (calls: Array<{ callId?: string; toolName: string; args: Record<string, unknown> }>) => {
      return calls.map(c => c.toolName === 'read_file'
        ? { callId: c.callId ?? 'x', toolName: c.toolName, status: 'success', summary: '读取成功', detail: '长'.repeat(30000) }
        : { callId: c.callId ?? 'x', toolName: c.toolName, status: 'success', summary: 'ok', detail: '' })
    })
    makeAIResponses([
      { toolCalls: [{ id: 'r1', function: { name: 'read_file', arguments: '{"file_path":"big.txt"}' } }] },
      { text: '【要点】分析完成' },
    ])
    await runSubagent({
      role: 'analyze',
      projectId: null,
      configId: 'test-config',
      userMessage: '任务文件: big.txt\n分析问题: 结构',
      sessionKey: 'global::big.txt',
    })
    expect(chatWithToolsMock).toHaveBeenCalledTimes(2)

    // 追问 → 历史已裁剪：总长有界（首条 + 尾部，不含 3 万字 detail）
    await runSubagent({
      role: 'analyze',
      projectId: null,
      configId: 'test-config',
      userMessage: '追问: 细节',
      sessionKey: 'global::big.txt',
    })
    const secondRunMessages = chatWithToolsMock.mock.calls[2]?.[0] as Array<{ role?: string; content?: string; tool_call_id?: string; tool_calls?: Array<{ id: string }> }>
    const joined = (secondRunMessages || []).map(m => String(m.content || '')).join('\n')
    expect(joined.length).toBeLessThan(21000)
    expect(joined).toContain('任务文件: big.txt')
    expect(joined).toContain('追问: 细节')

    // v14.3.1 回归：追问消息中不得有孤儿 tool 消息（tool_result 无对应 tool_use → Anthropic API 400）
    // 每个 tool 消息的 tool_call_id 必须在前面的 assistant tool_calls 中找到
    const seenToolUseIds = new Set<string>()
    for (const m of secondRunMessages || []) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) seenToolUseIds.add(tc.id)
      }
      if (m.role === 'tool' && m.tool_call_id) {
        expect(seenToolUseIds.has(m.tool_call_id), `孤儿 tool 消息: ${m.tool_call_id}`).toBe(true)
      }
    }
  })
})
