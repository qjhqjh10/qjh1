import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as chokidar from 'chokidar'
import { isPrivateIP, resolvesToPrivateIP } from './ssrfGuard'
import { isBlockedSystemPath } from './pathResolution'
import { netFetch } from './netFetch'  // v14.6.1: 系统代理/证书

const pendingSaves = new Map<string, boolean>()
let onFileWrite: ((filePath: string, content: string) => void) | null = null
let projectsBasePath = ''
let appRoot = ''

// ── H8: saveImageUrl 防护常量 ──
const IMAGE_FETCH_TIMEOUT = 15_000
const MAX_REDIRECTS = 3

const MIME_EXT_MAP: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/ico': 'ico',
}

/** data:image MIME → 扩展名（拒绝非白名单，未知回退 png） */
export function mimeToExt(mime: string): string {
  return MIME_EXT_MAP[mime] || 'png'
}

/** 解析 data:image/*;base64, URL（base64 段必须非空），格式不符返回 null */
export function parseDataImageUrl(url: string): { mime: string; base64: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url)
  if (!m || !m[2]) return null
  return { mime: m[1], base64: m[2] }
}

/** H8: 远程图片 URL 校验 — http(s) 白名单 + 私网/内网拦截（SSRF）。非法返回 false。
 *  注意：先校验原始输入协议再 URL 解析归一化——sanitizeUrl 会把 ftp:// 等补成伪 https:// 前缀，
 *  直接对它做协议白名单会被绕过；new URL 失败（无效输入）一律拒绝。 */
