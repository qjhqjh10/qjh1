// ── Constraint System Types ──

export interface ToolCallArgs {
  toolName: string
  filePath?: string
  newPath?: string
  content?: string
  projectId?: string
  [key: string]: unknown
}

export interface ConstraintResult {
  passed: boolean
  message: string       // Failure: includes actionable fix instruction
}

export interface ArchitecturalConstraint {
  id: string
  description: string
  check: (args: ToolCallArgs) => ConstraintResult
  fixInstruction: string
}

export interface TasteInvariant {
  id: string
  description: string
  check: (args: ToolCallArgs) => ConstraintResult
}

export interface ConstraintConfig {
  enabled: boolean
  fileSizeLimit: number
  enforceNamingConvention: boolean
  enforceDependencyDirection: boolean
  jsonSchemaValidation: boolean
  enforceNoEmptyFiles: boolean
  enforceNoDuplicateCreate: boolean
}
