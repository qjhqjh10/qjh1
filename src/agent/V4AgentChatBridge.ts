// ── V4 Agent Chat Bridge（OpenAI 协议）──
// v13.x: 主体已收敛至 BaseChatBridge（chatBridgeFactory.ts），本文件仅保留协议差异。

import { OpenAIAdapter } from './runtime/adapters/OpenAIAdapter'
import { ResponsesAdapter } from './runtime/adapters/ResponsesAdapter'
import { shouldUseResponses } from './runtime/adapters/responsesRouter'
import { BaseChatBridge } from './chatBridgeFactory'
import type { ProtocolAdapter } from './runtime/adapters/ProtocolAdapter'

export type { BridgeOptions, SendOptions, BridgeSendResult } from './ChatBridgeInterface'

// ── Bridge ──

export class V4AgentChatBridge extends BaseChatBridge {
  protected async createAdapter(): Promise<ProtocolAdapter> {
    const { aiService } = await import('@/services/fileService')
    // v14.8: 模型配置勾选「原生联网搜索」+ DeepSeek V4 → Responses API 通道（web_search 原生工具）
    const { useSettingsStore } = await import('@/store')
    const cfg = useSettingsStore.getState().configs.find(c => c.id === this.configId)
    if (shouldUseResponses(cfg)) {
      return new ResponsesAdapter({
        responsesChat: (msgs, cid, pid, tools, temperature, source, requestId) =>
          aiService.responsesChat(msgs, cid, pid, tools, temperature, source, requestId),
        abortStream: (requestId) => aiService.abortStream(requestId),
      })
    }
    return new OpenAIAdapter({
      chatWithTools: async (msgs, cid, pid, tools, temperature, _source, requestId) => {
        const result = await aiService.chatWithTools(msgs, cid, pid, tools, temperature, undefined, requestId)
        return {
          text: result.text,
          toolCalls: result.toolCalls?.map(tc => ({
            id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
          })) || null,
          finishReason: result.finishReason,
          usage: result.usage,
          reasoning_content: result.reasoning_content,
          // v14.6.1: aborted 透传（此前包装层丢弃——用户停止被当空响应处理，注入垃圾消息）
          aborted: result.aborted === true,
        }
      },
      abortStream: (requestId) => aiService.abortStream(requestId),
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
