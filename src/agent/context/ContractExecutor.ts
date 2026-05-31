// ── Contract Executor ──
// Filters tool result detail for API context injection.
// Keeps status+summary, strips verbose detail to prevent context bloat.

import type { ToolResult } from '../state/types'
import type { ThinkingPlan, ThinkingStep } from '../state/types'

export interface ContractResult {
  filtered: ToolResult
  stripped: string[]
  matched: boolean
}

const DEFAULT_CONTRACTS: Record<string, string[]> = {
  read_file: ['status', 'summary'],
  list_directory: ['status', 'summary'],
  search_files: ['status', 'summary'],
  search_content: ['status', 'summary'],
  create_file: ['status', 'summary'],
  edit_file: ['status', 'summary'],
  delete_file: ['status', 'summary'],
  rename_file: ['status', 'summary'],
  kb_list: ['status', 'summary'],
  kb_create_file: ['status', 'summary'],
  kb_append_file: ['status', 'summary'],
  kb_index_file: ['status', 'summary'],
  list_notes: ['status', 'summary'],
  read_note: ['status', 'summary'],
  write_note: ['status', 'summary'],
  append_note: ['status', 'summary'],
  delete_note: ['status', 'summary'],
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
