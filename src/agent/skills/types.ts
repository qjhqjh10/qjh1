// ── Tool Types ──
// Self-contained tool definitions. Skill system removed in v11.3.

export interface ToolResult {
  status: 'success' | 'error' | 'pending_confirm'
  summary: string
  detail?: string
}

export interface ToolExecutionContext {
  projectId: string | null
  configId: string
  callId: string
  toolName: string
  signal: AbortSignal
}

export interface ToolDefinition {
  schema: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string; properties?: Record<string, { type: string }> } }>
      required: string[]
    }
  }
  permission: 'AUTO' | 'READ_ASK' | 'PROJECT_ASK' | 'DANGEROUS_ASK'
  category: 'file' | 'kb' | 'note' | 'image' | 'template' | 'project' | 'prompt' | 'harness' | 'http' | 'browser' | 'shell' | 'lsp'
  availableInPlanMode: boolean
  executor: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>
}
