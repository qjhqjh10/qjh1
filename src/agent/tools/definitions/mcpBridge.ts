// ── MCP Bridge ──
// Converts MCP tool schemas to ToolDefinition format for ToolRegistry.

import type { ToolDefinition } from '../ToolRegistry'

interface MCPToolSchema {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * Convert an MCP tool schema to a ToolDefinition that can be registered.
 * The executor routes to the Electron IPC mcp:call-tool channel.
 */
export function mcpToolToDefinition(
  schema: MCPToolSchema,
  serverName: string,
): ToolDefinition {
  return {
    schema: {
      name: `mcp:${serverName}:${schema.name}`,
      description: `[MCP/${serverName}] ${schema.description}`,
      parameters: {
        type: 'object' as const,
        properties: (schema.inputSchema.properties || {}) as Record<string, { type: string; description: string }>,
        required: schema.inputSchema.required || [],
      },
    },
    permission: 'READ_ASK',
    category: 'shell',
    availableInPlanMode: true,
    executor: async (args) => {
      try {
        const { fileService } = await import('@/services/fileService')
        const result = await (fileService as any).mcpCallTool?.(serverName, schema.name, args)
        return result || { status: 'error', summary: 'MCP 工具调用失败' }
      } catch {
        return { status: 'error', summary: 'MCP 工具不可用' }
      }
    },
  }
}
