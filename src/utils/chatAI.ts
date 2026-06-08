// ── v11.7.2: 双协议 AI chat 路由 ──
// 仿写/续写/风格分析/故事脉络等独立功能共用。
// 根据模型配置的 protocol 字段自动选择 Anthropic 或 OpenAI 端点。

import { aiService } from '@/services/fileService'
import { useSettingsStore } from '@/store'

function isAnthropicProtocol(configId: string): boolean {
  const configs = useSettingsStore.getState().configs
  const config = configs.find(c => c.id === configId)
  return (config as any)?.protocol === 'anthropic'
}

/**
 * 非流式 AI 聊天。自动路由到对应协议。
 */
export async function chatAI(
  messages: Array<{ role: string; content: string }>,
  configId: string,
  system?: string,
): Promise<string> {
  if (isAnthropicProtocol(configId)) {
    const { anthropicService } = await import('@/services/anthropicService')
    return await anthropicService.chat({ messages, configId, system })
  }
  return await aiService.chat(messages, configId)
}

/** v11.7.2: 带 token 用量的非流式 chat（章节生成用） */
export async function chatAIWithUsage(
  messages: Array<{ role: string; content: string }>,
  configId: string,
  projectId?: string,
  system?: string,
): Promise<{ text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } }> {
  if (isAnthropicProtocol(configId)) {
    const { anthropicService } = await import('@/services/anthropicService')
    return await anthropicService.chatWithUsage({ messages, configId, system })
  }
  return await aiService.chatWithUsage(messages, configId, projectId)
}

/** v11.7.2: 流式 chat with callbacks（章节生成实时预览用） */
export function chatAIStream(
  messages: Array<{ role: string; content: string }>,
  configId: string,
  projectId: string | undefined,
  onChunk: (data: { chunk: string; accumulated: string }) => void,
  onDone: (data: { text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } }) => void,
  onError: (err: Error) => void,
): { abort: () => void } {
  if (isAnthropicProtocol(configId)) {
    import('@/services/anthropicService').then(({ anthropicService }) => {
      anthropicService.chatStream({ messages, configId }, onChunk, onDone, onError)
    }).catch(onError)
    return { abort: () => { import('@/services/anthropicService').then(s => s.anthropicService.abortAnthropicStream()).catch(() => {}) } }
  }
  const wrappedError = (data: { message: string }) => onError(new Error(data.message))
  return aiService.chatStream(messages, configId, projectId, onChunk, onDone, wrappedError, wrappedError)
}
