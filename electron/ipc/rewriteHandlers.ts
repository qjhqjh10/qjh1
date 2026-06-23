import { IpcMain, dialog, BrowserWindow, shell } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import type { RewriteProject, RewriteChapter } from '../../src/types/rewrite'

let projectsPath = ''

function countChineseWords(text: string): number {
  let count = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 0x4e00 && code <= 0x9fff) count++
  }
  return count
}

function safeDirName(name: string): string {
  return path.basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 200)
}

function projectDir(id: string): string {
  return path.join(projectsPath, safeDirName(id))
}

function projectJsonPath(id: string): string {
  return path.join(projectDir(id), 'project.json')
}

async function readProjectJson(id: string): Promise<RewriteProject | null> {
  try {
    const raw = await fs.readFile(projectJsonPath(id), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function registerRewriteHandlers(ipcMain: IpcMain, basePath: string) {
  projectsPath = path.join(basePath, 'rewrite_projects')

  // ── List all projects ──
  ipcMain.handle('rewrite:list', async () => {
    try {
      await fs.mkdir(projectsPath, { recursive: true })
      const dirs = await fs.readdir(projectsPath)
      const projects: RewriteProject[] = []
      for (const dir of dirs) {
        const pj = await readProjectJson(dir)
        if (pj) projects.push(pj)
      }
      return projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    } catch {
      return []
    }
  })

  // ── Read single project ──
  ipcMain.handle('rewrite:read', async (_event, id: string) => {
    return readProjectJson(id)
  })

  // ── Save project metadata ──
  ipcMain.handle('rewrite:save', async (_event, project: RewriteProject) => {
    await fs.mkdir(projectDir(project.id), { recursive: true })
    project.updatedAt = new Date().toISOString()
    await fs.writeFile(projectJsonPath(project.id), JSON.stringify(project, null, 2), 'utf-8')
    return project
  })

  // ── Delete project ──
  ipcMain.handle('rewrite:delete', async (_event, id: string) => {
    try {
      await fs.rm(projectDir(id), { recursive: true, force: true })
    } catch { /* ignore */ }
  })

  // ── Import file (open dialog) ──
  ipcMain.handle('rewrite:importFile', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择小说TXT文件',
      filters: [{ name: '文本文件', extensions: ['txt'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]

    // Auto-detect encoding (try UTF-8 first, then GBK)
    let content = ''
    const buf = await fs.readFile(filePath)
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      // Try GBK
      const { default: iconv } = await import('iconv-lite')
      content = iconv.decode(buf, 'gbk')
    }

    const name = path.basename(filePath, '.txt')
    return { name, content, sourceFileName: path.basename(filePath) }
  })

  // ── Create project from imported file ──
  ipcMain.handle('rewrite:create', async (_event, arg: { name: string; sourceFileName: string; content: string }) => {
    await fs.mkdir(projectsPath, { recursive: true })
    const id = `rw_${crypto.randomUUID().slice(0, 8)}`
    const dir = projectDir(id)

    // Create subdirectories
    await fs.mkdir(dir, { recursive: true })
    await fs.mkdir(path.join(dir, 'original'), { recursive: true })
    await fs.mkdir(path.join(dir, 'chapters'), { recursive: true })
    await fs.mkdir(path.join(dir, 'summaries'), { recursive: true })
    await fs.mkdir(path.join(dir, 'rewrites'), { recursive: true })
    await fs.mkdir(path.join(dir, 'merged'), { recursive: true })

    // Save original TXT
    await fs.writeFile(path.join(dir, 'original', arg.sourceFileName), arg.content, 'utf-8')

    const now = new Date().toISOString()
    const project: RewriteProject = {
      id,
      name: arg.name,
      sourceFileName: arg.sourceFileName,
      stage: 'imported',
      chapters: [],
      chapterCount: 0,
      wordCount: countChineseWords(arg.content),
      createdAt: now,
      updatedAt: now,
    }

    await fs.writeFile(projectJsonPath(id), JSON.stringify(project, null, 2), 'utf-8')
    return project
  })

  // ── Save chapters (split results from renderer) ──
  // Receives pre-split chapter data, writes files, updates project metadata
  ipcMain.handle('rewrite:saveChapters', async (_event, arg: {
    projectId: string
    sourceWordCount: number
    chapters: { title: string; content: string }[]
  }) => {
    const project = await readProjectJson(arg.projectId)
    if (!project) throw new Error('Project not found')

    const dir = projectDir(arg.projectId)
    const chaptersDir = path.join(dir, 'chapters')

    // Clear existing chapters
    await fs.rm(chaptersDir, { recursive: true, force: true })
    await fs.mkdir(chaptersDir, { recursive: true })

    // Write each chapter as a separate TXT file
    const chapters: RewriteChapter[] = []
    for (let i = 0; i < arg.chapters.length; i++) {
      const ch = arg.chapters[i]
      const chNum = String(i + 1).padStart(3, '0')
      const safeTitle = ch.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 40)
      const fileName = `第${chNum}章_${safeTitle}.txt`
      await fs.writeFile(path.join(chaptersDir, fileName), ch.content, 'utf-8')
      chapters.push({
        id: `ch_${arg.projectId}_${i}`,
        chapterNumber: i + 1,
        title: ch.title,
        fileName,
        wordCount: countChineseWords(ch.content),
      })
    }

    // Update project
    project.chapters = chapters
    project.chapterCount = chapters.length
    project.wordCount = arg.sourceWordCount
    project.stage = 'split'
    project.updatedAt = new Date().toISOString()

    await fs.writeFile(projectJsonPath(arg.projectId), JSON.stringify(project, null, 2), 'utf-8')
    return project
  })

  // ── Get project base path ──
  ipcMain.handle('app:getRewriteProjectsPath', async () => {
    return projectsPath
  })

  // ── Open folder in file explorer ──
  ipcMain.handle('app:openFolder', async (_event, folderPath: string) => {
    try {
      await shell.openPath(folderPath)
    } catch { /* ignore */ }
  })

  // ── Get project dir path (for file operations) ──
  ipcMain.handle('rewrite:getProjectPath', async (_event, id: string) => {
    return projectDir(id)
  })

  // ── List chapters (returns chapter file contents) ──
  ipcMain.handle('rewrite:listChapterFiles', async (_event, id: string) => {
    const dir = path.join(projectDir(id), 'chapters')
    try {
      const files = await fs.readdir(dir)
      return files.filter(f => f.endsWith('.txt')).sort()
    } catch {
      return []
    }
  })

  // ── Read chapter content ──
  ipcMain.handle('rewrite:readChapter', async (_event, id: string, fileName: string) => {
    const filePath = path.join(projectDir(id), 'chapters', fileName)
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch {
      return ''
    }
  })

  // ── Stage 2: Save analysis JSON to summaries/ ──
  ipcMain.handle('rewrite:saveAnalysis', async (_event, id: string, fileName: string, content: string) => {
    const dir = path.join(projectDir(id), 'summaries')
    await fs.mkdir(dir, { recursive: true })
    const jsonFileName = fileName.replace(/\.txt$/i, '.json')
    await fs.writeFile(path.join(dir, jsonFileName), content, 'utf-8')
  })

  // ── Stage 2: Read analysis JSON from summaries/ ──
  ipcMain.handle('rewrite:readAnalysis', async (_event, id: string, fileName: string) => {
    const jsonFileName = fileName.replace(/\.txt$/i, '.json')
    const filePath = path.join(projectDir(id), 'summaries', jsonFileName)
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch {
      return ''
    }
  })

  // ── Stage 2: Delete analysis (for re-analysis) ──
  ipcMain.handle('rewrite:deleteAnalysis', async (_event, id: string, fileName: string) => {
    const jsonFileName = fileName.replace(/\.txt$/i, '.json')
    const filePath = path.join(projectDir(id), 'summaries', jsonFileName)
    try {
      await fs.unlink(filePath)
    } catch { /* ignore */ }
  })

  // ── Stage 3 (old)/4 (new): Save rewritten chapter to rewrites/ ──
  ipcMain.handle('rewrite:saveRewrite', async (_event, id: string, fileName: string, content: string) => {
    const dir = path.join(projectDir(id), 'rewrites')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, fileName), content, 'utf-8')
  })

  // ── Stage 3/4: Read rewritten chapter from rewrites/ ──
  ipcMain.handle('rewrite:readRewrite', async (_event, id: string, fileName: string) => {
    const filePath = path.join(projectDir(id), 'rewrites', fileName)
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch {
      return ''
    }
  })

  // ── Stage 3/4: Delete rewrite (for re-rewrite) ──
  ipcMain.handle('rewrite:deleteRewrite', async (_event, id: string, fileName: string) => {
    const filePath = path.join(projectDir(id), 'rewrites', fileName)
    try {
      await fs.unlink(filePath)
    } catch { /* ignore */ }
  })

  // ── Stage 5: Merge rewrites into output TXT ──
  ipcMain.handle('rewrite:mergeRewrites', async (_event, id: string, outputPath: string, chapterIds?: string[]) => {
    const project = await readProjectJson(id)
    if (!project) throw new Error('Project not found')

    const rewritesDir = path.join(projectDir(id), 'rewrites')
    const chaptersToMerge = chapterIds
      ? project.chapters.filter(c => chapterIds.includes(c.id))
      : project.chapters

    const chaptersDir = path.join(projectDir(id), 'chapters')
    const lines: string[] = []
    for (const ch of chaptersToMerge) {
      try {
        // Try rewritten version first
        const content = await fs.readFile(path.join(rewritesDir, ch.fileName), 'utf-8')
        lines.push(`\n第${ch.chapterNumber}章 ${ch.title}（已改写）\n`)
        lines.push(content)
        lines.push('')
      } catch {
        // Fall back to original chapter
        try {
          const original = await fs.readFile(path.join(chaptersDir, ch.fileName), 'utf-8')
          lines.push(`\n第${ch.chapterNumber}章 ${ch.title}\n`)
          lines.push(original)
          lines.push('')
        } catch {
          lines.push(`\n第${ch.chapterNumber}章 ${ch.title}\n`)
          lines.push('（章节缺失）')
          lines.push('')
        }
      }
    }

    await fs.writeFile(outputPath, lines.join('\n'), 'utf-8')

    // Update project stage
    project.stage = 'merged'
    project.updatedAt = new Date().toISOString()
    await fs.writeFile(projectJsonPath(id), JSON.stringify(project, null, 2), 'utf-8')

    return project
  })

  // ═══════════════════════════════════════════════════════════
  // 提示词模板 handlers
  // ═══════════════════════════════════════════════════════════
  const templatesPath = path.join(basePath, 'rewrite_templates')

  function templateFilePath(id: string): string {
    return path.join(templatesPath, `${safeDirName(id)}.json`)
  }

  async function readTemplateJson(id: string): Promise<any | null> {
    try {
      const raw = await fs.readFile(templateFilePath(id), 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  // list
  ipcMain.handle('rewriteTemplate:list', async () => {
    try {
      await fs.mkdir(templatesPath, { recursive: true })
      const files = await fs.readdir(templatesPath)
      const templates: any[] = []
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const id = file.replace(/\.json$/, '')
        const tmpl = await readTemplateJson(id)
        if (tmpl) templates.push(tmpl)
      }
      return templates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    } catch {
      return []
    }
  })

  // read
  ipcMain.handle('rewriteTemplate:read', async (_event, id: string) => {
    return readTemplateJson(id)
  })

  // save (create or update)
  ipcMain.handle('rewriteTemplate:save', async (_event, template: any) => {
    await fs.mkdir(templatesPath, { recursive: true })
    if (!template.id) {
      template.id = `rt_${crypto.randomUUID().slice(0, 8)}`
      template.createdAt = new Date().toISOString()
    }
    template.updatedAt = new Date().toISOString()
    await fs.writeFile(templateFilePath(template.id), JSON.stringify(template, null, 2), 'utf-8')
    return template
  })

  // delete
  ipcMain.handle('rewriteTemplate:delete', async (_event, id: string) => {
    try {
      await fs.unlink(templateFilePath(id))
    } catch { /* ignore */ }
  })

  // import from JSON file — supports both native and sxsy.org formats
  ipcMain.handle('rewriteTemplate:import', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '导入提示词模板',
      filters: [{ name: 'JSON文件', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const raw = await fs.readFile(result.filePaths[0], 'utf-8')
      const source = JSON.parse(raw)
      let template: any

      // ── Helper: unescape literal \n / \t in sxsy.org fields ──
      const unescape = (s: string): string => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t')

      // ── Detect sxsy.org format ──
      if (source.breakthroughTemplate || source.identifyTemplate || source.rewriteTemplate) {
        // Parse inner JSON strings if needed
        let identify: any = source.identifyTemplate
        if (typeof identify === 'string') {
          try { identify = JSON.parse(identify) } catch { identify = { categories: [] } }
        }
        let rewrite: any = source.rewriteTemplate
        if (typeof rewrite === 'string') {
          try { rewrite = JSON.parse(rewrite) } catch { rewrite = { commonPrompt: '', categoryPrompts: {} } }
        }

        // Build SceneRule[] from identifyTemplate.categories
        const sceneRules = (identify.categories || []).map((cat: any) => ({
          id: cat.id || `sr_${crypto.randomUUID().slice(0, 8)}`,
          name: unescape(cat.name || ''),
          triggerCondition: unescape(cat.conditions || ''),
        }))

        // Build sceneGuidance from rewriteTemplate.categoryPrompts (keyed by sceneId)
        const sceneGuidance: Record<string, string> = {}
        const catPrompts = rewrite.categoryPrompts || rewrite.categoryPrompts || {}
        for (const [key, value] of Object.entries(catPrompts)) {
          sceneGuidance[key] = unescape(String(value))
        }

        template = {
          name: source.name || '导入的模板',
          systemPrompt: typeof source.breakthroughTemplate === 'string' ? unescape(source.breakthroughTemplate) : '',
          sceneRules,
          universalGuidance: unescape(rewrite.commonPrompt || ''),
          sceneGuidance,
        }
      } else {
        // ── Native format: pass through, ensure required fields ──
        template = {
          name: source.name || '导入的模板',
          systemPrompt: source.systemPrompt || '',
          sceneRules: Array.isArray(source.sceneRules) ? source.sceneRules : [],
          universalGuidance: source.universalGuidance || '',
          sceneGuidance: source.sceneGuidance || {},
        }
      }

      // Assign new ID
      template.id = `rt_${crypto.randomUUID().slice(0, 8)}`
      template.createdAt = new Date().toISOString()
      template.updatedAt = new Date().toISOString()
      await fs.mkdir(templatesPath, { recursive: true })
      await fs.writeFile(templateFilePath(template.id), JSON.stringify(template, null, 2), 'utf-8')
      return template
    } catch {
      return null
    }
  })

  // export to JSON file
  ipcMain.handle('rewriteTemplate:export', async (_event, id: string) => {
    const template = await readTemplateJson(id)
    if (!template) return null
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: '导出提示词模板',
      defaultPath: `${template.name}.json`,
      filters: [{ name: 'JSON文件', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, JSON.stringify(template, null, 2), 'utf-8')
    return result.filePath
  })
}
