// ── JSON 容错修复（v16.3.1 审计 D9 统一） ──
// 2026-08-11 审计: 原 4 处独立实现（chapterService.repairJson 5 策略 / schemaValidation.tryRepairJson
// 2 策略 / extractionService.jsonParsers / safeJsonParse），schemaValidation 注释自认 mirror 但
// 策略已与主实现脱节——主进程与渲染层对同一 AI 输出容错能力不一致。现收敛于此（含 fixJsonNewlines），
// 消费方从此处 import。新增修复策略时只需改本文件。
//
// 消费方与影响面（2026-08-11 审查结论）：渲染层 chapterService（解析 AI 生成的结构化文件）
// 与主进程 schemaValidation（落盘前校验）共用本实现——两端的语义同向（都要尽量容错解析
// AI 输出），修改本文件对两端都是"修复/增强"，不存在一方受益一方受害。
// ⚠️ 何时【应该拆开】：仅当两端容错策略需要真正分歧时（如主进程要"严格拒绝"而渲染层要
//   "尽量修复"）才拆为各自实现；拆分时请把 5 个策略逐一同步（或注明各自保留哪些策略）。
// 注意：本模块被主进程引用，禁止使用 '@' 别名导入（electron-vite main 构建不解析别名）。
import { safeJsonParse } from './safeJsonParse'

/** Fix unescaped newlines inside JSON string values. */
export function fixJsonNewlines(json: string): string {
  let result = ''
  let inString = false
  let i = 0
  while (i < json.length) {
    const ch = json[i]
    if (ch === '"' && (i === 0 || json[i - 1] !== '\\')) {
      inString = !inString
      result += ch
    } else if (inString && ch === '\n') {
      result += '\\n'
    } else if (inString && ch === '\r') {
      result += '\\r'
    } else if (inString && ch === '\t') {
      result += '\\t'
    } else {
      result += ch
    }
    i++
  }
  return result
}

/**
 * Attempt to repair AI-generated JSON that may have common issues:
 * - Unescaped newlines in string values
 * - Missing closing braces (truncation)
 * - Trailing commas before } or ]
 * Returns the repaired JSON string, or null if unrecoverable.
 */
export function repairJson(raw: string): string | null {
  // Strategy 1: try raw
  try { JSON.parse(raw); return raw } catch { /* continue */ }

  // Strategy 2: fix unescaped newlines
  const fixed = fixJsonNewlines(raw)
  try { JSON.parse(fixed); return fixed } catch { /* continue */ }

  // Strategy 3: auto-close missing braces (strip trailing comma first)
  const openBraces = (raw.match(/{/g) || []).length
  const closeBraces = (raw.match(/}/g) || []).length
  if (openBraces > closeBraces) {
    let closed = raw.trimEnd()
    closed = closed.replace(/,(\s*)$/, '$1')  // remove trailing comma before appending }
    closed += '\n' + '}'.repeat(openBraces - closeBraces)
    try { const f = fixJsonNewlines(closed); JSON.parse(f); return f } catch { /* continue */ }
  }

  // Strategy 4: try safeJsonParse utility (handles trailing commas + single quotes)
  try {
    const result = safeJsonParse(raw)
    if (result) return JSON.stringify(result, null, 2)
  } catch { /* continue */ }

  // Strategy 5: missing braces + trailing commas combined
  if (openBraces > closeBraces) {
    const both = raw.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']').trimEnd() + '\n' + '}'.repeat(openBraces - closeBraces)
    try { const f = fixJsonNewlines(both); JSON.parse(f); return f } catch { /* continue */ }
  }

  return null
}
