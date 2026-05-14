import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { SceneTemplate } from '../../src/types/story'

let basePath = ''

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
    await fs.mkdir(basePath, { recursive: true })
    await fs.writeFile(path.join(basePath, `${template.id}.json`), JSON.stringify(template, null, 2), 'utf-8')
  })

  ipcMain.handle('template:delete', async (_e, id: string) => {
    await fs.unlink(path.join(basePath, `${id}.json`)).catch(() => {})
  })
}
