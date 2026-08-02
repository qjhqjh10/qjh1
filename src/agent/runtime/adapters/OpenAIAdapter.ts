// ── OpenAI Protocol Adapter ──
// Thin wrapper around the OpenAI-compatible chatWithTools API.
// Messages pass through natively; only response normalization is needed.

import type { Message, ToolCallRequest } from '../../state/types'
import type { ProtocolAdapter, ProtocolCapabilities, NormalizedModelResponse } from './ProtocolAdapter'

// ── OpenAI AIService interface ──

export interface OpenAIAIService {
  chatWithTools(
    messages: Message[],
    configId: string,
    projectId: string | undefined,
    tools?: unknown[],
    /** v12.5.1: 阶段感知温度 (创作轮=config.temperature, 执行轮=min(config.temperature, toolTemperature)) */
    temperature?: number,
    /** v14.2.1: 调用来源（main/subagent/pipeline） */
    source?: string,
    /** v14.6.1: 请求标识 — 并行子代理场景下 abort 精确指向目标请求（原全局单槽会误杀兄弟请求） */
    requestId?: string,
  ): Promise<{
    text: string
    toolCalls: ToolCallRequest[] | null
    finishReason: string
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    reasoning_content?: string
    aborted?: boolean
  }>
  abortStream(requestId?: string): void
}

// ── Adapter Implementation ──

export class OpenAIAdapter implements ProtocolAdapter {
  readonly capabilities: ProtocolCapabilities = {
    progressiveDisclosure: true,
    systemRoleHints: true,
  }

  private service: OpenAIAIService
  /** v14.6.1: 当前在途请求标识（abortStream 精确指向，不再误杀并行子代理兄弟请求） */
  private currentRequestId = ''

  constructor(service: OpenAIAIService) {
    this.service = service
  }

  async callModel(params: {
    messages: Message[]
    tools: unknown[]
    configId: string
    projectId?: string
    signal: AbortSignal
    temperature?: number
  }): Promise<NormalizedModelResponse> {
    // v14.5.1: 接线 signal → abortStream——runtime 超时/用户中止时真正取消底层流
    // （原实现忽略 signal，超时后重试会产生双请求双计费）
    // v14.6.1: per-request abort——请求带唯一 id，中止精确指向自己（并行子代理不再误杀兄弟）
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.currentRequestId = requestId
    const onAbort = () => { this.service.abortStream(requestId) }
    if (params.signal) {
      if (params.signal.aborted) onAbort()
      else params.signal.addEventListener('abort', onAbort, { once: true })
    }
    let result: Awaited<ReturnType<OpenAIAIService['chatWithTools']>>
    try {
      result = await this.service.chatWithTools(
        params.messages,
        params.configId,
        params.projectId,
        params.tools.length > 0 ? params.tools : undefined,
        params.temperature,
        undefined,
        requestId,
      )
    } finally {
      params.signal?.removeEventListener('abort', onAbort)
    }

    return {
      text: result.text || '',
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
        // v11.7.1: DeepSeek OpenAI 端点自动缓存前缀 — 透传 cached_tokens
        cacheHitTokens: (result.usage as any)?.cached_tokens || 0,
        cost: (result.usage as any)?.cost,
      },
      reasoningContent: result.reasoning_content,
      aborted: result.aborted === true,
    }
  }

  abortStream(): void {
    // v14.6.1: 精确中止当前请求；无在途请求时兜底中止全部（保持旧语义）
    this.service.abortStream(this.currentRequestId || undefined)
  }
}
