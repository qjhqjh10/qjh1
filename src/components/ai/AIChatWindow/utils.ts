import { useSettingsStore } from '@/store'
import { WELCOME_MSG } from '@/components/ai/chatConstants'
import type { Message, Conversation } from '@/components/ai/chatConstants'

export function makeConversation(id: string, title: string): Conversation {
  const showWelcome = useSettingsStore.getState().aiSettings.showWelcome !== false
  const activeTemplateId = useSettingsStore.getState().aiSettings.activeRoleTemplateId || ''
  return { id, title, messages: showWelcome ? [{ ...WELCOME_MSG, id: `welcome_${id}` }] : [], createdAt: Date.now(), totalTokens: 0, lastPromptTokens: 0, peakPromptTokens: 0, roleTemplateId: activeTemplateId || undefined }
}

export function parsePopupCommand(text: string): { text: string; popup?: { type: 'outline' | 'worldbuilding' | 'draft' | 'kb'; title: string; documentKey?: string }; genTrigger?: string } {
  // Check for chapter gen trigger first
  const genMatch = text.match(/【生成(?:第(\S+?)章|本章)】/)
  if (genMatch) {
    const chapId = genMatch[1] // undefined for "生成本章" (current chapter)
    return { text: text.replace(genMatch[0], '').trim(), genTrigger: chapId || '__current__' }
  }

  const patterns: { pattern: RegExp; type: 'outline' | 'worldbuilding' | 'draft' | 'kb'; title: string; documentKey?: string }[] = [
    { pattern: /【打开大纲】/, type: 'outline', title: '大纲' },
    { pattern: /【打开世界观】/, type: 'worldbuilding', title: '世界观' },
    { pattern: /【打开草稿(?:[：:]\s*(.+?))?】/, type: 'draft', title: '草稿本', documentKey: '草稿本.md' },
    { pattern: /【打开知识库】/, type: 'kb', title: '知识库' },
  ]
  for (const p of patterns) {
    const match = text.match(p.pattern)
    if (match) {
      const docKey = p.type === 'draft' ? (match[1]?.trim() || '草稿本.md') : undefined
      return { text: text.replace(p.pattern, '').trim(), popup: { type: p.type, title: p.title, documentKey: docKey } }
    }
  }
  return { text }
}

/**
 * Detect when the AI claims it performed an action (e.g. "已创建", "已修改")
 * but didn't actually call the corresponding tool. Returns a warning string
 * or null if no hallucination detected.
 */
export function detectHallucination(text: string, toolsCalled: Set<string>): string | null {
  if (!text) return null

  const checks: { pattern: RegExp; tools: string[]; label: string }[] = [
    { pattern: /(?:已经|已).{0,10}(创建|新建|生成|写入|写好|做好|添加了)/, tools: ['create_file', 'create_project', 'generate_image'], label: '创建/生成' },
    { pattern: /(?:已经|已).{0,10}(修改|编辑|更新|替换|改写|改成|调整了|调整好)/, tools: ['edit_file', 'rename_file', 'create_file'], label: '修改/编辑' },
    { pattern: /(?:已经|已).{0,10}(读取|查看|读过|看过|查阅)/, tools: ['read_file', 'list_directory'], label: '读取/查看' },
    { pattern: /(?:已经|已).{0,10}(删除|移除|去掉)/, tools: ['delete_file'], label: '删除' },
    { pattern: /(?:已经|已).{0,10}(保存|存储)/, tools: ['create_file', 'edit_file', 'kb_append_file'], label: '保存/写入' },
    { pattern: /(?:已经|已).{0,10}(搜索|检索|查找|找到)/, tools: ['search_content', 'list_directory'], label: '搜索' },
    { pattern: /(?:已经|已).{0,10}(追加|写入)/, tools: ['edit_file', 'create_file', 'kb_append_file'], label: '追加/写入' },
  ]

  for (const check of checks) {
    if (check.pattern.test(text)) {
      const hasTool = check.tools.some(t => toolsCalled.has(t))
      if (!hasTool) {
        return `[系统提示] AI回复中声称"${check.label}"操作，但在本轮对话中未实际调用对应工具。以下内容可能不准确，建议要求AI重新执行并确认工具调用结果。`
      }
    }
  }
  return null
}

/**
 * v14.2.0: 跨 run 续跑注入 — 检测对话最后一条 assistant 消息携带的"中断未完成"任务清单，
 * 生成 [续跑] system 提示消息追加到 history 尾部（新历史在 runtime 中位于用户消息之前）。
 * 条件: taskProgress 存在 && !allDone（未全部完成）&& interrupted（中断/超时/迭代耗尽/API失败）。
 * 正常完成（allDone=true）或无任务清单 → 原样返回 history，不注入。
 * 纯函数不改入参，便于单测。
 */
export function maybeInjectResume(
  history: Array<{ role: string; content: string }>,
  messages: Message[],
): Array<{ role: string; content: string }> {
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const tp = lastAssistant?.taskProgress
  if (!tp || tp.allDone || !tp.interrupted) return history

  const total = tp.tasks.length
  const doneCount = tp.tasks.filter(t => t.done).length
  const doneList = tp.tasks.filter(t => t.done).map(t => `${t.id})${t.desc}`).join('；')
  const remainingList = tp.tasks.filter(t => !t.done).map(t => `${t.id})${t.desc}`).join('；')
  const content = `[续跑] 上一轮运行中断于任务 ${doneCount}/${total}，任务未全部完成。已完成: ${doneList || '无'}。剩余: ${remainingList}。请直接继续完成剩余任务，不要重新开始或重复已完成的工作。全部完成后明确说"全部完成"。`
  return [...history, { role: 'system', content }]
}

/**
 * v14.3: 子代理快照注入 — 检测对话中最后一条携带 subagentSummaries 的 assistant 消息，
 * 生成 [子代理快照] system 提示消息追加到 history 尾部（新历史在 runtime 中位于用户消息之前）。
 * 目的：子代理的分析/修改/验收结论跨 run 复用——主代理不必重新委托即可引用上次结果。
 * 反向扫描（最后一条纯聊天的 assistant 不拦截其之前有快照的消息）；
 * 最多注入 opts.maxEntries 条（默认 3），每条 detail 截 opts.detailChars（默认 800）。
 * 纯函数不改入参，便于单测。
 */
export function maybeInjectSubagentSummaries(
  history: Array<{ role: string; content: string }>,
  messages: Message[],
  opts?: { maxEntries?: number; detailChars?: number },
): Array<{ role: string; content: string }> {
  const maxEntries = opts?.maxEntries ?? 3
  const detailChars = opts?.detailChars ?? 800
  const lastWithSummaries = [...messages].reverse().find(m => m.role === 'assistant' && (m.subagentSummaries?.length ?? 0) > 0)
  const summaries = lastWithSummaries?.subagentSummaries
  if (!summaries || summaries.length === 0) return history

  const lines = summaries.slice(-maxEntries).map((s, i) => {
    const detail = (s.detail || '').slice(0, detailChars)
    const statusMark = s.status === 'error' ? '✗' : '✓'
    return `${i + 1}. [${s.tool}] ${s.filePath || '(无路径)'} — ${statusMark} ${s.summary || ''}${detail ? `\n   ${detail}` : ''}`
  })
  const content = `[子代理快照] 上次委托子代理的结果（信息为当时快照，文件可能已修改；需要最新内容请重新委托分析）:\n${lines.join('\n')}`
  return [...history, { role: 'system', content }]
}

