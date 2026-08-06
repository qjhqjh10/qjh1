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

  // v14.6.1: 否定/存在语境排除——"文件已存在，无需创建""无法写入""未能保存"等
  // 命中"已…创建/写入"正则但并非声称已执行操作，原实现会误报幻觉
  const NEGATION_RE = /无需|不用|不需要|不能|无法|没能|未能|失败|不成功|未成功|已存在|已经存在|已有了|已经有了|不存在|无法保存/

  for (const check of checks) {
    if (check.pattern.test(text)) {
      if (NEGATION_RE.test(text)) continue
      const hasTool = check.tools.some(t => toolsCalled.has(t))
      if (!hasTool) {
        return `[系统提示] AI回复中声称"${check.label}"操作，但在本轮对话中未实际调用对应工具。以下内容可能不准确，建议要求AI重新执行并确认工具调用结果。`
      }
    }
  }
  return null
}

// v14.9(审计): 续跑意图判定——只有用户消息含继续语义时才注入 [续跑] 并恢复旧清单。
// 原实现无差别触发：中断后问无关问题也会被 [续跑] + 旧清单门控劫持（nudge 拽回旧任务）。
// 与 AIChatWindow/index.tsx 的 resumeTaskProgress 传参共用同一判定。
export const RESUME_INTENT_RE = /继续|接着|续写|把剩下|剩下的|剩余|还没|未完成|未完|中断|上次|继续完成|接着做|下一步|还有.{0,8}(?:任务|项|章)/

/** 判断用户消息是否表达"继续完成之前任务"的意图 */
export function hasResumeIntent(userMessage: string | null | undefined): boolean {
  return !!userMessage && RESUME_INTENT_RE.test(userMessage)
}

/**
 * v14.9(接线): 「执行计划」卡片数据源——从 run 实际执行记录回溯生成。
 * 历史：v14.0 删除 ThinkingEngine（原计划生成器）→ v14.5 删除 parseThinkingPlan →
 * UI 面板无写入点成为死 UI。现以"实际执行的工具步骤"重建：意图=用户请求、步骤=工具轮记录、
 * 文件=从工具参数提取的路径——诚实展示 agent 做了什么（纯聊天/无工具调用时返回 undefined 不显示）。
 */
export function buildThinkingPlanFromRun(
  runResult: { toolCallSteps?: Array<{ tool: string; status: string; summary: string; arguments?: string }> },
  userMessage: string,
): { intent: string; files: string[]; steps: { tool: string; action: string }[] } | undefined {
  const stepsArr = runResult.toolCallSteps || []
  if (stepsArr.length === 0) return undefined
  const steps = stepsArr.map(s => ({ tool: s.tool, action: (s.summary || '').slice(0, 60) }))
  const files = new Set<string>()
  for (const s of stepsArr) {
    try {
      const args = JSON.parse(s.arguments || '{}')
      const p = args.file_path || args.path || args.dir_path || args.new_path
      if (typeof p === 'string' && p) files.add(p)
    } catch { /* 参数解析失败跳过 */ }
  }
  return { intent: (userMessage || '').slice(0, 60), files: [...files].slice(0, 8), steps }
}

/**
 * v15.3.0: #工具提示文本 — 用户通过输入框「#」按钮选择的工具提示。
 * 语义为软提示（suggestion，非强制）：仅告知模型"用户建议可能使用这些工具"，
 * 模型仍自主决定是否使用、使用哪些工具（不被限制/不被强制）。
 * 纯函数便于单测；防御性去重 + 非法名过滤（工具名必须与注册表一致，白名单由调用方保证）。
 */
export function buildToolHintText(toolNames: string[]): string {
  const names = [...new Set((toolNames || []).map(t => t.trim()).filter(t => /^[a-z0-9_]+$/i.test(t)))]
  if (names.length === 0) return ''
  return `[工具提示: 用户建议本轮可能使用到以下工具（仅供参考，非强制——请根据实际任务自主选择合适工具，也可使用其他工具或工具组合）: ${names.map(t => `#${t}`).join(' ')}]`
}

