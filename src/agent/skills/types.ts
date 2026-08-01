// ── Tool Types ──
// Self-contained tool definitions. Skill system removed in v11.3.

export interface ToolResult {
  status: 'success' | 'error' | 'pending_confirm'
  summary: string
  detail?: string
  matchedTools?: string[]  // v13.2.0: tool_search 返回的匹配工具名
  /** v15: 工具内部委托子 agent 的用量（analyze_file/edit_file_task） */
  subAgentUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cacheHitTokens: number
    cacheCreationTokens: number
    cost: number
    calls: number
  }
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
      properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string; description?: string; properties?: Record<string, { type: string; description?: string }>; required?: string[] } }>
      required: string[]
    }
  }
  permission: 'AUTO' | 'READ_ASK' | 'PROJECT_ASK' | 'DANGEROUS_ASK'
  /** 条件审批：permission 为 *_ASK 时生效——仅当 gate(args) 返回 true 才需审批。
   *  用于"默认安全、特定参数才危险"的工具（如 find_files：scope=computer 才需审批）。
   *  不传则保持静态判定（始终审批）。 */
  approvalGate?: (args: Record<string, unknown>) => boolean
  category: 'file' | 'kb' | 'note' | 'image' | 'template' | 'project' | 'prompt' | 'harness' | 'http' | 'browser' | 'shell' | 'lsp'
  executor: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>
}
