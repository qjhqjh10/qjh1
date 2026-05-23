/** Safely render a value that might be a string or an object (AI may generate nested JSON). */
export function safeStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') return JSON.stringify(v, null, 2)
  return ''
}
