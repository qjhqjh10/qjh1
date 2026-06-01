/**
 * Learning Engine (V5)
 *
 * AI-driven learning: the model itself summarizes problems and solutions.
 * No automatic pattern tracking. The Agent calls write_learning tool after
 * encountering and solving an issue. Each entry is a human-readable
 * Chinese description that the user can understand and toggle on/off.
 *
 * Data flow:
 *   Agent encounters error → Agent solves it → Agent calls write_learning
 *   → saved to disk → shown in Settings UI → injected into system prompt
 */

/** A single learning entry, written by the AI after solving a problem */
export interface LearningEntry {
  id: string
  problem: string       // 出错原因，简短中文
  solution: string      // 解决方法，具体可操作
  category: string      // 分类: file | character | outline | chapter | style | kb | general
  createdAt: string     // ISO timestamp
  enabled: boolean      // 用户是否启用注入
}

const PERSIST_PATH = '.aiharness/learnings.json'

export class LearningEngine {
  private entries: LearningEntry[] = []
  private loaded = false

  /** Add a new learning entry (called by write_learning tool) */
  addEntry(problem: string, solution: string, category = 'general'): LearningEntry {
    const entry: LearningEntry = {
      id: `learn_${Date.now().toString(36)}`,
      problem: problem.slice(0, 200),
      solution: solution.slice(0, 500),
      category: category.slice(0, 30),
      createdAt: new Date().toISOString(),
      enabled: false,  // default off, user must enable
    }
    this.entries.push(entry)
    // Keep only last 50 entries
    if (this.entries.length > 50) {
      this.entries = this.entries.slice(-50)
    }
    return entry
  }

  /** Get all entries (for UI display) */
  getAll(): LearningEntry[] {
    return [...this.entries].reverse()  // newest first
  }

  /** Get context injection text — only enabled entries */
  getContextInject(maxTokens?: number): string {
    const enabled = this.entries.filter(e => e.enabled)
    if (enabled.length === 0) return ''

    const lines: string[] = ['## 已学的经验教训']
    let totalTokens = 0
    const limit = maxTokens ?? 2000

    for (const e of enabled) {
      const line = `- **${e.problem}** → ${e.solution}`
      const estTokens = Math.ceil(line.length / 2)  // Chinese ~2 chars/token
      if (totalTokens + estTokens > limit) break
      totalTokens += estTokens
      lines.push(line)
    }

    return lines.join('\n')
  }

  /** Toggle enabled state of an entry (called by UI) */
  toggleEnabled(id: string): boolean {
    const entry = this.entries.find(e => e.id === id)
    if (entry) {
      entry.enabled = !entry.enabled
      this.persist().catch(() => {})
      return entry.enabled
    }
    return false
  }

  /** Delete an entry (called by UI) */
  deleteEntry(id: string): void {
    this.entries = this.entries.filter(e => e.id !== id)
    this.persist().catch(() => {})
  }

  /** Clear all entries */
  clearAll(): void {
    this.entries = []
    this.persist().catch(() => {})
  }

  // ── Persistence ──

  async persist(): Promise<void> {
    try {
      const { fileService } = await import('@/services/fileService')
      await fileService.write(PERSIST_PATH, JSON.stringify(this.entries, null, 2))
    } catch (err) {
      console.warn('[LearningEngine] Persist failed:', err)
    }
  }

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const { fileService } = await import('@/services/fileService')
      const raw = await fileService.read(PERSIST_PATH)
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw) as LearningEntry[]
        this.entries = parsed
      }
    } catch { /* first run */ }
    this.loaded = true
  }

  /** Legacy: keep minimal compatibility with existing callers */
  startSession(): void {}
  async endSession(): Promise<any[]> { return [] }
  onToolResult(_toolName: string, _result: any, _projectId?: string | null): void {
    // no-op: V5 does not auto-track patterns
  }
}
