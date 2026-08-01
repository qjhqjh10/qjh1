// ── Audit Trail (Flight Recorder) ──
// Append-only JSONL log of agent decisions, state transitions, tool calls, etc.

export interface AuditEvent {
  timestamp: number
  sessionId: string
  event: string
  data: Record<string, unknown>
}

export class AuditTrail {
  private events: AuditEvent[] = []
  private sessionId = ''
  private maxEvents: number

  constructor(maxEvents = 10000) {
    this.maxEvents = maxEvents
  }

  startSession(sessionId: string): void {
    // M9: warn if prior events were not persisted
    if (this.events.length > 0) {
      console.warn('[AuditTrail] Starting new session without persisting prior events')
      this.persist().catch(() => {})
    }
    this.sessionId = sessionId
    this.events = []
    this.record('session:start', {})
  }

  record(event: string, data: Record<string, unknown> = {}): void {
    this.events.push({
      timestamp: Date.now(),
      sessionId: this.sessionId,
      event,
      data,
    })
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents)
    }
  }

  recordStateTransition(from: string, to: string): void {
    this.record('state:transition', { from, to })
  }

  recordToolCall(toolName: string, args: Record<string, unknown>): void {
    // Redact sensitive fields: keep file_path but truncate search queries and content
    const safeArgs: Record<string, unknown> = { ...args }
    if (safeArgs.content) safeArgs.content = `(${String(safeArgs.content).length} chars)`
    if (safeArgs.search_query) safeArgs.search_query = String(safeArgs.search_query).slice(0, 100)
    if (safeArgs.query) safeArgs.query = String(safeArgs.query).slice(0, 100)
    this.record('tool:call', { toolName, args: safeArgs })
  }

  recordToolResult(toolName: string, status: string, summary: string): void {
    this.record('tool:result', { toolName, status, summary })
  }

  recordHookResult(hookName: string, passed: boolean, feedback: string): void {
    this.record('hook:result', { hookName, passed, feedback: feedback.slice(0, 200) })
  }

  recordPermissionDecision(toolName: string, effect: string, reason: string): void {
    this.record('permission:decision', { toolName, effect, reason })
  }

  // v14 批处理: +cost/model（可选，旧日志无 → 聚合端 Number(x)||0 兜底）
  recordApiCall(promptTokens: number, completionTokens: number, extra?: { cost?: number; model?: string }): void {
    this.record('api:call', {
      promptTokens,
      completionTokens,
      ...(extra?.cost != null ? { cost: extra.cost } : {}),
      ...(extra?.model ? { model: extra.model } : {}),
    })
  }

  recordError(message: string): void {
    this.record('error', { message })
  }

  getEvents(): readonly AuditEvent[] {
    return this.events
  }

  // Export as JSONL string
  toJSONL(): string {
    return this.events.map(e => JSON.stringify(e)).join('\n')
  }

  // Replay: regenerate the sequence of events
  replay(): AuditEvent[] {
    return [...this.events]
  }

  // Persist to disk as JSONL
  // v14 批处理修复: 快照必须在任何 await 之前同步捕获——persist 是 fire-and-forget
  // （startSession/run 结束处 .catch() 不 await），await import 会挂起执行，
  // 恢复时 this.events/this.sessionId 可能已被下一次 startSession 重置：
  // 旧实现把新会话的 session:start 写进旧会话文件，连续 sendMessage 时
  // 所有会话文件只剩 session:start（api:call/tool:result 全丢）。
  async persist(): Promise<void> {
    const sessionId = this.sessionId
    const content = this.toJSONL()
    if (!sessionId || !content) return
    try {
      const { fileService } = await import('@/services/fileService')
      await fileService.ensureDir('.aiharness/audit')
      await fileService.write(`.aiharness/audit/${sessionId}.jsonl`, content)
    } catch (err) { console.warn('[AuditTrail] 持久化失败:', err) }
  }
}
