import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as os from 'os'
import * as path from 'path'
import { isSafePath } from './utils'
import { logError } from './logger'

const PROJECT_DIRS = ['characters', 'outline', 'detailed_outline', 'chapters', 'covers', 'images', 'summaries']

let writingProjectsPath = ''
let imitationProjectsPath = ''
let continuationProjectDirsPath = ''

/** Resolve the target base path for a project type. */
function getPathForType(type: string): string {
  if (type === 'imitation') return imitationProjectsPath
  if (type === 'continuation') return continuationProjectDirsPath
  return writingProjectsPath
}

/** Check if a projectPath is safe under any of the three base dirs. */
function isSafeUnderAny(projectPath: string): boolean {
  return isSafePath(projectPath, writingProjectsPath) ||
    isSafePath(projectPath, imitationProjectsPath) ||
    isSafePath(projectPath, continuationProjectDirsPath)
}

export function registerProjectHandlers(
  ipcMain: IpcMain,
  basePath: string,
  imitationPath: string,
  continuationDirsPath: string,
) {
  writingProjectsPath = path.resolve(basePath)
  imitationProjectsPath = path.resolve(imitationPath)
  continuationProjectDirsPath = path.resolve(continuationDirsPath)

  // Ensure all project directories exist
  for (const p of [writingProjectsPath, imitationProjectsPath, continuationProjectDirsPath]) {
    fs.mkdir(p, { recursive: true }).catch(err => {
      logError(`项目目录创建失败: ${p}`, err)
    })
  }

  ipcMain.handle('project:create', async (_event, name: string, _basePath: string, type: string = 'writing') => {
    if (!name || typeof name !== 'string' || name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid project name')
    }
    const targetPath = getPathForType(type)
    const projectPath = path.join(targetPath, name)
    try {
      await fs.access(projectPath)
      throw new Error(`项目 "${name}" 已存在`)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === `项目 "${name}" 已存在`) throw err
    }
    for (const dir of PROJECT_DIRS) {
      await fs.mkdir(path.join(projectPath, dir), { recursive: true })
    }
    // Create outline tab files
    await fs.writeFile(path.join(projectPath, 'outline', 'plot.md'), '', 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'worldbuilding.md'), '', 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'items.yaml'), 'items:\n  # - id: example\n  #   name: 示例道具\n  #   type: 武器\n  #   grade: 凡品\n  #   owner: 角色名\n', 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'locations.yaml'), 'locations:\n  # - id: example\n  #   name: 示例地点\n  #   description: 描述\n  #   type: 宗门\n', 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'factions.yaml'), 'factions:\n  # - id: example\n  #   name: 示例势力\n  #   description: 描述\n  #   type: 宗门内斗势力\n', 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'power_system.yaml'), 'name: 修炼体系\nlevels:\n  # - name: 示例境界\n  #   description: 描述\n', 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'outline_meta.yaml'), 'foreshadowing:\n  # - id: f1\n  #   description: 伏笔描述\n  #   chapterIntroduced: 1\n  #   chapterResolved: \'\'\nplotThreads:\n  # - id: t1\n  #   name: 主线\n  #   description: 描述\n', 'utf-8')
    await fs.writeFile(path.join(projectPath, 'outline', 'emotion.yaml'), 'segments:\n  # - chapterStart: 1\n  #   chapterEnd: 3\n  #   dominantEmotion: 情绪\n', 'utf-8')
    const projectType = type === 'imitation' ? 'imitation' : type === 'continuation' ? 'continuation' : 'writing'
    await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify({ type: projectType, novelCategory: 'general' }), 'utf-8')
  })

  ipcMain.handle('project:delete', async (_event, projectPath: string, type?: string) => {
    // If type provided, check against specific path; otherwise check all
    if (type) {
      const basePath = getPathForType(type)
      if (!isSafePath(projectPath, basePath)) throw new Error('Access denied: path outside projects directory')
    } else if (!isSafeUnderAny(projectPath)) {
      throw new Error('Access denied: path outside projects directory')
    }
    const projectName = path.basename(projectPath)
    const parentDir = path.dirname(writingProjectsPath)
    // Clean up continuation JSON if it exists
    const contPath = path.join(parentDir, 'continuation_projects', `${projectName}.json`)
    try { await fs.unlink(contPath) } catch { /* may not exist */ }
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  ipcMain.handle('project:getMeta', async (_event, projectPath: string) => {
    if (!isSafeUnderAny(projectPath)) throw new Error('Access denied: path outside projects directory')
    const name = path.basename(projectPath)
    let chapterCount = 0
    let charCount = 0

    try {
      const chaptersDir = path.join(projectPath, 'chapters')
      const files = await fs.readdir(chaptersDir)
      const txtFiles = files.filter(f => f.endsWith('.txt'))
      chapterCount = txtFiles.length
      const contents = await Promise.all(
        txtFiles.map(f => fs.readFile(path.join(chaptersDir, f), 'utf-8').catch(() => ''))
      )
      charCount = contents.reduce((sum, c) => sum + c.replace(/\s/g, '').length, 0)
    } catch { /* chapter dir might not exist yet */ }

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
    if (!isSafeUnderAny(projectPath)) throw new Error('Access denied')
    const metaPath = path.join(projectPath, 'project.json')
    let meta: Record<string, unknown> = {}
    try { meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) } catch { /* use defaults */ }
    meta.novelCategory = novelCategory
    await fs.writeFile(metaPath, JSON.stringify(meta), 'utf-8')
  })

  // v13.1.0: List projects from ALL three directories, tagged with type
  ipcMain.handle('project:listProjects', async (_event, _basePath: string) => {
    const result: string[] = []
    for (const [dir, type] of [[writingProjectsPath, 'writing'], [imitationProjectsPath, 'imitation'], [continuationProjectDirsPath, 'continuation']] as const) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.')) result.push(e.name)
        }
      } catch { /* dir may not exist */ }
    }
    return result
  })

  ipcMain.handle('app:getProjectsBasePath', async () => writingProjectsPath)
  ipcMain.handle('app:getImitationProjectsPath', async () => imitationProjectsPath)
  ipcMain.handle('app:getContinuationProjectDirsPath', async () => continuationProjectDirsPath)

  ipcMain.handle('app:getStoryWorkspacePath', async () => {
    const { app } = await import('electron')
    return path.join(app.getPath('userData'), 'story_workspace')
  })

  // ====================== Project Import ======================
  ipcMain.handle('project:import', async (_event, zipPath: string, targetType?: string) => {
    const u = await import('unzipper')
    const unzipper = (u as any).default || u

    if (!fsSync.existsSync(zipPath)) throw new Error('文件不存在')

    const tmpDir = path.join(os.tmpdir(), `novel_import_${Date.now()}`)
    await new Promise<void>((resolve, reject) => {
      fsSync.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: tmpDir }))
        .on('close', resolve)
        .on('error', reject)
    })

    try {
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

      let projType = targetType || 'writing'
      try {
        const meta = JSON.parse(await fs.readFile(path.join(projDir, 'project.json'), 'utf-8'))
        projType = meta.type || targetType || 'writing'
      } catch { /* legacy */ }

      const projName = path.basename(projDir)
      const targetBasePath = getPathForType(projType)

      let finalName = projName
      let suffix = 1
      while (true) {
        try { await fs.access(path.join(targetBasePath, finalName)); finalName = `${projName}_${suffix++}` } catch { break }
      }
      const finalPath = path.join(targetBasePath, finalName)

      await copyDir(projDir, finalPath)
      await fs.writeFile(path.join(finalPath, 'project.json'), JSON.stringify({ type: projType }), 'utf-8')

      // Handle continuation data
      const contSrcDir = path.join(tmpDir, '_continuation')
      try {
        const contFiles = await fs.readdir(contSrcDir)
        const contDir = path.join(path.dirname(writingProjectsPath), 'continuation_projects')
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
