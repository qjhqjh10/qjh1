import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { SceneTemplate } from '../../src/types/story'

let basePath = ''

function sanitizeId(id: string): string {
  // Keep Chinese, letters, digits, spaces, common punct. Strip path-dangerous chars only.
  return path.basename(id).replace(/[\\/:*?"<>|]/g, '_')
}

export function registerTemplateHandlers(ipcMain: IpcMain, templatesPath: string) {
  basePath = templatesPath

  ipcMain.handle('template:list', async () => {
    await fs.mkdir(basePath, { recursive: true })
    const files = await fs.readdir(basePath)
    const templates: SceneTemplate[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      try {
        templates.push(JSON.parse(await fs.readFile(path.join(basePath, f), 'utf-8')))
      } catch { /* skip invalid */ }
    }
    return templates
  })

  ipcMain.handle('template:save', async (_e, template: SceneTemplate) => {
    if (!template.id) template.id = (template as any).name || `sc_${Date.now().toString(36)}`
    // Dedup: find a free filename. If current file IS this template (same id), overwrite.
    const baseId = template.id
    const currentPath = path.join(basePath, `${sanitizeId(baseId)}.json`)
    const existing = await fs.access(currentPath).then(async () => {
      try { const raw = await fs.readFile(currentPath, 'utf-8'); const t = JSON.parse(raw); return t.id === template.id } catch { return false }
    }).catch(() => false)
    if (!existing) {
      let counter = 0
      while (true) {
        try { await fs.access(path.join(basePath, `${sanitizeId(template.id)}.json`)); counter++; template.id = `${baseId}_${counter}` } catch { break }
      }
    }
    await fs.mkdir(basePath, { recursive: true })
    await fs.writeFile(path.join(basePath, `${sanitizeId(template.id)}.json`), JSON.stringify(template, null, 2), 'utf-8')
  })

  ipcMain.handle('template:delete', async (_e, id: string) => {
    if (!id) return
    await fs.unlink(path.join(basePath, `${sanitizeId(id)}.json`)).catch(() => {})
  })

  ipcMain.handle('template:listProject', async (_e, projectPath: string) => {
    const dir = path.join(projectPath, 'scene_templates')
    const templates: SceneTemplate[] = []
    try {
      const files = await fs.readdir(dir)
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          templates.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8')))
        } catch { /* skip invalid */ }
      }
    } catch { /* dir doesn't exist */ }
    return templates
  })
}
