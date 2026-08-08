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
  /** v11.7.0: Anthropic prompt caching — marks this block as cacheable */
  cache_control?: { type: 'ephemeral' }
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
  /** v13.x: Prompt caching on stable history turns */
  cache_control?: { type: 'ephemeral' }
}

/** DeepSeek V4 thinking block — 必须原样回传 */
export interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
  signature: string
  cache_control?: { type: 'ephemeral' }
}

/** Anthropic 格式的工具定义 */
export interface AnthropicToolDef {
  name: string
  description: string
  /** v15.5: 服务端执行工具（web_search_20250305）无 input_schema（官方定义：type+name+max_uses），
   * 客户端自定义工具才有 input_schema —— 改为可选 */
  input_schema?: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** v11.7.0: Anthropic prompt caching — marks this tool def as cacheable */
  cache_control?: { type: 'ephemeral' }
  /** v15.5: 工具类型——web_search_20250305 服务端执行搜索（DeepSeek Anthropic 端点原生支持，
   * 官方文档确认 server_tool_use/web_search_tool_result Supported）；
   * 缺省 = 客户端自定义工具（custom），由本地 tool_executor 执行 */
  type?: 'web_search_20250305' | 'custom' | string
  /** v15.5: web_search 工具可选参数（Anthropic 官方定义） */
  max_uses?: number
  allowed_domains?: string[]
  blocked_domains?: string[]
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
  /** H7: 请求失败时的错误信息（stopReason==='error' 时由主进程/本地 catch 填充） */
  error?: string
  thinking?: string
  /** v11.5.1: Extended thinking blocks — preserved for multi-turn conversation */
  thinkingBlocks?: Array<{ thinking: string; signature: string }>
  /** v15.5: 服务端工具块（server_tool_use / web_search_tool_result）——服务端执行搜索，
   * 多轮回传原样回传（DeepSeek Anthropic 端点要求） */
  serverToolBlocks?: Array<Record<string, unknown>>
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    /** v13.x: 主进程按配置计价后随 invoke 返回值下发 */
    cost?: number
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
