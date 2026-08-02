// ── Anthropic Protocol Adapter ──
// Wraps the Anthropic Messages API (via anthropicService).
// Contains messagesToAnthropic() and toAnthropicTools() — previously in V4AnthropicRuntime.ts.
// Internal message storage is OpenAI format; this adapter converts at the API boundary.

import type { Message } from '../../state/types'  // v14.9(清理): 移除未使用的 ToolCallRequest 导入
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
    /** v14.6.1: 请求标识 — 并行子代理场景下 abort 精确指向目标请求（原全局单槽会误杀兄弟请求） */
    requestId?: string
  }): Promise<AnthropicStreamResult>
  abortStream(requestId?: string): void
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
      // v14.6.1: 合并紧随 tool 结果后的纯文本 user（runtime 合成的"截断继续"/空响应兜底消息）——
      // 否则产生 [user(tool_result), user(text)] 连续同角色 → 严格 Anthropic 端点 400
      // （tool_result 与 text 块共存于同一 user 消息是 Anthropic 合法形态）
      if (j < msgs.length && msgs[j].role === 'user' && typeof msgs[j].content === 'string') {
        const text = msgs[j].content
        if (text.trim()) toolResultBlocks.push({ type: 'text', text })
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
      // v14.6.1: 合并连续同角色纯文本消息（会话裁剪/历史重建可能产生 [user,user]）——
      // Anthropic 要求消息角色交替，连续同角色 400
      const last = result[result.length - 1]
      if (last && last.role === m.role) {
        for (const block of content) last.content.push(block)
      } else {
        result.push({ role: m.role, content })
      }
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
  /** v14.6.1: 当前在途请求标识（abortStream 精确指向，不再误杀并行子代理兄弟请求） */
  private currentRequestId = ''

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
    // v14.5.1: 断点设在倒数第二个 system 块——最后一块常是易变内容（[当前任务] 进度每轮变化）。
    // 原实现（v11.7.0）在最后一块打断点 → 进度变化使"从开头到断点"的整段 system 前缀缓存
    // 失效（Anthropic 缓存"开头至最后一个 ephemeral 断点"的前缀），长任务每轮全量重编码。
    // 断点前移后：稳定前缀（核心规则/角色模板/项目信息）在断点之前 → 每轮命中；易变块不缓存（体量小）。
    if (systemBlocks.length > 0) {
      const idx = systemBlocks.length > 1 ? systemBlocks.length - 2 : 0
      const target = systemBlocks[idx]
      systemBlocks[idx] = typeof target === 'string'
        ? { type: 'text' as const, text: target, cache_control: { type: 'ephemeral' as const } }
        : { ...target, cache_control: { type: 'ephemeral' as const } }
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
    let streamResult: AnthropicStreamResult
    try {
      streamResult = await this.service.chatAnthropicStream({
        system: systemBlocks,
        messages: anthropicMessages,
        configId: params.configId,
        projectId: params.projectId,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        temperature: params.temperature,
        requestId,
      })
    } finally {
      params.signal?.removeEventListener('abort', onAbort)
    }

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
    // v14.6.1: 精确中止当前请求；无在途请求时兜底中止全部（保持旧语义）
    this.service.abortStream(this.currentRequestId || undefined)
  }
}
