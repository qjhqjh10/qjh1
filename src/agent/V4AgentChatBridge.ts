// ── V4 Agent Chat Bridge（OpenAI 协议）──
// v13.x: 主体已收敛至 BaseChatBridge（chatBridgeFactory.ts），本文件仅保留协议差异。

import { OpenAIAdapter } from './runtime/adapters/OpenAIAdapter'
import { BaseChatBridge } from './chatBridgeFactory'
import type { ProtocolAdapter } from './runtime/adapters/ProtocolAdapter'

export type { BridgeOptions, SendOptions, BridgeSendResult } from './ChatBridgeInterface'

// ── Bridge ──

export class V4AgentChatBridge extends BaseChatBridge {
  protected async createAdapter(): Promise<ProtocolAdapter> {
    const { aiService } = await import('@/services/fileService')
    return new OpenAIAdapter({
      chatWithTools: async (msgs, cid, pid, tools, temperature) => {
        const result = await aiService.chatWithTools(msgs, cid, pid, tools, temperature)
        return {
          text: result.text,
          toolCalls: result.toolCalls?.map(tc => ({
            id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
          })) || null,
          finishReason: result.finishReason,
          usage: result.usage,
          reasoning_content: result.reasoning_content,
        }
      },
      abortStream: () => aiService.abortStream(),
    })
  }

  protected abortStream(): void {
    import('@/services/fileService').then(m => m.aiService?.abortStream?.()).catch(() => {})
  }

  protected getRunId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  protected getEnableThinkingPlan(): boolean {
    return true
  }
}
