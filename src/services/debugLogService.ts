/**
 * Diagnostic event logging for Claude Code analysis.
 * Writes structured JSONL events to userData/ai-debug/ via IPC.
 * Claude Code can read these files to diagnose AI assistant issues.
 * (v14 批处理: 清理 11 个无调用者的辅助函数，仅保留 debugEvent/debugApiError)
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

export function debugApiError(conv: string, code: number | string, msg: string) {
  debugEvent({ e: 'api:error', conv, code, msg })
}
