// ── Security Utilities ──
// Shared validation functions for path sanitization, URL validation, and command allowlisting.
// Single source of truth — tools should import from here rather than implementing inline checks.

/** Result of a security validation */
export interface ValidationResult {
  valid: boolean
  value: string
  error?: string
}

/** Remove path traversal sequences and separators from user-provided paths */
export function sanitizePath(input: unknown): ValidationResult {
  const raw = String(input ?? '').trim()
  if (!raw) return { valid: false, value: '', error: '路径不能为空' }
  // Strip traversal sequences
  let cleaned = raw.replace(/\.\./g, '').replace(/\\/g, '/')
  // Collapse multiple slashes
  cleaned = cleaned.replace(/\/{2,}/g, '/')
  // Remove leading slash (relative paths only)
  cleaned = cleaned.replace(/^\//, '')
  if (!cleaned) return { valid: false, value: '', error: '消毒后路径为空' }
  return { valid: true, value: cleaned }
}

/** Sanitize a filename (remove path separators entirely) */
export function sanitizeFileName(input: unknown): ValidationResult {
  const raw = String(input ?? '').trim()
  if (!raw) return { valid: false, value: '', error: '文件名不能为空' }
  const cleaned = raw.replace(/\.\./g, '').replace(/[/\\]/g, '_')
  return { valid: true, value: cleaned }
}

/**
 * Validate URL: check protocol (http/https only) and reject private/internal IPs.
 * This is regex-only SSRF check for the renderer process.
 * The main process ssrfGuard.ts provides Layer 2 DNS-based checks.
 */
export function validateUrl(raw: unknown): ValidationResult {
  const urlStr = String(raw ?? '').trim()
  if (!urlStr) return { valid: false, value: '', error: 'URL 不能为空' }
  let parsed: URL
  try { parsed = new URL(urlStr) } catch { return { valid: false, value: '', error: 'URL 格式无效' } }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, value: '', error: '仅支持 HTTP/HTTPS URL' }
  }
  const host = parsed.hostname.toLowerCase()
  // Block loopback
  if (['127.0.0.1', 'localhost', '0.0.0.0', '[::1]'].includes(host)) {
    return { valid: false, value: '', error: '禁止访问内网地址' }
  }
  // Block RFC 1918 + link-local
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) {
    return { valid: false, value: '', error: '禁止访问内网地址' }
  }
  return { valid: true, value: urlStr }
}

/**
 * Check if a shell command uses an allowed executable.
 * @param cmd Full command string (e.g., "git status")
 * @param allowed Set of permitted executables
 */
export function checkCommand(cmd: unknown, allowed: Set<string>): ValidationResult {
  const cmdStr = String(cmd ?? '').trim()
  if (!cmdStr) return { valid: false, value: '', error: '命令不能为空' }
  const firstWord = cmdStr.split(/\s+/)[0]?.toLowerCase()
  if (!firstWord) return { valid: false, value: '', error: '无法解析命令' }
  if (!allowed.has(firstWord)) {
    return { valid: false, value: '', error: `命令 "${firstWord}" 不在允许列表中（仅允许: ${[...allowed].join(', ')}）` }
  }
  return { valid: true, value: cmdStr }
}
