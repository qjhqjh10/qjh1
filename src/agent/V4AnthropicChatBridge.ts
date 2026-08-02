// ── V4 Anthropic Chat Bridge（Anthropic 协议）──
// v13.x: 主体已收敛至 BaseChatBridge（chatBridgeFactory.ts），本文件仅保留协议差异。

import { AnthropicAdapter } from './runtime/adapters/AnthropicAdapter'
import { BaseChatBridge } from './chatBridgeFactory'
import type { ProtocolAdapter } from './runtime/adapters/ProtocolAdapter'

// ── Bridge ──

export class V4AnthropicChatBridge extends BaseChatBridge {
  protected async createAdapter(): Promise<ProtocolAdapter> {
    const { anthropicService } = await import('@/services/anthropicService')
    return new AnthropicAdapter({
      chatAnthropicStream: async (params) => {
        const result = await anthropicService.chatAnthropicStream(params)
        return result
      },
      // v14.9(审计): 透传 requestId——原丢弃参数 → 主 agent 请求超时（180s）中止时误杀该
      // webContents 全部 Anthropic 在途流（含并行子代理）；与 createSubagentAdapter.ts 对齐
      abortStream: (requestId) => anthropicService.abortAnthropicStream(requestId),
    })
  }

  protected abortStream(): void {
    import('@/services/anthropicService').then(m =>
      m.anthropicService.abortAnthropicStream(),
    ).catch(() => {})
  }

  protected getRunId(): string {
    return `ant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  }
}
