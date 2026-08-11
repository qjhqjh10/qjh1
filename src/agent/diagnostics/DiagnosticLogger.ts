// ── Diagnostic Logger ──
// Real-time monitoring of Agent state for debugging stuck/hang issues.
// Emits events that can be displayed in a diagnostic panel.

export type DiagnosticEventType =
  | 'phase_change'
  | 'api_call_start'
  | 'api_call_end'
  | 'api_call_error'
  | 'tool_start'
  | 'tool_end'
  | 'tool_error'
  | 'tool_timeout'
  | 'hook_start'
  | 'hook_end'
  | 'approval_pending'
  | 'approval_resolved'
  | 'stuck_detected'
  | 'error'
  | 'info'

export interface DiagnosticEvent {
  id: string
  type: DiagnosticEventType
  timestamp: number
  phase?: string
  toolName?: string
  duration?: number
  message: string
  detail?: string
  severity: 'info' | 'warn' | 'error'
}

export type DiagnosticListener = (event: DiagnosticEvent) => void

export class DiagnosticLogger {
  private events: DiagnosticEvent[] = []
  private listeners: Set<DiagnosticListener> = new Set()
  private maxEvents = 200
  private phaseStartTime = 0
  private currentPhase = 'IDLE'
  private apiCallStart = 0
  private toolCallStarts = new Map<string, number>()
  // v16.3.0(审计 H2 修复): 删除卡死监视器（checkStuck/stuckTimer）——recordPhaseChange 从未接线，
  // currentPhase 恒 IDLE → checkStuck 恒早退，2 分钟 setInterval 空转；真正的卡死兜底
  // 由 runtime 轮间超时 + AgentStateBar 实时状态承担
  private logFilePath = 'diagnostic-log.jsonl'
  private writeQueue: string[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  /** Clear stale events — called on new agent run */
  clearRecent(): void {
    this.events = []
    this.toolCallStarts.clear()
  }

  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.flushToFile() // flush remaining events
    this.listeners.clear()
  }

