// ── Tool Executor ──
// Extracted from executeSingleTool in both runtimes (~90% identical).
// Handles: tool argument parsing, execution with timeout, event emission,
// result filtering, and delegation to ToolActionPrompter for skill orchestration.

import { ContractExecutor } from '../context/ContractExecutor'
import { applyActionPrompts } from './ToolActionPrompter'
import type { ToolExecutorFn } from './RuntimeTypes'
import type { Message, ToolCallRequest, ToolResult } from '../state/types'
import type { AgentEventEmitter } from './AgentEventEmitter'

/** Tools that write — executed sequentially. */
export const WRITE_TOOLS = new Set([
  'create_file','edit_file','batch_replace','delete_file','rename_file','create_project','delete_project',
  'kb_append_file',
  'shell_exec','shell_run_script','generate_image','http_get','http_fetch','browser_open','browser_search',
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
  toolCallSteps: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number; arguments?: string }>
  emitter: AgentEventEmitter
  _consecutiveReads: number
  iteration: number
  /** v9.5.5: Store for tool progress tracking */
  store: {
    addToolExecution: (callId: string, toolName: string) => void
    completeTool: (callId: string, status: 'success' | 'error', summary: string, detail?: string) => void
    setStreamingText: (text: string) => void
  }
}

/**
 * Execute a single tool call with timeout, event emission, and skill orchestration.
 * Modifies ctx.messagesForApi, ctx.toolsUsed, ctx.toolCallSteps, ctx._consecutiveReads.
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
  ctx.toolCallSteps.push({ tool: tc.name, status: result.status, summary: result.summary || '', durationMs, iteration: ctx.iteration, arguments: tc.arguments })

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

  // ── v9.5.5: Skill orchestration (delegated to ToolActionPrompter) ──
  const newReads = applyActionPrompts({
    messagesForApi: ctx.messagesForApi,
    _consecutiveReads: ctx._consecutiveReads,
    tc, result, args,
  })
  ctx._consecutiveReads = newReads

  // Filter result for API context (ContractExecutor: strip verbose detail)
  const { resultForApi, note } = ContractExecutor.filterForContext(tc.name, result)
  const finalResult = note ? { ...resultForApi, note } : resultForApi
  ctx.messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(finalResult) })
}
