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

  it('子 runtime 收到过滤后的 schema：含 ANALYZE_TOOL_NAMES、不含 find_files/subagent 工具', async () => {
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
    // 只读工具集
    expect(names.sort()).toEqual([...ANALYZE_TOOL_NAMES].sort())
    // 无危险/递归工具
    expect(names).not.toContain('find_files')
    expect(names).not.toContain('analyze_file')
    expect(names).not.toContain('edit_file_task')
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
})
