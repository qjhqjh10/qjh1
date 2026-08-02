// ── Subagent Service (v15) ──
// 子 agent 工厂：组装独立 V4UnifiedRuntime（独立上下文窗口 + isolatedStore），
// 承担大文件读取/分析/编辑任务，返回结构化结果与 token 用量。
// 上下文隔离核心保证：子 agent 的 messagesForApi 存在于自身 runtime 实例内，
// run() 结束后即弃；主 agent 只接收工具返回值中的结构化 detail。

import { useSettingsStore } from '@/store'
import { V4UnifiedRuntime } from '../runtime/V4UnifiedRuntime'
import { V4SecurityFence } from '../V4SecurityFence'
import { AuditTrail } from '../audit/AuditTrail'
import { createToolExecutor } from '../bridge/toolExecutorFactory'
import { toolRegistry } from '../skills/ToolRegistry'
import { createSubagentAdapter } from './createSubagentAdapter'
import { SUBAGENT_ANALYZE_PROMPT, SUBAGENT_EDIT_PROMPT, SUBAGENT_VERIFY_PROMPT } from './SubagentPrompt'
import { estimateTokens } from '../utils/tokenEstimation'
import type { V4AgentRunResult } from '../runtime/RuntimeTypes'
import type { Message } from '../state/types'

// ── 角色与工具集 ──
// v14.5.1 全自由模式：find_files 两 scope 均免审批（子 agent 可用 scope=computer 定位文件）；
//   1. 系统目录由 IPC 层硬拦截（isBlockedSystemPath）
//   2. 不含 analyze_file/edit_file_task 本身 → 无递归委托风险

export type SubagentRole = 'analyze' | 'edit' | 'verify'

export const ANALYZE_TOOL_NAMES = new Set([
  'read_file', 'list_directory', 'search_content', 'find_files',
  'kb_search', 'search_notes', 'analyze_text_style',
])

export const EDIT_TOOL_NAMES = new Set([
  ...ANALYZE_TOOL_NAMES,
  'create_file', 'edit_file', 'batch_replace',  // 均 AUTO 权限，无审批路径
])

/** v14.2.1: verify 角色 — 只读验收（复用 analyze 工具集） */
export const VERIFY_TOOL_NAMES = ANALYZE_TOOL_NAMES

/** 主 agent 侧的子 agent 委托工具名（用于渐进披露/串行执行/契约过滤）— v14.3: +subagent_ask 追问 */
export const SUBAGENT_TOOL_NAMES = new Set(['analyze_file', 'edit_file_task', 'verify_task', 'subagent_ask'])

const ROLE_PROMPTS: Record<SubagentRole, string> = {
  analyze: SUBAGENT_ANALYZE_PROMPT,
  edit: SUBAGENT_EDIT_PROMPT,
  verify: SUBAGENT_VERIFY_PROMPT,
}

const ROLE_TOOLS: Record<SubagentRole, Set<string>> = {
  analyze: ANALYZE_TOOL_NAMES,
  edit: EDIT_TOOL_NAMES,
  verify: VERIFY_TOOL_NAMES,
}

// ── 类型 ──

export interface SubagentOptions {
  role: SubagentRole
  projectId: string | null
  configId: string
  /** 完整任务描述（已含 file_path / question / instruction） */
  userMessage: string
  signal?: AbortSignal
  maxIterations?: number   // 默认 10（v14.3.1: 6→10）
  contextWindow?: number   // 默认跟随模型配置（配置未设时 128_000，与主 agent 一致）
  temperature?: number
  toolTemperature?: number
  /** v14.3: 会话追问 key（`${projectId ?? 'global'}::${filePath}`）— 存在时优先复用该文件的上次子代理上下文；委托成功后保存会话 */
  sessionKey?: string
}

// ── v14.3: 子代理会话池（内存，不持久化；供 subagent_ask 追问复用上下文，避免重复读取大文件）──
// v14 批处理: MAX_SESSIONS 4→8（长讨论追多个文件时减少 LRU 淘汰；内存 ≈8×20K 字符，有界可接受）
const MAX_SESSIONS = 8
const MAX_SESSION_CHARS = 20000
/** v14.5.0: 会话 TTL（10 分钟）——过期会话视为无（文件可能已被修改，追问需重新分析） */
const SESSION_TTL_MS = 10 * 60 * 1000

interface SessionEntry {
  role: SubagentRole
  /** 已过滤 system 消息（ROLE_PROMPT/[任务边界]/[当前任务] 等——追问时由新 runtime 重新注入） */
  history: Message[]
  lastUsed: number
}

const subagentSessions = new Map<string, SessionEntry>()

// v14.5.0: 读取时校验角色匹配 + TTL 过期（此前无校验——edit 会话可被 analyze 追问复用错误语境的旧历史）
function getSubagentSession(key: string, role: SubagentRole): SessionEntry | undefined {
  const entry = subagentSessions.get(key)
  if (!entry) return undefined
  if (entry.role !== role || Date.now() - entry.lastUsed > SESSION_TTL_MS) {
    subagentSessions.delete(key)  // 角色不符或过期 → 视为无会话（后续重建全新分析）
    return undefined
  }
  entry.lastUsed = Date.now()
  return entry
}

