// ── Unified Task Detection ──
// Single source of truth for detecting whether a user message is task-oriented
// (requires tools) or pure chat (no tools needed).
// Used by both AgentRuntime and ContextAssembler.
// Note: single-char keywords like 写/改/帮我 removed to reduce false positives on casual chat.

// Unified TASK_KEYWORDS — single source of truth for task detection.
// Used by: coreRulesProvider, AgentRuntime, ContextAssembler, planWorkflowProvider
// Excludes single-char keywords (写/改/查等) to avoid false positives on casual chat.
const TASK_KEYWORDS = /创建|新建|修改|编辑|删除|生成|写入|添加|追加|读取|查看|列出|搜索|笔记|草稿|知识库|素材|图片|模板|风格|场景|提示词|prompt|项目|project|规则|学习|写一|改一|帮我写|帮我改|帮我创建|帮我编辑|大纲|细纲|章节|角色|人物|剧情|世界观|续写|仿写|分析|总结|替换|重命名|移动|复制|导出|备份|检查|诊断|修复|优化|整理|梳理|扩充|精简|润色|改写|重写|规划|导入|第\d+章|第[一二三四五六七八九十百千]+章|写.{0,3}章|改.{0,3}章|生成.{0,3}章|创作.{0,3}章/u

/**
 * Returns true if the message is task-oriented (should enable tools).
 * Returns false for pure chat messages (no tools needed, saves ~5000 tokens/round).
 */
export function isTaskMessage(message: string): boolean {
  return TASK_KEYWORDS.test(message)
}
