// ── Unified Task Detection ──
// Single source of truth for detecting whether a user message is task-oriented
// (requires tools) or pure chat (no tools needed).
// v13.x: 移除 v9.5.5 的 SKILL 复杂度评分体系（scoreTaskComplexity/isComplexTask
// 及辅助正则全库无调用方——SKILL 模式已废弃），保留实际使用的分类函数。

// ═══════════════════════════════════════════════════════════════
//  v11.5.1: 统一消息分类 — 替代 Bridge 中内联的 isChatOnly/hasTaskKeywords
//  和 Runtime 中私有的 _isChatQuestion
// ═══════════════════════════════════════════════════════════════

/** 纯寒喧检测 — 极窄匹配，用于决定是否跳过 Provider 上下文加载 */
const PURE_GREETING_RE = /^(你好|谢谢|再见|嗯|哦|哈哈|好的|知道了|ok|hi|hello|thanks|bye|早上好|晚上好|下午好|晚安|早|在吗|在不在|你是谁|你叫什么|你能做什么|你有什么功能)[!！。.，,～~]*$/i

export function isPureGreeting(msg: string): boolean {
  return PURE_GREETING_RE.test(msg.trim())
}

/** 知识问答检测 — 宽匹配，用于决定是否跳过 nudge（理解类问题不需要操作文件）
 *  v12.14.0: 保留正则用于快速过滤明显的知识问答。路由判断由 prompt 意图描述 + LLM 完成。
 *  此正则只影响 Nudge 是否触发，不影响决策分支选择。 */
const KNOWLEDGE_ONLY_RE = /^(你好|谢谢|再见|嗯|哦|哈哈|好的|知道了|ok|hi|hello|thanks|bye|早上好|晚上好|下午好|晚安|早|在吗|在不在|你是谁|你叫什么|你能做什么|你有什么功能|你了解|你知道|介绍一下|什么是|是什么意思|怎么[样么]|告诉我|解释一下|说明一下|有没有|检查.*(?:一下|自己|限制)|查一下)/i

export function isKnowledgeOnly(msg: string): boolean {
  const m = msg.trim()
  if (!KNOWLEDGE_ONLY_RE.test(m)) return false
  // 排除创作操作关键词（"你了解XX吗，请帮我写大纲" → 不是纯知识问答）
  const hasCreationOp = /帮我.*(?:写|创建|生成|修改|填充|填|导入|续写|仿写)|写第|创建.*[角色项目模板]|生成.*[章节细纲]|修改.*[大纲角色]|填充.*tab|导入到|填写.*[大纲项目]|润色|续写|仿写|[创编]写.*[章节小说文]|[生创]成.*[章节角色]/.test(m)
  return !hasCreationOp
}

/** 任务关键词检测 — 用于 Runtime _userRequestedFileOp 门控
 *  v12.16.5: 移除单字关键词(写|改|搜|画|图)避免聊天误判
 *  只保留明确表示文件操作的多字动词 */
/** 任务关键词检测 — 用于 Runtime _userRequestedFileOp 门控
 *  v12.16.5: 移除单字关键词(写|改|搜|画|图)避免聊天误判。
 *  匹配写操作动词(创建/修改/删除等)和任务短语(帮我X/写到/存到等) */
const TASK_KEYWORDS_FOR_INDEX = /帮我写|帮我改|帮我创建|帮我做|创建|新建|生成|写入|修改|编辑|删除|追加|保存|填充|导入|导出|整理|替换|重命名|续写|仿写|润色|扩充|精简|重写|写到|存到|放入|写一下|改一下|写第|改第|填一下|做一下|生成一下|创建一下|加到|补给|补上|更新|覆盖|全部写|全部改|都写|都改|填充一下/i

export function hasTaskKeywords(msg: string): boolean {
  return TASK_KEYWORDS_FOR_INDEX.test(msg)
}

