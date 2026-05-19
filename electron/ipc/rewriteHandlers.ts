import { IpcMain, app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'

function getRewritePath(): string {
  return path.join(app.getPath('userData'), 'rewrite_projects')
}

export function registerRewriteHandlers(ipcMain: IpcMain) {
  const basePath = getRewritePath()
  fs.mkdir(basePath, { recursive: true }).catch(() => {})
  fs.mkdir(path.join(basePath, 'chapters'), { recursive: true }).catch(() => {})

  ipcMain.handle('rewrite:list', async () => {
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true })
      const list: any[] = []
      for (const e of entries) {
        if (!e.isDirectory() || e.name === 'chapters') continue
        try {
          const meta = JSON.parse(await fs.readFile(path.join(basePath, e.name, 'meta.json'), 'utf-8'))
          list.push({ id: e.name, ...meta })
        } catch { /* skip */ }
      }
      return list.sort((a, b) => b.updatedAt?.localeCompare(a.updatedAt || '') || 0)
    } catch { return [] }
  })

  ipcMain.handle('rewrite:create', async (_event, name: string) => {
    const id = `rw_${Date.now()}`
    const dir = path.join(basePath, id)
    await fs.mkdir(dir, { recursive: true })
    await fs.mkdir(path.join(dir, 'chapters'), { recursive: true })
    const meta = { name, chapterCount: 0, charCount: 0, analyzedCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    return { id, ...meta }
  })

  ipcMain.handle('rewrite:readMeta', async (_event, id: string) => {
    try { return JSON.parse(await fs.readFile(path.join(basePath, id, 'meta.json'), 'utf-8')) } catch { return null }
  })

  ipcMain.handle('rewrite:saveMeta', async (_event, id: string, meta: any) => {
    await fs.writeFile(path.join(basePath, id, 'meta.json'), JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2))
  })

  ipcMain.handle('rewrite:readChapter', async (_event, id: string, chId: string) => {
    try { return await fs.readFile(path.join(basePath, id, 'chapters', `${chId}.txt`), 'utf-8') } catch { return '' }
  })

  ipcMain.handle('rewrite:writeChapter', async (_event, id: string, chId: string, content: string) => {
    await fs.writeFile(path.join(basePath, id, 'chapters', `${chId}.txt`), content, 'utf-8')
  })

  ipcMain.handle('rewrite:readAnalysis', async (_event, id: string, chId: string) => {
    try { return await fs.readFile(path.join(basePath, id, 'analysis', `${chId}.json`), 'utf-8') } catch { return '' }
  })

  ipcMain.handle('rewrite:writeAnalysis', async (_event, id: string, chId: string, content: string) => {
    await fs.mkdir(path.join(basePath, id, 'analysis'), { recursive: true })
    await fs.writeFile(path.join(basePath, id, 'analysis', `${chId}.json`), content, 'utf-8')
  })

  ipcMain.handle('rewrite:delete', async (_event, id: string) => {
    await fs.rm(path.join(basePath, id), { recursive: true, force: true })
  })
}