/** 字符预算裁剪：保留首条（任务描述）+ 尾部最近轮次；防孤儿 tool_result */
function trimSessionHistory(history: Message[]): Message[] {
  const total = history.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0)
  if (total <= MAX_SESSION_CHARS) return history
  let chars = typeof history[0].content === 'string' ? history[0].content.length : 0
  let tailCount = 0
  for (let i = history.length - 1; i > 0; i--) {
    const len = typeof history[i].content === 'string' ? history[i].content.length : 0
    if (chars + len > MAX_SESSION_CHARS) break
    chars += len
    tailCount++
  }
  if (tailCount === 0) return [history[0]]
  // v14.3.1: 丢弃尾部开头的孤儿 tool 消息——其对应的 assistant tool_use 已被裁剪，
  // 追问时 Anthropic API 会报 "tool_result must have a corresponding tool_use in the previous message" (400)
  let start = history.length - tailCount
  while (start < history.length && history[start].role === 'tool') start++
  if (start >= history.length) return [history[0]]
  const tail = history.slice(start)
  // v14.6.1: 裁剪边界若落在 mid-history 的 user 消息上（如 nudge），会产生
  // [user(任务描述), user(nudge)] 连续 user → 严格 Anthropic 端点 400；并入首条
  if (tail[0].role === 'user') {
    const first = history[0]
    const firstText = typeof first.content === 'string' ? first.content : ''
    const tailText = typeof tail[0].content === 'string' ? tail[0].content : ''
    const merged = { ...first, content: `${firstText}\n\n${tailText}` }
    return [merged, ...tail.slice(1)]
  }
  return [history[0], ...tail]
}

function saveSubagentSession(key: string, role: SubagentRole, messagesForApi: Message[]): void {
  if (!key) return
  let history = messagesForApi.filter(m => m.role !== 'system')
  // v14.3.1: 丢弃末尾"多余"user 消息——API 失败/中断的痕迹（V4UnifiedRuntime 的 success 不反映 API 失败，
  // 失败轮次以 user(当前消息) 结尾保存；不丢弃会导致下次追问产生连续 user 消息）。
  // 注意：保留首条 user（任务描述）——文本收尾的 run 不 push assistant 消息，messagesForApi 以 user 结尾是正常形态
  while (history.length > 1 && history[history.length - 1].role === 'user') history.pop()
  if (history.length === 0) return
  history = trimSessionHistory(history)
  if (history.length === 0) return
  subagentSessions.set(key, { role, history, lastUsed: Date.now() })
  // LRU 淘汰：超过上限时移除最久未使用的会话
  while (subagentSessions.size > MAX_SESSIONS) {
    let oldestKey: string | null = null
    let oldest = Infinity
    for (const [k, e] of subagentSessions) {
      if (e.lastUsed < oldest) { oldest = e.lastUsed; oldestKey = k }
    }
    if (oldestKey) subagentSessions.delete(oldestKey)
    else break
  }
}

export interface SubagentUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens: number
  cacheCreationTokens: number
  cost: number
  calls: number
}

export interface SubagentResult {
  success: boolean
  text: string
  toolCallSteps: V4AgentRunResult['toolCallSteps']
  usage: SubagentUsage
}

// ── 工厂 ──

