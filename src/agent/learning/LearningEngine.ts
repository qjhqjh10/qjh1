/**
 * Unified Learning Engine (V2-1)
 *
 * Replaces SkillLearner + LivingSkillManager with a single 6-stage lifecycle.
 * Eliminates the ~60% functional overlap and the 4-channel context duplication
 * of the old system.
 *
 * Lifecycle: OBSERVED → PATTERN → SOFT_SKILL → CONDITIONAL_RULE → HARD_CONSTRAINT → VERIFIED
 *
 * Single entry points:
 *   onToolResult()    — replaces onToolError + onToolSuccess
 *   getContextInject() — single channel, replaces 4 separate injections
 *   persist() / load() — unified persistence
 */

import type { ToolResult } from '../state/types'
import type {
  LearnedPattern, LearningConfig, LearningStage,
} from './types'
import { DEFAULT_LEARNING_CONFIG } from './types'

export class LearningEngine {
  private patterns = new Map<string, LearnedPattern>()
  private config: LearningConfig
  private sessionStartTime = Date.now()
  private patternsLoaded = false

  constructor(config?: Partial<LearningConfig>) {
    this.config = { ...DEFAULT_LEARNING_CONFIG, ...config }
  }

  // ── Observation ──

  /**
   * Single observation entry point.
   * Call for every tool execution result (both success and error).
   */
  onToolResult(
    toolName: string,
    result: ToolResult,
    projectId: string | null = null,
  ): void {
    const key = this.patternKey(toolName, result)
    const existing = this.patterns.get(key)

    if (existing) {
      existing.occurrenceCount++
      existing.updatedAt = Date.now()
      if (result.status === 'success') {
        existing.confirmationCount++
      }
      this.promoteIfReady(existing)
    } else {
      // New observation — create pattern entry
      const id = `${toolName}_${Date.now().toString(36)}`
      this.patterns.set(key, {
        id,
        toolName,
        status: (result.status === 'pending_confirm' ? 'error' : result.status) as 'success' | 'error',  // C5: persist status; coerce pending_confirm→error
        summary: result.summary.slice(0, 200),
        detail: result.detail || result.summary,
        occurrenceCount: 1,
        confirmationCount: result.status === 'success' ? 1 : 0,
        currentStage: 'OBSERVED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        projectId,
      })

      // Evict oldest if over capacity
      if (this.patterns.size > this.config.maxPatterns) {
        let oldestKey = ''
        let oldestTime = Infinity
        for (const [k, v] of this.patterns) {
          if (v.updatedAt < oldestTime) { oldestTime = v.updatedAt; oldestKey = k }
        }
        this.patterns.delete(oldestKey)
      }
    }
  }

  // ── Context Injection ──

  /**
   * Single context injection channel.
   * Returns patterns at SOFT_SKILL or above, ordered by stage priority.
   * Maximum output capped at config.maxContextTokens.
   */
  getContextInject(maxTokens?: number): string {
    const limit = maxTokens ?? this.config.maxContextTokens
    const relevant = [...this.patterns.values()]
      .filter(p =>
        p.currentStage === 'SOFT_SKILL' ||
        p.currentStage === 'CONDITIONAL_RULE' ||
        p.currentStage === 'HARD_CONSTRAINT' ||
        p.currentStage === 'VERIFIED'
      )
      .sort((a, b) => {
        const order: Record<LearningStage, number> = {
          VERIFIED: 5, HARD_CONSTRAINT: 4, CONDITIONAL_RULE: 3,
          SOFT_SKILL: 2, PATTERN: 1, OBSERVED: 0,
        }
        return order[b.currentStage] - order[a.currentStage]
      })

    if (relevant.length === 0) return ''

    const lines: string[] = ['## 已学习的经验']
    let totalTokens = 0

    for (const p of relevant) {
      const line = `- [${p.currentStage}] ${p.toolName}: ${p.summary} (${p.occurrenceCount}次)`
      const estTokens = Math.ceil(line.length / 3)
      if (totalTokens + estTokens > limit) break
      totalTokens += estTokens
      lines.push(line)
    }

    return lines.join('\n')
  }

