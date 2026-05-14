import { IpcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { StyleProject, StyleProjectMeta } from '../../src/types/story'

let basePath = ''

export function registerStyleHandlers(ipcMain: IpcMain, styleProjectsPath: string) {
  basePath = styleProjectsPath

  // Import TXT file: open dialog, read content
  ipcMain.handle('style:importFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '导入TXT小说',
          filters: [{ name: '文本文件', extensions: ['txt'] }],
          properties: ['openFile'],
        })
      : await dialog.showOpenDialog({
          title: '导入TXT小说',
          filters: [{ name: '文本文件', extensions: ['txt'] }],
          properties: ['openFile'],
        })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const content = await fs.readFile(filePath, 'utf-8')
    if (!content || content.trim().length === 0) throw new Error('文件为空')
    return {
      name: path.basename(filePath),
      content,
    }
  })

  // List all style projects (metadata only, no chapter content)
  ipcMain.handle('style:listProjects', async () => {
    await fs.mkdir(basePath, { recursive: true })
    const entries = await fs.readdir(basePath, { withFileTypes: true })
    const projects: StyleProjectMeta[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const raw = await fs.readFile(path.join(basePath, entry.name, 'project.json'), 'utf-8')
        const proj: StyleProject = JSON.parse(raw)
        projects.push({
          id: proj.id, name: proj.name, sourceFileName: proj.sourceFileName,
          chapterCount: proj.chapters.length, totalCharCount: proj.totalCharCount,
          hasProfile: proj.profile !== null, createdAt: proj.createdAt,
          novelType: proj.novelType || '通用',
        })
      } catch { /* skip invalid */ }
    }
    return projects
  })

  // Load full project
  ipcMain.handle('style:loadProject', async (_event, projectId: string) => {
    const raw = await fs.readFile(path.join(basePath, projectId, 'project.json'), 'utf-8')
    return JSON.parse(raw) as StyleProject
  })

  // Save project
  ipcMain.handle('style:saveProject', async (_event, project: StyleProject) => {
    const dir = path.join(basePath, project.id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8')
  })

  // Delete project
  ipcMain.handle('style:deleteProject', async (_event, projectId: string) => {
    const dir = path.join(basePath, projectId)
    await fs.rm(dir, { recursive: true, force: true })
  })
}
