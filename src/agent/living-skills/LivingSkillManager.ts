import type { LivingSkill, RawObservation, LivingSkillStage, SkillCategory, SkillSource } from './types'
import { STAGE_BOUNDS } from './types'
import { ConfidenceScorer } from './ConfidenceScorer'
import type { ToolResult } from '../runtime/AgentRuntime'

export class LivingSkillManager {
  private skills = new Map<string, LivingSkill>()
  private observations: RawObservation[] = []
  private scorer = new ConfidenceScorer()
  private currentSessionId = ''
  private currentProjectId: string | null = null

  // ── Session ──

  startSession(sessionId: string, projectId: string | null): void {
    this.currentSessionId = sessionId
    this.currentProjectId = projectId
    this.observations = []
    this.loadPersisted()
  }

  private async loadPersisted(): Promise<void> {
    try {
      const { fileService } = await import('@/services/fileService')
      const path = '.aiharness/living-skills/skills.json'
      const raw = await fileService.read(path)
      const data = JSON.parse(raw)
      if (Array.isArray(data)) {
        for (const s of data) this.skills.set(s.id, s)
      }
    } catch { /* first session or persist not available */ }
  }

  private async persistSkills(): Promise<void> {
    try {
      const { fileService } = await import('@/services/fileService')
      const data = [...this.skills.values()]
      if (data.length === 0) return
      await fileService.ensureDir('.aiharness/living-skills')
      await fileService.write('.aiharness/living-skills/skills.json', JSON.stringify(data, null, 2))
    } catch { /* persistence is best-effort */ }
  }

  async endSession(): Promise<LivingSkill[]> {
    const promoted = await this.runPromotionCycle()
    await this.persistSkills()
    return promoted
  }

  // ── Observation ──

  onToolError(toolName: string, error: string, category?: string): void {
    this.record({
      type: 'error', toolName, summary: error,
      sessionId: this.currentSessionId, projectId: this.currentProjectId,
      timestamp: Date.now(), errorCategory: category || this.inferCategory(error),
    })
  }

  onToolSuccess(toolName: string, args: Record<string, unknown>, result: ToolResult): void {
    // Increment effectiveness counters for skills related to this tool
    for (const [key, skill] of this.skills) {
      if (skill.trigger.toolName === toolName && skill.trigger.source === 'error') {
        skill.totalFixesAttempted++
        skill.totalFixSuccesses++
        skill.sessionsWhereEffective = Math.max(skill.sessionsWhereEffective, 1)
        skill.confidence = this.scorer.compute(skill)
        this.promoteIfReady(skill)
      }
    }

    // Positive learning: successful patterns
    if (result.status === 'success' && this.observations.length > 0) {
      const prevObs = this.observations.filter(o => o.toolName === toolName && o.type === 'success')
      if (prevObs.length >= 2) {
        this.record({
          type: 'success', toolName, summary: `Workflow: ${toolName} consistently successful`,
          sessionId: this.currentSessionId, projectId: this.currentProjectId, timestamp: Date.now(),
        })
      }
    }
  }

  onUserFeedback(skillId: string, rating: 1 | -1): void {
    const skill = this.skills.get(skillId)
    if (skill) {
      skill.userRating = rating
      skill.isUserApproved = rating === 1
      skill.updatedAt = Date.now()
    }
  }

  private record(obs: RawObservation): void {
    this.observations.push(obs)
    this.mergeObservation(obs)
  }

  private mergeObservation(obs: RawObservation): void {
    const key = `${obs.toolName}:${obs.type}:${obs.summary.slice(0, 80)}`
    const existing = this.skills.get(key)

    if (existing) {
      existing.occurrenceCount++
      existing.lastSeenAt = Date.now()
      existing.updatedAt = Date.now()
      if (obs.projectId && !existing.projects.includes(obs.projectId)) {
        existing.projects.push(obs.projectId)
      }
      existing.confidence = this.scorer.compute(existing)
      this.promoteIfReady(existing)
    } else {
      const skill = this.createSkill(obs)
      this.skills.set(key, skill)
    }
  }

  private createSkill(obs: RawObservation): LivingSkill {
    const now = Date.now()
    return {
      id: `skill_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: `[${obs.type}] ${obs.toolName}: ${obs.summary.slice(0, 60)}`,
      trigger: { toolName: obs.toolName, category: this.inferCategory(obs.summary) as SkillCategory, source: obs.type === 'error' ? 'error' : 'success' },
      problem: obs.summary,
      solution: this.inferSolution(obs),
      stage: 'OBSERVED',
      confidence: 0.0,
      occurrenceCount: 1, totalFixesAttempted: 0, totalFixSuccesses: 0,
      sessionsWhereEffective: 0,
      firstSeenAt: now, lastSeenAt: now, promotedAt: null,
      originProjectId: obs.projectId, projects: obs.projectId ? [obs.projectId] : [],
      userRating: 0, isUserApproved: false,
      softRuleText: '',
      policyConfig: null, hookConfig: null,
      createdAt: now, updatedAt: now, tags: [],
    }
  }

  // ── Promotion ──

  private promoteIfReady(skill: LivingSkill): void {
    const bounds = STAGE_BOUNDS[skill.stage]
    const nextStage = this.getNextStage(skill.stage)

    if (nextStage && skill.confidence >= bounds.max && skill.occurrenceCount >= 3) {
      const prevStage = skill.stage
      skill.stage = nextStage
      skill.promotedAt = Date.now()

      // Build artifacts for the new stage
      if (nextStage === 'SOFT_SKILL' || nextStage === 'CONDITIONAL_RULE') {
        skill.softRuleText = this.buildRuleText(skill)
      }
      if (nextStage === 'HARD_CONSTRAINT') {
        skill.policyConfig = { effect: 'ask', toolName: skill.trigger.toolName }
      }
      if (nextStage === 'CONDITIONAL_RULE') {
        skill.hookConfig = { event: 'PreToolUse', kind: 'shell' }
      }
    }
  }

  private getNextStage(stage: LivingSkillStage): LivingSkillStage | null {
    const order: LivingSkillStage[] = ['OBSERVED', 'PATTERN', 'SOFT_SKILL', 'CONDITIONAL_RULE', 'HARD_CONSTRAINT', 'VERIFIED']
    const idx = order.indexOf(stage)
    return idx < order.length - 1 ? order[idx + 1] : null
  }

  private buildRuleText(skill: LivingSkill): string {
    return [
      `## [学习经验] ${skill.title}`,
      `**触发条件**: ${skill.trigger.toolName} — ${skill.trigger.category}`,
      `**问题**: ${skill.problem}`,
      `**解决方案**: ${skill.solution}`,
      `**学习来源**: ${skill.projects.length} 个项目, ${skill.occurrenceCount} 次观察`,
      `**置信度**: ${(skill.confidence * 100).toFixed(0)}%`,
      skill.isUserApproved ? '**状态**: 用户已确认 ✅' : '**状态**: 自动学习, 待确认',
    ].join('\n')
  }

