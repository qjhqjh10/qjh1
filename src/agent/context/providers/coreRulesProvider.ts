import type { ContextProvider } from '../ContextAssembler'
import { extractSummary } from '../contentExtractor'
import { isTaskMessage } from '../../utils/taskDetection'

export const coreRulesProvider: ContextProvider = {
  domain: 'core-rules',
  relevance: (userMessage) => {
    // V1-3: Dynamic relevance gating — avoid injecting ~800 tokens of core rules
    // into simple greetings or casual chat that doesn't need tools
    if (!userMessage || userMessage.trim().length < 5) return 0.1
    if (isTaskMessage(userMessage)) return 0.8  // task messages need rules
    if (/^(你好|谢谢|再见|嗯|哦|哈哈|好的|知道了|ok|hi|hello|thanks|bye)[!！。.]?$/i.test(userMessage.trim())) return 0.0
    return 0.4  // non-task messages: below default 0.4 threshold → only included if explicitly relevant
  },

  buildContext: async (projectId, userMessage) => {
    const isTask = userMessage && isTaskMessage(userMessage)

    // V2-2: Use MemoryIndex (compact pointer list) instead of verbose projectSummary
    let projectIndex = ''
    if (projectId && isTask) {
      try {
        const { buildMemoryIndex } = await import('../MemoryIndex')
        projectIndex = await buildMemoryIndex(projectId)
      } catch { /* best effort */ }
    }

    let feedbackContent = ''
    try {
      const { fileService } = await import('@/services/fileService')
      const raw = await fileService.read('.aiharness/feedback/auto-suggestions.md')
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
      estimatedTokens: 250 + Math.ceil((projectIndex.length + feedbackContent.length) / 3),
      content: [
        '你是一位专业的小说写作助手，通过工具直接操作项目文件。',

        '## 核心规则',
        '1. 你没调工具就说"已完成"=欺骗。没调工具就说"没权限"=幻觉。你拥有所有工具的使用权。',
        '2. 理解用户意图再行动。查看/了解内容→直接 read_file 定位文件，不要先 list_directory。',
        '3. 编辑前先 read_file 确认内容。创建 JSON 文件→系统自动校验格式→按错误提示修正。',
        '4. 完成后报告结果。不要反复调用同一工具。不确定时用工具查找，不要编造理由。',

        projectIndex ? `\n${projectIndex}` : '',

        '\n## 项目导航',
        '需要了解项目结构或规则详情时，用 read_file 读取：',
        '- 项目结构: .aiharness/rules/project-structure.md',
        '- 编码约束: .aiharness/rules/golden-rules.md',
        '- 小说约束: .aiharness/rules/novel-constraints.md',
        '- 配置: .aiharness/aiharness.json',

        feedbackContent,
      ].filter(Boolean).join('\n'),
    }
  },
}
