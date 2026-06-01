import type { ContextProvider } from '../ContextAssembler'
import { fileService } from '@/services/fileService'
import { cachedRead } from '../FileCache'
import { extractChapterTail, extractSummary } from '../contentExtractor'
import { estimateTokensFromLines } from '../../utils/tokenEstimation'

const STATIC_DOC = [
  '## 章节写作',
  '',
  '章节正文: chapters/{id}.txt  摘要: summaries/{id}.md',
  '写作流程: 1.读细纲 2.读角色 3.读大纲 4.撰写 5.生成摘要',
  '注意: 章节是 .txt，细纲是 .json，大纲是 .md，格式不同。',
].join('\n')

export const chapterWritingProvider: ContextProvider = {
  domain: 'chapter-writing',
  relevance: (userMessage) => {
    if (/生成.*正文|写本章|生成本章|写.*第.*章/.test(userMessage)) return 1.0
    if (/续写|接着写|继续写|接着上/.test(userMessage)) return 0.9
    if (/章节|写作|chapter|生成.*章|写.*章|正文|创作/i.test(userMessage)) return 0.8
    return 0.2
  },

  buildContext: async (projectId, userMessage) => {
    if (!projectId) {
      return { domain: 'chapter-writing', priority: 70, estimatedTokens: 200, content: STATIC_DOC }
    }

    const msg = userMessage || ''
    const isContinuation = /续写|接着写|继续写|接着上/.test(msg)

    // Detect chapter number from message (e.g. "写第3章" → 3)
    const chapterMatch = msg.match(/第\s*(\d+)\s*章/)
    const targetChapterNum = chapterMatch ? parseInt(chapterMatch[1]) : null

    // Inject previous chapter context when:
    // 1. Explicit continuation ("续写") → inject latest chapter
    // 2. Writing chapter N where N>1 ("写第3章") → inject chapter N-1
    const needsPreviousChapter = isContinuation || (targetChapterNum !== null && targetChapterNum > 1)

    if (needsPreviousChapter) {
      try {
        const files = await fileService.listDir(`${projectId}/chapters`)
        const txtFiles = files.filter((f: string) => f.endsWith('.txt')).sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, '')) || 0
          const numB = parseInt(b.replace(/\D/g, '')) || 0
          return numA - numB
        })

        // Find the specific previous chapter file, or fall back to latest
        let prevFile: string | null = null
        if (targetChapterNum !== null && targetChapterNum > 1) {
          // Find chapter N-1 by matching file numbers
          const prevNum = targetChapterNum - 1
          prevFile = txtFiles.find((f: string) => {
            const num = parseInt(f.replace(/\D/g, ''))
            return num === prevNum
          }) || null
        }
        // Fallback: use latest chapter
        if (!prevFile && txtFiles.length > 0) {
          prevFile = txtFiles[txtFiles.length - 1]
        }

        if (prevFile) {
          const chId = prevFile.replace('.txt', '')
          const label = targetChapterNum ? `写第${targetChapterNum}章 — 前章(${chId})上下文` : `续写上下文 — 最新章节 ${chId}`
          const parts: string[] = [`## ${label}`, '']

          try {
            const content = await cachedRead(`${projectId}/chapters/${prevFile}`)
            const tail = extractChapterTail(content, 50)  // C6: 50 trailing lines, not 2500 (was line count, not char count)
            parts.push('### 上一章末尾', tail, '')
          } catch { /* file read error */ }

          try {
            const summary = await cachedRead(`${projectId}/summaries/${chId}.md`)
            if (summary && summary.trim()) {
              parts.push('### 上一章摘要', extractSummary(summary, 600), '')
            }
          } catch { /* no summary */ }

          return { domain: 'chapter-writing', priority: 70, estimatedTokens: Math.min(estimateTokensFromLines(parts), 3500), content: parts.join('\n') }
        }
      } catch { /* directory error */ }
    }

    return { domain: 'chapter-writing', priority: 70, estimatedTokens: 200, content: STATIC_DOC }
  },
}
