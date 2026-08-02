// ── Tool Executor ──
// Handles: tool argument parsing, execution with timeout, event emission, result filtering.

import { ContractExecutor } from '../context/ContractExecutor'
import type { ToolExecutorFn, SubagentSummary } from './RuntimeTypes'
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
  'kb_append_file','kb_index_file',  // v14.9(审计): +kb_index_file——同轮 create_file(新建KB文件)+索引 时
  // 索引必须等文件落盘后执行（原归只读段 → 文件尚不存在 → "索引失败: File not found"白费一轮）
  'generate_image','http_get','http_fetch','browser_open','browser_search',
])

/**
 * v14.2.1: 子 agent 委托工具拆分（取代旧 SERIAL_TOOLS）— 批量并行分析（功能 2）
 * - PARALLEL_READ_TOOLS（analyze_file/verify_task 只读）：可并行。isolatedStore 保证每个子代理独立
 *   上下文/store，并发安全；只读无副作用，互不干扰。
 * - SERIAL_WRITE_TOOLS（edit_file_task 写）：保持串行——写操作共享文件系统状态，
 *   同文件多处修改交错会互相覆盖。
 * v14.3.1: +verify_task（只读验收子代理）— 此前归普通只读无限并行，多文件验收同时起多个
 *   子代理有 API 限流风险；归入分片 ≤3 并行。
 */
export const PARALLEL_READ_TOOLS = new Set(['analyze_file', 'verify_task', 'subagent_ask', 'kb_analyze'])  // v14.5.0: +subagent_ask（防无限并发）；v14.8: +kb_analyze（只读子代理，分片并行）
export const SERIAL_WRITE_TOOLS = new Set(['edit_file_task'])

/** v15: 子 agent 委托完成文件操作视为"已写"（_hasWriteCall 计入，避免自愈误判 nudge） */
export const SUBAGENT_WRITE_TOOLS = new Set(['edit_file_task'])

/**
 * v14.5.0: 子代理委托工具名镜像（per-call abort 用）。
 * 不 import subagentTools——避免 subagentTools → SubagentService → V4UnifiedRuntime → ToolExecutor 循环依赖。
 */
const SUBAGENT_TOOL_NAMES_LOCAL = new Set(['analyze_file', 'edit_file_task', 'verify_task', 'subagent_ask', 'kb_analyze'])  // v14.8: +kb_analyze

/** v14.5.0: AbortSignal.any 兜底（旧运行时无 any 时手动组合两个信号） */
function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController()
  if (a.aborted || b.aborted) {
    ctrl.abort()
    return ctrl.signal
  }
  const onAbort = () => ctrl.abort()
  a.addEventListener('abort', onAbort)
  b.addEventListener('abort', onAbort)
  return ctrl.signal
}

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

/** v15: per-tool 超时（毫秒）— 子 agent 委托工具内部跑独立 runtime，需更长预算 */
const PER_TOOL_TIMEOUT_MS: Record<string, number> = {
  analyze_file: 300_000,      // 子 agent 预算 10 轮 × 60s（SubagentService maxIterations 默认 10）
  edit_file_task: 300_000,
  verify_task: 300_000,       // v14.5.0: 与其他子代理工具对齐（多文件×多标准验收可能超 120s）
  subagent_ask: 300_000,      // v14.3: 会话追问（可能复用长历史）
  kb_analyze: 300_000,        // v14.8: 知识库深度分析（多次检索 + 全文阅读，需更长预算）
  analyze_text_style: 180_000, // AI 分析较长内容时 120s 偏紧
}

