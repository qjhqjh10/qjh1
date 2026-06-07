// ── Anthropic Protocol Adapter ──
// Wraps the Anthropic Messages API (via anthropicService).
// Contains messagesToAnthropic() and toAnthropicTools() — previously in V4AnthropicRuntime.ts.
// Internal message storage is OpenAI format; this adapter converts at the API boundary.

import type { Message, ToolCallRequest } from '../../state/types'
import type { AnthropicToolDef, AnthropicStreamResult } from '@/types/anthropicTypes'
import type { ProtocolAdapter, ProtocolCapabilities, NormalizedModelResponse } from './ProtocolAdapter'

// ── Anthropic AIService interface ──

export interface AnthropicAIService {
  chatAnthropicStream(params: {
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
  }): Promise<AnthropicStreamResult>
  abortStream(): void
}

// ── Tool schema conversion ──

function toAnthropicTools(openaiTools: unknown[]): AnthropicToolDef[] {
  return openaiTools
    .map((t: any) => {
      const fn = t?.function
      if (!fn) return null
      return {
        name: fn.name,
        description: fn.description || '',
        input_schema: {
          type: 'object' as const,
          properties: fn.parameters?.properties || {},
          required: fn.parameters?.required || [],
        },
      }
    })
    .filter(Boolean) as AnthropicToolDef[]
}

// ── Message format conversion ──

function messagesToAnthropic(msgs: Message[]): Array<{
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
}> {
  const result: Array<{
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
  }> = []

  for (const m of msgs) {
    if (m.role === 'system') continue // system as top-level parameter

    const content: Array<{
      type: string
      text?: string
      tool_use_id?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
      content?: string
      thinking?: string
      signature?: string
    }> = []

    if (m.role === 'tool') {
      // Tool result → user message (Anthropic requirement)
      content.push({
        type: 'tool_result',
        tool_use_id: (m as any).tool_call_id || '',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })
      result.push({ role: 'user', content })
    } else if (m.role === 'assistant' && (m as any).tool_calls) {
      // Assistant with tool calls
      if (m.content && typeof m.content === 'string' && m.content.trim()) {
        content.push({ type: 'text', text: m.content })
      }
      // v11.5.1: Preserve thinking/signature blocks for extended thinking support
      const thinkingBlocks = (m as any).thinkingBlocks
      if (thinkingBlocks && Array.isArray(thinkingBlocks)) {
        for (const tb of thinkingBlocks) {
          content.push({ type: 'thinking' as any, thinking: tb.thinking, signature: tb.signature || '' })
        }
      } else if ((m as any).thinking) {
        // Backward compat: old single thinking field
        content.push({ type: 'thinking' as any, thinking: (m as any).thinking, signature: (m as any).signature || '' })
      }
      for (const tc of (m as any).tool_calls) {
        let input: Record<string, unknown> = {}
        try {
          input = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments || {})
        } catch { /* keep empty */ }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || tc.name,
          input,
        })
      }
      result.push({ role: 'assistant', content })
    } else {
      // Plain user/assistant message
      const text = typeof m.content === 'string' ? m.content : ''
      if (text) content.push({ type: 'text', text })
      if (content.length === 0) content.push({ type: 'text', text: '' })
      result.push({ role: m.role, content })
    }
  }

  return result
}

// ── Adapter Implementation ──

export class AnthropicAdapter implements ProtocolAdapter {
  readonly capabilities: ProtocolCapabilities = {
    progressiveDisclosure: false,
    systemRoleHints: false,
  }

  private service: AnthropicAIService

  constructor(service: AnthropicAIService) {
    this.service = service
  }

  async callModel(params: {
    messages: Message[]
    tools: unknown[]
    configId: string
    projectId?: string
    signal: AbortSignal
  }): Promise<NormalizedModelResponse> {
    // 1. Extract system messages to top-level parameter
    const systemTexts: string[] = []
    const nonSystemMsgs: Message[] = []
    for (const m of params.messages) {
      if (m.role === 'system') {
        systemTexts.push(typeof m.content === 'string' ? m.content : '')
      } else {
        nonSystemMsgs.push(m)
      }
    }

    // 2. Convert messages & tools to Anthropic format
    const anthropicMessages = messagesToAnthropic(nonSystemMsgs)
    const anthropicTools = toAnthropicTools(params.tools)

    // 3. Call Anthropic streaming API
    const streamResult = await this.service.chatAnthropicStream({
      system: systemTexts,
      messages: anthropicMessages,
      configId: params.configId,
      projectId: params.projectId,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    })

    // 4. Normalize to canonical format
    // v11.5.1: Preserve thinkingBlocks + cacheHitTokens
    return {
      text: streamResult.text || '',
      toolCalls: (streamResult.toolUses || []).map(tu => ({
        id: tu.id,
        name: tu.name,
        arguments: JSON.stringify(tu.input),
      })),
      finishReason: streamResult.stopReason || 'end_turn',
      usage: {
        inputTokens: streamResult.usage?.input_tokens || 0,
        outputTokens: streamResult.usage?.output_tokens || 0,
        totalTokens: (streamResult.usage?.input_tokens || 0) + (streamResult.usage?.output_tokens || 0),
        cacheHitTokens: (streamResult.usage?.cache_creation_input_tokens || 0) + (streamResult.usage?.cache_read_input_tokens || 0),
        cost: (streamResult.usage as any)?.cost,
      },
      reasoningContent: streamResult.thinkingBlocks?.map(b => b.thinking).join('\n') || streamResult.thinking,
      thinkingBlocks: streamResult.thinkingBlocks,
    }
  }

  abortStream(): void {
    this.service.abortStream()
  }
}
