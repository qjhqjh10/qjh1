import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import * as yaml from 'js-yaml'
import type { StyleTemplate } from '../../src/types/styleTemplate'

let templatesPath = ''

function getTemplatesPath(): string {
  return templatesPath
}

function safeTemplatePath(id: string): string {
  const safe = path.basename(id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 64)
  if (!safe.trim()) throw new Error('Invalid style template ID')
  return path.join(getTemplatesPath(), `${safe}.yaml`)
}

async function ensureDir() {
  await fs.mkdir(getTemplatesPath(), { recursive: true })
}

async function listTemplates(): Promise<StyleTemplate[]> {
  try {
    await ensureDir()
    const files = await fs.readdir(getTemplatesPath())
    const yamlFiles = files.filter(f => f.endsWith('.yaml'))
    const templates: StyleTemplate[] = []
    for (const f of yamlFiles) {
      try {
        const raw = await fs.readFile(path.join(getTemplatesPath(), f), 'utf-8')
        templates.push(yaml.load(raw) as StyleTemplate)
      } catch { /* skip malformed */ }
    }
    return templates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } catch {
    return []
  }
}

async function readTemplate(id: string): Promise<StyleTemplate | null> {
  try {
    const raw = await fs.readFile(safeTemplatePath(id), 'utf-8')
    return yaml.load(raw) as StyleTemplate
  } catch {
    return null
  }
}

async function saveTemplate(template: StyleTemplate): Promise<StyleTemplate> {
  await ensureDir()
  if (!template.id) template.id = `st_${crypto.randomUUID().slice(0, 8)}`

  // Dedup: existing file with same id → overwrite; different id → find free name
  const baseId = template.id
  const existsSameId = await fs.access(safeTemplatePath(baseId)).then(async () => {
    try { const raw = await fs.readFile(safeTemplatePath(baseId), 'utf-8'); return (yaml.load(raw) as any)?.id === template.id } catch { return false }
  }).catch(() => false)
  if (!existsSameId) {
    let counter = 0
    while (true) {
      try { await fs.access(safeTemplatePath(template.id)); counter++; template.id = `${baseId}_${counter}` } catch { break }
    }
  }

  template.updatedAt = new Date().toISOString()
  if (!template.createdAt) template.createdAt = template.updatedAt

  // 过滤 undefined 值（YAML dump 会保留 null，JSON 会丢弃）
  const clean = JSON.parse(JSON.stringify(template))
  await fs.writeFile(safeTemplatePath(template.id), yaml.dump(clean, { indent: 2, lineWidth: 120 }), 'utf-8')
  return template
}

async function deleteTemplate(id: string): Promise<void> {
  try {
    await fs.unlink(safeTemplatePath(id))
  } catch { /* not found */ }
}

export function registerStyleTemplateHandlers(ipcMain: IpcMain, basePath: string) {
  templatesPath = path.join(basePath, 'style_templates')

  ipcMain.handle('styleTemplate:list', async () => {
    return await listTemplates()
  })

  ipcMain.handle('styleTemplate:read', async (_event, id: string) => {
    return await readTemplate(id)
  })

  ipcMain.handle('styleTemplate:save', async (_event, template: StyleTemplate) => {
    return await saveTemplate(template)
  })

  ipcMain.handle('styleTemplate:delete', async (_event, id: string) => {
    await deleteTemplate(id)
  })

  ipcMain.handle('styleTemplate:listProject', async (_event, projectPath: string) => {
    const normalized = path.normalize(projectPath).toLowerCase()
    if (!normalized.startsWith(path.normalize(templatesPath).toLowerCase()) && !normalized.startsWith(path.normalize(basePath).toLowerCase())) {
      return []
    }
    const dir = path.join(projectPath, 'style_templates')
    const templates: StyleTemplate[] = []
    try {
      const files = await fs.readdir(dir)
      for (const f of files) {
        if (!f.endsWith('.yaml')) continue
        try {
          templates.push(yaml.load(await fs.readFile(path.join(dir, f), 'utf-8')) as StyleTemplate)
        } catch { /* skip invalid */ }
      }
    } catch { /* dir doesn't exist */ }
    return templates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  })
}
