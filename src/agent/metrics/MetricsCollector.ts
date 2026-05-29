// ── Metrics Collector ──
// Aggregates AuditTrail events into trackable metrics.
// Answers: "Is the agent getting better or worse?"

import type { AuditEvent } from '../audit/AuditTrail'

export interface SessionMetrics {
  sessionId: string
  timestamp: number
  toolCalls: number
  toolSuccesses: number
  toolFailures: number
  hallucinationTriggers: number
  totalTokens: number
  iterationCycles: number
  toolsUsed: string[]
  toolStats: Record<string, { success: number; failure: number }>
  firstPassSuccess: boolean  // Did all tools succeed on first try?
}

export interface AggregateMetrics {
  totalSessions: number
  avgToolSuccessRate: number
  avgIterationCycles: number
  avgTokensPerSession: number
  hallucinationRate: number  // per session
  firstPassRate: number
  toolBreakdown: Record<string, { success: number; failure: number }>
  trend: 'improving' | 'stable' | 'declining'
}

export class MetricsCollector {
  private sessions: SessionMetrics[] = []
  private maxSessions = 100
  private persistPath = '.aiharness/metrics/sessions.json'

  async save(): Promise<void> {
    try {
      const { fileService } = await import('@/services/fileService')
      await fileService.ensureDir('.aiharness/metrics')
      await fileService.write(this.persistPath, JSON.stringify(this.sessions.slice(-100), null, 2))
    } catch { /* persistence is best-effort */ }
  }

  async load(): Promise<void> {
    try {
      const { fileService } = await import('@/services/fileService')
      const raw = await fileService.read(this.persistPath)
      const data = JSON.parse(raw)
      if (Array.isArray(data)) this.sessions = data.slice(-this.maxSessions)
    } catch { /* first session or persist not available */ }
  }

  /** Build session metrics from AuditTrail events */
  collect(events: readonly AuditEvent[], sessionId: string): SessionMetrics {
    const toolCalls = events.filter(e => e.event === 'tool:call').length
    const successes = events.filter(e => e.event === 'tool:result' && e.data.status === 'success').length
    const failures = events.filter(e => e.event === 'tool:result' && e.data.status === 'error').length
    const hallucinationTriggers = events.filter(e => e.event === 'hallucination:detected').length

    const apiCalls = events.filter(e => e.event === 'api:call')
    const totalTokens = apiCalls.reduce((sum, e) =>
      sum + (Number(e.data.promptTokens) || 0) + (Number(e.data.completionTokens) || 0), 0)

    const stateTransitions = events.filter(e => e.event === 'state:transition')
    const callingApiCount = stateTransitions.filter(e => e.data.to === 'CALLING_API').length

    const toolsUsed: string[] = []
    const toolStats: Record<string, { success: number; failure: number }> = {}
    for (const e of events) {
      if (e.event === 'tool:call' && e.data.toolName) {
        const name = String(e.data.toolName)
        if (!toolsUsed.includes(name)) toolsUsed.push(name)
        if (!toolStats[name]) toolStats[name] = { success: 0, failure: 0 }
      }
      if (e.event === 'tool:result' && e.data.toolName) {
        const name = String(e.data.toolName)
        if (!toolStats[name]) toolStats[name] = { success: 0, failure: 0 }
        if (e.data.status === 'success') toolStats[name].success++
        else toolStats[name].failure++
      }
    }

    const firstPassSuccess = failures === 0 && toolCalls > 0

    const metrics: SessionMetrics = {
      sessionId,
      timestamp: Date.now(),
      toolCalls,
      toolSuccesses: successes,
      toolFailures: failures,
      hallucinationTriggers,
      totalTokens,
      iterationCycles: Math.max(1, callingApiCount),
      toolsUsed,
      toolStats,
      firstPassSuccess,
    }

    this.sessions.push(metrics)
    if (this.sessions.length > this.maxSessions) {
      this.sessions = this.sessions.slice(-this.maxSessions)
    }

    return metrics
  }

  /** Get aggregated metrics across recent sessions */
  getAggregate(lastN = 20): AggregateMetrics {
    const subset = this.sessions.slice(-lastN)
    if (subset.length === 0) {
      return {
        totalSessions: 0, avgToolSuccessRate: 0, avgIterationCycles: 0,
        avgTokensPerSession: 0, hallucinationRate: 0, firstPassRate: 0,
        toolBreakdown: {}, trend: 'stable',
      }
    }

    const totalTools = subset.reduce((s, m) => s + m.toolCalls, 0)
    const totalSuccesses = subset.reduce((s, m) => s + m.toolSuccesses, 0)
    const avgIters = subset.reduce((s, m) => s + m.iterationCycles, 0) / subset.length
    const avgTokens = subset.reduce((s, m) => s + m.totalTokens, 0) / subset.length
    const hRate = subset.reduce((s, m) => s + m.hallucinationTriggers, 0) / subset.length
    const firstPassCount = subset.filter(m => m.firstPassSuccess).length

    // Tool breakdown
    const breakdown: Record<string, { success: number; failure: number }> = {}
    for (const m of subset) {
      for (const [t, stats] of Object.entries(m.toolStats || {})) {
        if (!breakdown[t]) breakdown[t] = { success: 0, failure: 0 }
        breakdown[t].success += stats.success
        breakdown[t].failure += stats.failure
      }
    }

    // Trend: compare first half vs second half
    const mid = Math.floor(subset.length / 2)
    const firstHalf = subset.slice(0, mid)
    const secondHalf = subset.slice(mid)
    const firstRate = firstHalf.length > 0
      ? firstHalf.reduce((s, m) => s + m.toolSuccesses, 0) / Math.max(1, firstHalf.reduce((s, m) => s + m.toolCalls, 0))
      : 0
    const secondRate = secondHalf.length > 0
      ? secondHalf.reduce((s, m) => s + m.toolSuccesses, 0) / Math.max(1, secondHalf.reduce((s, m) => s + m.toolCalls, 0))
      : 0
    const trend: AggregateMetrics['trend'] =
      secondRate > firstRate + 0.05 ? 'improving' :
      secondRate < firstRate - 0.05 ? 'declining' : 'stable'

    return {
      totalSessions: subset.length,
      avgToolSuccessRate: totalTools > 0 ? totalSuccesses / totalTools : 0,
      avgIterationCycles: Math.round(avgIters * 10) / 10,
      avgTokensPerSession: Math.round(avgTokens),
      hallucinationRate: Math.round(hRate * 100) / 100,
      firstPassRate: subset.length > 0 ? firstPassCount / subset.length : 0,
      toolBreakdown: breakdown,
      trend,
    }
  }

  getRecentSessions(n = 10): SessionMetrics[] {
    return this.sessions.slice(-n)
  }

  get sessionCount(): number {
    return this.sessions.length
  }
}