  // ── Promotion Cycle ──

  async runPromotionCycle(): Promise<LivingSkill[]> {
    const promoted: LivingSkill[] = []
    for (const skill of this.skills.values()) {
      skill.confidence = this.scorer.compute(skill)
      const prevStage = skill.stage
      this.promoteIfReady(skill)
      if (skill.stage !== prevStage) promoted.push(skill)
    }
    this.pruneStale()
    const garbage = this.collectGarbage()
    if (garbage.length > 0) console.log(`[LivingSkill] GC: ${garbage.length} skills cleaned`)
    return promoted
  }

  private pruneStale(): void {
    for (const [key, skill] of this.skills) {
      if (skill.stage === 'OBSERVED' && skill.occurrenceCount <= 1 && Date.now() - skill.createdAt > 7 * 86400000) {
        this.skills.delete(key)
      }
    }
  }

  collectGarbage(): LivingSkill[] {
    const garbage: LivingSkill[] = []
    for (const [key, skill] of this.skills) {
      if (skill.stage !== 'OBSERVED' && skill.stage !== 'VERIFIED' &&
          Date.now() - skill.updatedAt > 30 * 86400000 &&
          skill.confidence < STAGE_BOUNDS[skill.stage].min) {
        garbage.push(skill); this.skills.delete(key)
      }
      if (skill.stage === 'OBSERVED' && Date.now() - skill.createdAt > 14 * 86400000) {
        garbage.push(skill); this.skills.delete(key)
      }
      if (skill.confidence <= 0 && skill.totalFixSuccesses === 0 && skill.occurrenceCount > 3) {
        garbage.push(skill); this.skills.delete(key)
      }
    }
    return garbage
  }

  // ── Context Injection ──

  getContextInject(maxTokens = 2000): string {
    const activeSkills = [...this.skills.values()]
      .filter(s => s.stage === 'SOFT_SKILL' || s.stage === 'CONDITIONAL_RULE' || s.stage === 'VERIFIED')
      .filter(s => this.isRelevantToCurrentProject(s))
      .sort((a, b) => b.confidence - a.confidence)
    if (activeSkills.length === 0) return ''

    let body = ''
    for (const s of activeSkills.slice(0, 5)) {
      const candidate = body + s.softRuleText + '\n\n'
      if (candidate.length / 3 > maxTokens) break
      body = candidate
    }
    return body ? `[系统学习 — 以下规则来自历史经验]\n\n${body}` : ''
  }

  private isRelevantToCurrentProject(skill: LivingSkill): boolean {
    if (!this.currentProjectId) return true
    return skill.projects.length === 0 || skill.projects.includes(this.currentProjectId) || skill.projects.length >= 3
  }

  // ── Hard Enforcement ──

  getHardSkills(): LivingSkill[] {
    return [...this.skills.values()].filter(s => s.stage === 'HARD_CONSTRAINT' || s.stage === 'VERIFIED')
  }

  getSkillsByStage(stage: LivingSkillStage): LivingSkill[] {
    return [...this.skills.values()].filter(s => s.stage === stage)
  }

  getAll(): LivingSkill[] {
    return [...this.skills.values()]
  }

  // ── Helpers ──

  private inferCategory(error: string): SkillCategory {
    if (/格式|json|schema/.test(error)) return 'format_error'
    if (/不存在|not found/.test(error)) return 'path_error'
    if (/权限|deny|拒绝/.test(error)) return 'permission_error'
    if (/已存在|冲突/.test(error)) return 'conflict_error'
    if (/超时|timeout/.test(error)) return 'timeout_error'
    if (/已完成|已创建/.test(error) && !/error/.test(error)) return 'hallucination'
    return 'format_error'
  }

  private inferSolution(obs: RawObservation): string {
    if (obs.type === 'success') return `持续使用 ${obs.toolName} 的这种方式效果好`
    switch (this.inferCategory(obs.summary)) {
      case 'format_error': return `先 read_file 查看已有文件格式，确保符合 schema`
      case 'path_error': return `先 list_directory 或 search_files 确认路径`
      case 'permission_error': return `切换到 Action 模式或请求用户授权`
      case 'conflict_error': return `检查目标是否已存在，使用不同名称`
      case 'timeout_error': return `减少文件大小或拆分操作`
      case 'hallucination': return `检测到未执行操作的声明，系统将自动纠正`
      default: return `检查参数并重试`
    }
  }
}