/**
 * v14.2.0: 跨 run 续跑注入 — 检测对话最后一条 assistant 消息携带的"中断未完成"任务清单，
 * 生成 [续跑] 提示消息追加到 history 尾部（新历史在 runtime 中位于用户消息之前）。
 * 条件: taskProgress 存在 && !allDone（未全部完成）&& interrupted（中断/超时/迭代耗尽/API失败）
 *       && 最后一条用户消息含继续意图（v14.9: 防旧清单劫持无关新请求）。
 * 正常完成（allDone=true）或无任务清单 → 原样返回 history，不注入。
 * 纯函数不改入参，便于单测。
 * v14.6.1: role 从 system 改为 user——Anthropic 协议把所有 system 提到顶层参数，
 * 续跑指令离用户消息远、权重低；且每次快照变化都使 system 缓存断点失效。
 * 改为 user 后留在消息序列中紧邻新用户消息（Anthropic 由 adapter 连续 user 合并逻辑并入同轮），
 * 指令权重最大 + system 前缀稳定（缓存断点恢复有效）。
 */
export function maybeInjectResume(
  history: Array<{ role: string; content: string }>,
  messages: Message[],
): Array<{ role: string; content: string }> {
  // v14.9(审计): 新消息无继续意图 → 不注入（旧清单门控也不会被恢复）
  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  if (!lastUser || !hasResumeIntent(String(lastUser.content))) return history
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const tp = lastAssistant?.taskProgress
  if (!tp || tp.allDone || !tp.interrupted) return history

  const total = tp.tasks.length
  const doneCount = tp.tasks.filter(t => t.done).length
  const doneList = tp.tasks.filter(t => t.done).map(t => `${t.id})${t.desc}`).join('；')
  const remainingList = tp.tasks.filter(t => !t.done).map(t => `${t.id})${t.desc}`).join('；')
  const content = `[续跑] 上一轮运行中断于任务 ${doneCount}/${total}，任务未全部完成。已完成: ${doneList || '无'}。剩余: ${remainingList}。请直接继续完成剩余任务，不要重新开始或重复已完成的工作。全部完成后明确说"全部完成"。`
  return [...history, { role: 'user', content }]
}

/**
 * v14.3: 子代理快照注入 — 检测对话中最后一条携带 subagentSummaries 的 assistant 消息，
 * 生成 [子代理快照] 提示消息追加到 history 尾部（新历史在 runtime 中位于用户消息之前）。
 * 目的：子代理的分析/修改/验收结论跨 run 复用——主代理不必重新委托即可引用上次结果。
 * 反向扫描（最后一条纯聊天的 assistant 不拦截其之前有快照的消息）；
 * 最多注入 opts.maxEntries 条（默认 3），每条 detail 截 opts.detailChars（默认 800）。
 * 纯函数不改入参，便于单测。
 * v14.6.1: role 从 system 改为 user（同 maybeInjectResume——Anthropic 顶层 system 远端
 * + 快照文本变化破坏缓存断点；user 注入由 adapter 连续 user 合并逻辑并入新消息轮）。
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
  return [...history, { role: 'user', content }]
}

// ═══ v14.5.1: 从 AIChatWindow/index.tsx 抽取为纯函数（可单测）═══
// 修复两个审计发现:
//   ① 工具轮检测改用 toolCallSteps——会话消息从不持久化 tool_calls（onComplete 只存
//      toolsUsed/toolCallSteps），原检测恒空 → "保留最近5轮工具调用完整记录、让 AI 从错误中
//      学习"是死代码、所有历史直通。toolCallSteps 已落盘，用它构造跨 run 工具记忆：
//      最近 5 个工具轮完整保留，更早的工具轮压缩为 [上轮已完成 N 个操作] 摘要。
//   ② compressedSummary（手动 LLM 压缩摘要）此前在过滤中被剔除 → 压缩=截断、早期决策对
//      模型清零；现作为 system 消息置于历史最前，模型可见摘要（与 [早期对话已折叠] 互补）。
/** 消息是否为"工具轮"（assistant 带 tool_calls 或已落盘的 toolCallSteps） */
function isToolTurn(m: Message): boolean {
  return !!((m as any).tool_calls?.length > 0 || (m as any).toolCallSteps?.length > 0)
}