export async function validateRemoteImageUrl(url: string): Promise<boolean> {
  try {
    const trimmed = url.trim()
    if (!/^https?:\/\//i.test(trimmed)) return false
    const parsed = new URL(trimmed) // 无效输入抛错 → false
    const normalized = parsed.toString() // 归一化（hostname 小写）后私网检查
    if (isPrivateIP(normalized)) return false
    if (await resolvesToPrivateIP(normalized)) return false
    return true
  } catch {
    return false
  }
}

// ── System-critical directories (NEVER accessible — hard block) ──
// v14.6.1: 统一到 pathResolution.isBlockedSystemPath（任意盘符 + POSIX），
// 原 SYSTEM_BLOCKED 仅拦 C: 盘——分享给他人时其 Windows 可能装在 D:/E: 盘。

// ── App-internal write-protected dirs (read OK, write forbidden) ──
const WRITE_PROTECTED_DIRS = ['node_modules', '.git', 'dist', 'release', '.git/']

export function registerFileHandlers(
  ipcMain: IpcMain,
  onWrite?: (filePath: string, content: string) => void,
  basePath?: string,
): void {
  onFileWrite = onWrite || null
  if (basePath) projectsBasePath = basePath
  appRoot = path.dirname(projectsBasePath)

  const normalizeSafe = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '')

  const MAX_FILE_SIZE = 50 * 1024 * 1024       // 50MB
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024      // 10MB

  /** Check if a resolved path is write-protected (app-internal dangerous dirs) */
  function isWriteProtected(resolved: string): boolean {
    const rel = path.relative(appRoot, resolved).replace(/\\/g, '/')
    for (const blocked of WRITE_PROTECTED_DIRS) {
      if (rel === blocked || rel.startsWith(blocked + '/')) return true
    }
    return false
  }

  /** Check if a path is in a system-critical directory */
  function isSystemBlocked(resolved: string): boolean {
    return isBlockedSystemPath(resolved)
  }

  /** Unified path resolution: app-relative → absolute, or absolute path as-is.
   *  Returns null only for system-critical dirs. All other paths allowed. */
  function resolveAnyPath(raw: string): string | null {
    let cleaned = normalizeSafe(raw)
    // Handle ../ prefix → navigate up from appRoot
    let depth = 0
    while (cleaned.startsWith('../')) { cleaned = cleaned.slice(3); depth++ }
    // Handle absolute paths
    if (path.isAbsolute(cleaned)) {
      const resolved = path.resolve(cleaned)
      if (isSystemBlocked(resolved)) return null
      return resolved
    }
    // Relative path: resolve against appRoot
    const resolved = path.resolve(appRoot, cleaned)
    // Don't let ../ escape above appRoot unless depth > appRoot depth
    if (isSystemBlocked(resolved)) return null
    return resolved
  }

  /** Like resolveAnyPath but additionally blocks write-protected app dirs */
  function resolveWritePath(raw: string): string | null {
    const resolved = resolveAnyPath(raw)
    if (!resolved) return null
    if (isWriteProtected(resolved)) return null
    return resolved
  }

  // ═══════════════════════════════════════════════
  // READ handlers (full system access, AUTO permission)
  // ═══════════════════════════════════════════════

  ipcMain.handle('files:read', async (_event, filePath: string) => {
    const resolved = resolveAnyPath(filePath)
    if (!resolved) throw new Error('Access denied: system directory')
    try {
      const stat = await fs.stat(resolved)
      if (stat.size > MAX_FILE_SIZE) throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 50MB)`)
      return await fs.readFile(resolved, 'utf-8')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return ''
      throw err
    }
  })

  ipcMain.handle('files:listDir', async (_event, dirPath: string) => {
    const resolved = resolveAnyPath(dirPath)
    if (!resolved) throw new Error('Access denied: system directory')
    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true })
      return entries.map(e => e.name)
    } catch {
      return []
    }
  })

  ipcMain.handle('files:readBinary', async (_event, filePath: string) => {
    const resolved = resolveAnyPath(filePath)
    if (!resolved) throw new Error('Access denied')
    try {
      const stat = await fs.stat(resolved)
      if (stat.size > MAX_IMAGE_SIZE) throw new Error('File too large')
      const buf = await fs.readFile(resolved)
      return buf.toString('base64')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return ''
      console.error('[fileHandlers] readBinary failed:', resolved, err)
      return ''
    }
  })

  // ═══════════════════════════════════════════════
  // WRITE handlers (system-wide, READ_ASK permission, blocked: system + write-protected app dirs)
  // ═══════════════════════════════════════════════

  ipcMain.handle('files:write', async (_event, filePath: string, content: string) => {
    const resolved = resolveWritePath(filePath)
    if (!resolved) throw new Error('Access denied: system or write-protected directory')
    if (typeof content === 'string' && content.length > 10_000_000) throw new Error('Content too large (>10M chars)')
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    const normalizedPath = resolved.replace(/\\/g, '/')
    pendingSaves.set(normalizedPath, true)
    await fs.writeFile(resolved, content, 'utf-8')
    setTimeout(() => pendingSaves.delete(normalizedPath), 500)
    onFileWrite?.(resolved, content)
  })

  ipcMain.handle('files:writeBinary', async (_event, filePath: string, base64: string) => {
    const resolved = resolveWritePath(filePath)
    if (!resolved) throw new Error('Access denied: system or write-protected directory')
    if (!base64 || base64.length > MAX_IMAGE_SIZE * 1.4) throw new Error('Image too large')
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    const buf = Buffer.from(base64, 'base64')
    await fs.writeFile(resolved, buf)
  })

  ipcMain.handle('files:saveImageUrl', async (_event, imageUrl: string, projectPath: string) => {
    const resolved = resolveWritePath(projectPath)
    if (!resolved) throw new Error('Access denied')
    if (!imageUrl) throw new Error('Invalid URL')
    try {
      let buf: Buffer | undefined
      let ext = 'jpg'
      if (imageUrl.startsWith('data:image/')) {
        // H8: data URL — 格式校验（必须 base64 且非空）+ 解码前大小校验（同 writeBinary 系数）
        const parsed = parseDataImageUrl(imageUrl)
        if (!parsed) throw new Error('Invalid data URL')
        if (parsed.base64.length > MAX_IMAGE_SIZE * 1.4) throw new Error('Image too large')
        buf = Buffer.from(parsed.base64, 'base64')
        ext = mimeToExt(parsed.mime)
      } else {
        // H8: http(s) URL — SSRF 防护（协议白名单 + 私网拦截）+ 15s 超时 + redirect 逐跳校验
        if (!(await validateRemoteImageUrl(imageUrl))) throw new Error('URL not allowed')
        let currentUrl = imageUrl
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
          const controller = new AbortController()
          // 超时覆盖 fetch 头 + 整个响应体读取（防"头秒回、体无限慢"挂死 IPC）
          const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT)
          try {
            const res = await netFetch(currentUrl, { redirect: 'manual', signal: controller.signal })  // v14.6.1: 系统代理/证书
            if (res.status >= 300 && res.status < 400) {
              await res.body?.cancel().catch(() => {})
              if (hop === MAX_REDIRECTS) throw new Error('Too many redirects')
              const loc = res.headers.get('location')
              if (!loc) throw new Error('Redirect without location')
              const next = new URL(loc, currentUrl).toString()
              if (!(await validateRemoteImageUrl(next))) throw new Error('URL not allowed')
              currentUrl = next
              continue
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            if (!res.body) throw new Error('No response body')
            // 流式读取：边读边累计，超限立即中断（避免整包缓冲进内存后才发现超限）
            const chunks: Uint8Array[] = []
            let total = 0
            const reader = res.body.getReader()
            for (;;) {
              if (controller.signal.aborted) throw new Error('Fetch timeout')
              const { done, value } = await reader.read()
              if (done) break
              total += value.byteLength
              if (total > MAX_IMAGE_SIZE) {
                await reader.cancel().catch(() => {})
                throw new Error('Image too large')
              }
              chunks.push(value)
            }
            buf = Buffer.concat(chunks)
            break
          } finally {
            clearTimeout(timer)
          }
        }
        if (!buf) throw new Error('Fetch failed')
      }
      const imagesDir = path.join(resolved, 'images')
      await fs.mkdir(imagesDir, { recursive: true })
      const fileName = `img_${Date.now().toString(36)}.${ext}`
      const fp = path.join(imagesDir, fileName)
      await fs.writeFile(fp, buf)
      return fileName
    } catch { return '' }
  })

  ipcMain.handle('files:ensureDir', async (_event, dirPath: string) => {
    const resolved = resolveWritePath(dirPath)
    if (!resolved) throw new Error('Access denied: system or write-protected directory')
    await fs.mkdir(resolved, { recursive: true })
  })

  ipcMain.handle('files:deleteFile', async (_event, filePath: string) => {
    const resolved = resolveWritePath(filePath)
    if (!resolved) throw new Error('Access denied: system or write-protected directory')
    try { await fs.unlink(resolved) } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e  // 文件不存在=已删除，不报错
    }
  })

  ipcMain.handle('files:deleteDir', async (_event, dirPath: string) => {
    const resolved = resolveWritePath(dirPath)
    if (!resolved) throw new Error('Access denied: system or write-protected directory')
    try {
      await fs.rm(resolved, { recursive: true, force: false })
    } catch (err: any) {
      if (err?.code === 'EBUSY' || err?.code === 'EPERM') {
        console.warn('[fileHandlers] deleteDir partial failure, using force:', resolved, err)
        await fs.rm(resolved, { recursive: true, force: true })
      } else {
        throw err
      }
    }
  })
}

export function setupFileWatcher(
  projectsPath: string,
  sendToRenderer: (channel: string, data: unknown) => void
): chokidar.FSWatcher {
  const watcher = chokidar.watch(projectsPath, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
    depth: 5,
  })

  watcher.on('change', async (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/')
    if (pendingSaves.has(normalizedPath)) return
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      sendToRenderer('files:external-change', { path: normalizedPath, content })
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn('[fileHandlers] watcher failed to read changed file:', normalizedPath, err)
      }
    }
  })

  return watcher
}
