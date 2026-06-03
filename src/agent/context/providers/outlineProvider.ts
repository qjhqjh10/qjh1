import type { ContextProvider } from '../ContextAssembler'
import { cachedRead } from '../FileCache'
import { extractMarkdownStructure } from '../contentExtractor'
import { estimateTokens } from '../../utils/tokenEstimation'

const STATIC_DOC = [
  '## 大纲与世界观',
  '',
  '文件位置: outline/plot.md (剧情), outline/worldbuilding.md (世界观)',
  '编辑前先 read_file 确认当前内容。修改用 edit_file，追加用末尾原文做 old_string。',
  '大纲是 .md，细纲是 .yaml，两者文件夹不同。',
].join('\n')

export const outlineProvider: ContextProvider = {
  domain: 'outline',
  relevance: (userMessage) => {
    if (/修改.*outline|编辑.*大纲|写.*大纲/.test(userMessage)) return 1.0
    if (/大纲|剧情|情节|故事线|世界观|设定|worldbuilding|outline|plot/i.test(userMessage)) return 0.9
    // V4: writing/editing chapters needs plot context (where are we in the story?)
    if (/写.*第.*章|创作.*第.*章|生成.*第.*章|续写|修改|编辑|章节/i.test(userMessage)) return 0.6
    return 0.2
  },

  buildContext: async (projectId) => {
    if (!projectId) {
      return { domain: 'outline', priority: 85, estimatedTokens: 200, content: STATIC_DOC }
    }

    const parts: string[] = ['## 当前项目大纲', '']
    let totalTokens = 0

    // Read plot.md — extract structure instead of naive truncation
    try {
      const plot = await cachedRead(`projects/${projectId}/outline/plot.md`, projectId)
      if (plot && plot.trim()) {
        const extracted = extractMarkdownStructure(plot, 2000)
        parts.push('### 故事剧情', extracted, '')
        totalTokens += estimateTokens(extracted)
      }
    } catch { /* file not found */ }

    // Read worldbuilding.md — extract structure
    try {
      const wb = await cachedRead(`projects/${projectId}/outline/worldbuilding.md`, projectId)
      if (wb && wb.trim()) {
        const extracted = extractMarkdownStructure(wb, 1000)
        parts.push('### 世界观设定', extracted, '')
        totalTokens += estimateTokens(extracted)
      }
    } catch { /* file not found */ }

    if (parts.length <= 2) {
      return { domain: 'outline', priority: 85, estimatedTokens: 200, content: '## 大纲\n当前项目暂无大纲文件。\n\n' + STATIC_DOC }
    }

    return { domain: 'outline', priority: 85, estimatedTokens: Math.min(totalTokens, 3000), content: parts.join('\n') }
  },
}
