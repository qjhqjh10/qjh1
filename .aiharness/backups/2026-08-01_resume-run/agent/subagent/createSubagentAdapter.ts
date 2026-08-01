// ── Subagent Adapter Factory (v15) ──
// 按模型配置的 protocol 字段路由构造子 agent 的协议适配器。
// 与 chatAI.ts 的 isAnthropicProtocol 同一判定逻辑；OpenAI 分支 toolCalls 归一化同 V4AgentChatBridge。

import { useSettingsStore } from '@/store'
import { OpenAIAdapter } from '../runtime/adapters/OpenAIAdapter'
import { AnthropicAdapter } from '../runtime/adapters/AnthropicAdapter'
import type { ProtocolAdapter } from '../runtime/adapters/ProtocolAdapter'

/**
 * v14.2.1: 共享服务模块（promise 缓存）— 批量并行委托时多个子代理并发创建 adapter，
 * 各自 `await import(...)` 在 vitest 的 mock 解析器下会竞态返回原始模块（真实 IPC 调用）；
 * promise 缓存让所有并发调用复用同一次 import。生产 ESM 无此竞态，但缓存同样减少重复解析。
 */
let anthropicServicePromise: Promise<typeof import('@/services/anthropicService')> | null = null
let aiServicePromise: Promise<typeof import('@/services/fileService')> | null = null

export async function createSubagentAdapter(configId: string): Promise<ProtocolAdapter> {
  const configs = useSettingsStore.getState().configs
  const config = configs.find(c => c.id === configId)
  const isAnthropic = (config as any)?.protocol === 'anthropic'

  if (isAnthropic) {
    if (!anthropicServicePromise) anthropicServicePromise = import('@/services/anthropicService')
    const { anthropicService } = await anthropicServicePromise
    return new AnthropicAdapter({
      chatAnthropicStream: async (params) => {
        const result = await anthropicService.chatAnthropicStream(params)
        return result
      },
      abortStream: () => anthropicService.abortAnthropicStream(),
    })
  }

  if (!aiServicePromise) aiServicePromise = import('@/services/fileService')
  const { aiService } = await aiServicePromise
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
