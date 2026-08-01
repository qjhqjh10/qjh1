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
  selectedKbFileIds?: string[]
  onResponse?: (chunk: { text: string; accumulated: string; timestamp: number }) => void
  onComplete?: (result: V4AgentRunResult) => void
  onToolProgress?: (event: { callId: string; toolName: string; phase: string; progress: number; message: string; timestamp: number }) => void
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
}

/** 两个 Bridge 实现都满足的接口 */
export interface IChatBridge {
  init(options: {
    configId: string
    projectId: string | null
    maxIterations?: number
    historyMessages?: Message[]
    contextWindow?: number
  }): void

  sendMessage(
    userMessage: string,
    options?: {
      kbEnabled?: boolean
      webSearchEnabled?: boolean
      selectedKbFileIds?: string[]
      onResponse?: (chunk: { text: string; accumulated: string; timestamp: number }) => void
      onComplete?: (result: V4AgentRunResult) => void
      onToolProgress?: (event: {
        callId: string; toolName: string; phase: string
        progress: number; message: string; timestamp: number
      }) => void
      onApprovalRequired?: (
        tools: Array<{ name: string; args: Record<string, unknown> }>,
      ) => Promise<boolean>
    },
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
