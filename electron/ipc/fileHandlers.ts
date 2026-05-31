import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as chokidar from 'chokidar'
import { isSafePath } from './utils'

const pendingSaves = new Map<string, boolean>()
let onFileWrite: ((filePath: string, content: string) => void) | null = null
let projectsBasePath = ''

export function registerFileHandlers(
  ipcMain: IpcMain,
  onWrite?: (filePath: string, content: string) => void,
  basePath?: string,
): void {
  onFileWrite = onWrite || null
  if (basePath) projectsBasePath = basePath
  const globalNotesPath = path.join(path.dirname(projectsBasePath), 'notes')
  const globalSessionsPath = path.join(path.dirname(projectsBasePath), 'agent-sessions')
  const globalUploadsPath = path.join(path.dirname(projectsBasePath), 'uploads')
  const globalAppDataPath = path.join(path.dirname(projectsBasePath), '.appdata')
  // Normalize: strip leading slashes (AI sometimes generates /outline/plot.md)
  // and resolve relative to allowed directories. Must match safeResolve in fileToolHandlers.
  const normalizeSafe = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '')

  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

  // Resolve and validate a path: strips leading slashes, resolves relative to allowed dirs
  const resolvePath = (raw: string): string | null => {
    const cleaned = normalizeSafe(raw)
    const resolved = path.resolve(projectsBasePath, cleaned)
    if (isSafePath(resolved, projectsBasePath)
      || isSafePath(resolved, globalNotesPath)
      || isSafePath(resolved, globalSessionsPath)
      || isSafePath(resolved, globalUploadsPath)
      || isSafePath(resolved, globalAppDataPath)) {
      return resolved
    }
    return null
  }

  ipcMain.handle('files:read', async (_event, filePath: string) => {
    const resolved = resolvePath(filePath)
    if (!resolved) throw new Error('Access denied')
    try {
      const stat = await fs.stat(resolved)
      if (stat.size > MAX_FILE_SIZE) throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 50MB)`)
      return await fs.readFile(resolved, 'utf-8')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return ''  // File not found → return empty (callers check for empty)
      throw err  // Other errors (permission, lock) → propagate to caller
    }
  })

  ipcMain.handle('files:write', async (_event, filePath: string, content: string) => {
    const resolved = resolvePath(filePath)
    if (!resolved) throw new Error('Access denied')
    if (typeof content === 'string' && content.length > 10_000_000) throw new Error('Content too large (>10M chars)')
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    const normalizedPath = resolved.replace(/\\/g, '/')
    pendingSaves.set(normalizedPath, true)
    await fs.writeFile(resolved, content, 'utf-8')
    setTimeout(() => pendingSaves.delete(normalizedPath), 500)
    onFileWrite?.(resolved, content)
  })

  const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

  ipcMain.handle('files:readBinary', async (_event, filePath: string) => {
    const resolved = resolvePath(filePath)
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

  ipcMain.handle('files:writeBinary', async (_event, filePath: string, base64: string) => {
    const resolved = resolvePath(filePath)
    if (!resolved) throw new Error('Access denied')
    if (!base64 || base64.length > MAX_IMAGE_SIZE * 1.4) throw new Error('Image too large')
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    const buf = Buffer.from(base64, 'base64')
    await fs.writeFile(resolved, buf)
  })

  ipcMain.handle('files:saveImageUrl', async (_event, imageUrl: string, projectPath: string) => {
    const resolved = resolvePath(projectPath)
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

  ipcMain.handle('files:listDir', async (_event, dirPath: string) => {
    const resolved = resolvePath(dirPath)
    if (!resolved) throw new Error('Access denied')
    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true })
      return entries.map(e => e.name)
    } catch {
      return []
    }
  })

  ipcMain.handle('files:ensureDir', async (_event, dirPath: string) => {
    const resolved = resolvePath(dirPath)
    if (!resolved) throw new Error('Access denied')
    await fs.mkdir(resolved, { recursive: true })
  })

  ipcMain.handle('files:deleteFile', async (_event, filePath: string) => {
    const resolved = resolvePath(filePath)
    if (!resolved) throw new Error('Access denied')
    await fs.unlink(resolved)
  })

  ipcMain.handle('files:deleteDir', async (_event, dirPath: string) => {
    const resolved = resolvePath(dirPath)
    if (!resolved) throw new Error('Access denied')
    try {
      await fs.rm(resolved, { recursive: true, force: false })
    } catch (err: any) {
      // If some files are locked, try force mode as fallback and log it
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
    // Normalize Windows backslash paths for pendingSaves lookup
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


