// ── Skill Learner ──
// The "越用越聪明" engine. Persists error patterns across sessions,
// auto-generates rules from learned experience, and compounds knowledge.
//
// Flow:
//   Tool fails → recordError()
//   Pattern repeats ≥3 times → generateRule()
//   Next session → loadLearned() → inject rules into system prompt
//   Cross-project rules shared via ~/.aiharness/learned/

import type { ToolResult } from '../runtime/AgentRuntime'

export interface ErrorRecord {
  toolName: string
  error: string
  category: string
  timestamp: number
  sessionId: string
  projectId: string | null
}

export interface LearnedPattern {
  id: string
  toolName: string
  errorCategory: string
  errorSnippet: string
  solution: string
  occurrenceCount: number
  lastSeen: number
  sessions: string[]
  projects: string[]
}

export interface LearnedRule {
  id: string
  title: string
  when: string   // when to apply this rule
  rule: string   // the rule text (injected as system prompt)
  source: LearnedPattern
  createdAt: number
  isAutoDraft: boolean  // false once human approves
}

export class SkillLearner {
  private patterns = new Map<string, LearnedPattern>()
  private rules: LearnedRule[] = []
  private storagePath: string
  private sessionErrors: ErrorRecord[] = []
  private currentSessionId = ''
  private currentProjectId: string | null = null

  constructor(storagePath: string) {
    this.storagePath = storagePath
  }

  // ── Session Lifecycle ──

  startSession(sessionId: string, projectId: string | null): void {
    this.currentSessionId = sessionId
    this.currentProjectId = projectId
    this.sessionErrors = []
  }

  async loadLearned(): Promise<LearnedRule[]> {
    this.patterns.clear()
    this.rules = []

    // Load from shared learned directory
    try {
      const { readdir, readFile } = await import('fs/promises')
      const { join } = await import('path')
      const dir = join(this.storagePath, 'learned')

      try {
        const files = await readdir(dir)
        for (const f of files) {
          if (f.endsWith('.json')) {
            try {
              const raw = await readFile(join(dir, f), 'utf-8')
              const pattern = JSON.parse(raw) as LearnedPattern
              this.patterns.set(pattern.id, pattern)
            } catch { /* skip corrupt */ }
          }
        }
      } catch { /* dir doesn't exist yet */ }

      // Load auto-generated rules
      const rulesDir = join(this.storagePath, 'rules', 'auto-learned')
      try {
        const ruleFiles = await readdir(rulesDir)
        for (const f of ruleFiles) {
          if (f.endsWith('.json')) {
            try {
              const raw = await readFile(join(rulesDir, f), 'utf-8')
              this.rules.push(JSON.parse(raw) as LearnedRule)
            } catch { /* skip */ }
          }
        }
      } catch { /* dir doesn't exist yet */ }
    } catch { /* node fs not available (renderer context) */ }

    return this.rules
  }

  // ── Record errors ──

  recordError(toolName: string, error: string, category?: string): void {
    const record: ErrorRecord = {
      toolName,
      error,
      category: category || this.categorizeError(error),
      timestamp: Date.now(),
      sessionId: this.currentSessionId,
      projectId: this.currentProjectId,
    }
    this.sessionErrors.push(record)
    this.mergeIntoPatterns(record)
  }

  recordSuccess(toolName: string): void {
    // Decrement error counters for patterns that had a success
    for (const [, pattern] of this.patterns) {
      if (pattern.toolName === toolName && pattern.occurrenceCount > 0) {
        pattern.occurrenceCount = Math.max(0, pattern.occurrenceCount - 0.5)
      }
    }
  }

  // ── Pattern analysis ──