  /**
   * Get patterns at or above a given stage.
   */
  getPatternsAboveStage(minStage: LearningStage): LearnedPattern[] {
    const order: Record<LearningStage, number> = {
      VERIFIED: 5, HARD_CONSTRAINT: 4, CONDITIONAL_RULE: 3,
      SOFT_SKILL: 2, PATTERN: 1, OBSERVED: 0,
    }
    const minLevel = order[minStage]
    return [...this.patterns.values()]
      .filter(p => order[p.currentStage] >= minLevel)
  }

  /**
   * Get patterns for a specific tool with at least N occurrences.
   * Used by AgentRuntime advisory inject for immediate feedback.
   */
  getPatternsForTool(toolName: string, minOccurrences: number = 1): LearnedPattern[] {
    return [...this.patterns.values()]
      .filter(p => p.toolName === toolName && p.occurrenceCount >= minOccurrences)
  }

  /** Check if any patterns exist above OBSERVED */
  hasActivePatterns(): boolean {
    return this.patterns.size > 0 &&
      [...this.patterns.values()].some(p => p.currentStage !== 'OBSERVED')
  }

  // ── Promotion ──

  private promoteIfReady(pattern: LearnedPattern): void {
    const thresholds = this.config.promotionThresholds
    if (pattern.occurrenceCount >= thresholds.hardConstraint && pattern.currentStage === 'CONDITIONAL_RULE') {
      pattern.currentStage = 'HARD_CONSTRAINT'
    } else if (pattern.occurrenceCount >= thresholds.conditionalRule &&
      (pattern.currentStage === 'SOFT_SKILL' || pattern.currentStage === 'PATTERN')) {
      pattern.currentStage = 'CONDITIONAL_RULE'
    } else if (pattern.occurrenceCount >= thresholds.softSkill &&
      (pattern.currentStage === 'PATTERN' || pattern.currentStage === 'OBSERVED')) {
      pattern.currentStage = 'SOFT_SKILL'
    } else if (pattern.occurrenceCount >= thresholds.pattern && pattern.currentStage === 'OBSERVED') {
      pattern.currentStage = 'PATTERN'
    }
  }

  private patternKey(toolName: string, result: ToolResult): string {
    // Group by tool name + status + first 50 chars of summary
    const prefix = result.status === 'success' ? 'S:' : 'E:'
    return `${prefix}${toolName}:${result.summary.slice(0, 50)}`
  }

  // ── Session Lifecycle ──

  startSession(): void {
    this.sessionStartTime = Date.now()
  }

  /** Run end-of-session promotion cycle. Returns newly promoted patterns. */
  async endSession(): Promise<{ oldStage: LearningStage; newStage: LearningStage; pattern: LearnedPattern }[]> {
    const promoted: { oldStage: LearningStage; newStage: LearningStage; pattern: LearnedPattern }[] = []
    for (const pattern of this.patterns.values()) {
      const oldStage = pattern.currentStage
      this.promoteIfReady(pattern)
      if (pattern.currentStage !== oldStage) {
        promoted.push({ oldStage, newStage: pattern.currentStage, pattern })
      }
    }
    await this.persist()
    return promoted
  }

  // ── Persistence ──

  async persist(): Promise<void> {
    try {
      const { fileService } = await import('@/services/fileService')
      const data = JSON.stringify([...this.patterns.values()], null, 2)
      await fileService.write(this.config.persistPath, data)
    } catch (err) {
      console.warn('[LearningEngine] Pattern persistence failed:', err)
    }
  }

  async load(): Promise<void> {
    if (this.patternsLoaded) return
    try {
      const { fileService } = await import('@/services/fileService')
      const raw = await fileService.read(this.config.persistPath)
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw) as LearnedPattern[]
        for (const p of parsed) {
          this.patterns.set(this.patternKey(p.toolName, { status: p.status || 'error', summary: p.summary }), p)
        }
        this.patternsLoaded = true
      }
    } catch (err) {
      // First session — no saved patterns yet
    }
  }

  /** Get all patterns (for settings UI) */
  getAll(): LearnedPattern[] {
    return [...this.patterns.values()]
  }

  getAllByStage(): Record<LearningStage, LearnedPattern[]> {
    const result: Record<string, LearnedPattern[]> = {}
    for (const p of this.patterns.values()) {
      if (!result[p.currentStage]) result[p.currentStage] = []
      result[p.currentStage].push(p)
    }
    return result as Record<LearningStage, LearnedPattern[]>
  }
}
