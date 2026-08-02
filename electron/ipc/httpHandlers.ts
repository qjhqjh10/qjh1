// ── HTTP Handlers ──
// Execute HTTP requests on behalf of the Agent.
// Runs in Electron main process with full Node.js fetch access.
// Security: URL validation, size limits, private IP blocking (regex + DNS resolution).

import { IpcMain } from 'electron'
import { isPrivateIP, resolvesToPrivateIP, sanitizeUrl } from './ssrfGuard'

const MAX_RESPONSE_SIZE = 500 * 1024 // 500KB
const REQUEST_TIMEOUT = 15_000 // 15s

async function httpFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number; allowPrivateIPs?: boolean } = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeout || REQUEST_TIMEOUT)
  const allowPrivateIPs = options.allowPrivateIPs ?? false

  try {
    let current = url
    // v14.5.1: 手动跟踪重定向——原实现 fetch 默认跟随，跳转后不复查 SSRF（公网 302 → 内网/元数据可被访问）。
    // 现在逐跳校验目标（sanitizeUrl + 私网 IP 检查），最多 3 跳。
    for (let hop = 0; hop <= 3; hop++) {
      const res = await fetch(current, {
        method: options.method || 'GET',
        headers: { 'User-Agent': 'AIWritingAssistant/1.0', ...options.headers },
        body: options.body || undefined,
        signal: controller.signal,
        redirect: 'manual',
      })

      // Redirect → 复查目标后继续
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const nextRaw = new URL(res.headers.get('location')!, new URL(current)).toString()
        const next = sanitizeUrl(nextRaw)
        if (!/^https?:\/\//.test(next) || (!allowPrivateIPs && (isPrivateIP(next) || await resolvesToPrivateIP(next)))) {
          return {
            status: res.status,
            body: `(重定向目标被拦截: ${next.slice(0, 60)})`,
            headers: { location: next },
          }
        }
        current = next
        continue
      }

      const resHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { resHeaders[k] = v })

      const text = await res.text()
      const truncated = text.length > MAX_RESPONSE_SIZE
        ? text.slice(0, MAX_RESPONSE_SIZE) + `\n\n... (截断 ${text.length - MAX_RESPONSE_SIZE} 字符)`
        : text

      return { status: res.status, body: truncated, headers: resHeaders }
    }
    return { status: 599, body: '重定向次数过多（超过 3 跳）', headers: {} }
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
        allowPrivateIPs,
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
      const result = await httpFetch(cleanUrl, { method: 'GET', allowPrivateIPs })
      return { status: 'success', summary: `HTTP ${result.status}: ${cleanUrl.slice(0, 60)}`, detail: result.body }
    } catch (err) {
      return { status: 'error', summary: `HTTP 请求失败: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  })
}
