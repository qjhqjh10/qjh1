// ── Anthropic 协议服务（渲染进程侧） ──
// 包装 Anthropic IPC 通道，与 aiService 在 fileService.ts 中完全独立。
// 仅在 protocol === 'anthropic' 时使用。

import type { AnthropicStreamResult, AnthropicToolDef, AnthropicTextBlock } from '@/types/anthropicTypes'
import { logError } from '@/utils/logger'

/** v11.7.0: system 参数支持 content block（含 cache_control）或纯字符串 */
export type AnthropicSystemBlock = AnthropicTextBlock | string

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
    system: AnthropicSystemBlock[]
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
    /** v12.5.1: 阶段感知温度 */
    temperature?: number
    onChunk?: (data: { chunk: string; accumulated: string }) => void
  }): Promise<AnthropicStreamResult> => {
    let unsubChunk: (() => void) | undefined
    try {
      // 注册实时 chunk 回调（如果有）
      if (params.onChunk) {
        unsubChunk = e().ai.onAnthropicChunk(params.onChunk)
      }

      const raw = await e().ai.chatAnthropicStream({
        system: params.system,
        messages: params.messages,
        configId: params.configId,
        projectId: params.projectId,
        tools: params.tools,
        temperature: params.temperature,
      })

      const parsed = JSON.parse(raw)
      return {
        text: parsed.text || '',
        toolUses: parsed.toolUses || [],
        stopReason: parsed.stopReason || 'end_turn',
        usage: parsed.usage,
        // H7: 主进程失败时返回 stopReason:'error' + error 字段，透传给上层判断
        error: parsed.error,
      }
    } catch (err) {
      logError('anthropicService.chatAnthropicStream failed', err)
      return {
        text: '',
        toolUses: [],
        stopReason: 'error',
        // H7: IPC 抛异常（本地错误）时携带消息，不再吞掉
        error: err instanceof Error ? err.message : 'Anthropic 请求失败',
      }
    } finally {
      // H7: 成功/失败路径都清理 chunk 监听，防止泄漏
      unsubChunk?.()
    }
  },

  /**
   * v11.7.2: 非流式 chat — 仿写/风格分析等场景用，不需要工具。
   * 自动内部调用 chatAnthropicStream，收集全量后返回纯文本。
   */
  chat: async (params: {
    messages: Array<{ role: string; content: string }>
    configId: string
    system?: string
  }): Promise<string> => {
    const result = await anthropicService.chatAnthropicStream({
      system: params.system ? [params.system] : [],
      messages: params.messages.map(m => ({
        role: m.role as string,
        content: [{ type: 'text' as const, text: m.content }],
      })),
      configId: params.configId,
    })
    return result.text || ''
  },

  /**
   * v11.7.2: 非流式 chat with token usage — 章节生成等场景用
   */
  chatWithUsage: async (params: {
    messages: Array<{ role: string; content: string }>
    configId: string
    system?: string
  }): Promise<{ text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } }> => {
    const result = await anthropicService.chatAnthropicStream({
      system: params.system ? [params.system] : [],
      messages: params.messages.map(m => ({
        role: m.role as string,
        content: [{ type: 'text' as const, text: m.content }],
      })),
      configId: params.configId,
    })
    const usage = result.usage
    return {
      text: result.text || '',
      usage: usage ? { prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0, total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0), cost: usage.cost || 0 } : undefined,
    }
  },

  /**
   * v11.7.2: 流式 chat with callbacks — 章节生成实时预览用
   */
  chatStream: (
    params: {
      messages: Array<{ role: string; content: string }>
      configId: string
      system?: string
    },
    onChunk: (data: { chunk: string; accumulated: string }) => void,
    onDone: (data: { text: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number } }) => void,
    onError: (err: Error) => void,
  ): { abort: () => void } => {
    anthropicService.chatAnthropicStream({
      system: params.system ? [params.system] : [],
      messages: params.messages.map(m => ({
        role: m.role as string,
        content: [{ type: 'text' as const, text: m.content }],
      })),
      configId: params.configId,
      onChunk,
    }).then(result => {
      // H7: 请求失败（主进程 stopReason:'error' 或本地错误）→ 走 onError，不再表现为"成功但空文本"
      if (result.error || result.stopReason === 'error') {
        onError(new Error(result.error || 'Anthropic 请求失败'))
        return
      }
      const usage = result.usage
      onDone({
        text: result.text || '',
        usage: usage ? { prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0, total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0), cost: usage.cost || 0 } : undefined,
      })
    }).catch(onError)
    return { abort: () => anthropicService.abortAnthropicStream() }
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
