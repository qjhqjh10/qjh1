// ── DeepSeek Responses API Adapter（v14.8） ──
// 原生联网搜索通道：模型配置勾选「原生联网搜索」+ DeepSeek V4 时，agent 工具循环经此适配器
// 走 /responses 端点——web_search 为服务端原生工具（模型自主调用，agentic 语义）。
// 路由决策：responsesRouter.shouldUseResponses（两处路由共用）。
//
// 实测约束（2026-08-02 真实 API 冒烟）见 electron/ipc/aiHandlers.ts 的 ai:responses-chat 注释。

import type { Message, ToolCallRequest } from '../../state/types'
import type { ProtocolAdapter, ProtocolCapabilities, NormalizedModelResponse } from './ProtocolAdapter'

export interface ResponsesAIService {
  responsesChat(
    messages: Message[],
    configId: string,
    projectId: string | undefined,
    tools?: unknown[],
    temperature?: number,
    /** v14.2.1: 调用来源（main/subagent）— 供 token 统计区分 */
    source?: string,
    /** v14.6.1: 请求标识 — per-request abort */
    requestId?: string,
  ): Promise<{
    text: string
    toolCalls: Array<{ id: string; name: string; arguments: string }> | null
    finishReason: string
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cached_tokens?: number; cost?: number }
    reasoning_content?: string
    aborted?: boolean
    fallbackUsed?: boolean
  }>
  abortStream(requestId?: string): void
}

export class ResponsesAdapter implements ProtocolAdapter {
  readonly capabilities: ProtocolCapabilities = {
    progressiveDisclosure: true,
    systemRoleHints: true,
  }

  private service: ResponsesAIService
  /** v14.8: 调用来源（子代理传 'subagent'，主 agent 默认 'main'） */
  private source: string
  /** v14.6.1 同 OpenAIAdapter：当前在途请求标识（abort 精确指向） */
  private currentRequestId = ''

  constructor(service: ResponsesAIService, source = 'main') {
    this.service = service
    this.source = source
  }

  async callModel(params: {
    messages: Message[]
    tools: unknown[]
    configId: string
    projectId?: string
    signal: AbortSignal
    temperature?: number
  }): Promise<NormalizedModelResponse> {
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.currentRequestId = requestId
    const onAbort = () => { this.service.abortStream(requestId) }
    if (params.signal) {
      if (params.signal.aborted) onAbort()
      else params.signal.addEventListener('abort', onAbort, { once: true })
    }
    let result: Awaited<ReturnType<ResponsesAIService['responsesChat']>>
    try {
      result = await this.service.responsesChat(
        params.messages,
        params.configId,
        params.projectId,
        params.tools.length > 0 ? params.tools : undefined,
        params.temperature,
        this.source,
        requestId,
      )
    } finally {
      params.signal?.removeEventListener('abort', onAbort)
    }

    return {
      text: result.text || '',
      // v14.8: 主进程 converter 已归一化为 {id, name, arguments}
      toolCalls: (result.toolCalls || []).map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      finishReason: result.finishReason || 'stop',
      usage: {
        inputTokens: result.usage?.prompt_tokens || 0,
        outputTokens: result.usage?.completion_tokens || 0,
        totalTokens: result.usage?.total_tokens || 0,
        cacheHitTokens: result.usage?.cached_tokens || 0,
        cost: result.usage?.cost,
      },
      reasoningContent: result.reasoning_content,
      aborted: result.aborted === true,
    }
  }

  abortStream(): void {
    this.service.abortStream(this.currentRequestId || undefined)
  }
}
