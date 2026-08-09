// ── v16.0.1(审计 S4): ToolExecutor 超时孤儿执行提示 ──
// 写工具超时后（非子代理工具），注入结果带 note 引导模型先 read_file 确认现状

import { describe, it, expect, vi } from 'vitest'
import { executeSingleTool, setPerToolTimeoutForTest, type ToolExecContext } from '../runtime/ToolExecutor'
import type { ToolCallRequest } from '../state/types'
import { ReadResultTracker } from '../context/ReadResultTracker'

function makeCtx(overrides?: Partial<ToolExecContext>): ToolExecContext {
  return {
    toolExecutor: vi.fn(() => new Promise(() => {})),  // 永不 resolve → 触发超时
    projectId: 'test-project',
    configId: 'cfg1',
    abortSignal: new AbortController().signal,
    messagesForApi: [],
    toolsUsed: [],
    toolCallSteps: [],
    emitter: {
      on: vi.fn(), emit: vi.fn(), abort: vi.fn(),
    } as unknown as ToolExecContext['emitter'],
    iteration: 1,
    subagentSummaries: [],
    store: {
      addToolExecution: vi.fn(),
      completeTool: vi.fn(),
      setStreamingText: vi.fn(),
    },
    ...overrides,
  } as unknown as ToolExecContext
}

describe('ToolExecutor — S4 超时提示', () => {
  it('写工具超时 → 注入结果带 note 引导先 read_file 确认现状', async () => {
    setPerToolTimeoutForTest({ edit_file: 50 })  // 缩短超时
    const ctx = makeCtx()
    const tc: ToolCallRequest = { id: 't1', name: 'edit_file', arguments: JSON.stringify({ file_path: 'test-project/chapters/1.md', old_string: 'a', new_string: 'b' }) }

    await executeSingleTool(tc, ctx)

    const toolMsg = ctx.messagesForApi.find(m => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    const parsed = JSON.parse(String(toolMsg!.content))
    expect(parsed.status).toBe('error')
    expect(parsed.summary).toContain('执行超时')
    // v16.0.1(S4): note 引导模型超时后先确认现状（防双写/错改）
    expect(parsed.note).toContain('read_file 确认文件当前状态')
  })

  it('超时结果不记录 readTracker.recordWrite（结果不可信）', async () => {
    setPerToolTimeoutForTest({ edit_file: 50 })
    const tracker = new ReadResultTracker()
    const recordWriteSpy = vi.spyOn(tracker, 'recordWrite')
    const ctx = makeCtx({ readTracker: tracker })
    const tc: ToolCallRequest = { id: 't2', name: 'edit_file', arguments: JSON.stringify({ file_path: 'test-project/chapters/1.md', old_string: 'a', new_string: 'b' }) }

    await executeSingleTool(tc, ctx)

    expect(recordWriteSpy).not.toHaveBeenCalled()
  })

  it('成功结果不受影响（无超时 note）', async () => {
    const ctx = makeCtx({
      toolExecutor: vi.fn(async () => ({ status: 'success' as const, summary: '已修改', detail: '' })),
    })
    const tc: ToolCallRequest = { id: 't3', name: 'edit_file', arguments: JSON.stringify({ file_path: 'test-project/chapters/1.md', old_string: 'a', new_string: 'b' }) }

    await executeSingleTool(tc, ctx)

    const toolMsg = ctx.messagesForApi.find(m => m.role === 'tool')
    const parsed = JSON.parse(String(toolMsg!.content))
    expect(parsed.status).toBe('success')
    expect(parsed.note ?? '').not.toContain('执行超时')
  })
})
