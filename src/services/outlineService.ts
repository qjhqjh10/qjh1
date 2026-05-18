import { fileService } from './fileService'
import { logError } from '@/utils/logger'
import type { OutlineContentData, WorldbuildingContentData } from '@/types/outline'

const EMPTY_OUTLINE: OutlineContentData = { content: '', updatedAt: new Date().toISOString() }
const EMPTY_WORLDBUILDING: WorldbuildingContentData = { content: '', updatedAt: new Date().toISOString() }

export async function loadOutlineContent(projectPath: string): Promise<string> {
  try {
    const raw = await fileService.read(`${projectPath}/outline/outline.json`)
    if (raw) {
      const data = JSON.parse(raw) as OutlineContentData
      return data.content || ''
    }
  } catch { /* JSON doesn't exist, try legacy TXT */ }

  try {
    const raw = await fileService.read(`${projectPath}/outline/outline.txt`)
    // Back up corrupt JSON if it exists before overwriting
    try {
      const existing = await fileService.read(`${projectPath}/outline/outline.json`)
      if (existing) {
        await fileService.write(`${projectPath}/outline/outline.json.bak`, existing)
      }
    } catch { /* no corrupt JSON to back up */ }
    const data: OutlineContentData = { content: raw, updatedAt: new Date().toISOString() }
    await fileService.write(`${projectPath}/outline/outline.json`, JSON.stringify(data, null, 2))
    return raw
  } catch { /* neither exists */ }

  return ''
}

export async function saveOutlineContent(projectPath: string, content: string): Promise<void> {
  const data: OutlineContentData = { content, updatedAt: new Date().toISOString() }
  try {
    await fileService.ensureDir(`${projectPath}/outline`)
    await fileService.write(`${projectPath}/outline/outline.json`, JSON.stringify(data, null, 2))
  } catch (err) {
    logError('Failed to save outline content', err)
  }
}

export async function loadWorldbuildingContent(projectPath: string): Promise<string> {
  try {
    const raw = await fileService.read(`${projectPath}/worldbuilding/worldbuilding.json`)
    if (raw) {
      const data = JSON.parse(raw) as WorldbuildingContentData
      return data.content || ''
    }
  } catch { /* JSON doesn't exist, try legacy TXT */ }

  try {
    const raw = await fileService.read(`${projectPath}/worldbuilding/worldbuilding.txt`)
    // Back up corrupt JSON if it exists before overwriting
    try {
      const existing = await fileService.read(`${projectPath}/worldbuilding/worldbuilding.json`)
      if (existing) {
        await fileService.write(`${projectPath}/worldbuilding/worldbuilding.json.bak`, existing)
      }
    } catch { /* no corrupt JSON to back up */ }
    const data: WorldbuildingContentData = { content: raw, updatedAt: new Date().toISOString() }
    await fileService.write(`${projectPath}/worldbuilding/worldbuilding.json`, JSON.stringify(data, null, 2))
    return raw
  } catch { /* neither exists */ }

  return ''
}

export async function saveWorldbuildingContent(projectPath: string, content: string): Promise<void> {
  const data: WorldbuildingContentData = { content, updatedAt: new Date().toISOString() }
  try {
    await fileService.ensureDir(`${projectPath}/worldbuilding`)
    await fileService.write(`${projectPath}/worldbuilding/worldbuilding.json`, JSON.stringify(data, null, 2))
  } catch (err) {
    logError('Failed to save worldbuilding content', err)
  }
}

export function emptyOutlineData(): OutlineContentData {
  return { ...EMPTY_OUTLINE, updatedAt: new Date().toISOString() }
}

export function emptyWorldbuildingData(): WorldbuildingContentData {
  return { ...EMPTY_WORLDBUILDING, updatedAt: new Date().toISOString() }
}
