import { fileService } from '@/services/fileService'
import type { DetailedChapter, ChapterStatus } from '@/types/chapter'
import { logError } from '@/utils/logger'

function jsonPath(projectPath: string, id: string) {
  return `${projectPath}/detailed_outline/${id}.json`
}

export async function saveDetailedChapter(projectPath: string, chapter: DetailedChapter) {
  try {
    await fileService.write(jsonPath(projectPath, chapter.id), JSON.stringify(chapter, null, 2))
  } catch (e) {
    logError(`保存细纲失败: ${chapter.title || chapter.id}`, e)
    throw e
  }
}

export async function loadDetailedChapters(projectPath: string): Promise<DetailedChapter[]> {
  try {
    const files = await fileService.listDir(`${projectPath}/detailed_outline`)
    const chapters: DetailedChapter[] = []
    const seenIds = new Set<string>()

    // Prefer .json files
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    for (const file of jsonFiles) {
      try {
        const content = await fileService.read(`${projectPath}/detailed_outline/${file}`)
        const ch = JSON.parse(content) as DetailedChapter
        chapters.push(ch)
        seenIds.add(file.replace('.json', ''))
      } catch (e) {
        logError(`解析细纲JSON文件失败: ${file}`, e)
      }
    }

    // Fallback: legacy .txt files not yet migrated
    const txtFiles = files.filter(f => {
      if (!f.endsWith('.txt')) return false
      const id = f.replace('.txt', '')
      return !seenIds.has(id)
    })

    for (const file of txtFiles) {
      try {
        const content = await fileService.read(`${projectPath}/detailed_outline/${file}`)
        const id = file.replace('.txt', '')
        let title = ''
        let description = ''
        let summary = ''
        let order = 0

        const orderMatch = content.match(/^顺序: (\d+)$/m)
        if (orderMatch) order = parseInt(orderMatch[1], 10) || 0

        let status: ChapterStatus = 'outline'
        const statusMatch = content.match(/^状态: (\w+)$/m)
        if (statusMatch && ['outline', 'draft', 'revising', 'final'].includes(statusMatch[1])) {
          status = statusMatch[1] as ChapterStatus
        }

        const titleMatch = content.match(/^标题: (.+)$/m)
        if (titleMatch) title = titleMatch[1]

        const descMatch = content.match(/描述:\n([\s\S]*?)(?:\n\n摘要:|$)/)
        if (descMatch) description = descMatch[1].trim()

        const summaryMatch = content.match(/\n摘要:\n([\s\S]*)$/)
        if (summaryMatch) summary = summaryMatch[1].trim()

        chapters.push({ id, title, description, summary, order, status })
      } catch (e) {
        logError(`解析细纲TXT文件失败: ${file}`, e)
        chapters.push({ id: file.replace('.txt', ''), title: '', description: '', summary: '', order: 0, status: 'outline' })
      }
    }

    chapters.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    return chapters
  } catch (e) {
    logError('加载细纲列表失败', e)
    return []
  }
}
