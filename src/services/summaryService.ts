import { fileService } from '@/services/fileService'
import { logError } from '@/utils/logger'

import { sanitizeFileName } from '../utils/security'

function summaryPath(projectPath: string, chapterId: string): string {
  const safe = sanitizeFileName(chapterId).value || 'unknown'
  return `${projectPath}/summaries/${safe}.md`
}

export async function loadSummary(projectPath: string, chapterId: string): Promise<string> {
  try {
    return await fileService.read(summaryPath(projectPath, chapterId))
  } catch {
    return ''
  }
}

export async function saveSummary(projectPath: string, chapterId: string, content: string): Promise<void> {
  try {
    await fileService.ensureDir(`${projectPath}/summaries`)
    await fileService.write(summaryPath(projectPath, chapterId), content)
  } catch (e) {
    logError(`保存章节摘要失败: ${chapterId}`, e)
    throw e
  }
}

export async function loadAllSummaries(projectPath: string, chapterIds: string[]): Promise<Record<string, string>> {
  const results: Record<string, string> = {}
  await Promise.all(chapterIds.map(async (id) => {
    results[id] = await loadSummary(projectPath, id)
  }))
  return results
}

export async function deleteSummary(projectPath: string, chapterId: string): Promise<void> {
  try {
    await fileService.deleteFile(summaryPath(projectPath, chapterId))
  } catch {
    // File may not exist, that's fine
  }
}