export async function runSubagent(opts: SubagentOptions): Promise<SubagentResult> {
  const { role, projectId, configId, userMessage, signal, sessionKey } = opts
  // v14.3.1: 默认 6 → 10 轮（大文件分段读取 + 修改 + 重读验证 + 重试的典型路径需要更多预算）
  const maxIterations = opts.maxIterations ?? 10

  // 温度/窗口配置（同 chatBridgeFactory：跟随模型配置）
  const configs = useSettingsStore.getState().configs
  const modelConfig = configs.find(c => c.id === configId)
  const temperature = opts.temperature ?? (modelConfig as any)?.temperature ?? 1.0
  const toolTemperature = opts.toolTemperature ?? (modelConfig as any)?.toolTemperature ?? 0.5
  // v14.2.1: 上下文窗口跟随模型配置（与主 agent 一致，可达 1M）——
  // 修复前硬编码 64K：大文件（>7 万字符）在 70% 压缩阈值下内容被压缩失真，
  // 违背子代理"处理大文件"的使命。显式传入仍优先；配置未设时兜底与 DEFAULT_MODEL_CONFIG 一致。
  const contextWindow = opts.contextWindow ?? (modelConfig as any)?.contextWindow ?? 128_000

  // 1. 按角色筛选工具 schema（防御性过滤：即使工具集配置出错也不含 subagent 工具）
  const toolNames = ROLE_TOOLS[role]
  const schemas = toolRegistry.getAll()
    .filter(t => toolNames.has(t.schema.name))
    .map(t => ({ type: 'function' as const, function: t.schema }))

  // 2. 协议适配器（按 configId.protocol 路由）
  const adapter = await createSubagentAdapter(configId)

  // 3. abort 传播（注意：signal 可能已 aborted——addEventListener 不会触发已发生的事件）
  // v14.6.1: 命名监听器引用 + once——原匿名函数 add/remove 引用不同，remove 恒为 no-op，
  // 每次委托在父 signal 上累积死监听器
  const controller = new AbortController()
  const onParentAbort = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', onParentAbort, { once: true })
  }

  const auditTrail = new AuditTrail()
  let result: V4AgentRunResult

  try {
    // v14.3: 会话追问 — 复用该文件上次子代理的上下文（无会话则全新）
    // v14.5.0: 传入 role 校验（角色不符/过期 → 视为无会话，重建全新分析）
    const session = sessionKey ? getSubagentSession(sessionKey, role) : undefined

    // 4. 独立 runtime（isolatedStore：不触碰共享 AgentStore，隔离 UI 状态与熔断器）
    const runtime = new V4UnifiedRuntime({
      configId,
      projectId,
      maxIterations,
      abortSignal: controller.signal,
      contextWindow,
      temperature,
      toolTemperature,
      isolatedStore: true,
      // v14 批处理: 审计接线 — 子代理 api:call 事件同样记录（会话统计消费）
      auditTrail,
      model: (modelConfig as any)?.model,
    }, adapter)

    runtime.setTools(schemas)
    // 子 agent 上下文 = 独立提示词 + 任务消息（无对话历史、无 KB/Web 注入）
    runtime.setContextAssembler(async () => {
      const prompt = ROLE_PROMPTS[role]
      return {
        systemMessages: [{ role: 'system', content: prompt }],
        searchContext: undefined,
        totalTokens: estimateTokens(prompt),
        domains: ['subagent'],
        breakdown: [],
      }
    })
    // v14.3: 追问时注入会话历史（原历史的首条 user 即该文件的任务描述，runtime 自动加 [任务边界]）
    runtime.setHistory(session ? session.history : [])
    runtime.setToolExecutor(createToolExecutor({
      securityFence: new V4SecurityFence(projectId),
      auditTrail,
      projectId,
      // 不传 onApprovalRequired：子 agent 工具集含 DANGEROUS_ASK 条件工具（list_directory broad / find_files computer），
      // 无审批路径时 toolExecutorFactory 一律拒绝——符合子代理只能 scope=project 的安全边界
    }))

    auditTrail.startSession(`sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`)

    // 5. 执行
    result = await runtime.run({ userMessage, attachments: [] })
    // v14.3: 委托成功 → 保存会话快照（供 subagent_ask 追问复用；abort/截断不保存——上下文不完整）
    // v14.3.1: +truncated 判定（迭代耗尽/超时中断 = 部分完成，不保存不完整快照）
    if (sessionKey && result.success && !result.truncated) {
      saveSubagentSession(sessionKey, role, runtime.getMessagesForApi())
    }
  } catch (err) {
    return {
      success: false,
      text: `子代理执行失败: ${err instanceof Error ? err.message : '未知错误'}`,
      toolCallSteps: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0, calls: 0 },
    }
  } finally {
    signal?.removeEventListener('abort', onParentAbort)
    controller.abort()  // 防止超时后残留（不影响 success 判定——用 runtime 的结果）
    auditTrail.persist().catch(() => {})
  }

  // v14.3: 失败时回传子代理内部错误轨迹（主 agent 据此分析原因、换方法重试）
  // 注意：拼接串与 error summary 均不含 { }（防 verify_task 的 JSON 贪婪正则被破坏）
  let text = result.text || ''
  // v14.3.1: 迭代耗尽/超时中断 → success 置 false（防"假成功"——此前子代理 6 轮耗尽 success 仍 true，
  // 主 agent 把不完整结果当完成）。abort 路径 success 本就 false，无需重复标记。
  const success = result.success && !result.truncated
  if (result.truncated) {
    text = `${text}\n\n[子代理未完成] 子代理在迭代/时间限制内未完成全部工作，返回结果可能不完整。请缩小范围或分步重试。`
  }
  if (!result.success) {
    const errSteps = result.toolCallSteps.filter(s => s.status === 'error').slice(-2)
    if (errSteps.length > 0) {
      const errSummary = errSteps.map(s => `${s.tool}: ${s.summary.slice(0, 120)}`).join('；')
      text = `${text}\n\n[子代理失败摘要] 最近错误: ${errSummary}`
    }
  }

  return {
    success,
    text,
    toolCallSteps: result.toolCallSteps,
    usage: {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      cacheHitTokens: result.cacheHitTokens || 0,
      cacheCreationTokens: result.cacheCreationTokens || 0,
      cost: result.cost || 0,
      calls: result.iterationCount,
    },
  }
}
