// ── Contract Executor ──
// Per-tool result filter that runs before API context injection.
// Read tools (read_file, search, list, kb) keep detail so the AI sees content.
// Write tools strip detail to avoid context bloat from verbose confirmations.
// Heavy truncation is deferred to ContextCompressor (threshold-based, Stage 1 at 70%).

import type { ToolResult } from '../state/types'
import type { ThinkingPlan, ThinkingStep } from '../state/types'

export interface ContractResult {
  filtered: ToolResult
  stripped: string[]
  matched: boolean
}

// V4-1: Split contracts — read tools keep 'detail' so the AI can see actual content.
// Write tools keep only status+summary to avoid context bloat from verbose write
// confirmations. ContextCompressor handles truncation at 70%+ thresholds.
const DEFAULT_CONTRACTS: Record<string, string[]> = {
  // ── Read tools: keep detail (the actual response content) ──
  read_file:      ['status', 'summary', 'detail'],
  list_directory: ['status', 'summary', 'detail'],
  search_content: ['status', 'summary', 'detail'],
  list_notes:     ['status', 'summary', 'detail'],
  read_note:      ['status', 'summary', 'detail'],
  kb_list:        ['status', 'summary', 'detail'],
  kb_index_file:  ['status', 'summary', 'detail'],
  // ── Template tools: strip detail (template JSON) to stay lean ──
  create_style_template: ['status', 'summary'],
  create_scene_template:  ['status', 'summary'],
  // ── Write tools: strip detail to stay lean ──
  create_file:    ['status', 'summary'],
  edit_file:      ['status', 'summary'],
  batch_replace:  ['status', 'summary'],  // v9.5.3: write tool
  delete_file:    ['status', 'summary'],
  rename_file:    ['status', 'summary'],
  kb_create_file: ['status', 'summary'],
  kb_append_file: ['status', 'summary'],
  write_note:     ['status', 'summary'],
  append_note:    ['status', 'summary'],
  delete_note:    ['status', 'summary'],
  // ── Search tools ──
  find_files:     ['status', 'summary', 'detail'],  // v9.5.3: read/search
  search_notes:   ['status', 'summary', 'detail'],  // v9.5.3: read
  // ── HTTP tools: strip detail (response body) ──
  http_get:       ['status', 'summary'],
  http_fetch:     ['status', 'summary'],
  // ── Browser tools ──
  browser_open:   ['status', 'summary'],
  browser_search: ['status', 'summary'],
  // ── Shell tools ──
  shell_exec:     ['status', 'summary'],
  shell_run_script: ['status', 'summary'],
  // ── Image tools ──
  search_images:  ['status', 'summary', 'detail'],
  generate_image: ['status', 'summary', 'detail'],
  // ── Prompt tools ──
  list_prompts:   ['status', 'summary', 'detail'],
  toggle_prompt:  ['status', 'summary'],
  update_prompt:  ['status', 'summary'],
  // ── Project tools ──
  create_project: ['status', 'summary'],
  delete_project: ['status', 'summary'],
  // ── LSP ──
  lsp_diagnose:   ['status', 'summary'],
  // ── Harness tools ──
  think:          ['status', 'summary', 'detail'],  // v9.5.3: thought content
  list_rules:     ['status', 'summary', 'detail'],
  learn_rule:     ['status', 'summary'],
  list_audit:     ['status', 'summary', 'detail'],
  write_learning: ['status', 'summary'],
  update_config:  ['status', 'summary'],  // v9.5.3: harness write
}

export class ContractExecutor {
  static filterResult(result: ToolResult, contract: string[]): ContractResult {
    const resultObj = result as unknown as Record<string, unknown>
    const allFields = Object.keys(resultObj)
    const kept: Record<string, unknown> = {}
    const stripped: string[] = []

    // v9.5.3: 当工具返回 error 时，保留 detail 字段（最多 1000 字符），
    // 让模型能看到错误详情从而自我修复。覆盖 Contract 中的 strip 规则。
    const isError = resultObj['status'] === 'error'
    const errorFields = isError ? ['detail'] : []

    for (const field of allFields) {
      if (contract.includes(field) || errorFields.includes(field)) {
        kept[field] = resultObj[field]
        // 截断错误 detail 防止上下文膨胀
        if (isError && field === 'detail' && typeof kept[field] === 'string' && (kept[field] as string).length > 1000) {
          kept[field] = (kept[field] as string).slice(0, 1000) + '…(已截断)'
        }
      } else {
        stripped.push(field)
      }
    }

    return {
      filtered: kept as unknown as ToolResult,
      stripped,
      matched: Object.keys(kept).length > 0,
    }
  }

  static resolveContract(
    toolName: string,
    _plan?: ThinkingPlan | null,
    _planStep?: ThinkingStep,
  ): string[] | null {
    return DEFAULT_CONTRACTS[toolName] || null
  }

  static filterForContext(
    toolName: string,
    result: ToolResult,
    _plan?: ThinkingPlan | null,
    _planStep?: ThinkingStep,
  ): { resultForApi: ToolResult; note?: string } {
    const contract = ContractExecutor.resolveContract(toolName, _plan, _planStep)
    if (!contract) return { resultForApi: result }

    const { filtered, stripped } = ContractExecutor.filterResult(result, contract)
    if (stripped.length > 0) {
      return {
        resultForApi: filtered,
        note: `已省略: ${stripped.join(', ')}`,
      }
    }
    return { resultForApi: filtered }
  }
}
