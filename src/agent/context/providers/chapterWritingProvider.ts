import type { ContextProvider } from '../ContextAssembler'
import { fileService } from '@/services/fileService'
import { extractChapterTail, extractSummary } from '../contentExtractor'

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

    if (isContinuation) {
      try {
        const files = await fileService.listDir(`${projectId}/chapters`)
        const txtFiles = files.filter((f: string) => f.endsWith('.txt')).sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, '')) || 0
          const numB = parseInt(b.replace(/\D/g, '')) || 0
          return numA - numB
        })
        if (txtFiles.length > 0) {
          const latestFile = txtFiles[txtFiles.length - 1]
          const chId = latestFile.replace('.txt', '')
          const parts: string[] = [`## 续写上下文 — 最新章节 ${chId}`, '']

          try {
            const content = await fileService.read(`${projectId}/chapters/${latestFile}`)
            const tail = extractChapterTail(content, 2500)
            parts.push('### 上一章末尾', tail, '')
          } catch { /* file read error */ }

          try {
            const summary = await fileService.read(`${projectId}/summaries/${chId}.md`)
            if (summary && summary.trim()) {
              parts.push('### 上一章摘要', extractSummary(summary, 600), '')
            }
          } catch { /* no summary */ }

          return { domain: 'chapter-writing', priority: 70, estimatedTokens: Math.min(Math.ceil(parts.join('\n').length / 3), 3500), content: parts.join('\n') }
        }
      } catch { /* directory error */ }
    }

    return { domain: 'chapter-writing', priority: 70, estimatedTokens: 200, content: STATIC_DOC }
  },
}
