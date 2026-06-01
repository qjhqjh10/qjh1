import type { Message } from './types'

export function createWelcomeMessage(projectState?: string): Message {
  return {
    id: 'welcome', role: 'assistant',
    content: `你好！我是 AI 写作助手，可以直接操作项目文件来帮你创作小说。${projectState || ''}

常用操作：
• "查看大纲" / "看看角色" — 查看当前项目内容
• "创建新角色" — AI 生成完整角色档案
• "生成第X章" — 根据细纲和风格/场景模板生成章节正文
• "帮我写故事剧情" — 从零开始构建大纲
• "分析这段文字的风格" — 创建风格模板
• "续写这本小说" — 导入未完结作品，AI 续写新章

问"你能做什么"了解我的能力，问"软件有什么功能"了解青剑的全部功能。`,
  }
}

// Default welcome without project state (used when project state unavailable)
export const WELCOME_MSG: Message = createWelcomeMessage()
