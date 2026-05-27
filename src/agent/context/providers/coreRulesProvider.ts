import type { ContextProvider } from '../ContextAssembler'

export const coreRulesProvider: ContextProvider = {
  domain: 'core-rules',
  relevance: () => 1.0,

  buildContext: async () => {
    // Read feedback suggestions if available
    let feedbackContent = ''
    try {
      const { fileService } = await import('@/services/fileService')
      const raw = await fileService.read('.aiharness/feedback/auto-suggestions.md')
      if (raw && raw.trim()) {
        // Extract last 2 suggestions (most recent)
        const sections = raw.split('## 自动反馈')
        const lastSection = sections[sections.length - 1]
        if (lastSection && lastSection.trim().length > 20) {
          feedbackContent = '\n\n## 系统反馈（来自历史会话的经验）\n' + lastSection.slice(0, 2000)
        }
      }
    } catch { /* feedback file not yet created — normal for first session */ }

    return {
      domain: 'core-rules',
      priority: 100,
      estimatedTokens: 450 + Math.ceil(feedbackContent.length / 3),
      content: [
        '你是 AI 小说写作助手 Agent，运行在 Harness Agent 引擎中。',

        '## 铁律（不可绕过）',
        '1. 口头描述 ≠ 操作完成。只有工具返回 status:"success" 才算完成。',
        '2. 所有文件操作限于当前项目目录内，路径不可越界。',
        '3. 精准执行：只做用户要求的操作，不确定时先询问。',

        '## 操作流程',
        '- 写操作前必须先 read_file 确认目标文件现状',
        '- 编辑用 edit_file 精确替换，old_string 与原文精确匹配；失败则用 old_string="__FULL_REPLACE__" 全量替换',
        '- 读取时优先直接路径，避免遍历整个目录',
        '- 创建 JSON 时系统自动校验格式，失败根据错误提示修正',

        '## 金规则（编码约束）',
        '1. 共享优先：重复代码抽取到 utils/，单个文件不超过 500 行',
        '2. 边界校验：JSON 文件必须通过 schema 校验',
        '3. 修改前先读：写操作前必须 read_file',
        '4. 失败即记录：连续 3 次失败自动 learn_rule',

        '## 导航',
        '需要详细信息时，用 read_file 读取对应文件，不要猜测：',
        '- 项目结构 & 数据格式: .aiharness/rules/project-structure.md',
        '- 金规则详情: .aiharness/rules/golden-rules.md',
        '- Harness 配置: .aiharness/aiharness.json',
        '- 已学习规则: .aiharness/rules/auto-learned/（list_rules 列出）',
        '- 项目顶级导航: AGENTS.md',
        feedbackContent,
      ].filter(Boolean).join('\n'),
    }
  },
}
