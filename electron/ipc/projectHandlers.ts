import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { isSafePath } from './utils'
import { logError } from './logger'

const PROJECT_DIRS = ['characters', 'outline', 'detailed_outline', 'chapters', 'notes', 'covers', 'images']

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
    await fs.writeFile(path.join(projectPath, 'outline', 'worldbuilding.json'), emptyWorldbuilding, 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'outline.json'), emptyOutline, 'utf-8')
    // Persist project type metadata
    const projectType = type === 'imitation' ? 'imitation' : type === 'continuation' ? 'continuation' : 'writing'
    await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify({ type: projectType, novelCategory: 'general' }), 'utf-8')
  })

  ipcMain.handle('project:delete', async (_event, projectPath: string) => {
    if (!isSafePath(projectPath, projectsBasePath)) throw new Error('Access denied: path outside projects directory')
    // If continuation project, also clean up the continuation_projects/ JSON
    const projectName = path.basename(projectPath)
    const contPath = path.join(path.dirname(projectsBasePath), 'continuation_projects', `${projectName}.json`)
    try { await fs.unlink(contPath) } catch { /* may not exist */ }
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
    let novelCategory: string = 'general'
    let coverImage: string | undefined
    try {
      const metaRaw = await fs.readFile(path.join(projectPath, 'project.json'), 'utf-8')
      const meta = JSON.parse(metaRaw)
      if (meta.type === 'imitation') type = 'imitation'
      else if (meta.type === 'continuation') type = 'continuation'
      if (meta.novelCategory) novelCategory = meta.novelCategory
      if (meta.coverImage) coverImage = meta.coverImage
    } catch { /* no project.json, legacy project */ }

    return { name, chapterCount, wordCount: charCount, path: projectPath, type, novelCategory, coverImage }
  })

  ipcMain.handle('project:updateCategory', async (_event, projectPath: string, novelCategory: string) => {
    if (!isSafePath(projectPath, projectsBasePath)) throw new Error('Access denied')
    const metaPath = path.join(projectPath, 'project.json')
    let meta: Record<string, unknown> = {}
    try { meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) } catch { /* use defaults */ }
    meta.novelCategory = novelCategory
    await fs.writeFile(metaPath, JSON.stringify(meta), 'utf-8')
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

  ipcMain.handle('app:getStoryWorkspacePath', async () => {
    const { app } = await import('electron')
    return path.join(app.getPath('userData'), 'story_workspace')
  })

  // ====================== Project Import ======================

  ipcMain.handle('project:import', async (_event, zipPath: string) => {
    const fsSync = require('fs')
    const unzipper = require('unzipper')
    const os = require('os')

    if (!fsSync.existsSync(zipPath)) throw new Error('文件不存在')

    // Extract to temp directory
    const tmpDir = path.join(os.tmpdir(), `novel_import_${Date.now()}`)
    await new Promise<void>((resolve, reject) => {
      fsSync.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: tmpDir }))
        .on('close', resolve)
        .on('error', reject)
    })

    try {
      // Find project root (first directory that contains project.json)
      const entries = await fs.readdir(tmpDir, { withFileTypes: true })
      let projDir = tmpDir
      for (const e of entries) {
        if (e.isDirectory()) {
          try {
            await fs.access(path.join(tmpDir, e.name, 'project.json'))
            projDir = path.join(tmpDir, e.name)
            break
          } catch { /* not here */ }
        }
      }

      // Read project type
      let projType = 'writing'
      try {
        const meta = JSON.parse(await fs.readFile(path.join(projDir, 'project.json'), 'utf-8'))
        projType = meta.type || 'writing'
      } catch { /* legacy project without project.json */ }

      // Read or derive project name
      const projName = path.basename(projDir)

      // Check for name conflict
      const destPath = path.join(projectsBasePath, projName)
      let finalName = projName
      let suffix = 1
      while (true) {
        try { await fs.access(path.join(projectsBasePath, finalName)); finalName = `${projName}_${suffix++}` } catch { break }
      }
      const finalPath = path.join(projectsBasePath, finalName)

      // Copy project directory
      await copyDir(projDir, finalPath)

      // Ensure project.json reflects correct type
      await fs.writeFile(path.join(finalPath, 'project.json'), JSON.stringify({ type: projType }), 'utf-8')

      // Handle continuation project
      const contSrcDir = path.join(tmpDir, '_continuation')
      try {
        const contFiles = await fs.readdir(contSrcDir)
        const contDir = path.join(path.dirname(projectsBasePath), 'continuation_projects')
        await fs.mkdir(contDir, { recursive: true })
        for (const cf of contFiles) {
          const src = path.join(contSrcDir, cf)
          const basename = path.basename(cf)
          const newName = cf !== basename ? cf.replace(path.basename(cf, '.json'), finalName) + '.json' : cf
          await fs.copyFile(src, path.join(contDir, newName))
        }
      } catch { /* no continuation data */ }

      return { name: finalName, type: projType }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })
}

async function copyDir(src: string, dest: string): Promise<void> {
  const fs = await import('fs/promises')
  const path = await import('path')
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) {
      await copyDir(s, d)
    } else {
      await fs.copyFile(s, d)
    }
  }
}
