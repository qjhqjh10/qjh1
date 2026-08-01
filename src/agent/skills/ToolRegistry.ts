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

  /** 兼容旧 ToolRegistry 的别名 */
  getAllDefinitions(): ToolDefinition[] { return this.getAll() }

  /** 获取 OpenAI 格式的工具 schema（别名，兼容旧 ToolRegistry） */
  getAllSchemas(): Array<{ type: 'function'; function: ToolDefinition['schema'] }> {
    return this.getAll().map(t => ({ type: 'function' as const, function: t.schema }))
  }

  /** 获取 OpenAI 格式的工具 schema */
  getOpenAISchemas(): Array<{ type: 'function'; function: ToolDefinition['schema'] }> {
    return this.getAllSchemas()
  }

  /** 返回紧凑 schema — name + 一行 description，无完整参数 */
  getCompactSchemas(): Array<{ type: 'function'; function: { name: string; description: string; parameters: { type: 'object'; properties: {}; required: [] } } }> {
    return this.getAll().map(t => ({
      type: 'function' as const,
      function: {
        name: t.schema.name,
        description: t.schema.description.slice(0, 80),
        parameters: { type: 'object' as const, properties: {}, required: [] },
      },
    }))
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

  /** 权限查询（别名，兼容旧 ToolRegistry） */
  getPermissionLevel(name: string): ToolDefinition['permission'] | undefined {
    return this.getPermission(name)
  }

  needsApproval(name: string, args?: Record<string, unknown>): boolean {
    const def = this.tools.get(name)
    if (!def) return false
    const perm = def.permission
    if (perm !== 'DANGEROUS_ASK' && perm !== 'PROJECT_ASK') return false
    // 条件审批：有 approvalGate 时一律按 gate 判定（缺省参数按 gate 的缺省行为——
    // v14.5.0: 原实现"无 args 直接 return true"会让 list_directory 无参数调用也弹审批）
    if (def.approvalGate) return def.approvalGate(args ?? {})
    return true
  }

  /** 检查工具是否为危险操作（兼容旧 ToolRegistry） */
  isDangerous(name: string): boolean {
    return this.tools.get(name)?.permission === 'DANGEROUS_ASK'
  }

  /** 按类别筛选工具 */
  getByCategory(cat: ToolDefinition['category']): ToolDefinition[] {
    return this.getAll().filter(t => t.category === cat)
  }
}

/** 全局单例 */
export const skillToolRegistry = new SkillToolRegistry()

/** 兼容旧 ToolRegistry 的别名 — 所有 Bridge/Runtime 使用此名 */
export const toolRegistry = skillToolRegistry
