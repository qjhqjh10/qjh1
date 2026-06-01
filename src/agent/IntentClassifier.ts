// ── Agent 1: Intent Classifier ──
// Lightweight (~500 token) API call to classify user intent and count requirements.
// No tools, no deep thinking.

import { aiService } from '@/services/fileService'

export type Intent = 'chat' | 'simple' | 'complex'

export interface IntentResult {
  intent: Intent
  requirementCount: number   // 用户提出的独立要求数量
}

const CLASSIFY_PROMPT = `你是一个意图分类器。分析用户消息，输出格式: 意图|要求数

意图判断:
- chat: 纯问候、感谢、闲聊、确认。不需要操作文件。
- simple: 需要读文件或查看信息。1-2个操作即可完成。
- complex: 3个以上独立要求，或多步骤依赖操作（如"先读A再根据A写B"），或需要创建/生成/修改且涉及多个文件。

要求数: 用户消息中明确独立的操作要求数量。如"帮我创建3个角色"=1个要求。"完善世界观、创建角色、写大纲"=3个要求。

只输出: chat|0 / simple|1 / simple|2 / complex|3 等`

/** Classify user intent with a minimal API call */
export async function classifyIntent(
  msg: string,
  configId: string,
): Promise<IntentResult> {
  try {
    const result = await aiService.chat([
      { role: 'system', content: CLASSIFY_PROMPT },
      { role: 'user', content: msg },
    ], configId)

    const text = ((result as any).text || '').trim().toLowerCase()
    const match = text.match(/(chat|simple|complex)\|?(\d+)?/)
    const intent = match?.[1] as Intent || 'chat'
    const count = parseInt(match?.[2] || '0') || 0
    console.log('[Agent1] raw:', JSON.stringify((result as any).text), '→', intent, count)

    if (intent === 'complex' || intent === 'simple' || intent === 'chat') {
      return { intent, requirementCount: count }
    }

    // Fallback: keyword-based
    if (/写|创建|修改|删除|编辑|生成|续写|改|替换|重命名/.test(msg)) return { intent: 'complex', requirementCount: 1 }
    if (/查看|检查|列出|读取|看看|显示|搜索|找/.test(msg)) return { intent: 'simple', requirementCount: 1 }
    return { intent: 'chat', requirementCount: 0 }
  } catch (e) {
    console.error('[Agent1] classification failed:', e)
    return { intent: 'complex', requirementCount: 1 }
  }
}
