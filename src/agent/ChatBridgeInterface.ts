// ── Chat Bridge 共享接口 ──
// 两个协议 Bridge 都满足此接口，AIChatWindow 只需依赖此接口
//
// V4AgentChatBridge        → OpenAI 协议（现有，不改）
// V4AnthropicChatBridge    → Anthropic 协议（新建）

import type { Message } from './state/types'
import type { V4AgentRunResult } from './runtime/RuntimeTypes'

// ── 两个 Bridge 共享的类型（原定义于 V4AgentChatBridge，此处为单一数据源）──

export interface BridgeOptions {
  configId: string
  projectId: string | null
  maxIterations?: number
  historyMessages?: Message[]
  contextWindow?: number  // 模型上下文窗口大小, 传递给 ContextCompressor 做阈值计算
}

export interface SendOptions {
  kbEnabled?: boolean
  webSearchEnabled?: boolean
  /** v16.3.0: 联网会话级覆盖（三态循环）— 'builtin'|'off' = 本会话临时不走原生通道
   * （内置/关闭），null/undefined = 跟随模型配置勾选。**不修改** config.nativeWebSearch。 */
  nativeOverride?: 'builtin' | 'off' | null
  selectedKbFileIds?: string[]
  /** v14.8: 跨 run KB 去重 — 历史 run 已注入过的知识库文件 id（来自上一条 assistant 消息 kbInjectedFileIds），
   * 传给 BridgeContextBuilder 排除，避免同一文件跨 run 反复注入 */
  excludeKbFileIds?: string[]
  /** v14.5.0: 跨 run 续跑 — 上次中断的任务清单进度快照（UI 从消息 taskProgress 透传） */
  resumeTaskProgress?: V4AgentRunResult['taskProgress']
  /** v14.6.1: 工具开关 — false 时本轮禁用工具调用（纯文本对话） */
  toolsEnabled?: boolean
  /** v16.1.0(审查修复 B6): 章节协作——本轮是否注入全文。
   * 成本优化「变更才注入+心跳」由 UI 层判定（chapterVersion/text 变化或 ≥5 轮），
   * 未变化轮只注入锚点+版本（全文已在历史 user 消息中，模型可参考） */
  chapterFullText?: boolean
  /** v16.4.0: 会话绑定的角色模板 id——BridgeContextBuilder 按此注入角色外壳，
   * 不再读取全局 activeRoleTemplateId（修复绑定错位：已锁定会话的人设不再被全局切换/删模板静默改变）。
   * 未传（非聊天窗调用方）时回退全局值。 */
  roleTemplateId?: string
  onResponse?: (chunk: { text: string; accumulated: string; timestamp: number }) => void
  onComplete?: (result: V4AgentRunResult) => void
  onApprovalRequired?: (tools: Array<{ name: string; args: Record<string, unknown> }>) => Promise<boolean>
}

export interface BridgeSendResult {
  success: boolean
  text: string
  toolCalls: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  cacheCreationTokens: number
  cost: number
  phase: string
  toolsUsed: string[]
  iterationCount: number
  toolCallSteps: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number }>
  contextBreakdown?: Array<{ domain: string; tokens: number }>
  /** v13.2.0: 下一次 API 请求的预估上下文 token 数 */
  estimatedContextTokens?: number
  /** v15: 子 agent 委托任务用量（独立上下文窗口，主/子分开统计；不并入 totalTokens） */
  subAgentUsage?: V4AgentRunResult['subAgentUsage']
  /** v14.2.0: 任务清单进度快照（中断未完成时 UI 据此注入续跑提示） */
  taskProgress?: V4AgentRunResult['taskProgress']
  /** v14.3: 子代理执行快照（UI 持久化 + 跨 run 注入复用） */
  subagentSummaries?: V4AgentRunResult['subagentSummaries']
  /** v14.8: 本轮 KB 预注入文件 id（UI 持久化到 assistant 消息，下轮经 excludeKbFileIds 排除） */
  kbInjectedFileIds?: string[]
  /** v16.0.1(审计 M11): 本轮工具结果（跨 run 去重重建数据源，UI 持久化到 assistant 消息） */
  toolResults?: V4AgentRunResult['toolResults']
  /** v16.3.0(审计 H1 修复): 推理链回传（"思考过程"面板数据源——原 bridge 返回值缺失，UI 恒读 undefined） */
  reasoningContent?: string
  /** v16.3.0(审计 H1 修复): API 逐轮明细（会话记录 api-calls.jsonl 数据源——原缺失恒空） */
  apiCallDetails?: V4AgentRunResult['apiCallDetails']
}

/** 两个 Bridge 实现都满足的接口 */
export interface IChatBridge {
  // v16.3.0(审计 M9 修复): init/sendMessage 参数改为引用 BridgeOptions/SendOptions——
  // 原内联逐字段重复声明 13+ 字段，两份声明漂移（onToolProgress 曾只在内联版，接口与实现不一致）
  init(options: BridgeOptions): void

  sendMessage(
    userMessage: string,
    options?: SendOptions,
  ): Promise<BridgeSendResult>

  abort(): void
  destroy(): void
  updateProject(projectId: string | null): void
  updateHistory(messages: Message[]): void
}

// ── Bridge 工厂 ──

import { V4AgentChatBridge } from './V4AgentChatBridge'

/**
 * 根据当前模型配置的 protocol 字段创建对应的 ChatBridge
 * - protocol === 'anthropic' → V4AnthropicChatBridge（动态加载）
 * - 其他（默认）→ V4AgentChatBridge（OpenAI 协议，不动）
 */
export async function createChatBridge(
  projectId: string | null,
): Promise<IChatBridge> {
  // 读取运行时的协议配置
  const { useSettingsStore } = await import('@/store')
  const configs = useSettingsStore.getState().configs
  const activeId = useSettingsStore.getState().activeConfigId
  const config = activeId ? configs.find(c => c.id === activeId) : undefined
  const protocol = (config as any)?.protocol as string | undefined

  if (protocol === 'anthropic') {
    const { V4AnthropicChatBridge } = await import('./V4AnthropicChatBridge')
    return new V4AnthropicChatBridge(projectId)
  }

  // v9.6.0: V4AgentChatBridge implements IChatBridge structurally
  return new V4AgentChatBridge(projectId)
}