  private mergeIntoPatterns(record: ErrorRecord): void {
    const key = `${record.toolName}:${record.error.slice(0, 80)}`
    const existing = this.patterns.get(key)

    if (existing) {
      existing.occurrenceCount++
      existing.lastSeen = record.timestamp
      if (!existing.sessions.includes(record.sessionId)) {
        existing.sessions.push(record.sessionId)
      }
      if (record.projectId && !existing.projects.includes(record.projectId)) {
        existing.projects.push(record.projectId)
      }
    } else {
      this.patterns.set(key, {
        id: `pat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        toolName: record.toolName,
        errorCategory: record.category,
        errorSnippet: record.error.slice(0, 100),
        solution: this.suggestSolution(record),
        occurrenceCount: 1,
        lastSeen: record.timestamp,
        sessions: [record.sessionId],
        projects: record.projectId ? [record.projectId] : [],
      })
    }
  }

  getPatternsAboveThreshold(threshold = 3): LearnedPattern[] {
    return [...this.patterns.values()]
      .filter(p => p.occurrenceCount >= threshold)
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
  }

  // ── Rule generation ──

  async generateRules(): Promise<LearnedRule[]> {
    const newRules: LearnedRule[] = []
    const patterns = this.getPatternsAboveThreshold(3)

    for (const p of patterns) {
      // Check if we already have a rule for this pattern
      const existing = this.rules.find(r => r.source.id === p.id)
      if (existing) continue

      const rule = this.buildRule(p)
      newRules.push(rule)
      this.rules.push(rule)

      // Persist the rule
      await this.saveRule(rule)
    }

    return newRules
  }

  private buildRule(p: LearnedPattern): LearnedRule {
    const rule: LearnedRule = {
      id: `rule_${p.id}`,
      title: `[自动学习] ${p.toolName}: ${p.errorCategory}`,
      when: `当使用 ${p.toolName} 工具时`,
      rule: [
        `## 经验教训: ${p.toolName}`,
        ``,
        `**问题**: 在过去 ${p.occurrenceCount} 次会话中（项目: ${p.projects.join(', ')}），`,
        `${p.toolName} 反复出现以下错误:`,
        `> ${p.errorSnippet}`,
        ``,
        `**原因**: ${p.errorCategory}`,
        ``,
        `**解决方案**: ${p.solution}`,
        ``,
        `此规则由系统自动学习生成。已验证 ${p.sessions.length} 个会话。`,
      ].join('\n'),
      source: p,
      createdAt: Date.now(),
      isAutoDraft: true,
    }
    return rule
  }

  // ── Get learned rules for context injection ──

  getActiveRules(): LearnedRule[] {
    return this.rules
      .filter(r => {
        // Only inject rules relevant to the current project or marked as shared
        return !r.source.projects.length
          || (this.currentProjectId && r.source.projects.includes(this.currentProjectId))
          || r.source.projects.length >= 3 // cross-project after 3 projects
      })
      .sort((a, b) => b.source.occurrenceCount - a.source.occurrenceCount)
  }

  getContextInject(maxTokens = 2000): string {
    const rules = this.getActiveRules()
    if (rules.length === 0) return ''

    const header = '[系统学习] 以下是从历史经验中自动学习的规则，请优先遵守：\n\n'
    let body = ''
    for (const r of rules.slice(0, 5)) { // max 5 rules
      const candidate = body + r.rule + '\n\n'
      if ((header.length + candidate.length) / 3 > maxTokens) break
      body = candidate
    }

    return body ? header + body : ''
  }

  // ── Persist ──

  private async saveRule(rule: LearnedRule): Promise<void> {
    try {
      const { mkdir, writeFile } = await import('fs/promises')
      const { join } = await import('path')
      const dir = join(this.storagePath, 'rules', 'auto-learned')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${rule.id}.json`), JSON.stringify(rule, null, 2), 'utf-8')
    } catch { /* persist failure is non-fatal */ }
  }

  async persistPatterns(): Promise<void> {
    try {
      const { mkdir, writeFile } = await import('fs/promises')
      const { join } = await import('path')
      const dir = join(this.storagePath, 'learned')
      await mkdir(dir, { recursive: true })
      for (const [key, pattern] of this.patterns) {
        await writeFile(join(dir, `${pattern.id}.json`), JSON.stringify(pattern, null, 2), 'utf-8').catch(() => {})
      }
    } catch { /* non-fatal */ }
  }

  // ── Helpers ──

  private categorizeError(error: string): string {
    const s = error.toLowerCase()
    if (/格式|json|schema/.test(s)) return '格式错误'
    if (/不存在|not found|找不到/.test(s)) return '文件不存在'
    if (/权限|deny|拒绝|未获/.test(s)) return '权限不足'
    if (/已存在|冲突|already exists/.test(s)) return '命名冲突'
    if (/超时|timeout/.test(s)) return '超时'
    return '其他错误'
  }

  private suggestSolution(record: ErrorRecord): string {
    switch (record.category) {
      case '格式错误': return `在使用 ${record.toolName} 前，先 read_file 参考已有文件格式，确保 JSON schema 正确`
      case '文件不存在': return `在使用 ${record.toolName} 前，先用 list_directory 或 search_files 确认目标路径存在`
      case '命名冲突': return `使用不同的文件名，或先检查是否已有同名文件`
      case '超时': return `减少单次操作的文件大小，或拆分为多次操作`
      case '权限不足': return `该操作需要用户确认。在 Action 模式下执行，或请求用户授权`
      default: return `检查参数是否正确，必要时先读取相关文件了解上下文`
    }
  }
}
