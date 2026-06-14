// ── Tool Action Prompter (v11.3: skill logic removed) ──
// Handles consecutive-reads action prompts.

import type { Message, ToolCallRequest, ToolResult } from '../state/types'

export interface ActionPromptContext {
  messagesForApi: Message[]
  _consecutiveReads: number
  tc: ToolCallRequest
  result: ToolResult
  args: Record<string, unknown>
}

const READ_TOOLS = new Set(['read_file','list_directory','search_content','find_files'])
const WRITE_TOOLS = new Set(['create_file','edit_file','batch_replace','delete_file','rename_file',
  'kb_append_file', 'create_project', 'delete_project'])
const PATH_ERROR_RE = /ENOENT|文件不存在|not found|no such file|路径|directory|path/i

export function applyActionPrompts(ctx: ActionPromptContext): number {
  let reads = ctx._consecutiveReads

  // Track consecutive reads → warn when too many without a write
  if (READ_TOOLS.has(ctx.tc.name)) {
    reads = (reads || 0) + 1
  } else if (WRITE_TOOLS.has(ctx.tc.name)) {
    reads = 0
  }

  // v12.14.0: 互斥阈值 — 只触发最高严重级别的一条消息，避免同时注入多条矛盾指令
  if ((reads || 0) >= 8) {
    ctx.messagesForApi.push({
      role: 'user',
      content: `[系统指令-强制] 已达到最大读取次数限制(${reads}次)。现在只能调用 create_file 或 edit_file。如果你不确定内容，基于你的知识直接创作——先有再改。`,
    })
  } else if ((reads || 0) >= 6) {
    ctx.messagesForApi.push({
      role: 'user',
      content: `[系统指令-最高优先级] 已连续读取 ${reads} 次。忽略所有犹豫，立即调用 create_file 或 edit_file 执行用户请求。不要继续读取。`,
    })
  } else if ((reads || 0) >= 4) {
    ctx.messagesForApi.push({
      role: 'user',
      content: `⚠️ 已连续读取 ${reads} 个文件。立即停止读取，调用 create_file 或 edit_file 写入。即使信息不完整也要基于你的知识直接写。`,
    })
  } else if ((reads || 0) >= 2 && ctx.result.status === 'success') {
    ctx.messagesForApi.push({
      role: 'user',
      content: `已连续读取 ${reads} 个文件。如果你已经有足够信息，请立即用 create_file 或 edit_file 写入。如果还需要信息，最多再读 1 个文件后必须写。`,
    })
  }

  // v12.6.0: 单次读取失败 → 注入路径修正提示 (仅当未超过读取上限)
  if (READ_TOOLS.has(ctx.tc.name) && ctx.result.status === 'error' && (reads || 0) < 4) {
    const errSummary = ctx.result.summary || ''
    if (PATH_ERROR_RE.test(errSummary)) {
      const failedPath = (ctx.args as any)?.file_path || (ctx.args as any)?.dir_path || ''
      ctx.messagesForApi.push({
        role: 'user',
        content: `⚠️ 读取失败: ${errSummary.slice(0, 120)}。路径可能不正确。${failedPath ? '失败路径: ' + failedPath : ''}`,
      })
    }
  }

  return reads
}
