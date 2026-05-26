import { fileService } from './fileService'
import { logError } from '@/utils/logger'
import { repairJson } from '@/services/chapterService'
import type { NovelExtraction, DetailGenResult } from '@/types/story'

export async function loadExtraction(projectPath: string): Promise<NovelExtraction | null> {
  try {
    const raw = await fileService.read(`${projectPath}/extraction.json`)
    if (!raw) return null
    const repaired = repairJson(raw)
    if (repaired) return JSON.parse(repaired) as NovelExtraction
  } catch { /* not found */ }
  return null
}

export async function saveExtraction(projectPath: string, data: NovelExtraction): Promise<void> {
  try {
    await fileService.ensureDir(projectPath)
    await fileService.write(`${projectPath}/extraction.json`, JSON.stringify(data, null, 2))
  } catch (err) { logError('Failed to save extraction', err) }
}

export async function loadOutlineResults(projectPath: string): Promise<Record<string, string>> {
  const ext = await loadExtraction(projectPath)
  return ext?.outlineResults || {}
}

export async function saveDimResult(projectPath: string, dimKey: string, result: string): Promise<void> {
  const ext = await loadExtraction(projectPath)
  if (!ext) return
  ext.outlineResults = { ...(ext.outlineResults || {}), [dimKey]: result }
  ext.updatedAt = new Date().toISOString()
  await saveExtraction(projectPath, ext)
}

export async function loadDetailResults(projectPath: string): Promise<DetailGenResult[]> {
  const ext = await loadExtraction(projectPath)
  return ext?.detailGenResults || []
}

export async function saveDetailResults(projectPath: string, results: DetailGenResult[]): Promise<void> {
  const ext = await loadExtraction(projectPath)
  if (!ext) return
  ext.detailGenResults = results
  ext.detailsResults = JSON.stringify(results)
  ext.updatedAt = new Date().toISOString()
  await saveExtraction(projectPath, ext)
}
