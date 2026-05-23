import { fileService } from './fileService'
import { logError } from '@/utils/logger'

const PLOT_MD = (pp: string) => `${pp}/outline/plot.md`
const PLOT_JSON = (pp: string) => `${pp}/outline/plot.json`
const PLOT_OLD = (pp: string) => `${pp}/outline/outline.json`
const WORLD_MD = (pp: string) => `${pp}/outline/worldbuilding.md`
const WORLD_JSON = (pp: string) => `${pp}/outline/worldbuilding.json`

export async function loadOutlineContent(projectPath: string): Promise<string> {
  try { const raw = await fileService.read(PLOT_MD(projectPath)); if (raw) return raw } catch {}
  try { const raw = await fileService.read(PLOT_JSON(projectPath)); if (raw) return raw } catch {}
  try { const raw = await fileService.read(PLOT_OLD(projectPath)); if (raw) return raw } catch {}
  try { const raw = await fileService.read(`${projectPath}/outline/outline.txt`); if (raw) return raw } catch {}
  return ''
}

export async function saveOutlineContent(projectPath: string, content: string): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline`)
    await fileService.write(PLOT_MD(projectPath), content)
  } catch (err) { logError('Failed to save plot', err) }
}

export async function loadWorldbuildingContent(projectPath: string): Promise<string> {
  try { const raw = await fileService.read(WORLD_MD(projectPath)); if (raw) return raw } catch {}
  try { const raw = await fileService.read(WORLD_JSON(projectPath)); if (raw) return raw } catch {}
  try { const raw = await fileService.read(`${projectPath}/worldbuilding/worldbuilding.json`); if (raw) return raw } catch {}
  try { const raw = await fileService.read(`${projectPath}/worldbuilding/worldbuilding.txt`); if (raw) return raw } catch {}
  return ''
}

export async function saveWorldbuildingContent(projectPath: string, content: string): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline`)
    await fileService.write(WORLD_MD(projectPath), content)
  } catch (err) { logError('Failed to save worldbuilding', err) }
}
