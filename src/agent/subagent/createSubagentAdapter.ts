// ── Subagent Adapter Factory (v15) ──
// 按模型配置的 protocol 字段路由构造子 agent 的协议适配器。
// 协议判定复用 chatAI.ts 的 isAnthropicProtocol（v16.3.1 审计 D17: 原内联重复实现）；
// OpenAI 分支 toolCalls 归一化同 V4AgentChatBridge。

import { useSettingsStore } from '@/store'
import { isAnthropicProtocol } from '@/utils/chatAI'
import { OpenAIAdapter } from '../runtime/adapters/OpenAIAdapter'
import { ResponsesAdapter } from '../runtime/adapters/ResponsesAdapter'
import { shouldUseResponses } from '../runtime/adapters/responsesRouter'
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
  const isAnthropic = isAnthropicProtocol(configId)

  if (isAnthropic) {
    if (!anthropicServicePromise) anthropicServicePromise = import('@/services/anthropicService')
    const { anthropicService } = await anthropicServicePromise
    return new AnthropicAdapter({
      chatAnthropicStream: async (params) => {
        // v14.2.1: 标记子代理调用来源（token 统计区分）
        const result = await anthropicService.chatAnthropicStream({ ...params, source: 'subagent' })
        return result
      },
      // v14.6.1: per-request abort 透传（并行子代理各自精确中止，不再误杀兄弟请求）
      abortStream: (requestId) => anthropicService.abortAnthropicStream(requestId),
    })
  }

  if (!aiServicePromise) aiServicePromise = import('@/services/fileService')
  const { aiService } = await aiServicePromise

  // v14.8: 主 agent 走 Responses API 时子代理同步走（原生联网搜索能力一致；source='subagent' 区分统计）
  if (shouldUseResponses(config)) {
    return new ResponsesAdapter({
      responsesChat: async (msgs, cid, pid, tools, temperature, _source, requestId) => {
        const result = await aiService.responsesChat(msgs, cid, pid, tools, temperature, 'subagent', requestId)
        return result
      },
      abortStream: (requestId) => aiService.abortStream(requestId),
    }, 'subagent')
  }

  return new OpenAIAdapter({
    chatWithTools: async (msgs, cid, pid, tools, temperature, _source, requestId) => {
      // v14.2.1: 标记子代理调用来源（token 统计区分）
      const result = await aiService.chatWithTools(msgs, cid, pid, tools, temperature, 'subagent', requestId)
      return {
        text: result.text,
        toolCalls: result.toolCalls?.map(tc => ({
          id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
        })) || null,
        finishReason: result.finishReason,
        usage: result.usage,
        reasoning_content: result.reasoning_content,
        aborted: result.aborted === true,
      }
    },
    // v14.6.1: per-request abort 透传（并行子代理各自精确中止，不再误杀兄弟请求）
    abortStream: (requestId) => aiService.abortStream(requestId),
  })
}
