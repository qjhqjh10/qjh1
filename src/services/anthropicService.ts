// ── Anthropic 协议服务（渲染进程侧） ──
// 包装 Anthropic IPC 通道，与 aiService 在 fileService.ts 中完全独立。
// 仅在 protocol === 'anthropic' 时使用。

import type { AnthropicStreamResult, AnthropicToolDef } from '@/types/anthropicTypes'
import { logError } from '@/utils/logger'

const e = () => {
  const api = window.electron
  if (!api) throw new Error('Electron bridge not available')
  return api
}

export const anthropicService = {
  /**
   * 通过 Anthropic Messages API 发送流式请求。
   * 文本块实时回调，工具调用在完成时返回。
   */
  chatAnthropicStream: async (params: {
    system: string[]
    messages: Array<{
      role: string
      content: Array<{
        type: string
        text?: string
        tool_use_id?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
        content?: string
        thinking?: string
        signature?: string
      }>
    }>
    configId: string
    projectId?: string
    tools?: AnthropicToolDef[]
    onChunk?: (data: { chunk: string; accumulated: string }) => void
  }): Promise<AnthropicStreamResult> => {
    try {
      // 注册实时 chunk 回调（如果有）
      let unsubChunk: (() => void) | undefined
      if (params.onChunk) {
        unsubChunk = e().ai.onAnthropicChunk(params.onChunk)
      }

      const raw = await e().ai.chatAnthropicStream({
        system: params.system,
        messages: params.messages,
        configId: params.configId,
        projectId: params.projectId,
        tools: params.tools,
      })

      // 清理 chunk 监听
      unsubChunk?.()

      const parsed = JSON.parse(raw)
      return {
        text: parsed.text || '',
        toolUses: parsed.toolUses || [],
        stopReason: parsed.stopReason || 'end_turn',
        usage: parsed.usage,
      }
    } catch (err) {
      logError('anthropicService.chatAnthropicStream failed', err)
      return {
        text: '',
        toolUses: [],
        stopReason: 'error',
      }
    }
  },

  /** 中止正在进行的 Anthropic 流式请求 */
  abortAnthropicStream: () => {
    try {
      e().ai.abortAnthropicStream()
    } catch { /* bridge unavailable */ }
  },

  /** 注册 Anthropic chunk 回调，返回取消订阅函数 */
  onAnthropicChunk: (
    callback: (data: { chunk: string; accumulated: string }) => void,
  ): (() => void) => {
    return e().ai.onAnthropicChunk(callback)
  },
}
