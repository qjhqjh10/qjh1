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

// ── 角色与工具集 ──
// 注意：子 agent 工具集不含 find_files（DANGEROUS_ASK，无审批路径下会直接执行——权限绕过风险）
//      不含 analyze_file/edit_file_task 本身 → 无递归委托风险

export type SubagentRole = 'analyze' | 'edit' | 'verify'

export const ANALYZE_TOOL_NAMES = new Set([
  'read_file', 'list_directory', 'search_content',
  'kb_search', 'search_notes', 'analyze_text_style',
])

export const EDIT_TOOL_NAMES = new Set([
  ...ANALYZE_TOOL_NAMES,
  'create_file', 'edit_file', 'batch_replace',  // 均 AUTO 权限，无审批路径
])

/** v14.2.1: verify 角色 — 只读验收（复用 analyze 工具集） */
export const VERIFY_TOOL_NAMES = ANALYZE_TOOL_NAMES

/** 主 agent 侧的子 agent 委托工具名（用于渐进披露/串行执行/契约过滤） */
export const SUBAGENT_TOOL_NAMES = new Set(['analyze_file', 'edit_file_task', 'verify_task'])

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
  maxIterations?: number   // 默认 6
  contextWindow?: number   // 默认跟随模型配置（配置未设时 128_000，与主 agent 一致）
  temperature?: number
  toolTemperature?: number
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
  const { role, projectId, configId, userMessage, signal } = opts
  const maxIterations = opts.maxIterations ?? 6

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
  const controller = new AbortController()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', () => controller.abort())
  }

  const auditTrail = new AuditTrail()
  let result: V4AgentRunResult

  try {
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
    runtime.setHistory([])
    runtime.setToolExecutor(createToolExecutor({
      securityFence: new V4SecurityFence(projectId),
      auditTrail,
      projectId,
      // 不传 onApprovalRequired：子 agent 工具集无 DANGEROUS_ASK 工具，无审批路径
    }))

    auditTrail.startSession(`sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`)

    // 5. 执行
    result = await runtime.run({ userMessage, attachments: [] })
  } catch (err) {
    return {
      success: false,
      text: `子代理执行失败: ${err instanceof Error ? err.message : '未知错误'}`,
      toolCallSteps: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0, calls: 0 },
    }
  } finally {
    signal?.removeEventListener('abort', () => controller.abort())
    controller.abort()  // 防止超时后残留（不影响 success 判定——用 runtime 的结果）
    auditTrail.persist().catch(() => {})
  }

  return {
    // success 以 runtime 结果为准（runtime 内部已按 abortSignal 计算，finally 的 abort 不影响）
    success: result.success,
    text: result.text || '',
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
