// ── 技能注册表 ──
// 核心：管理所有技能，匹配用户意图，生成提示词片段。
//
// 扩展点：
//   1. addSource() — 注入外部技能来源（文件/插件）
//   2. reload() — 热重载所有技能
//   3. match() — 用户消息 → 技能匹配
//   4. buildPrompt() — 生成技能提示词注入

import type {
  SkillDefinition,
  SkillSource,
  SkillMatch,
  SkillPromptContext,
  SkillPromptFragment,
} from './types'

export class SkillRegistry {
  /** 所有已注册的技能 (id → SkillDefinition) */
  private skills = new Map<string, SkillDefinition>()

  /** 所有技能来源 */
  private sources = new Map<string, SkillSource>()

  /** 内置技能数量（用于区分来源） */
  private builtinCount = 0

  // ── 技能注册 ──

  /** 注册单个内置技能 */
  registerBuiltin(skill: SkillDefinition): void {
    skill.metadata.source = 'builtin'
    this.skills.set(skill.id, skill)
    this.builtinCount++
  }

  /** 批量注册内置技能 */
  registerBuiltins(skills: SkillDefinition[]): void {
    for (const s of skills) this.registerBuiltin(s)
  }

  /** 获取所有技能 */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values())
  }

  /** 获取已启用的技能 */
  getEnabled(): SkillDefinition[] {
    return this.getAll().filter(s => s.metadata.enabled)
  }

  /** 按类别获取 */
  getByCategory(cat: string): SkillDefinition[] {
    return this.getEnabled().filter(s => s.category === cat)
  }

  get(id: string): SkillDefinition | undefined { return this.skills.get(id) }
  has(id: string): boolean { return this.skills.has(id) }
  count(): number { return this.skills.size }

  // ── 扩展接口（Claude Code 风格）──

  /**
   * 添加技能来源。
   * 任何实现了 SkillSource 接口的系统都可以通过这个入口注入技能。
   *
   * @example
   *   // 从文件系统加载
   *   registry.addSource(new FileSkillSource('./my-skills/'))
   *
   *   // 从社区插件加载
   *   registry.addSource(new PluginSkillSource('community-writing-skills'))
   *
   *   // 从远程 URL 加载
   *   registry.addSource(new RemoteSkillSource('https://skills.example.com/manifest.json'))
   */
  async addSource(source: SkillSource): Promise<number> {
    if (this.sources.has(source.id)) {
      console.warn(`[SkillRegistry] 重复来源: ${source.id}，将重新加载`)
      await this.removeSource(source.id)
    }

    this.sources.set(source.id, source)
    const discovered = await source.discover()

    let added = 0
    for (const skill of discovered) {
      skill.metadata.source = source.type
      skill.metadata.sourcePath = source.type === 'file' ? source.id : undefined
      skill.metadata.pluginId = source.type === 'plugin' ? source.id : undefined

      // 不覆盖同 ID 的内置技能（内置技能优先）
      if (this.skills.has(skill.id) && this.skills.get(skill.id)!.metadata.source === 'builtin') {
        continue
      }

      this.skills.set(skill.id, skill)
      added++
    }

    return added
  }

  /** 移除技能来源 */
  async removeSource(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId)
    if (!source) return

    // 移除该来源的所有技能
    for (const [id, skill] of Array.from(this.skills.entries())) {
      const matchSource =
        (skill.metadata.pluginId === sourceId) ||
        (skill.metadata.sourcePath === sourceId)
      if (matchSource && skill.metadata.source !== 'builtin') {
        this.skills.delete(id)
      }
    }

    this.sources.delete(sourceId)
  }

  /** 获取所有已注册的来源 */
  getSources(): Array<{ id: string; type: string; description: string; skillCount: number }> {
    return Array.from(this.sources.entries()).map(([id, source]) => ({
      id,
      type: source.type,
      description: source.description,
      skillCount: this.getAll().filter(s =>
        s.metadata.pluginId === id || s.metadata.sourcePath === id
      ).length,
    }))
  }

  /** 热重载所有来源 */
  async reload(): Promise<{ sourceId: string; added: number }[]> {
    const results: { sourceId: string; added: number }[] = []

    // 清除非内置技能
    for (const [id, skill] of Array.from(this.skills.entries())) {
      if (skill.metadata.source !== 'builtin') {
        this.skills.delete(id)
      }
    }

    // 重新加载每个来源
    for (const [sourceId, source] of Array.from(this.sources.entries())) {
      const reloaded = await source.reload()
      let added = 0
      for (const skill of reloaded) {
        skill.metadata.source = source.type
        skill.metadata.pluginId = source.type === 'plugin' ? sourceId : undefined
        skill.metadata.sourcePath = source.type === 'file' ? sourceId : undefined
        this.skills.set(skill.id, skill)
        added++
      }
      results.push({ sourceId, added })
    }

    return results
  }

  /** 禁用一个技能 */
  disable(id: string): void {
    const skill = this.skills.get(id)
    if (skill) skill.metadata.enabled = false
  }

  /** 启用一个技能 */
  enable(id: string): void {
    const skill = this.skills.get(id)
    if (skill) skill.metadata.enabled = true
  }

  // ── 意图匹配 ──

  /**
   * 匹配用户消息到技能。
   * 返回所有匹配的技能，按 confidence 降序排列。
   */
  match(userMessage: string): SkillMatch[] {
    const msg = userMessage.toLowerCase()
    const results: SkillMatch[] = []

    for (const skill of this.getEnabled()) {
      const matchedPatterns: string[] = []

      for (const pattern of skill.triggerPatterns) {
        try {
          const re = new RegExp(pattern, 'i')
          if (re.test(msg)) {
            matchedPatterns.push(pattern)
          }
        } catch {
          // 不是正则，做子串匹配
          if (msg.includes(pattern.toLowerCase())) {
            matchedPatterns.push(pattern)
          }
        }
      }

      if (matchedPatterns.length > 0) {
        // 计算置信度：命中模式数 / 总模式数，加权优先级
        const patternScore = matchedPatterns.length / skill.triggerPatterns.length
        const priorityBonus = skill.metadata.priority / 100
        const confidence = Math.min(1, patternScore * 0.7 + priorityBonus * 0.3)

        // 提取字段
        const extractedFields: Record<string, unknown> = {}
        for (const field of skill.inputSchema.fields) {
          if (field.extractFrom) {
            try {
              const re = new RegExp(field.extractFrom, 'i')
              const m = userMessage.match(re)
              if (m) extractedFields[field.name] = m[1] || m[0]
            } catch { /* regex error, skip */ }
          }
        }

        results.push({ skill, confidence, matchedPatterns, extractedFields })
      }
    }

    // 按置信度降序
    return results.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * 获取最佳匹配技能
   * @param threshold 最低置信度阈值
   */
  matchBest(userMessage: string, threshold = 0.3): SkillMatch | null {
    const matches = this.match(userMessage)
    if (matches.length === 0) return null
    return matches[0].confidence >= threshold ? matches[0] : null
  }

  // ── 提示词生成 ──

  /**
   * 为匹配到的技能生成提示词片段。
   * 注入到系统提示词中，教模型"怎么用这个技能"。
   */
  buildPromptFragments(ctx: SkillPromptContext): SkillPromptFragment[] {
    const matches = this.match(ctx.userMessage)
    const fragments: SkillPromptFragment[] = []

    // 匹配到的技能（详细指引）
    for (const match of matches.slice(0, 3)) { // 最多注入 3 个匹配技能
      const { skill } = match
      const lines: string[] = [
        `## 🔧 技能: ${skill.name}`,
        `> ${skill.description}`,
        '',
        skill.workflow.description,
        '',
      ]

      // 步骤指引 — 强制语气
      if (skill.workflow.steps.length > 0) {
        lines.push('### 必须执行的步骤（不允许跳过或调换顺序）：')
        for (const step of skill.workflow.steps) {
          const prefix = step.optional ? '  [可选]' : '  [必做]'
          lines.push(`${prefix} 步骤${step.order}. ${step.purpose} → 工具: \`${step.tool}\``)
        }
        lines.push('')
      }

      // 质量检查
      if (skill.qualityChecks.length > 0) {
        lines.push('### 质量检查（不通过会被自动退回重做）：')
        for (const qc of skill.qualityChecks) {
          const icon = qc.severity === 'error' ? '❌' : '⚠️'
          lines.push(`  ${icon} ${qc.description}`)
        }
        lines.push('')
      }

      // 字段提取
      if (skill.inputSchema.fields.length > 0 && match.extractedFields) {
        lines.push('### 已提取的参数：')
        for (const [k, v] of Object.entries(match.extractedFields)) {
          lines.push(`  - ${k}: ${v}`)
        }
        lines.push('')
      }

      fragments.push({
        skillId: skill.id,
        skillName: skill.name,
        promptText: lines.join('\n'),
        priority: skill.metadata.priority + 10, // 匹配到的技能提权
        matched: true,
        confidence: match.confidence,
      })
    }

    // 未匹配的技能（简要列表，模型备选）
    const unmatched = this.getEnabled().filter(s =>
      !matches.some(m => m.skill.id === s.id)
    )

    if (unmatched.length > 0 && matches.length < 3) {
      const skillList = unmatched
        .sort((a, b) => b.metadata.priority - a.metadata.priority)
        .slice(0, 8)
        .map(s => `- **${s.name}** — ${s.description}`)
        .join('\n')

      fragments.push({
        skillId: '__available__',
        skillName: '可用技能列表',
        promptText: `## 🔧 可用技能（未匹配但可用）\n${skillList}`,
        priority: -5,
        matched: false,
        confidence: 0,
      })
    }

    return fragments
  }
}

/** 全局单例 */
export const skillRegistry = new SkillRegistry()
