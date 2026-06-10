// ── Chat Bridge 共享接口 ──
// 两个协议 Bridge 都满足此接口，AIChatWindow 只需依赖此接口
//
// V4AgentChatBridge        → OpenAI 协议（现有，不改）
// V4AnthropicChatBridge    → Anthropic 协议（新建）

import type { Message } from './state/types'
import type { V4AgentRunResult } from './runtime/RuntimeTypes'
import type { BridgeSendResult } from './V4AgentChatBridge'

// 从 V4AgentChatBridge 重导出类型（单一数据源，不重复定义）
export type {
  BridgeOptions,
  SendOptions,
  BridgeSendResult,
} from './V4AgentChatBridge'

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
  const config = configs.find(c => c.id === activeId)
  const protocol = (config as any)?.protocol as string | undefined

  if (protocol === 'anthropic') {
    const { V4AnthropicChatBridge } = await import('./V4AnthropicChatBridge')
    return new V4AnthropicChatBridge(projectId)
  }

  // v9.6.0: V4AgentChatBridge implements IChatBridge structurally
  return new V4AgentChatBridge(projectId)
}
