import { IpcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { NovelExtraction } from '../../src/types/story'

let basePath = ''

export function registerExtractionHandlers(ipcMain: IpcMain, extractionsPath: string) {
  basePath = extractionsPath

  ipcMain.handle('extraction:importFile', async () => {
    const wins = BrowserWindow.getAllWindows()
    const result = await dialog.showOpenDialog(wins[0], {
      title: '导入TXT小说',
      filters: [{ name: '文本文件', extensions: ['txt'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const content = await fs.readFile(filePath, 'utf-8')
    if (!content || content.trim().length === 0) throw new Error('文件为空')
    return { name: path.basename(filePath), content }
  })

  ipcMain.handle('extraction:listProjects', async () => {
    await fs.mkdir(basePath, { recursive: true })
    const entries = await fs.readdir(basePath, { withFileTypes: true })
    const projects: { id: string; name: string; chapterCount: number; status: string; createdAt: string }[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(basePath, entry.name), 'utf-8')
        const proj = JSON.parse(raw) as NovelExtraction
        projects.push({
          id: proj.id, name: proj.novelName,
          chapterCount: proj.chapters.length, status: proj.status,
          createdAt: proj.createdAt,
        })
      } catch { /* skip invalid */ }
    }
    return projects
  })

  ipcMain.handle('extraction:loadProject', async (_event, projectId: string) => {
    const raw = await fs.readFile(path.join(basePath, `${projectId}.json`), 'utf-8')
    return JSON.parse(raw) as NovelExtraction
  })

  ipcMain.handle('extraction:saveProject', async (_event, project: NovelExtraction) => {
    await fs.mkdir(basePath, { recursive: true })
    project.updatedAt = new Date().toISOString()
    await fs.writeFile(path.join(basePath, `${project.id}.json`), JSON.stringify(project, null, 2), 'utf-8')
  })

  ipcMain.handle('extraction:deleteProject', async (_event, projectId: string) => {
    await fs.unlink(path.join(basePath, `${projectId}.json`)).catch(() => {})
  })
}
