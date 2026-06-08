import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as chokidar from 'chokidar'
import { isSafePath } from './utils'

const pendingSaves = new Map<string, boolean>()
let onFileWrite: ((filePath: string, content: string) => void) | null = null
let projectsBasePath = ''
let appRoot = ''

// ── System-critical directories (NEVER accessible — hard block) ──
const SYSTEM_BLOCKED = [
  'c:\\windows', 'c:\\system32', 'c:\\windows\\system32',
  '/dev/', '/etc/', '/usr/', '/bin/', '/sys/', '/proc/', '/boot/',
]

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
    const lowered = resolved.toLowerCase()
    for (const blocked of SYSTEM_BLOCKED) {
      if (lowered.startsWith(blocked)) return true
    }
    return false
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
    if (!imageUrl || (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:image/'))) throw new Error('Invalid URL')
    try {
      let buf: Buffer
      if (imageUrl.startsWith('data:image/')) {
        const base64 = imageUrl.split(',')[1] || ''
        buf = Buffer.from(base64, 'base64')
      } else {
        const res = await fetch(imageUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const arrayBuf = await res.arrayBuffer()
        if (arrayBuf.byteLength > MAX_IMAGE_SIZE) throw new Error('Image too large')
        buf = Buffer.from(arrayBuf)
      }
      const imagesDir = path.join(resolved, 'images')
      await fs.mkdir(imagesDir, { recursive: true })
      const ext = imageUrl.startsWith('data:image/') ? (imageUrl.split(';')[0]?.split('/')[1] || 'png') : 'jpg'
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
