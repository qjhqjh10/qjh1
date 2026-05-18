import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { SceneTemplate } from '../../src/types/story'

let basePath = ''

function sanitizeId(id: string): string {
  return path.basename(id).replace(/[^a-zA-Z0-9_-]/g, '_')
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
    if (!template.id) throw new Error('Template ID is required')
    await fs.mkdir(basePath, { recursive: true })
    await fs.writeFile(path.join(basePath, `${sanitizeId(template.id)}.json`), JSON.stringify(template, null, 2), 'utf-8')
  })

  ipcMain.handle('template:delete', async (_e, id: string) => {
    if (!id) return
    await fs.unlink(path.join(basePath, `${sanitizeId(id)}.json`)).catch(() => {})
  })
}
