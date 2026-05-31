import type { ToolResult, ToolExecutionContext } from '../state/types'
import type { ToolProgressEvent } from '../runtime/AgentEventEmitter'

// ── Tool Definition ──

export interface ToolDefinition {
  schema: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description: string; items?: { type: string }; enum?: string[] }>
      required: string[]
    }
  }

  permission: 'AUTO' | 'READ_ASK' | 'PROJECT_ASK' | 'DANGEROUS_ASK'

  executor: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>

  category: 'file' | 'kb' | 'note' | 'image' | 'template' | 'project' | 'prompt' | 'http' | 'browser' | 'shell'

  availableInPlanMode: boolean
}

// ── Registry ──

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.schema.name)) {
      console.warn(`[ToolRegistry] Duplicate tool: ${tool.schema.name}, overwriting`)
    }
    this.tools.set(tool.schema.name, tool)
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const t of tools) this.register(t)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  getAllDefinitions(): ToolDefinition[] {
    return [...this.tools.values()]
  }

  getNames(): string[] {
    return [...this.tools.keys()]
  }

  count(): number {
    return this.tools.size
  }

  // ── OpenAI Function Calling schema ──

  getAllSchemas(): Array<{ type: 'function'; function: ToolDefinition['schema'] }> {
    return this.getAllDefinitions().map(t => ({
      type: 'function' as const,
      function: t.schema,
    }))
  }

  getFilteredSchemas(workMode: 'plan' | 'action', enabledToolNames?: Set<string>): Array<{ type: 'function'; function: ToolDefinition['schema'] }> {
    let defs = this.getAllDefinitions()
    if (workMode === 'plan') {
      defs = defs.filter(t => t.availableInPlanMode)
    }
    if (enabledToolNames) {
      defs = defs.filter(t => enabledToolNames.has(t.schema.name))
    }
    return defs.map(t => ({ type: 'function' as const, function: t.schema }))
  }

  // ── Execution ──

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
    onProgress?: (event: ToolProgressEvent) => void,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { status: 'error', summary: `未知工具: ${name}` }
    }

    onProgress?.({
      callId: ctx.callId, toolName: name,
      phase: 'started', progress: 0,
      message: `${name} 开始执行`,
      timestamp: Date.now(),
    })

    try {
      const result = await tool.executor(args, ctx)
      onProgress?.({
        callId: ctx.callId, toolName: name,
        phase: 'done', progress: 1,
        message: result.summary,
        timestamp: Date.now(),
      })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return { status: 'error', summary: msg }
    }
  }

  // ── Permission helpers ──

  isDangerous(name: string): boolean {
    return this.tools.get(name)?.permission === 'DANGEROUS_ASK'
  }

  needsApproval(name: string): boolean {
    const perm = this.tools.get(name)?.permission
    return perm === 'DANGEROUS_ASK' || perm === 'PROJECT_ASK'
  }

  getPermissionLevel(name: string): ToolDefinition['permission'] | undefined {
    return this.tools.get(name)?.permission
  }
}

// ── Global singleton ──

export const toolRegistry = new ToolRegistry()
