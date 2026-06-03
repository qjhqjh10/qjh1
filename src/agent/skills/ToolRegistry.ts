// ── Skill 工具注册表 ──
// skills/ 文件夹专用的工具注册表，与旧 tools/ToolRegistry.ts 完全独立。
// 工具定义复用 skills/tools/ 文件夹中的 ToolDefinition。

import type { ToolDefinition, ToolResult, ToolExecutionContext } from './types'

export class SkillToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.schema.name)) {
      console.warn(`[SkillToolRegistry] 重复工具: ${tool.schema.name}，覆盖`)
    }
    this.tools.set(tool.schema.name, tool)
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const t of tools) this.register(t)
  }

  has(name: string): boolean { return this.tools.has(name) }
  get(name: string): ToolDefinition | undefined { return this.tools.get(name) }
  getNames(): string[] { return Array.from(this.tools.keys()) }
  count(): number { return this.tools.size }
  getAll(): ToolDefinition[] { return Array.from(this.tools.values()) }

  /** 获取 OpenAI 格式的工具 schema */
  getOpenAISchemas(): Array<{ type: 'function'; function: ToolDefinition['schema'] }> {
    return this.getAll().map(t => ({ type: 'function' as const, function: t.schema }))
  }

  /** 获取 Anthropic 格式的工具 schema */
  getAnthropicSchemas(): Array<{ name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] } }> {
    return this.getAll().map(t => ({
      name: t.schema.name,
      description: t.schema.description,
      input_schema: {
        type: 'object' as const,
        properties: t.schema.parameters.properties,
        required: t.schema.parameters.required,
      },
    }))
  }

  /** 执行工具 */
  async execute(name: string, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) return { status: 'error', summary: `未知工具: ${name}` }
    try {
      return await tool.executor(args, ctx)
    } catch (err) {
      return { status: 'error', summary: err instanceof Error ? err.message : '工具执行失败' }
    }
  }

  /** 权限查询 */
  getPermission(name: string): ToolDefinition['permission'] | undefined {
    return this.tools.get(name)?.permission
  }

  needsApproval(name: string): boolean {
    const perm = this.getPermission(name)
    return perm === 'DANGEROUS_ASK' || perm === 'PROJECT_ASK'
  }

  isAvailableInPlanMode(name: string): boolean {
    return this.tools.get(name)?.availableInPlanMode ?? true
  }

  /** 按类别筛选工具 */
  getByCategory(cat: ToolDefinition['category']): ToolDefinition[] {
    return this.getAll().filter(t => t.category === cat)
  }
}

/** 全局单例 */
export const skillToolRegistry = new SkillToolRegistry()