/** v14.3: 子代理快照 detail 收集截断上限（防 IndexedDB 膨胀；注入时还会再截） */
const SUBAGENT_SUMMARY_DETAIL_CHARS = 1500

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
  /** v14.5.0: 子代理（isolatedStore）内部工具调用跳过全局操作历史写入（防污染） */
  skipOpHistory?: boolean
  /** v14.8: 本轮 KB 预注入文件 id（透传进 ToolExecutionContext → kb_search 排除集） */
  injectedKbFileIds?: string[]
  /** v14.3: 子代理执行快照收集器（主 runtime 持有数组，run 结束随结果返回） */
  subagentSummaries: SubagentSummary[]
  /** v9.5.5: Store for tool progress tracking */
  store: {
    addToolExecution: (callId: string, toolName: string) => void
    completeTool: (callId: string, status: 'success' | 'error', summary: string, detail?: string) => void
    setStreamingText: (text: string) => void
    /** v15: 工具内部委托子 agent 的用量上报（主 runtime 累加进 run 结果） */
    reportSubAgentUsage?: (usage: NonNullable<ToolResult['subAgentUsage']>) => void
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
    // v13.1.0: 记录解析失败（v14.5.0: 子代理跳过——防内部调用污染全局操作历史）
    if (!ctx.skipOpHistory) {
      try {
        const { useOpHistoryStore } = await import('@/store/operationHistoryStore')
        useOpHistoryStore.getState().addEntry({
          id: nanoid(8), timestamp: new Date().toISOString(),
          conversationId: ctx.projectId || 'global', toolName: tc.name,
          filePath: '', args: {}, status: 'error',
          summary: '工具参数 JSON 解析失败', detail: tc.arguments,
        })
      } catch { /* ignore */ }
    }
    return
  }

  // Execute (v15: per-tool 超时查表，默认 120s — analyze_text_style/子 agent 工具更长)
  const t0 = Date.now()
  let result: ToolResult
  let timedOut = false  // v14.5.0: 超时落败标记（补记判定用，替代字符串匹配）
  const TOOL_TIMEOUT = PER_TOOL_TIMEOUT_MS[tc.name] ?? 120_000
  // v14.5.0: 子代理委托工具 per-call abort——超时/竞态时中止底层子代理 runtime，
  // 消除"超时后孤儿运行 5 分钟 + 会话池被失败运行污染 + 用量漏记"
  const perCallCtrl = SUBAGENT_TOOL_NAMES_LOCAL.has(tc.name) ? new AbortController() : null
  const execSignal = perCallCtrl
    ? (typeof AbortSignal.any === 'function'
        ? AbortSignal.any([ctx.abortSignal, perCallCtrl.signal])
        : composeSignals(ctx.abortSignal, perCallCtrl.signal))
    : ctx.abortSignal
  const execPromise = ctx.toolExecutor(args, {
    projectId: ctx.projectId,
    configId: ctx.configId,
    callId: tc.id,
    toolName: tc.name,
    signal: execSignal,
    // v14.8: 本轮 KB 预注入文件 id（kb_search 排除集）
    kbInjectedFileIds: ctx.injectedKbFileIds,
  })
  let timerHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<ToolResult>(r => {
    timerHandle = setTimeout(() => {
      perCallCtrl?.abort()  // 超时即中止子代理 runtime（runSubagent 已支持 signal 传播）
      timedOut = true
      r({ status: 'error', summary: `工具 ${tc.name} 执行超时` })
    }, TOOL_TIMEOUT)
  })
  // v14.9(审计): ① 异常兜底——审批回调/缓存失效通知等 reject 不再击穿整个 run（原冒泡 →
  // sendMessage catch → 本轮已执行结果与模型上下文全丢，模型无法自愈）；统一转 error 结果照常回传
  // ② 超时计时器及时清理——原悬挂 120-300s 定时器在长会话中累积到点才触发
  try {
    result = await Promise.race([execPromise, timeoutPromise])
  } catch (execErr) {
    result = { status: 'error', summary: `工具 ${tc.name} 执行异常: ${execErr instanceof Error ? execErr.message : '未知错误'}` }
  } finally {
    if (timerHandle) clearTimeout(timerHandle)
  }
  // v14.5.0: 超时落败时，迟到 resolve 的 subAgentUsage 照常补记（正常路径由下方统一上报，避免双计）。
  // 布尔标记判定（原字符串匹配"执行超时"可能被工具自身错误摘要误命中 → 双计）
  if (timedOut) {
    execPromise.then((lateResult) => {
      if (lateResult?.subAgentUsage) ctx.store.reportSubAgentUsage?.(lateResult.subAgentUsage)
    }).catch(() => { /* 迟到错误无消费方 */ })
  }

  // v15: 子 agent 委托用量上报（analyze_file/edit_file_task 返回 subAgentUsage）
  if (result.subAgentUsage) {
    ctx.store.reportSubAgentUsage?.(result.subAgentUsage)
    // v14.3: 子代理执行快照收集（subAgentUsage 存在 = 实际委托过；
    // 参数校验失败无 usage 不收集；子代理失败仍有 usage → 失败快照也进跨 run 记忆）
    ctx.subagentSummaries.push({
      tool: tc.name,
      filePath: extractFilePath(args),
      status: result.status === 'error' ? 'error' : 'success',
      summary: result.summary || '',
      detail: (result.detail || '').slice(0, SUBAGENT_SUMMARY_DETAIL_CHARS),
      iteration: ctx.iteration,
    })
  }

  const durationMs = Date.now() - t0
  ctx.toolCallSteps.push({ tool: tc.name, status: result.status, summary: result.summary || '', durationMs, iteration: ctx.iteration, arguments: tc.arguments, matchedTools: (result as any).matchedTools })

  // ── v13.1.0: 操作记录持久化（v14.5.0: 子代理跳过——防内部调用污染全局操作历史）──
  if (!ctx.skipOpHistory) {
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
  }

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
