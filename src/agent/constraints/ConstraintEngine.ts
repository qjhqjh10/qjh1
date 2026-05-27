// ── Constraint Engine ──
// Unifies architectural constraints + taste invariants.
// Checked in PreToolUse hook — before tool execution, after PolicyEngine.

import type { ArchitecturalConstraint, TasteInvariant, ToolCallArgs, ConstraintResult } from './types'
import { ALL_ARCHITECTURAL_CONSTRAINTS } from './ArchitecturalConstraints'
import { ALL_TASTE_INVARIANTS } from './TasteInvariants'

export interface ConstraintConfig {
  enabled: boolean
  fileSizeLimit: number
  enforceNamingConvention: boolean
  enforceDependencyDirection: boolean
  jsonSchemaValidation: boolean
  enforceNoEmptyFiles: boolean
  enforceNoDuplicateCreate: boolean
}

const DEFAULT_CONFIG: ConstraintConfig = {
  enabled: true,
  fileSizeLimit: 500,
  enforceNamingConvention: true,
  enforceDependencyDirection: false, // off by default — too many false positives in Electron+React
  jsonSchemaValidation: true,
  enforceNoEmptyFiles: true,
  enforceNoDuplicateCreate: true,
}

export class ConstraintEngine {
  private archConstraints: ArchitecturalConstraint[] = []
  private tasteInvariants: TasteInvariant[] = []
  private config: ConstraintConfig

  constructor(config: Partial<ConstraintConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rebuild()
  }

  updateConfig(config: Partial<ConstraintConfig>): void {
    this.config = { ...this.config, ...config }
    this.rebuild()
  }

  private rebuild(): void {
    if (!this.config.enabled) {
      this.archConstraints = []
      this.tasteInvariants = []
      return
    }

    // Filter architectural constraints based on config
    this.archConstraints = ALL_ARCHITECTURAL_CONSTRAINTS.filter(c => {
      if (c.id === 'dependency-direction' && !this.config.enforceDependencyDirection) return false
      if (c.id === 'json-schema-validation' && !this.config.jsonSchemaValidation) return false
      return true
    })

    // Filter taste invariants based on config
    this.tasteInvariants = ALL_TASTE_INVARIANTS.filter(c => {
      if (c.id === 'naming-convention' && !this.config.enforceNamingConvention) return false
      if (c.id === 'no-empty-files' && !this.config.enforceNoEmptyFiles) return false
      return true
    })
  }

  /**
   * Check all constraints before tool execution.
   * Returns: { passed, messages } — if !passed, tool should be BLOCKED.
   */
  check(args: ToolCallArgs): ConstraintResult {
    // Architectural constraints: fail = BLOCK
    for (const c of this.archConstraints) {
      const result = c.check(args)
      if (!result.passed) return result
    }

    // Taste invariants: fail = WARN (still pass, but log)
    for (const t of this.tasteInvariants) {
      const result = t.check(args)
      if (!result.passed) return result
    }

    return { passed: true, message: '' }
  }

  /** Only check architectural constraints (for hard blocking) */
  checkArchitectural(args: ToolCallArgs): ConstraintResult {
    for (const c of this.archConstraints) {
      const result = c.check(args)
      if (!result.passed) return result
    }
    return { passed: true, message: '' }
  }

  get activeConstraints(): number {
    return this.archConstraints.length + this.tasteInvariants.length
  }
}
