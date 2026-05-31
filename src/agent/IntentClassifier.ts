// ── Agent 1: Intent Classifier ──
// Lightweight (~500 token) API call to classify user intent.
// No tools, no deep thinking — just output one word: chat / simple / complex.

import { aiService } from '@/services/fileService'

export type Intent = 'chat' | 'simple' | 'complex'

const CLASSIFY_PROMPT = `你是一个意图分类器。分析用户消息，只输出一个词。

规则:
- 包含"查看/检查/列出/读取/看看/显示/搜索/找"等词 → simple (需要读文件)
- 包含"写/创建/修改/删除/编辑/生成/续写"等词 → complex (需要多步操作)
- 纯问候、感谢、闲聊、确认 → chat (不需要操作)

只输出一个词: chat / simple / complex`

/** Classify user intent with a minimal API call */
export async function classifyIntent(
  msg: string,
  configId: string,
): Promise<Intent> {
  try {
    const result = await aiService.chat([
      { role: 'system', content: CLASSIFY_PROMPT },
      { role: 'user', content: msg },
    ], configId)

    const text = ((result as any).text || '').trim().toLowerCase()
    console.log('[Agent1] raw:', JSON.stringify((result as any).text), '→',
      text.includes('complex') ? 'complex' : text.includes('simple') ? 'simple' : 'chat')

    // Model classification
    if (text.includes('complex')) return 'complex'
    if (text.includes('simple')) return 'simple'
    if (text.includes('chat')) return 'chat'

    // Fallback: keyword-based
    if (/写|创建|修改|删除|编辑|生成|续写|改|替换|重命名|移动|复制|导出|备份|清理|修复/.test(msg)) return 'complex'
    if (/查看|检查|列出|读取|看看|显示|搜索|找|查|读|打开|浏览|进入/.test(msg)) return 'simple'
    return 'chat'
  } catch (e) {
    console.error('[Agent1] classification failed:', e)
    return 'complex'
  }
}
