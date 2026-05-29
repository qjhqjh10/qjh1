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

  recordApiCall(promptTokens: number, completionTokens: number): void {
    this.record('api:call', { promptTokens, completionTokens })
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
  async persist(): Promise<void> {
    try {
      const { fileService } = await import('@/services/fileService')
      await fileService.ensureDir('.aiharness/audit')
      await fileService.write(`.aiharness/audit/${this.sessionId}.jsonl`, this.toJSONL())
    } catch { /* persistence is best-effort */ }
  }
}