export function buildHistoryMessages(msgs: Message[]) {
  // v12.6.0: 保留最近5轮有工具调用的完整记录，让AI从错误中学习
  // 更早的轮次使用压缩摘要格式，纯闲聊轮次不计入工具保留配额
  const PRESERVE_TOOL_TURNS = 5  // 保留最近5个"有工具调用"的user turn

  // v14.5.1: 手动 LLM 压缩摘要不再过滤——作为 system 消息注入历史（见函数头注释 ②）
  const compressedSummaries = msgs.filter(m => (m as any).compressedSummary)

  // Step 1: Filter out welcome, compression summaries, display-only
  let filtered = msgs.filter(m =>
    !String(m.id).startsWith('welcome')
    && !(m as any).compressedSummary
    && !(m as any).displayOnly
  )

  // Step 2: Identify user turns that had tool calls
  // v14.5.1: 检测改用 toolCallSteps（生产数据流只持久化 toolCallSteps，无 tool_calls）
  const toolTurnUserIndices: number[] = []
  for (let i = 0; i < filtered.length; i++) {
    if (filtered[i].role !== 'user') continue
    // Look ahead: does the next assistant message have tool calls?
    for (let j = i + 1; j < filtered.length; j++) {
      const fj = filtered[j]
      if (!fj) continue
      if (fj.role === 'assistant') {
        if (isToolTurn(fj)) {
          toolTurnUserIndices.push(i)
        }
        break
      }
      if (fj.role === 'user') break
    }
  }

  // Cap total user messages — v14.3.1: 超过 20 轮时早期轮次不再整体丢弃
  // （长讨论中早期的写作偏好/决策/约定会完全丢失），改为折叠成一条摘要 system 消息
  // （保留最近 8 条早期用户消息的前 60 字，至少留下讨论脉络）
  const allUserIndices: number[] = []
  filtered.forEach((m, i) => { if (m.role === 'user') allUserIndices.push(i) })
  let earlySummary = ''
  if (allUserIndices.length > 20) {
    const cutoff = allUserIndices[allUserIndices.length - 20]
    const earlyMsgs = filtered.slice(0, cutoff)
    const earlyUserTexts = earlyMsgs
      .filter(m => m.role === 'user')
      .map(m => (m.content || '').replace(/\s+/g, ' ').slice(0, 60))
    if (earlyUserTexts.length > 0) {
      earlySummary = `[早期对话已折叠] 此前 ${earlyUserTexts.length} 轮的用户请求要点:\n${earlyUserTexts.slice(-8).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    }
    filtered = filtered.slice(cutoff)
    // Recalculate
    toolTurnUserIndices.length = 0
    allUserIndices.length = 0
    for (let i = 0; i < filtered.length; i++) {
      if (filtered[i].role === 'user') {
        allUserIndices.push(i)
        for (let j = i + 1; j < filtered.length; j++) {
          const fj = filtered[j]
          if (!fj) continue
          if (fj.role === 'assistant') {
            if (isToolTurn(fj)) toolTurnUserIndices.push(i)
            break
          }
          if (fj.role === 'user') break
        }
      }
    }
  }

  // Preserve: last N user turns that HAD tool calls (not just any N user turns)
  const preserveStartIdx = toolTurnUserIndices.length > PRESERVE_TOOL_TURNS
    ? toolTurnUserIndices[toolTurnUserIndices.length - PRESERVE_TOOL_TURNS]
    : 0

  const result: Array<{ role: string; content: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; tool_call_id?: string; thinkingBlocks?: Array<{ thinking: string; signature: string }>; reasoning_content?: string }> = []
  // v14.3.1: 早期轮次折叠摘要（system 消息，置于历史最前）
  if (earlySummary) {
    result.push({ role: 'system', content: earlySummary })
  }
  // v14.5.1: 手动 LLM 压缩摘要（system 消息，紧随早期折叠摘要之后——模型可见压缩点前的决策）
  for (const cm of compressedSummaries) {
    result.push({ role: 'system', content: `[对话压缩摘要] ${typeof cm.content === 'string' ? cm.content : ''}` })
  }

  for (const m of filtered) {
    const msgIdx = filtered.indexOf(m)

    // ── Preserve mode: 最近5轮 → 保留完整 tool_calls + tool results ──
    if (msgIdx >= preserveStartIdx) {
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        // Keep assistant message with tool_calls intact (legacy 数据；新数据流无 tool_calls)
        // v14.5.0: 透传推理内容（thinkingBlocks/reasoningContent）——多轮工具调用时模型可见推理链
        const reasoningContent = (m as any).reasoning_content ?? (m as any).reasoningContent
        result.push({
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.tool_calls,
          thinkingBlocks: (m as any).thinkingBlocks,
          reasoning_content: reasoningContent,
        })
        // Find and append corresponding tool result messages from original msgs
        const tcIds = new Set(m.tool_calls.map(tc => tc.id))
        for (const origMsg of msgs) {
          if (origMsg.role === 'tool' && origMsg.tool_call_id && tcIds.has(origMsg.tool_call_id)) {
            result.push({
              role: 'tool',
              tool_call_id: origMsg.tool_call_id,
              content: origMsg.content || '{}',
            })
          }
        }
        continue
      }
      if (m.role === 'assistant') {
        // v14.5.1: 最近工具轮（toolCallSteps 型）→ 在原文前补工具操作摘要，模型"继续"时可见探索记录
        const steps = (m as any).toolCallSteps as Array<{ tool: string; status: string; summary: string }> | undefined
        const stepsPrefix = steps && steps.length > 0
          ? `[上轮工具: ${steps.map(s => `${s.status === 'success' ? '✓' : '✗'} ${s.tool}`).join(' · ')}]\n`
          : ''
        // Assistant message without tool_calls — pass through
        // v14.5.0: 文本轮同样透传推理内容（thinking 模式的纯文本轮）
        const reasoningContent = (m as any).reasoning_content ?? (m as any).reasoningContent
        result.push({
          role: 'assistant',
          content: stepsPrefix + (m.content || ''),
          thinkingBlocks: (m as any).thinkingBlocks,
          reasoning_content: reasoningContent,
        })
        continue
      }
      if (m.role === 'user') {
        result.push({ role: 'user', content: m.content || '' })
        continue
      }
      // Skip standalone tool messages (they're attached to their parent assistant)
      continue
    }

    // ── Compress mode: 更早的轮次 → 压缩摘要（v14.5.1: 现在真实可达——工具轮检测已修复）──
    if (m.role === 'assistant') {
      const steps = (m as any).toolCallSteps as Array<{ tool: string; status: string; summary: string }> | undefined
      if (steps && steps.length > 0) {
        const doneList = steps.map(s =>
          `${s.status === 'success' ? '✓' : '✗'} ${s.tool}: ${s.summary}`,
        ).join('\n')
        const toolSummary = `[上轮已完成 ${steps.length} 个操作，无需重复——直接基于结果继续]\n${doneList}`
        result.push({ role: 'assistant', content: toolSummary + '\n\n' + (m.content || '') })
        continue
      }
      const tools = (m as any).toolsUsed as string[] | undefined
      if (tools && tools.length > 0) {
        const toolSummary = `[上轮已调用: ${tools.join('、')}，已完成——直接基于结果继续下一步]`
        result.push({ role: 'assistant', content: toolSummary + '\n\n' + (m.content || '') })
        continue
      }
    }
    if (m.role === 'user' || m.role === 'assistant') {
      result.push({ role: m.role, content: m.content || '' })
    }
  }

  return result
}

