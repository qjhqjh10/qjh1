// ── Tool Executor ──
// Handles: tool argument parsing, execution with timeout, event emission, result filtering.

import { ContractExecutor } from '../context/ContractExecutor'
import type { ToolExecutorFn } from './RuntimeTypes'
import type { Message, ToolCallRequest, ToolResult } from '../state/types'
import type { AgentEventEmitter } from './AgentEventEmitter'
import { nanoid } from 'nanoid'

/** Extract file path from tool args — best-effort across all tool naming conventions. */
function extractFilePath(args: Record<string, unknown>): string {
  // Direct file path keys (ordered by most common)
  const keys = ['filePath', 'path', 'targetPath', 'sourcePath', 'filepath', 'file_path',
    'target', 'dest', 'destination', 'projectPath', 'kbPath', 'notePath', 'templatePath']
  for (const k of keys) {
    const v = args[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  // Fallback: check any key ending with "Path" or "path"
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 0 && (k.endsWith('Path') || k.endsWith('path'))) {
      return v
    }
  }
  return ''
}

/** Tools that write — executed sequentially. */
export const WRITE_TOOLS = new Set([
  'create_file','edit_file','batch_replace','delete_file','rename_file','create_project','delete_project',
  'kb_append_file',
  'generate_image','http_get','http_fetch','browser_open','browser_search',
])

/** Split tool calls into read-only (parallel) and write (sequential) groups. */
export function classifyToolCalls(toolCalls: ToolCallRequest[]): {
  readOnlyCalls: ToolCallRequest[]
  writeCalls: ToolCallRequest[]
} {
  const readOnlyCalls: ToolCallRequest[] = []
  const writeCalls: ToolCallRequest[] = []
  for (const tc of toolCalls) {
    if (WRITE_TOOLS.has(tc.name)) {
      writeCalls.push(tc)
    } else {
      readOnlyCalls.push(tc)
    }
  }
  return { readOnlyCalls, writeCalls }
}

export interface ToolExecContext {
  toolExecutor: ToolExecutorFn
  projectId: string | null
  configId: string
  abortSignal: AbortSignal
  messagesForApi: Message[]
  toolsUsed: string[]
  toolCallSteps: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number; arguments?: string; matchedTools?: string[] }>
  emitter: AgentEventEmitter
  iteration: number
  /** v9.5.5: Store for tool progress tracking */
  store: {
    addToolExecution: (callId: string, toolName: string) => void
    completeTool: (callId: string, status: 'success' | 'error', summary: string, detail?: string) => void
    setStreamingText: (text: string) => void
  }
}

/**
 * Execute a single tool call with timeout, event emission.
 * Modifies ctx.messagesForApi, ctx.toolsUsed, ctx.toolCallSteps.
 */
export async function executeSingleTool(
  tc: ToolCallRequest,
  ctx: ToolExecContext,
): Promise<void> {
  if (!ctx.toolsUsed.includes(tc.name)) ctx.toolsUsed.push(tc.name)

  ctx.store.addToolExecution(tc.id, tc.name)
  ctx.emitter.emit('tool:started', {
    callId: tc.id, toolName: tc.name,
    phase: 'started', progress: 0,
    message: `${tc.name} 开始执行`,
    timestamp: Date.now(),
  })

  let args: Record<string, unknown>
  try {
    args = JSON.parse(tc.arguments)
  } catch {
    const errResult = { status: 'error' as const, summary: '工具参数 JSON 解析失败' }
    ctx.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(errResult) })
    ctx.store.completeTool(tc.id, 'error', errResult.summary)
    // v13.1.0: 记录解析失败
    try {
      const { useOpHistoryStore } = await import('@/store/operationHistoryStore')
      useOpHistoryStore.getState().addEntry({
        id: nanoid(8), timestamp: new Date().toISOString(),
        conversationId: ctx.projectId || 'global', toolName: tc.name,
        filePath: '', args: {}, status: 'error',
        summary: '工具参数 JSON 解析失败', detail: tc.arguments,
      })
    } catch { /* ignore */ }
    return
  }

  // Execute (120s — analyze_text_style calls AI, needs >60s)
  const t0 = Date.now()
  let result: ToolResult
  const TOOL_TIMEOUT = 120_000
  const execPromise = ctx.toolExecutor(args, {
    projectId: ctx.projectId,
    configId: ctx.configId,
    callId: tc.id,
    toolName: tc.name,
    signal: ctx.abortSignal,
  })
  const timeoutPromise = new Promise<ToolResult>(r =>
    setTimeout(() => r({ status: 'error', summary: `工具 ${tc.name} 执行超时` }), TOOL_TIMEOUT)
  )
  result = await Promise.race([execPromise, timeoutPromise])

  const durationMs = Date.now() - t0
  ctx.toolCallSteps.push({ tool: tc.name, status: result.status, summary: result.summary || '', durationMs, iteration: ctx.iteration, arguments: tc.arguments, matchedTools: (result as any).matchedTools })

  // ── v13.1.0: 操作记录持久化 ──
  try {
    const { useOpHistoryStore } = await import('@/store/operationHistoryStore')
    useOpHistoryStore.getState().addEntry({
      id: nanoid(8),
      timestamp: new Date().toISOString(),
      conversationId: ctx.projectId || 'global',
      toolName: tc.name,
      filePath: extractFilePath(args),
      args,
      status: result.status === 'success' ? 'success' : 'error',
      summary: result.summary || '',
      detail: result.detail || '',
    })
  } catch { /* 记录写入失败不影响主流程 */ }

  // Emit result
  if (result.status === 'success') {
    ctx.store.completeTool(tc.id, 'success', result.summary, result.detail)
    ctx.emitter.emit('tool:completed', {
      callId: tc.id, toolName: tc.name,
      status: 'success', summary: result.summary, detail: result.detail,
      timestamp: Date.now(),
    })
  } else {
    ctx.store.completeTool(tc.id, 'error', result.summary, result.detail)
    ctx.emitter.emit('tool:failed', {
      callId: tc.id, toolName: tc.name,
      status: 'error', summary: result.summary, detail: result.detail,
      timestamp: Date.now(),
    })
  }

  // Filter result for API context (ContractExecutor: strip verbose detail)
  const { resultForApi, note } = ContractExecutor.filterForContext(tc.name, result)
  const finalResult = note ? { ...resultForApi, note } : resultForApi
  ctx.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(finalResult) })

}
