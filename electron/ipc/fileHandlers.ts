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

  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

  ipcMain.handle('files:read', async (_event, filePath: string) => {
    if (!isSafePath(filePath, projectsBasePath)) throw new Error('Access denied')
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_FILE_SIZE) throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 50MB)`)
      return await fs.readFile(filePath, 'utf-8')
    } catch {
      return ''
    }
  })

  ipcMain.handle('files:write', async (_event, filePath: string, content: string) => {
    if (!isSafePath(filePath, projectsBasePath)) throw new Error('Access denied')
    if (typeof content === 'string' && content.length > 10_000_000) throw new Error('Content too large (>10M chars)')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    // Normalize to forward slashes for cross-platform consistency
    const normalizedPath = filePath.replace(/\\/g, '/')
    pendingSaves.set(normalizedPath, true)
    await fs.writeFile(filePath, content, 'utf-8')
    setTimeout(() => pendingSaves.delete(normalizedPath), 500)
    // onFileWrite callback is intentionally null (v3.1.0+ removed KB auto-indexing)
    // Knowledge base indexing is manual-only via KnowledgeBasePage "索引" button
    onFileWrite?.(filePath, content)
  })

  const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

  ipcMain.handle('files:readBinary', async (_event, filePath: string) => {
    if (!isSafePath(filePath, projectsBasePath)) throw new Error('Access denied')
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_IMAGE_SIZE) throw new Error('File too large')
      const buf = await fs.readFile(filePath)
      return buf.toString('base64')
    } catch { return '' }
  })

  ipcMain.handle('files:writeBinary', async (_event, filePath: string, base64: string) => {
    if (!isSafePath(filePath, projectsBasePath)) throw new Error('Access denied')
    if (!base64 || base64.length > MAX_IMAGE_SIZE * 1.4) throw new Error('Image too large')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const buf = Buffer.from(base64, 'base64')
    await fs.writeFile(filePath, buf)
  })

  ipcMain.handle('files:saveImageUrl', async (_event, imageUrl: string, projectPath: string) => {
    if (!isSafePath(projectPath, projectsBasePath)) throw new Error('Access denied')
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
      const imagesDir = path.join(projectPath, 'images')
      await fs.mkdir(imagesDir, { recursive: true })
      const ext = imageUrl.startsWith('data:image/') ? (imageUrl.split(';')[0]?.split('/')[1] || 'png') : 'jpg'
      const fileName = `img_${Date.now().toString(36)}.${ext}`
      const filePath = path.join(imagesDir, fileName)
      await fs.writeFile(filePath, buf)
      return fileName
    } catch { return '' }
  })

  ipcMain.handle('files:listDir', async (_event, dirPath: string) => {
    if (!isSafePath(dirPath, projectsBasePath)) throw new Error('Access denied')
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries.map(e => e.name)
    } catch {
      return []
    }
  })

  ipcMain.handle('files:ensureDir', async (_event, dirPath: string) => {
    if (!isSafePath(dirPath, projectsBasePath)) throw new Error('Access denied')
    await fs.mkdir(dirPath, { recursive: true })
  })

  ipcMain.handle('files:deleteFile', async (_event, filePath: string) => {
    if (!isSafePath(filePath, projectsBasePath)) throw new Error('Access denied')
    try {
      await fs.unlink(filePath)
    } catch { /* ignore */ }
  })

  ipcMain.handle('files:deleteDir', async (_event, dirPath: string) => {
    if (!isSafePath(dirPath, projectsBasePath)) throw new Error('Access denied')
    try {
      await fs.rm(dirPath, { recursive: true, force: true })
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
  })

  return watcher
}


