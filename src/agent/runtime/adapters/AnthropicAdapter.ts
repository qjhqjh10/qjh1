// ── Anthropic Protocol Adapter ──
// Wraps the Anthropic Messages API (via anthropicService).
// Contains messagesToAnthropic() and toAnthropicTools() — previously in V4AnthropicRuntime.ts.
// Internal message storage is OpenAI format; this adapter converts at the API boundary.

import type { Message, ToolCallRequest } from '../../state/types'
import type { AnthropicToolDef, AnthropicStreamResult, AnthropicTextBlock, AnthropicContentBlock } from '@/types/anthropicTypes'
import type { ProtocolAdapter, ProtocolCapabilities, NormalizedModelResponse } from './ProtocolAdapter'
import type { AnthropicSystemBlock } from '@/services/anthropicService'

// ── Anthropic AIService interface ──

export interface AnthropicAIService {
  chatAnthropicStream(params: {
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
    /** v12.5.1: 阶段感知温度 (创作轮=config.temperature, 执行轮=min(config.temperature, toolTemperature)) */
    temperature?: number
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

// v11.7.1: 统一使用 AnthropicContentBlock 类型，消除 as any 断言
// v12.14.1: 合并连续 tool 消息 → 一个 user 消息含多个 tool_result 块
// Anthropic API 要求: assistant(tool_use×N) 后的 user 必须含全部 N 个 tool_result
function messagesToAnthropic(msgs: Message[]): Array<{ role: string; content: AnthropicContentBlock[] }> {
  const result: Array<{ role: string; content: AnthropicContentBlock[] }> = []

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.role === 'system') continue // system as top-level parameter

    const content: AnthropicContentBlock[] = []

    if (m.role === 'tool') {
      // 收集连续的所有 tool 消息，合并为一个 user 消息
      const toolResultBlocks: AnthropicContentBlock[] = []
      let j = i
      while (j < msgs.length && msgs[j].role === 'tool') {
        const tm = msgs[j]
        const contentStr = typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content)
        let isError = false
        try {
          const parsed = JSON.parse(contentStr)
          isError = parsed.status === 'error'
        } catch { /* not valid JSON, keep isError=false */ }
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: (tm as any).tool_call_id || '',
          content: contentStr,
          ...(isError ? { is_error: true } : {}),
        })
        j++
      }
      result.push({ role: 'user', content: toolResultBlocks })
      i = j - 1  // 跳过合并的消息
    } else if (m.role === 'assistant' && (m as any).tool_calls) {
      // Assistant with tool calls
      if (m.content && typeof m.content === 'string' && m.content.trim()) {
        content.push({ type: 'text', text: m.content })
      }
      // v11.5.1: Preserve thinking/signature blocks for extended thinking support
      const thinkingBlocks = m.thinkingBlocks
      if (thinkingBlocks && Array.isArray(thinkingBlocks)) {
        for (const tb of thinkingBlocks) {
          content.push({ type: 'thinking', thinking: tb.thinking, signature: tb.signature || '' })
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

  // v13.x: 分段缓存对话历史 — 每条已完成消息自成一个 cache segment
  // 最后一条（当前用户消息）不标记，其余全部标记 → 历史轮次稳定不变=每次命中
  for (let i = 0; i < result.length - 1; i++) {
    const blocks = result[i].content
    if (blocks.length > 0) {
      const last = blocks[blocks.length - 1]
      // cache_control on AnthropicTextBlock already typed; cast for other block types
      ;(last as any).cache_control = { type: 'ephemeral' }
    }
  }

  return result
}

// ── Adapter Implementation ──

export class AnthropicAdapter implements ProtocolAdapter {
  readonly capabilities: ProtocolCapabilities = {
    // v14.5.0: 安全收窄——runtime 收窄时保留历史已用工具（toolsUsed），历史 tool_use 始终有 schema；
    // 基线（无条件收窄）31 场景实证 DeepSeek anthropic 端点对收窄宽松。子代理由 isolatedStore 门控恒全量。
    progressiveDisclosure: true,
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
    temperature?: number
  }): Promise<NormalizedModelResponse> {
    // 1. Extract system messages to top-level parameter
    // v11.7.0: Convert to AnthropicSystemBlock with cache_control on last block
    // so the API caches static system content (core prompt + index)
    const systemBlocks: AnthropicSystemBlock[] = []
    const nonSystemMsgs: Message[] = []
    for (const m of params.messages) {
      if (m.role === 'system') {
        systemBlocks.push(typeof m.content === 'string' ? m.content : '')
      } else {
        nonSystemMsgs.push(m)
      }
    }
    // v11.7.0: Mark the last system block with cache_control → caches ALL system blocks
    // Anthropic caches everything from the beginning up to the ephemeral breakpoint
    if (systemBlocks.length > 0) {
      const last = systemBlocks[systemBlocks.length - 1]
      systemBlocks[systemBlocks.length - 1] = typeof last === 'string'
        ? { type: 'text' as const, text: last, cache_control: { type: 'ephemeral' as const } }
        : { ...last, cache_control: { type: 'ephemeral' as const } }
    }

    // 2. Convert messages & tools to Anthropic format
    const anthropicMessages = messagesToAnthropic(nonSystemMsgs)
    const anthropicTools = toAnthropicTools(params.tools)

    // v11.7.0: Mark tools with cache_control — caches all tool definitions on first call
    if (anthropicTools.length > 0) {
      const lastTool = anthropicTools[anthropicTools.length - 1]
      lastTool.cache_control = { type: 'ephemeral' }
    }

    // 3. Call Anthropic streaming API
    const streamResult = await this.service.chatAnthropicStream({
      system: systemBlocks,
      messages: anthropicMessages,
      configId: params.configId,
      projectId: params.projectId,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      temperature: params.temperature,
    })

    // H7: 请求失败（stopReason:'error'）→ 抛错让 runtime 的重试/错误路径接管，
    // 避免空文本被当作"模型拒绝调用工具"进入自愈循环
    if (streamResult.stopReason === 'error') {
      throw new Error(streamResult.error || 'Anthropic 请求失败')
    }

    // 4. Normalize to canonical format
    // v11.7.0: 拆分 cacheCreation vs cacheRead — 首轮 creation 不计入 display 扣除
    const cacheCreation = streamResult.usage?.cache_creation_input_tokens || 0
    const cacheRead = streamResult.usage?.cache_read_input_tokens || 0
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
        // v11.7.0: 分开记录 creation 和 read。display 只扣 read（首轮 creation 是实际输入）
        cacheHitTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
        cost: (streamResult.usage as any)?.cost,
      },
      reasoningContent: streamResult.thinkingBlocks?.map(b => b.thinking).join('\n') || streamResult.thinking,
      thinkingBlocks: streamResult.thinkingBlocks,
      // v14.5.0: 用户中止（anthropicHandlers 返回 stopReason:'aborted'）→ 透传，runtime 识别为中止而非失败
      aborted: streamResult.stopReason === 'aborted',
    }
  }

  abortStream(): void {
    this.service.abortStream()
  }
}
