import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import type { StyleTemplate } from '../../src/types/styleTemplate'

let templatesPath = ''

function getTemplatesPath(): string {
  return templatesPath
}

function safeTemplatePath(id: string): string {
  // Keep Chinese, letters, digits, spaces, and common punct. Strip path-dangerous chars only.
  const safe = path.basename(id).replace(/[\\/:*?"<>|]/g, '_').slice(0, 64)
  if (!safe.trim()) throw new Error('Invalid style template ID')
  return path.join(getTemplatesPath(), `${safe}.json`)
}

async function ensureDir() {
  await fs.mkdir(getTemplatesPath(), { recursive: true })
}

async function listTemplates(): Promise<StyleTemplate[]> {
  try {
    await ensureDir()
    const files = await fs.readdir(getTemplatesPath())
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    const templates: StyleTemplate[] = []
    for (const f of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(getTemplatesPath(), f), 'utf-8')
        templates.push(JSON.parse(raw))
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
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function saveTemplate(template: StyleTemplate): Promise<StyleTemplate> {
  await ensureDir()
  if (!template.id) template.id = template.name || `st_${crypto.randomUUID().slice(0, 8)}`
  // Deduplicate filename
  const baseId = template.id
  let counter = 0
  while (true) {
    try { await fs.access(safeTemplatePath(template.id)); counter++; template.id = `${baseId}_${counter}` } catch { break }
  }
  template.updatedAt = new Date().toISOString()
  if (!template.createdAt) template.createdAt = template.updatedAt
  await fs.writeFile(
    safeTemplatePath(template.id),
    JSON.stringify(template, null, 2),
    'utf-8',
  )
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
    const dir = path.join(projectPath, 'style_templates')
    const templates: StyleTemplate[] = []
    try {
      const files = await fs.readdir(dir)
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          templates.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8')))
        } catch { /* skip invalid */ }
      }
    } catch { /* dir doesn't exist */ }
    return templates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  })
}
