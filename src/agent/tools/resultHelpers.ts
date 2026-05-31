// ── Tool Result Helpers ──
// Standardized result formatting for all tool executors.
// Replaces ad-hoc `{ status: 'error', summary: '...' }` patterns.

import type { ToolResult } from '../state/types'

/** Success result */
export function ok(summary: string, detail?: string): ToolResult {
  return { status: 'success', summary, detail }
}

/** Error result with automatic error message extraction */
export function err(toolName: string, e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message : '未知错误'
  return { status: 'error', summary: `${toolName} 失败: ${msg}` }
}

/** Error result with custom message (no tool name prefix) */
export function errMsg(summary: string, detail?: string): ToolResult {
  return { status: 'error', summary, detail }
}
