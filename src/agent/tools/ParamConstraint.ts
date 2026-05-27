// ── Parameter-level Constraint Engine ──
// Validates tool arguments against fine-grained constraints.
// Fail-closed: any violation = reject.

export type ConstraintType = 'prefix' | 'contains' | 'regex' | 'blocklist' | 'max_items' | 'max_length'

export interface ParamConstraintRule {
  type: ConstraintType
  value: unknown
}

export interface ToolConstraints {
  [paramName: string]: ParamConstraintRule[]
}

export interface ConstraintValidationResult {
  valid: boolean
  violations: { param: string; rule: ConstraintType; message: string }[]
}

export class ParamConstraint {
  private constraints: Record<string, ToolConstraints> = {}

  loadFromConfig(config: Record<string, Record<string, any>>): void {
    this.constraints = {}
    for (const [toolName, toolRules] of Object.entries(config)) {
      const toolConstraints: ToolConstraints = {}
      for (const [paramName, rules] of Object.entries(toolRules)) {
        toolConstraints[paramName] = this.normalizeRules(rules)
      }
      this.constraints[toolName] = toolConstraints
    }
  }

  private normalizeRules(raw: Record<string, unknown>): ParamConstraintRule[] {
    const rules: ParamConstraintRule[] = []
    const map: Record<string, ConstraintType> = {
      must_start_with: 'prefix', must_not_contain: 'contains',
      must_not_match: 'regex', blocklist: 'blocklist',
      max_items: 'max_items', max_length: 'max_length',
    }
    for (const [key, ctype] of Object.entries(map)) {
      if (key in raw) rules.push({ type: ctype, value: raw[key] })
    }
    return rules
  }

  validate(toolName: string, args: Record<string, unknown>): ConstraintValidationResult {
    const toolRules = this.constraints[toolName]
    if (!toolRules) return { valid: true, violations: [] }

    const violations: ConstraintValidationResult['violations'] = []

    for (const [paramName, rules] of Object.entries(toolRules)) {
      const val = args[paramName]
      for (const rule of rules) {
        const msg = this.checkRule(paramName, val, rule)
        if (msg) violations.push({ param: paramName, rule: rule.type, message: msg })
      }
    }

    return { valid: violations.length === 0, violations }
  }

  private checkRule(param: string, val: unknown, rule: ParamConstraintRule): string | null {
    const str = String(val ?? '')
    switch (rule.type) {
      case 'prefix': {
        const prefixes = rule.value as string[]
        if (!prefixes.some(p => str.startsWith(p))) {
          return `${param} 必须以 ${prefixes.join(' 或 ')} 开头，当前: ${str.slice(0, 50)}`
        }
        return null
      }
      case 'contains': {
        const forbidden = rule.value as string[]
        for (const f of forbidden) {
          if (str.includes(f)) return `${param} 不能包含 "${f}"`
        }
        return null
      }
      case 'regex': {
        const patterns = rule.value as string[]
        for (const p of patterns) {
          try { if (new RegExp(p).test(str)) return `${param} 匹配了禁止的模式: ${p}` } catch { /* skip bad regex */ }
        }
        return null
      }
      case 'blocklist': {
        const blocked = rule.value as string[]
        if (blocked.includes(str)) return `${param} 的值 "${str.slice(0, 50)}" 在禁止列表中`
        return null
      }
      case 'max_items': {
        const max = rule.value as number
        if (Array.isArray(val) && val.length > max) return `${param} 最多 ${max} 项，当前 ${val.length}`
        return null
      }
      case 'max_length': {
        const max = rule.value as number
        if (str.length > max) return `${param} 最多 ${max} 字符，当前 ${str.length}`
        return null
      }
      default:
        return null
    }
  }
}
