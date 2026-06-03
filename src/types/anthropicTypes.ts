// ── Anthropic Messages API 类型定义 ──
// DeepSeek /anthropic/v1/messages 兼容格式

/** Anthropic 协议中的消息 */
export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

/** Anthropic content block 联合类型 */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock

export interface AnthropicTextBlock {
  type: 'text'
  text: string
}

export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string  // DeepSeek 要求必须是字符串
}

/** DeepSeek V4 thinking block — 必须原样回传 */
export interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
  signature: string
}

/** Anthropic 格式的工具定义 */
export interface AnthropicToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** 流式响应的累积结果 */
export interface AnthropicStreamResult {
  text: string
  toolUses: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }>
  stopReason: string
  thinking?: string
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

/** SSE 事件类型 */
export type SSEEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'ping'
  | 'error'
