import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { isSafePath } from './utils'

function sanitizeId(id: string): string {
  return String(id || '').replace(/\.\./g, '').replace(/[\\/]/g, '').slice(0, 64)
}

function getStoryPath(): string {
  return path.join(app.getPath('userData'), 'story_analyses')
}

function safeJoin(base: string, ...segments: string[]): string {
  const p = path.join(base, ...segments.map(sanitizeId))
  if (!isSafePath(p, base)) throw new Error('Access denied')
  return p
}

export function registerStoryHandlers(ipcMain: IpcMain) {
  const basePath = getStoryPath()
  fs.mkdir(basePath, { recursive: true }).catch(() => {})

  // List all saved analyses
  ipcMain.handle('story:list', async () => {
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true })
      const list: any[] = []
      for (const e of entries) {
        if (!e.isDirectory()) continue
        try {
          const meta = JSON.parse(await fs.readFile(path.join(basePath, e.name, 'meta.json'), 'utf-8'))
          list.push({ id: e.name, ...meta })
        } catch { /* skip invalid */ }
      }
      return list.sort((a, b) => b.updatedAt?.localeCompare(a.updatedAt || '') || 0)
    } catch { return [] }
  })

  // Create new analysis session
  ipcMain.handle('story:create', async (_event, name: string) => {
    const id = `sa_${Date.now()}`
    const dir = path.join(basePath, id)
    await fs.mkdir(dir, { recursive: true })
    await fs.mkdir(path.join(dir, 'chapters'), { recursive: true })
    await fs.mkdir(path.join(dir, 'analysis'), { recursive: true })
    const meta = { name, chapterCount: 0, conflictCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    return { id, ...meta }
  })

  // Read meta
  ipcMain.handle('story:readMeta', async (_event, id: string) => {
    try {
      return JSON.parse(await fs.readFile(safeJoin(basePath, id, 'meta.json'), 'utf-8'))
    } catch { return null }
  })

  // Save meta
  ipcMain.handle('story:saveMeta', async (_event, id: string, meta: any) => {
    await fs.writeFile(safeJoin(basePath, id, 'meta.json'), JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2))
  })

  // Read chapter
  ipcMain.handle('story:readChapter', async (_event, id: string, chapterId: string) => {
    try {
      return await fs.readFile(safeJoin(basePath, id, 'chapters', `${sanitizeId(chapterId)}.txt`), 'utf-8')
    } catch { return '' }
  })

  // Write chapter
  ipcMain.handle('story:writeChapter', async (_event, id: string, chapterId: string, content: string) => {
    await fs.writeFile(safeJoin(basePath, id, 'chapters', `${sanitizeId(chapterId)}.txt`), content, 'utf-8')
  })

  // Read analysis result
  ipcMain.handle('story:readAnalysis', async (_event, id: string, chapterId: string) => {
    try {
      return await fs.readFile(safeJoin(basePath, id, 'analysis', `${sanitizeId(chapterId)}.json`), 'utf-8')
    } catch { return '' }
  })

  // Write analysis result
  ipcMain.handle('story:writeAnalysis', async (_event, id: string, chapterId: string, content: string) => {
    await fs.writeFile(safeJoin(basePath, id, 'analysis', `${sanitizeId(chapterId)}.json`), content, 'utf-8')
  })

  // Read graph
  ipcMain.handle('story:readGraph', async (_event, id: string) => {
    try {
      return await fs.readFile(safeJoin(basePath, id, 'graph.json'), 'utf-8')
    } catch { return '{}' }
  })

  // Write graph
  ipcMain.handle('story:writeGraph', async (_event, id: string, content: string) => {
    await fs.writeFile(safeJoin(basePath, id, 'graph.json'), content, 'utf-8')
  })

  // Delete analysis
  ipcMain.handle('story:delete', async (_event, id: string) => {
    await fs.rm(safeJoin(basePath, id), { recursive: true, force: true })
  })
}
