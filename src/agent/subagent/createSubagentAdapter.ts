// ── Subagent Adapter Factory (v15) ──
// 按模型配置的 protocol 字段路由构造子 agent 的协议适配器。
// 与 chatAI.ts 的 isAnthropicProtocol 同一判定逻辑；OpenAI 分支 toolCalls 归一化同 V4AgentChatBridge。

import { useSettingsStore } from '@/store'
import { OpenAIAdapter } from '../runtime/adapters/OpenAIAdapter'
import { AnthropicAdapter } from '../runtime/adapters/AnthropicAdapter'
import type { ProtocolAdapter } from '../runtime/adapters/ProtocolAdapter'

export async function createSubagentAdapter(configId: string): Promise<ProtocolAdapter> {
  const configs = useSettingsStore.getState().configs
  const config = configs.find(c => c.id === configId)
  const isAnthropic = (config as any)?.protocol === 'anthropic'

  if (isAnthropic) {
    const { anthropicService } = await import('@/services/anthropicService')
    return new AnthropicAdapter({
      chatAnthropicStream: async (params) => {
        const result = await anthropicService.chatAnthropicStream(params)
        return result
      },
      abortStream: () => anthropicService.abortAnthropicStream(),
    })
  }

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
