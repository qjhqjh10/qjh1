import { fileService } from './fileService'
import { logError } from '@/utils/logger'
import { repairJson } from '@/services/chapterService'
import type { NovelExtraction, DetailGenResult } from '@/types/story'

// C3: Per-file mutex to prevent read-modify-write races on extraction.json.
// Multiple concurrent saveDimResult / saveDetailResults calls queue up
// for the same file, ensuring each one completes before the next begins.
const _writeLocks = new Map<string, Promise<void>>()

function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = _writeLocks.get(filePath) || Promise.resolve()
  const next = prev.then(fn, fn)  // run fn even if previous lock rejected
  _writeLocks.set(filePath, next.then(() => {}, () => {}))  // clear after completion
  return next
}

export async function loadExtraction(projectPath: string): Promise<NovelExtraction | null> {
  try {
    const raw = await fileService.read(`${projectPath}/extraction.json`)
    if (!raw) return null
    const repaired = repairJson(raw)
    if (repaired) return JSON.parse(repaired) as NovelExtraction
  } catch { /* not found */ }
  return null
}

/** 内部写实现（调用方须已持有 withLock）——saveExtraction 与锁内读改写共用 */
async function writeExtractionUnlocked(projectPath: string, data: NovelExtraction): Promise<void> {
  try {
    await fileService.ensureDir(projectPath)
    await fileService.write(`${projectPath}/extraction.json`, JSON.stringify(data, null, 2))
  } catch (err) { logError('Failed to save extraction', err) }
}

/** v16.3.1(审计 F6): 空态初始化对象——extraction.json 不存在时锁内"读-改-写"不再静默丢结果 */
function emptyExtraction(): NovelExtraction {
  const now = new Date().toISOString()
  return {
    id: `ext_${Date.now().toString(36)}`, novelName: '', sourceFileName: '', novelType: '',
    chapters: [], aggregated: null, plotStructure: null, styleProfile: null, pacingTemplate: null,
    eventPattern: null, progressionRhythm: null, characterArchetype: null, emotionCurve: null,
    generatedNovel: null, status: 'extracting', createdAt: now, updatedAt: now,
  }
}

export async function saveExtraction(projectPath: string, data: NovelExtraction): Promise<void> {
  // v16.3.1(审计 F6): 纳入 withLock——原直写与锁内"读-改-写"并发互相覆盖
  return withLock(`${projectPath}/extraction.json`, () => writeExtractionUnlocked(projectPath, data))
}

export async function loadOutlineResults(projectPath: string): Promise<Record<string, string>> {
  const ext = await loadExtraction(projectPath)
  return ext?.outlineResults || {}
}

export async function saveDimResult(projectPath: string, dimKey: string, result: string): Promise<void> {
  const filePath = `${projectPath}/extraction.json`
  return withLock(filePath, async () => {
    // v16.3.1(审计 F6): 空态初始化——原 `if (!ext) return` 静默丢结果（首个维度结果丢失）
    const ext = await loadExtraction(projectPath) ?? emptyExtraction()
    ext.outlineResults = { ...(ext.outlineResults || {}), [dimKey]: result }
    ext.updatedAt = new Date().toISOString()
    await writeExtractionUnlocked(projectPath, ext)
  })
}

export async function loadDetailResults(projectPath: string): Promise<DetailGenResult[]> {
  const ext = await loadExtraction(projectPath)
  return ext?.detailGenResults || []
}

export async function saveDetailResults(projectPath: string, results: DetailGenResult[]): Promise<void> {
  const filePath = `${projectPath}/extraction.json`
  return withLock(filePath, async () => {
    // v16.3.1(审计 F6): 空态初始化（同 saveDimResult）
    const ext = await loadExtraction(projectPath) ?? emptyExtraction()
    ext.detailGenResults = results
    ext.detailsResults = JSON.stringify(results)
    ext.updatedAt = new Date().toISOString()
    await writeExtractionUnlocked(projectPath, ext)
  })
}