  onEvent(listener: DiagnosticListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getEvents(): readonly DiagnosticEvent[] {
    return this.events
  }

  getRecentEvents(count = 50): DiagnosticEvent[] {
    return this.events.slice(-count)
  }

  getCurrentPhase(): string {
    return this.currentPhase
  }

  getPhaseDuration(): number {
    return this.currentPhase === 'IDLE' ? 0 : Date.now() - this.phaseStartTime
  }

  // ── Event Recording ──

  recordPhaseChange(from: string, to: string): void {
    this.currentPhase = to
    this.phaseStartTime = Date.now()
    this.emit({
      type: 'phase_change',
      phase: to,
      message: `${from} → ${to}`,
      severity: 'info',
    })
  }

  recordApiCallStart(): void {
    this.apiCallStart = Date.now()
    this.emit({
      type: 'api_call_start',
      phase: this.currentPhase,
      message: 'API 调用开始',
      severity: 'info',
    })
  }

  recordApiCallEnd(tokens: number, hasToolCalls: boolean): void {
    const duration = Date.now() - this.apiCallStart
    // v14.6.1: 结束即归零——原实现 apiCallStart 永不重置（v16.3.0: 卡死监视器已删除，归零仍保证
    // 后续调用的 duration 正确）
    this.apiCallStart = 0
    this.emit({
      type: 'api_call_end',
      phase: this.currentPhase,
      duration,
      message: `API 调用完成 (${duration}ms, ${tokens} tokens, tool_calls: ${hasToolCalls})`,
      severity: duration > 30000 ? 'warn' : 'info',
    })
  }

  recordApiCallError(error: string): void {
    const duration = Date.now() - this.apiCallStart
    this.apiCallStart = 0  // v14.6.1: 同 recordApiCallEnd
    this.emit({
      type: 'api_call_error',
      phase: this.currentPhase,
      duration,
      message: `API 调用失败: ${error}`,
      severity: 'error',
      detail: error,
    })
  }

  recordToolStart(callId: string, toolName: string): void {
    this.toolCallStarts.set(callId, Date.now())
    this.emit({
      type: 'tool_start',
      toolName,
      phase: this.currentPhase,
      message: `工具开始: ${toolName}`,
      severity: 'info',
    })
  }

  recordToolEnd(callId: string, toolName: string, status: string): void {
    const startTime = this.toolCallStarts.get(callId) || Date.now()
    const duration = Date.now() - startTime
    this.toolCallStarts.delete(callId)
    this.emit({
      type: 'tool_end',
      toolName,
      phase: this.currentPhase,
      duration,
      message: `工具完成: ${toolName} (${status}, ${duration}ms)`,
      severity: status === 'error' ? 'warn' : 'info',
    })
  }

  recordToolError(callId: string, toolName: string, error: string): void {
    const startTime = this.toolCallStarts.get(callId) || Date.now()
    const duration = Date.now() - startTime
    this.toolCallStarts.delete(callId)
    this.emit({
      type: 'tool_error',
      toolName,
      phase: this.currentPhase,
      duration,
      message: `工具失败: ${toolName} (${error})`,
      severity: 'error',
      detail: error,
    })
  }

  recordToolTimeout(toolName: string, timeoutMs: number): void {
    this.emit({
      type: 'tool_timeout',
      toolName,
      phase: this.currentPhase,
      duration: timeoutMs,
      message: `工具超时: ${toolName} (${timeoutMs}ms)`,
      severity: 'error',
    })
  }

  recordApprovalPending(toolName: string): void {
    this.emit({
      type: 'approval_pending',
      toolName,
      phase: this.currentPhase,
      message: `等待审批: ${toolName}`,
      severity: 'warn',
    })
  }

  recordApprovalResolved(toolName: string, approved: boolean): void {
    this.emit({
      type: 'approval_resolved',
      toolName,
      phase: this.currentPhase,
      message: `审批${approved ? '通过' : '拒绝'}: ${toolName}`,
      severity: approved ? 'info' : 'warn',
    })
  }

  recordError(error: string, detail?: string): void {
    this.emit({
      type: 'error',
      phase: this.currentPhase,
      message: error,
      severity: 'error',
      detail,
    })
  }

  recordInfo(message: string): void {
    this.emit({
      type: 'info',
      phase: this.currentPhase,
      message,
      severity: 'info',
    })
  }

  // ── Internal ──

  private emit(event: Omit<DiagnosticEvent, 'id' | 'timestamp'>): void {
    const fullEvent: DiagnosticEvent = {
      ...event,
      id: `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      timestamp: Date.now(),
    }

    this.events.push(fullEvent)
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents)
    }

    for (const listener of this.listeners) {
      try { listener(fullEvent) } catch { /* swallow */ }
    }

    // Persist to file (queued, flushed every 2 seconds)
    // M8: Cap queue at 1000 entries to prevent unbounded memory growth
    if (this.writeQueue.length >= 1000) {
      this.writeQueue = this.writeQueue.slice(-500)
    }
    this.writeQueue.push(JSON.stringify(fullEvent))
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushToFile()
    }, 2000)
  }

  private async flushToFile(): Promise<void> {
    if (this.writeQueue.length === 0) return
    const lines = [...this.writeQueue]
    this.writeQueue = []
    try {
      // Use Electron's appendDebugLog which writes to app data directory
      if (typeof window !== 'undefined' && (window as any).electron?.appendDebugLog) {
        // Each event on its own line for easy parsing
        await (window as any).electron.appendDebugLog('agent-diagnostic', lines.join('\n') + '\n')
      }
    } catch (err) {
      // Non-fatal — but at least log so we know if this is broken
      if (typeof console !== 'undefined') console.warn('[DiagnosticLogger] flushToFile failed:', err)
    }
  }

  /** Force flush all pending events (call at end of run) */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.flushToFile()
  }
}

// Global singleton
export const diagnosticLogger = new DiagnosticLogger()

// Auto-cleanup when the window unloads (prevents setInterval leak)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    diagnosticLogger.destroy()
  })
}
