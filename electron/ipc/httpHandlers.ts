// ── HTTP Handlers ──
// Execute HTTP requests on behalf of the Agent.
// Runs in Electron main process with full Node.js fetch access.
// Security: URL validation, size limits, private IP blocking (regex + DNS resolution).

import { IpcMain } from 'electron'
import { promises as dns } from 'dns'

const MAX_RESPONSE_SIZE = 500 * 1024 // 500KB
const REQUEST_TIMEOUT = 15_000 // 15s

// RFC 1918 + loopback + link-local CIDR blocks
const BLOCKED_IP_PATTERNS = [
  /^https?:\/\/127\.0\.0\./,
  /^https?:\/\/localhost/,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./, // 172.16-31.x.x
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/\[::1\]/,
]

function isPrivateIP(url: string): boolean {
  return BLOCKED_IP_PATTERNS.some(p => p.test(url))
}

// DNS-level SSRF protection — resolve hostname then check if IP is private
async function resolvesToPrivateIP(url: string): Promise<boolean> {
  try {
    const hostname = new URL(url).hostname
    // Skip resolution for IP literals (already caught by regex)
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return isPrivateIP(url)
    if (hostname === 'localhost' || hostname.startsWith('[')) return isPrivateIP(url)
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[])
    const privateRanges = [
      /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\.0\.0\.0$/,
    ]
    return addresses.some(ip => privateRanges.some(r => r.test(ip)))
  } catch {
    // If DNS fails, fall back to regex-only check
    return isPrivateIP(url)
  }
}

function sanitizeUrl(url: string): string {
  let u = url.trim()
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'https://' + u
  }
  return u
}

async function httpFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number } = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeout || REQUEST_TIMEOUT)

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: { 'User-Agent': 'AIWritingAssistant/1.0', ...options.headers },
      body: options.body || undefined,
      signal: controller.signal,
    })

    const resHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { resHeaders[k] = v })

    const text = await res.text()
    const truncated = text.length > MAX_RESPONSE_SIZE
      ? text.slice(0, MAX_RESPONSE_SIZE) + `\n\n... (截断 ${text.length - MAX_RESPONSE_SIZE} 字符)`
      : text

    return { status: res.status, body: truncated, headers: resHeaders }
  } finally {
    clearTimeout(timeout)
  }
}

export function registerHttpHandlers(ipcMain: IpcMain, config?: { allowPrivateIPs?: boolean }) {
  const allowPrivateIPs = config?.allowPrivateIPs ?? false

  ipcMain.handle('http:fetch', async (_event, url: string, options?: Record<string, unknown>) => {
    const cleanUrl = sanitizeUrl(String(url || ''))

    if (!/^https?:\/\//.test(cleanUrl)) {
      return { status: 'error', summary: `无效 URL: ${url}` }
    }

    if (!allowPrivateIPs && (isPrivateIP(cleanUrl) || await resolvesToPrivateIP(cleanUrl))) {
      return { status: 'error', summary: '禁止访问内网地址' }
    }

    try {
      const result = await httpFetch(cleanUrl, {
        method: String(options?.method || 'GET'),
        headers: (options?.headers as Record<string, string>) || {},
        body: options?.body as string | undefined,
      })
      return {
        status: 'success',
        summary: `HTTP ${result.status}: ${cleanUrl.slice(0, 60)}`,
        detail: result.body,
      }
    } catch (err) {
      return { status: 'error', summary: `HTTP 请求失败: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  })

  ipcMain.handle('http:get', async (_event, url: string) => {
    const cleanUrl = sanitizeUrl(String(url || ''))
    if (!/^https?:\/\//.test(cleanUrl)) {
      return { status: 'error', summary: `无效 URL: ${url}` }
    }
    if (!allowPrivateIPs && (isPrivateIP(cleanUrl) || await resolvesToPrivateIP(cleanUrl))) {
      return { status: 'error', summary: '禁止访问内网地址' }
    }
    try {
      const result = await httpFetch(cleanUrl, { method: 'GET' })
      return { status: 'success', summary: `HTTP ${result.status}: ${cleanUrl.slice(0, 60)}`, detail: result.body }
    } catch (err) {
      return { status: 'error', summary: `HTTP 请求失败: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  })
}
