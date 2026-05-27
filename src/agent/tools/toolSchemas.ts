import { ALL_TOOLS } from './definitions'

/**
 * Pure OpenAI function calling schemas extracted from ALL_TOOLS.
 * No executors — just JSON-safe schema objects.
 * Used as the canonical source for both GUI (via ToolRegistry) and CLI (via JSON export).
 */
export const TOOL_SCHEMAS: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> =
  ALL_TOOLS.map(t => ({
    type: 'function' as const,
    function: t.schema,
  }))

export function getToolCount(): number {
  return TOOL_SCHEMAS.length
}
