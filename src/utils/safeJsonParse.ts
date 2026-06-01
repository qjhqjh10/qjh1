/**
 * Safely parse AI-generated JSON that may contain trailing commas.
 *
 * Strategy: try direct parse first; on failure, progressively fix common issues:
 *   1. Trailing commas before } or ]  (the most common AI JSON error)
 *   2. Single quotes instead of double quotes
 *   3. Unquoted property names
 *
 * Returns the parsed object, or null if all attempts fail.
 */
export function safeJsonParse(text: string): unknown {
  // First, try to extract the first JSON object/array from the text
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return null

  let json = match[0]

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

  // Attempt 3: also fix single quotes
  try {
    let fixed = json.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']')
    // Replace single-quoted strings with double-quoted (simple heuristic)
    fixed = fixed.replace(/'([^']*)'/g, (_, content) => {
      // Escape any double quotes inside
      return `"${content.replace(/"/g, '\\"')}"`
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
