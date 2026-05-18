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

  ipcMain.handle('files:read', async (_event, filePath: string) => {
    if (!isSafePath(filePath, projectsBasePath)) throw new Error('Access denied')
    try {
      await fs.access(filePath)
      return await fs.readFile(filePath, 'utf-8')
    } catch {
      return ''
    }
  })

  ipcMain.handle('files:write', async (_event, filePath: string, content: string) => {
    if (!isSafePath(filePath, projectsBasePath)) throw new Error('Access denied')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    // Normalize to forward slashes for cross-platform consistency
    const normalizedPath = filePath.replace(/\\/g, '/')
    pendingSaves.set(normalizedPath, true)
    await fs.writeFile(filePath, content, 'utf-8')
    setTimeout(() => pendingSaves.delete(normalizedPath), 500)
    // Emit event for KB auto-index (debounced per file)
    onFileWrite?.(filePath, content)
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


