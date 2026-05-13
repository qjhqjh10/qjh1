import { IpcMain, app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'

const PROJECT_DIRS = ['worldbuilding', 'characters', 'outline', 'detailed_outline', 'chapters']

let projectsBasePath = ''

function isSafePath(inputPath: string): boolean {
  if (!inputPath || typeof inputPath !== 'string') return false
  const normalized = path.normalize(inputPath)
  const base = path.normalize(projectsBasePath)
  if (!base) return false
  // Must be within projectsBasePath
  return normalized.startsWith(base + path.sep) || normalized === base
}

export function registerProjectHandlers(ipcMain: IpcMain, basePath: string) {
  projectsBasePath = path.resolve(basePath)

  // Ensure projects directory exists
  fs.mkdir(projectsBasePath, { recursive: true }).catch(err => {
    console.error('Failed to create projects directory:', projectsBasePath, err.message)
  })

  ipcMain.handle('project:create', async (_event, name: string, _basePath: string) => {
    if (!name || typeof name !== 'string' || name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid project name')
    }
    const projectPath = path.join(projectsBasePath, name)
    for (const dir of PROJECT_DIRS) {
      await fs.mkdir(path.join(projectPath, dir), { recursive: true })
    }
    await fs.writeFile(path.join(projectPath, 'worldbuilding', 'worldbuilding.txt'), '', 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'outline.txt'), '', 'utf-8')
  })

  ipcMain.handle('project:delete', async (_event, projectPath: string) => {
    if (!isSafePath(projectPath)) throw new Error('Access denied: path outside projects directory')
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  ipcMain.handle('project:getMeta', async (_event, projectPath: string) => {
    if (!isSafePath(projectPath)) throw new Error('Access denied: path outside projects directory')
    const name = path.basename(projectPath)
    let chapterCount = 0
    let charCount = 0

    try {
      const chaptersDir = path.join(projectPath, 'chapters')
      const files = await fs.readdir(chaptersDir)
      const txtFiles = files.filter(f => f.endsWith('.txt'))
      chapterCount = txtFiles.length

      // Read files in parallel for performance
      const contents = await Promise.all(
        txtFiles.map(f => fs.readFile(path.join(chaptersDir, f), 'utf-8').catch(() => ''))
      )
      charCount = contents.reduce((sum, c) => sum + c.replace(/\s/g, '').length, 0)
    } catch { /* chapter dir might not exist yet */ }

    return { name, chapterCount, wordCount: charCount, path: projectPath }
  })

  ipcMain.handle('project:listProjects', async (_event, _basePath: string) => {
    try {
      const entries = await fs.readdir(projectsBasePath, { withFileTypes: true })
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      return []
    }
  })

  ipcMain.handle('app:getProjectsBasePath', async () => {
    return projectsBasePath
  })

  ipcMain.handle('app:getAppPath', async () => {
    return app.getAppPath()
  })
}
