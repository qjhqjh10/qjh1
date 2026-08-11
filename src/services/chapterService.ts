import { fileService } from '@/services/fileService'
import type { DetailedChapter, ChapterStatus } from '@/types/chapter'
import { logError } from '@/utils/logger'
import { loadSummary } from '@/services/summaryService'
import { yamlStringify, tryParseJsonOrYaml } from '@/utils/yamlUtils'
import { isStructuredDataFile, stripExtension, readAndMigrate, detailedOutlinePath } from '@/utils/filePaths'

// v16.3.1(审计 D9): repairJson/fixJsonNewlines 迁至 @/utils/jsonRepair（单一真源，
// 主进程 schemaValidation 共用 5 策略）。此处 re-export 保持既有消费方导入路径不变。
export { repairJson } from '@/utils/jsonRepair'

/** v16.3.1(审计 D9): fixJsonNewlines 随 repairJson 迁至 @/utils/jsonRepair，本文件不再持有实现 */
export async function saveDetailedChapter(projectPath: string, chapter: DetailedChapter) {
  try {
    await fileService.write(detailedOutlinePath(projectPath, chapter.id), yamlStringify(chapter))
  } catch (e) {
    logError(`保存细纲失败: ${chapter.title || chapter.id}`, e)
    throw e
  }
}

export async function loadDetailedChapters(projectPath: string): Promise<DetailedChapter[]> {
  try {
    const files = await fileService.listDir(`${projectPath}/detailed_outline`)
    const seenIds = new Set<string>()

    // Read .yaml files; auto-migrate old .json files (parallel M14)
    const dataFiles = files.filter(f => isStructuredDataFile(f))
    const seenBaseNames = new Set<string>()
    const results = await Promise.allSettled(dataFiles.map(async (file) => {
      const baseName = stripExtension(file)
      if (seenBaseNames.has(baseName)) return null
      seenBaseNames.add(baseName)

      const migrated = await readAndMigrate(
        p => fileService.read(p).catch(() => null),
        (p, c) => fileService.write(p, c),
        `${projectPath}/detailed_outline`,
        baseName,
      )
      if (!migrated) throw new Error('文件读取失败')

      const parsed = tryParseJsonOrYaml(migrated.content)
      if (!parsed) throw new Error('格式解析失败')

      const ch = parsed.obj as DetailedChapter
      if (!ch.id) ch.id = baseName
      if (!ch.title) ch.title = baseName
      const fileSummary = await loadSummary(projectPath, ch.id).catch(() => '')
      if (fileSummary) ch.summary = fileSummary
      return ch
    }))

    const chapters: DetailedChapter[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        chapters.push(r.value)
        seenIds.add(r.value.id || '')
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

        let status: ChapterStatus = 'incomplete'
        const statusMatch = content.match(/^状态: (\w+)$/m)
        if (statusMatch && ['incomplete', 'completed'].includes(statusMatch[1])) {
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
        chapters.push({ id: file.replace('.txt', ''), title: '', description: '', summary: '', order: 0, status: 'incomplete' })
      }
    }

    // Fallback: .md files (AI may have created before format fix)
    const mdFiles = files.filter(f => {
      if (!f.endsWith('.md')) return false
      const id = f.replace('.md', '')
      return !seenIds.has(id)
    })

    for (const file of mdFiles) {
      try {
        const content = await fileService.read(`${projectPath}/detailed_outline/${file}`)
        const id = file.replace('.md', '')
        // Parse Markdown: first # heading is title, rest is plotOverview
        const lines = content.split('\n')
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '')
        const body = content.replace(/^#\s+.+\n*/m, '').trim()
        chapters.push({
          id, title, order: 0, status: 'incomplete',
          description: body, summary: '',
          plotOverview: body.slice(0, 500),
        })
        seenIds.add(id)
      } catch (e) {
        logError(`解析细纲MD文件失败: ${file}`, e)
      }
    }

    chapters.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    // Normalize order to 0-based index (AI may write 1-based values)
    chapters.forEach((c, i) => { c.order = i })
    return chapters
  } catch (e) {
    logError('加载细纲列表失败', e)
    return []
  }
}
