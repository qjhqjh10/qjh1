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
  search_files:   ['status', 'summary', 'detail'],
  search_content: ['status', 'summary', 'detail'],
  list_notes:     ['status', 'summary', 'detail'],
  read_note:      ['status', 'summary', 'detail'],
  kb_list:        ['status', 'summary', 'detail'],
  kb_index_file:  ['status', 'summary', 'detail'],
  // ── Write tools: strip detail to stay lean ──
  create_file:    ['status', 'summary'],
  edit_file:      ['status', 'summary'],
  delete_file:    ['status', 'summary'],
  rename_file:    ['status', 'summary'],
  kb_create_file: ['status', 'summary'],
  kb_append_file: ['status', 'summary'],
  write_note:     ['status', 'summary'],
  append_note:    ['status', 'summary'],
  delete_note:    ['status', 'summary'],
}

export class ContractExecutor {
  static filterResult(result: ToolResult, contract: string[]): ContractResult {
    const resultObj = result as unknown as Record<string, unknown>
    const allFields = Object.keys(resultObj)
    const kept: Record<string, unknown> = {}
    const stripped: string[] = []

    for (const field of allFields) {
      if (contract.includes(field)) {
        kept[field] = resultObj[field]
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
