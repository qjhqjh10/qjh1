import { fileService } from './fileService'
import { logError } from '@/utils/logger'

const PLOT = (pp: string) => `${pp}/outline/plot.json`
const PLOT_OLD = (pp: string) => `${pp}/outline/outline.json`
const WORLD = (pp: string) => `${pp}/outline/worldbuilding.json`

export async function loadOutlineContent(projectPath: string): Promise<string> {
  // 1. plot.json
  try { const raw = await fileService.read(PLOT(projectPath)); if (raw) return raw } catch {}
  // 2. outline.json (legacy)
  try { const raw = await fileService.read(PLOT_OLD(projectPath)); if (raw) return raw } catch {}
  // 3. outline.txt (legacy)
  try { const raw = await fileService.read(`${projectPath}/outline/outline.txt`); if (raw) return raw } catch {}
  return ''
}

export async function saveOutlineContent(projectPath: string, content: string): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline`)
    await fileService.write(PLOT(projectPath), content)
  } catch (err) { logError('Failed to save plot', err) }
}

export async function loadWorldbuildingContent(projectPath: string): Promise<string> {
  // 1. worldbuilding.json
  try { const raw = await fileService.read(WORLD(projectPath)); if (raw) return raw } catch {}
  // 2. worldbuilding/worldbuilding.json (legacy)
  try { const raw = await fileService.read(`${projectPath}/worldbuilding/worldbuilding.json`); if (raw) return raw } catch {}
  // 3. worldbuilding.txt (legacy)
  try { const raw = await fileService.read(`${projectPath}/worldbuilding/worldbuilding.txt`); if (raw) return raw } catch {}
  return ''
}

export async function saveWorldbuildingContent(projectPath: string, content: string): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/outline`)
    await fileService.write(WORLD(projectPath), content)
  } catch (err) { logError('Failed to save worldbuilding', err) }
}
