import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { isSafePath } from './utils'
import { logError } from './logger'

const PROJECT_DIRS = ['worldbuilding', 'characters', 'outline', 'detailed_outline', 'chapters']

let projectsBasePath = ''

export function registerProjectHandlers(ipcMain: IpcMain, basePath: string) {
  projectsBasePath = path.resolve(basePath)

  // Ensure projects directory exists
  fs.mkdir(projectsBasePath, { recursive: true }).catch(err => {
    logError(`项目目录创建失败: ${projectsBasePath}`, err)
  })

  ipcMain.handle('project:create', async (_event, name: string, _basePath: string, type: string = 'writing') => {
    if (!name || typeof name !== 'string' || name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid project name')
    }
    const projectPath = path.join(projectsBasePath, name)
    try {
      await fs.access(projectPath)
      throw new Error(`项目 "${name}" 已存在`)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === `项目 "${name}" 已存在`) throw err
      // ENOENT means directory doesn't exist, which is what we want
    }
    for (const dir of PROJECT_DIRS) {
      await fs.mkdir(path.join(projectPath, dir), { recursive: true })
    }
    const emptyOutline = JSON.stringify({ content: '', updatedAt: new Date().toISOString() }, null, 2)
    const emptyWorldbuilding = JSON.stringify({ content: '', updatedAt: new Date().toISOString() }, null, 2)
    await fs.writeFile(path.join(projectPath, 'worldbuilding', 'worldbuilding.json'), emptyWorldbuilding, 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'outline.json'), emptyOutline, 'utf-8')
    // Persist project type metadata
    const projectType = type === 'imitation' ? 'imitation' : type === 'continuation' ? 'continuation' : 'writing'
    await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify({ type: projectType }), 'utf-8')
  })

  ipcMain.handle('project:delete', async (_event, projectPath: string) => {
    if (!isSafePath(projectPath, projectsBasePath)) throw new Error('Access denied: path outside projects directory')
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  ipcMain.handle('project:getMeta', async (_event, projectPath: string) => {
    if (!isSafePath(projectPath, projectsBasePath)) throw new Error('Access denied: path outside projects directory')
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

    // Read project type metadata (default to 'writing' for legacy projects)
    let type: string = 'writing'
    try {
      const metaRaw = await fs.readFile(path.join(projectPath, 'project.json'), 'utf-8')
      const meta = JSON.parse(metaRaw)
      if (meta.type === 'imitation') type = 'imitation'
      else if (meta.type === 'continuation') type = 'continuation'
    } catch { /* no project.json, legacy project */ }

    return { name, chapterCount, wordCount: charCount, path: projectPath, type }
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
}
