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
  }

  recordStateTransition(from: string, to: string): void {
    this.record('state:transition', { from, to })
  }

  recordToolCall(toolName: string, args: Record<string, unknown>): void {
    this.record('tool:call', { toolName, args: { ...args, content: args.content ? `(${String(args.content).length} chars)` : undefined } })
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
}
