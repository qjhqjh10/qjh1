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
  ): Promise<{
    text: string
    toolCalls: ToolCallRequest[] | null
    finishReason: string
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    reasoning_content?: string
  }>
  abortStream(): void
}

// ── Adapter Implementation ──

export class OpenAIAdapter implements ProtocolAdapter {
  readonly capabilities: ProtocolCapabilities = {
    progressiveDisclosure: true,
    systemRoleHints: true,
  }

  private service: OpenAIAIService

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
    const result = await this.service.chatWithTools(
      params.messages,
      params.configId,
      params.projectId,
      params.tools.length > 0 ? params.tools : undefined,
      params.temperature,
    )

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
    }
  }

  abortStream(): void {
    this.service.abortStream()
  }
}
