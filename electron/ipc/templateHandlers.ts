import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import type { SceneTemplate } from '../../src/types/story'

let basePath = ''

function sanitizeId(id: string): string {
  const sanitized = path.basename(id).replace(/[\\/:*?"<>|]/g, '_').trim()
  if (!sanitized) throw new Error('Invalid template ID: empty after sanitization')
  return sanitized
}

export function registerTemplateHandlers(ipcMain: IpcMain, templatesPath: string) {
  basePath = templatesPath

  ipcMain.handle('template:list', async () => {
    await fs.mkdir(basePath, { recursive: true })
    const files = await fs.readdir(basePath)
    const templates: SceneTemplate[] = []
    for (const f of files) {
      if (!f.endsWith('.yaml')) continue
      try {
        templates.push(yaml.load(await fs.readFile(path.join(basePath, f), 'utf-8')) as SceneTemplate)
      } catch { /* skip invalid */ }
    }
    templates.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
    return templates
  })

  ipcMain.handle('template:save', async (_e, template: SceneTemplate) => {
    if (!template.id) template.id = (template as any).name || `sc_${Date.now().toString(36)}`
    const baseId = template.id
    const currentPath = path.join(basePath, `${sanitizeId(baseId)}.yaml`)
    const existing = await fs.access(currentPath).then(async () => {
      try { const raw = await fs.readFile(currentPath, 'utf-8'); const t = yaml.load(raw) as any; return t.id === template.id } catch { return false }
    }).catch(() => false)
    if (!existing) {
      let counter = 0
      while (true) {
        try { await fs.access(path.join(basePath, `${sanitizeId(template.id)}.yaml`)); counter++; template.id = `${baseId}_${counter}` } catch { break }
      }
    }
    template.updatedAt = new Date().toISOString()
    if (!template.createdAt) template.createdAt = template.updatedAt
    await fs.mkdir(basePath, { recursive: true })
    // 过滤 undefined（YAML dump 会保留 null）
    const clean = JSON.parse(JSON.stringify(template))
    await fs.writeFile(path.join(basePath, `${sanitizeId(template.id)}.yaml`), yaml.dump(clean, { indent: 2, lineWidth: 120 }), 'utf-8')
    return template as SceneTemplate
  })

  ipcMain.handle('template:delete', async (_e, id: string) => {
    if (!id) return
    await fs.unlink(path.join(basePath, `${sanitizeId(id)}.yaml`)).catch(() => {})
  })

  ipcMain.handle('template:listProject', async (_e, projectPath: string) => {
    const normalized = path.normalize(projectPath).toLowerCase()
    if (!normalized.startsWith(path.normalize(basePath).toLowerCase())) {
      return []
    }
    const dir = path.join(projectPath, 'scene_templates')
    const templates: SceneTemplate[] = []
    try {
      const files = await fs.readdir(dir)
      for (const f of files) {
        if (!f.endsWith('.yaml')) continue
        try {
          templates.push(yaml.load(await fs.readFile(path.join(dir, f), 'utf-8')) as SceneTemplate)
        } catch { /* skip invalid */ }
      }
    } catch { /* dir doesn't exist */ }
    return templates
  })
}
