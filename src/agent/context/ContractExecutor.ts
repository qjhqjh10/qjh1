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
  kb_index_file:  ['status', 'summary', 'detail'],
  // v14.6.1: kb_search 契约缺失——完整原始结果无截断直灌上下文（20 段≈1 万字符）+ 每调必 warn
  kb_search:      ['status', 'summary', 'detail'],
  // v14.8: kb_analyze — 子代理分析总结（detail 由执行器按 8000 字符截断）
  kb_analyze:     ['status', 'summary', 'detail'],
  // ── v15: 子 agent 委托工具：detail 保留（执行器按 subagentTools MAX_DETAIL_CHARS 截断）──
  analyze_file:   ['status', 'summary', 'detail'],
  edit_file_task: ['status', 'summary', 'detail'],
  verify_task:    ['status', 'summary', 'detail'],  // v14.2.1: 验收报告 JSON
  subagent_ask:   ['status', 'summary', 'detail'],  // v14.3: 追问结果
  // ── Write tools: strip detail to stay lean ──
  // v14.6.1: create_file 保留 detail（handler 特意返回前 500 字预览供模型验证写入——
  // 原剥离使 v11.5.1 的"写入验证"设计失效，JSON/YAML 落盘内容模型永远看不到）
  create_file:    ['status', 'summary', 'detail'],
  edit_file:      ['status', 'summary'],
  batch_replace:  ['status', 'summary'],  // v9.5.3: write tool
  delete_file:    ['status', 'summary'],
  rename_file:    ['status', 'summary'],
  kb_append_file: ['status', 'summary'],
  // ── Search tools ──
  find_files:     ['status', 'summary', 'detail'],  // v9.5.3: read/search
  search_notes:   ['status', 'summary', 'detail'],  // v9.5.3: read
  // ── HTTP tools: 保留 detail（响应体）— v14.5.0: 原剥离导致模型永远看不到抓取内容，
  // 工具形同虚设；截断上限在 filterForContext（4000 字符，压缩器 70% 阈值仍兜底）──
  http_get:       ['status', 'summary', 'detail'],
  http_fetch:     ['status', 'summary', 'detail'],
  // ── Browser tools ──
  browser_open:   ['status', 'summary', 'detail'],
  browser_search: ['status', 'summary', 'detail'],
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
  // ── Harness tools ──
  // v14.6.1: think 工具已删除（v12.6.0）——死契约条目移除
  list_rules:     ['status', 'summary', 'detail'],
  tool_search:    ['status', 'summary', 'detail'],
  // lsp_diagnose, update_config, list_audit removed in v13.2.0
}

/** v14.5.0: HTTP/浏览器 4 工具的 detail（响应体）截断上限——对齐子代理 detail 量级 */
const HTTP_DETAIL_MAX_CHARS = 4000
const HTTP_BROWSER_TOOLS = new Set(['http_get', 'http_fetch', 'browser_open', 'browser_search'])
// v14.6.1: read_file detail 截断上限——handler 硬上限 50 万字符，单条 tool 消息直灌上下文
// 可达 30-40 万 token（128K 窗口直接爆掉；压缩器只做轮间兜底）。30K 覆盖常规章节全文，
// 超出后 AI 用 offset/limit 续读
const READ_FILE_DETAIL_MAX_CHARS = 30_000

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
    const contract = DEFAULT_CONTRACTS[toolName]
    if (!contract) {
      console.warn(`[ContractExecutor] 未知工具 "${toolName}" 无结果契约，完整返回原始结果`)
      return null
    }
    return contract
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
    // v14.5.0: HTTP/浏览器工具响应体保留但截断（原剥离 → 模型拿不到内容）
    // v14.6.1: read_file 同样截断（原 50 万字符无上限直灌）
    let finalFiltered = filtered
    if (HTTP_BROWSER_TOOLS.has(toolName)
        && typeof filtered.detail === 'string' && filtered.detail.length > HTTP_DETAIL_MAX_CHARS) {
      finalFiltered = { ...filtered, detail: filtered.detail.slice(0, HTTP_DETAIL_MAX_CHARS) + '\n…(已截断)' }
    } else if (toolName === 'read_file'
        && typeof filtered.detail === 'string' && filtered.detail.length > READ_FILE_DETAIL_MAX_CHARS) {
      finalFiltered = { ...filtered, detail: filtered.detail.slice(0, READ_FILE_DETAIL_MAX_CHARS) + `\n…(内容过长已截断至 ${READ_FILE_DETAIL_MAX_CHARS} 字符，可用 offset/limit 参数继续读取剩余部分)` }
    }
    if (stripped.length > 0) {
      return {
        resultForApi: finalFiltered,
        note: `已省略: ${stripped.join(', ')}`,
      }
    }
    return { resultForApi: finalFiltered }
  }
}
