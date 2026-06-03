import type { ContextProvider } from '../ContextAssembler'
import { extractSummary } from '../contentExtractor'
import { estimateTokens } from '../../utils/tokenEstimation'
import { cachedRead } from '../FileCache'

export const coreRulesProvider: ContextProvider = {
  domain: 'core-rules',
  relevance: (userMessage) => {
    if (!userMessage || userMessage.trim().length < 5) return 0.1
    if (/^(你好|谢谢|再见|嗯|哦|哈哈|好的|知道了|ok|hi|hello|thanks|bye)[!！。.]?$/i.test(userMessage.trim())) return 0.0
    return 0.8
  },

  buildContext: async (projectId, _userMessage) => {
    let feedbackContent = ''
    try {
      const raw = await cachedRead('.aiharness/feedback/auto-suggestions.md', projectId)
      if (raw && raw.trim()) {
        const sections = raw.split('## 自动反馈')
        const lastSection = sections[sections.length - 1]
        if (lastSection && lastSection.trim().length > 20) {
          feedbackContent = '\n\n## 历史经验\n' + extractSummary(lastSection, 500)
        }
      }
    } catch { /* first session */ }

    return {
      domain: 'core-rules',
      priority: 100,
      estimatedTokens: 250 + estimateTokens(feedbackContent),
      content: [
        '你是一位专业的小说写作助手，通过工具直接操作项目文件。',
        '',
        '## 核心规则',
        '1. 不调工具说"已完成"=欺骗。不调工具说"没权限"=幻觉。',
        '2. 找文件用 list_directory，读内容用 read_file，搜文本用 search_content。每个工具各司其职。',
        '3. 编辑前read_file确认。失败最多重试1次。',
        feedbackContent,
      ].filter(Boolean).join('\n'),
    }
  },
}
