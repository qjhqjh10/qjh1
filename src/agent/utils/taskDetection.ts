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

// ═══════════════════════════════════════════════════════════════
//  v9.5.5: 任务复杂度评分 — 替代二元 isMultiFile 正则
// ═══════════════════════════════════════════════════════════════
//
// 聚合多个信号加权评分，score >= 3 触发 SKILL 模式（工具裁剪 + 步骤追踪）。
// 替代 V4AgentChatBridge:163 和 V4AnthropicChatBridge:203 的单一正则。

/** 小说创作实体词 — 项目文件中存在的文件夹/文件类型 */
const ENTITY_KEYWORDS = /(?:文件|yaml|yml|md|txt|json|角色卡|人物卡|章节|模板|笔记|大纲|细纲|设定|场景|知识库|摘要|草稿|角色|人物|Tab|tab|items\.yaml|locations\.yaml|factions\.yaml|power_system|outline_meta|emotion\.yaml|characters|chapters|outline|detailed_outline|summaries|notes|knowledge_base|style_templates|scene_templates)/u

/** 批量操作量词 — 暗示需要处理多个对象 */
const BATCH_QUANTIFIER = /(?:每个|所有|各个|全部|分别|每[章节篇个]|批量|整批|一批|全都|全部.|所有.|\d+个|\d+\s*个)/u

/** 编排类动词 — 天然需要多步骤才能完成 */
const ORCHESTRATION_VERBS = /(?:补充完整|完善|整理|梳理|统一|批量处理|逐一|逐个|逐[章节篇个]|补齐|补全|全部补|填充.*Tab|填充.*tab|给我写|都写|都做|都.*一遍)/u

/** 任务分解语言标记 — 用户显式规划了多步操作 */
const DECOMPOSE_MARKERS = /(?:先.*再|然后|接着|之后|第一步|第二步|第[一二三]步|^\s*[1-9][、.）\)]\s*\S)/mu

/** 实体类型 → 类别映射 — 用于检测消息中提到了几类不同实体 */
const ENTITY_TYPE_MAP: Array<[RegExp, string]> = [
  [/角色卡|人物卡|角色|人物|男主|女主|配角|反派|characters?\b/u, 'character'],
  [/大纲|outline|plot|worldbuilding|世界观|剧情/u, 'outline'],
  [/细纲|detailed.outline/u, 'detailed-outline'],
  [/第.{0,3}[章节]|章节|chapter\d|chapters?\b|正文|续写/u, 'chapter'],
  [/模板|template|风格|文风|场景模板|仿写/u, 'template'],
  [/笔记|note|草稿/u, 'note'],
  [/知识库|kb|素材/u, 'kb'],
  [/摘要|summar(y|ies)/u, 'summary'],
]

/**
 * 任务复杂度评分（0-11）。
 *
 * 评分信号:
 *   +3: 批量量词 + 小说实体（"所有角色卡""每个章节文件"）
 *   +2: 编排动词 + 批量量词（"批量补充完整""逐一完善"）
 *   +2: 任务分解标记（"先读大纲然后创建角色"）
 *   +2: 原始 isMultiFile 正则命中（向后兼容 v9.5.4）
 *   +1: 消息提到 ≥2 类不同实体（如"角色卡和大纲"）
 *   +1: 消息长度 > 200 字（长消息更可能是复杂任务）
 *
 * @returns 0-11 的复杂度评分
 */
export function scoreTaskComplexity(message: string): number {
  let score = 0

  // Signal 1: 批量量词 + 小说实体（权重最高，最可靠的多文件信号）
  if (BATCH_QUANTIFIER.test(message) && ENTITY_KEYWORDS.test(message)) {
    score += 3
  }

  // Signal 2: 编排动词 + 批量量词（"批量补充完整所有角色卡"）
  if (ORCHESTRATION_VERBS.test(message) && BATCH_QUANTIFIER.test(message)) {
    score += 2
  }

  // Signal 3: 任务分解语言（用户显式列出了步骤）
  if (DECOMPOSE_MARKERS.test(message)) {
    score += 2
  }

  // Signal 4: 原始 isMultiFile 正则（向后兼容 v9.5.4）
  if (/(?:每个|所有|各个|全部|分别).*(?:tab|文件|yaml|md)|(?:填写|创建|写入).*(?:各个|多个|每个)/i.test(message)) {
    score += 2
  }

  // Signal 5: 消息中涉及 ≥2 类不同实体类型（如"角色卡和大纲"）
  const entityTypes = new Set<string>()
  for (const [re, type] of ENTITY_TYPE_MAP) {
    if (re.test(message)) entityTypes.add(type)
  }
  if (entityTypes.size >= 2) {
    score += entityTypes.size - 1  // 2 类 +1, 3 类 +2, ...
  }

  // Signal 6: 长消息更可能是复杂任务
  if (message.length > 200) {
    score += 1
  }

  return score
}

/** SKILL 模式阈值: score >= 3 视为复杂任务 */
const SKILL_MODE_THRESHOLD = 3

/**
 * 快捷判断：消息是否属于复杂任务（应启用 SKILL 模式）。
 * 替代旧的 isMultiFile 二元正则。
 */
export function isComplexTask(message: string): boolean {
  return scoreTaskComplexity(message) >= SKILL_MODE_THRESHOLD
}
