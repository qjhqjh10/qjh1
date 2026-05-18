import { IpcMain } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import type { ContinuationProject } from '../../src/types/continuation'

let projectsPath = ''

export function registerContinuationHandlers(ipcMain: IpcMain, basePath: string) {
  projectsPath = path.join(basePath, 'continuation_projects')

  ipcMain.handle('continuation:list', async () => {
    try {
      await fs.mkdir(projectsPath, { recursive: true })
      const files = await fs.readdir(projectsPath)
      const projects: ContinuationProject[] = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const raw = await fs.readFile(path.join(projectsPath, f), 'utf-8')
          projects.push(JSON.parse(raw))
        } catch { /* skip */ }
      }
      return projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    } catch { return [] }
  })

  ipcMain.handle('continuation:read', async (_event, id: string) => {
    try {
      const raw = await fs.readFile(path.join(projectsPath, `${id}.json`), 'utf-8')
      return JSON.parse(raw)
    } catch { return null }
  })

  ipcMain.handle('continuation:save', async (_event, project: ContinuationProject) => {
    await fs.mkdir(projectsPath, { recursive: true })
    if (!project.id) project.id = `cp_${crypto.randomUUID().slice(0, 8)}`
    project.updatedAt = new Date().toISOString()
    if (!project.createdAt) project.createdAt = project.updatedAt
    await fs.writeFile(
      path.join(projectsPath, `${project.id}.json`),
      JSON.stringify(project, null, 2),
      'utf-8',
    )
    return project
  })

  ipcMain.handle('continuation:delete', async (_event, id: string) => {
    try { await fs.unlink(path.join(projectsPath, `${id}.json`)) } catch {}
  })
}
