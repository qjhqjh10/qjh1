/**
 * Safely parse AI-generated JSON that may contain trailing commas.
 *
 * Strategy: try direct parse first; on failure, progressively fix common issues:
 *   1. Trailing commas before } or ]  (the most common AI JSON error)
 *   2. Single quotes instead of double quotes（仅修复键值对的值位置，
 *      避免误伤双引号字符串内部的单引号，如 "it's"）
 *
 * 注：v13.x 修正——原注释声称的"第 3 步 unquoted property names"从未实现，已删除；
 * 单引号替换从 `'([^']*)'`（会误伤字符串内单引号）改为仅匹配 `: '...'` 形式。
 *
 * Returns the parsed object, or null if all attempts fail.
 */
export function safeJsonParse(text: string): unknown {
  // First, try to extract the first JSON object/array from the text
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return null

  const json = match[0]

  // Attempt 1: direct parse
  try {
    return JSON.parse(json)
  } catch {
    // continue to fix
  }

  // Attempt 2: remove trailing commas (most common AI mistake)
  try {
    const fixed = json.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']')
    return JSON.parse(fixed)
  } catch {
    // continue to fix
  }

  // Attempt 3: also fix single quotes（仅匹配键 `{ 'k':` / `, 'k':` 和值 `: 'v'` 形式，
  // 避免误伤双引号字符串内部的单引号，如 "it's"）
  try {
    let fixed = json.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']')
    // 单引号键：`{'k':` / `,'k':`
    fixed = fixed.replace(/([{,]\s*)'([^']*)'(\s*:)/g, (_, prefix, key, suffix) => {
      return `${prefix}"${key.replace(/"/g, '\\"')}"${suffix}`
    })
    // 单引号值：`: 'v'`
    fixed = fixed.replace(/(:\s*)'([^']*)'/g, (_, prefix, content) => {
      return `${prefix}"${content.replace(/"/g, '\\"')}"`
    })
    return JSON.parse(fixed)
  } catch {
    // give up
  }

  return null
}

/**
 * Convenience: safeJsonParse with type assertion.
 */
export function safeJsonParseAs<T>(text: string): T | null {
  const result = safeJsonParse(text)
  return result as T | null
}
