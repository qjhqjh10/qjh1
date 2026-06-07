// ── Tool Action Prompter (v11.3: skill logic removed) ──
// Handles consecutive-reads action prompts.

import type { Message, ToolCallRequest, ToolResult } from '../state/types'

export interface ActionPromptContext {
  messagesForApi: Message[]
  activeSkill: unknown  // kept for type compatibility
  _consecutiveReads: number
  tc: ToolCallRequest
  result: ToolResult
  args: Record<string, unknown>
}

const READ_TOOLS = new Set(['read_file','list_directory','search_content','find_files'])
const WRITE_TOOLS = new Set(['create_file','edit_file','batch_replace','delete_file','rename_file',
  'kb_append_file'])

export function applyActionPrompts(ctx: ActionPromptContext): number {
  let reads = ctx._consecutiveReads

  // Track consecutive reads → warn when too many without a write
  if (READ_TOOLS.has(ctx.tc.name)) {
    reads = (reads || 0) + 1
  } else if (WRITE_TOOLS.has(ctx.tc.name)) {
    reads = 0
  }
  if ((reads || 0) >= 3 && ctx.result.status === 'success') {
    ctx.messagesForApi.push({
      role: 'user',
      content: '已连续读取多个文件，请立即调用 edit_file 或 create_file 写入。',
    })
    reads = 0
  }

  return reads
}
