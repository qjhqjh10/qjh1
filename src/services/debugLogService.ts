/**
 * Diagnostic event logging for Claude Code analysis.
 * Writes structured JSONL events to userData/ai-debug/ via IPC.
 * Claude Code can read these files to diagnose AI assistant issues.
 */

const electron = (window as any).electron

export function debugEvent(event: Record<string, unknown>) {
  try {
    if (!electron?.appendDebugLog) return
    const name = `${event.conv || 'unknown'}`
    const line = JSON.stringify({ ...event, ts: Date.now() }) + '\n'
    electron.appendDebugLog(name, line)
  } catch { /* diagnostic logging should never crash the app */ }
}

// Convenience helpers for common event types
export function debugApiSend(conv: string, inputLen: number, msgCount: number, tools: number) {
  debugEvent({ e: 'api:send', conv, inputLen, msgCount, tools })
}

export function debugApiResponse(conv: string, finish: string, tcCount: number, promptT: number, compT: number) {
  debugEvent({ e: 'api:response', conv, finish, tcCount, promptT, compT })
}

export function debugApiError(conv: string, code: number | string, msg: string) {
  debugEvent({ e: 'api:error', conv, code, msg })
}

export function debugBatchCheck(conv: string, needs: boolean, reads: number, writes: number, creates: number, deletes: number, hasProj: boolean) {
  debugEvent({ e: 'batch:check', conv, needs, reads, writes, creates, deletes, hasProj })
}

export function debugBatchShow(conv: string, plan: string) {
  debugEvent({ e: 'batch:show', conv, plan: plan.slice(0, 120) })
}

export function debugBatchApprove(conv: string) {
  debugEvent({ e: 'batch:approve', conv })
}

export function debugBatchDeny(conv: string, feedback?: string) {
  debugEvent({ e: 'batch:deny', conv, feedback: feedback?.slice(0, 200) || '' })
}

export function debugBatchTimeout(conv: string) {
  debugEvent({ e: 'batch:timeout', conv })
}

export function debugToolCall(conv: string, name: string, args: Record<string, unknown>) {
  // Strip content fields to keep logs small
  const safe = { ...args }
  if (safe.content && typeof safe.content === 'string' && safe.content.length > 100) safe.content = safe.content.slice(0, 100) + '...'
  if (safe.old_string && typeof safe.old_string === 'string' && safe.old_string.length > 100) safe.old_string = safe.old_string.slice(0, 100) + '...'
  if (safe.new_string && typeof safe.new_string === 'string' && safe.new_string.length > 100) safe.new_string = safe.new_string.slice(0, 100) + '...'
  debugEvent({ e: 'tool:call', conv, name, args: safe })
}

export function debugToolResult(conv: string, name: string, status: string, summary: string) {
  debugEvent({ e: 'tool:result', conv, name, status, summary })
}

export function debugSysError(conv: string, ctx: string, msg: string) {
  debugEvent({ e: 'sys:error', conv, ctx, msg })
}

export function debugSysWarn(conv: string, ctx: string, detail?: string) {
  debugEvent({ e: 'sys:warn', conv, ctx, detail: detail || '' })
}
