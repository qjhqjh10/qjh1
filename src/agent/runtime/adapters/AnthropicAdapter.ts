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
        // v15.5: 服务端工具（type='web_search_20250305'）无 input_schema——由服务端执行
        ...(fn.type === 'web_search_20250305'
          ? { type: 'web_search_20250305' as const, max_uses: 3 }
          : { input_schema: { type: 'object' as const, properties: fn.parameters?.properties || {}, required: fn.parameters?.required || [] } }),
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

  // v16.0.2(F1): 建立已知 tool_use id 集——孤儿 tool_result（无前置 assistant.tool_calls 配对）
  // 必须丢弃，否则严格 Anthropic 端点 400。来源：M11 跨 run 还原的 hist_ tool 消息
  //（toolCallSteps 型历史无 tool_calls，还原的 tool 消息天然孤儿）；对齐 responsesConverter:87。
  const knownToolUseIds = new Set<string>()
  for (const m of msgs) {
    if (m.role === 'assistant' && Array.isArray((m as any).tool_calls)) {
      for (const tc of (m as any).tool_calls as Array<{ id?: string }>) {
        if (tc?.id) knownToolUseIds.add(tc.id)
      }
    }
  }

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
        const toolUseId = (tm as any).tool_call_id || ''
        // v16.0.2(F1): 孤儿 tool_result（id 不在已知集 → 无前置 tool_use）转为 text 块——
        // 不能丢弃（ReadResultTracker.stillInContext 依赖其在 messagesForApi 做内容指纹），
        // 也不能作为 tool_result 发送（严格 Anthropic 端点 400）。文本块保内容可见。
        if (!toolUseId || !knownToolUseIds.has(toolUseId)) {
          // 内容如 "[历史工具结果: 读取成功] ..."——保留 status/summary/detail 供模型参考
          try {
            const parsed = JSON.parse(contentStr)
            const summary = parsed.summary || ''
            const detail = parsed.detail || ''
            const snippet = `[历史工具结果${summary ? ` ${summary}` : ''}]\n${typeof detail === 'string' ? detail.slice(0, 500) : ''}`
            toolResultBlocks.push({ type: 'text', text: snippet })
          } catch {
            toolResultBlocks.push({ type: 'text', text: `[历史工具结果]\n${contentStr.slice(0, 500)}` })
          }
          j++
          continue
        }
        let isError = false
        try {
          const parsed = JSON.parse(contentStr)
          isError = parsed.status === 'error'
        } catch { /* not valid JSON, keep isError=false */ }
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
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
      // v15.5: 服务端工具块（server_tool_use / web_search_tool_result）原样回传——
      // DeepSeek Anthropic 端点要求多轮保留（否则 400）。runtime 把 server_tool_use 也归入
      // tool_calls，此处按 serverToolBlocks 标记还原。
      // v16.0.3(审查修复): 混合轮修复——serverToolBlocks 存在时不再跳过本地 tool_calls 转换。
      // 原实现整块跳过：同轮模型既调 web_search（服务端）又调本地工具时，本地 tool_use 被丢弃，
      // 但本地工具结果 tool 消息仍正常 push → 下轮发送无前置 tool_use 的 tool_result → 400。
      // 现改为：server_tool_use 块只回传 type 为 server_tool_use / web_search_tool_result 的块，
      // 本地 tool_calls 单独转换（二者 id 不同名不冲突，Anthropic 允许同一 assistant 消息
      // 同时含 tool_use 与 server_tool_use 块）。
      const serverBlocks = (m as any).serverToolBlocks
      const serverToolUseIds = new Set<string>()
      if (serverBlocks && Array.isArray(serverBlocks)) {
        for (const sb of serverBlocks) {
          // 只回传服务端块（server_tool_use 及其结果 web_search_tool_result）；不做本地工具转换
          if (sb?.type === 'server_tool_use') {
            if (sb.id) serverToolUseIds.add(String(sb.id))
            content.push({ ...sb } as any)
          } else if (sb?.type) {
            content.push({ ...sb } as any)
          }
        }
      }
      // 本地工具调用：与 server_tool_use 块并存转换（不跳过）
      for (const tc of (m as any).tool_calls ?? []) {
        const tcName = tc.function?.name ?? tc.name ?? ''
        // 跳过已由服务端块覆盖的 web_search 调用（防双份重复回传）
        if (tcName === 'web_search' || (tc.id && serverToolUseIds.has(String(tc.id)))) continue
        let input: Record<string, unknown> = {}
        try {
          input = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments || {})
        } catch { /* keep empty */ }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tcName,
          input,
        })
      }
      // v16.3.1(审计 F10): 空内容兜底——tool_calls 为 []（旧持久化数据可能产生）时
      // content 可能为空数组 → 严格 Anthropic 端点 400。对齐下方纯文本分支的兜底。
      if (content.length === 0) content.push({ type: 'text', text: '' })
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
  /** v16.3.0: 联网会话级覆盖（三态循环）— 'builtin'|'off' 时 web_search 服务端工具不注入 */
  private nativeOverride?: 'builtin' | 'off' | null

  constructor(service: AnthropicAIService, nativeOverride?: 'builtin' | 'off' | null) {
    this.service = service
    this.nativeOverride = nativeOverride
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
    // v16(缓存审计修复): 断点位置按末块是否易变判定——运行时注入的 system 块（[当前任务]/
    // [系统提醒]/[任务边界]）每轮可能变化 → 断点前移到倒数第二块；否则（如角色模板激活且无
    // 任务清单时 [角色模板, 核心规则] 两块，末块=核心规则为最大稳定内容）断点设在最后一块——
    // 原实现无条件取倒数第二块，导致核心规则（~3600 tokens）每轮全量重编码不享受缓存。
    if (systemBlocks.length > 0) {
      const last = systemBlocks[systemBlocks.length - 1]
      const lastStr = typeof last === 'string' ? last : ''
      // v16.0.1(审计 N1): 易变前缀名单补 [验收提示]——验收提示（V4UnifiedRuntime 清单完成时
    // 以 system push）在 [当前任务] 之后成为末块 → 原名单不含 → lastVolatile=false → 断点留在
    // 末块 → [当前任务] 重新进入缓存前缀，后续轮次全前缀重编码（缓存失效）
    const lastVolatile = lastStr.startsWith('[当前任务]') || lastStr.startsWith('[系统提醒]')
      || lastStr.startsWith('[任务边界]') || lastStr.startsWith('[验收提示]')
      const idx = systemBlocks.length > 1 && lastVolatile ? systemBlocks.length - 2 : systemBlocks.length - 1
      const target = systemBlocks[idx]
      systemBlocks[idx] = typeof target === 'string'
        ? { type: 'text' as const, text: target, cache_control: { type: 'ephemeral' as const } }
        : { ...target, cache_control: { type: 'ephemeral' as const } }
    }

    // 2. Convert messages & tools to Anthropic format
    const anthropicMessages = messagesToAnthropic(nonSystemMsgs)
    const anthropicTools = toAnthropicTools(params.tools)

    // v15.5: DeepSeek Anthropic 端点原生支持 web_search 服务端工具（官方文档确认：
    // server_tool_use / web_search_tool_result Supported；Claude Code 集成文档明确
    // 「DeepSeek API 原生支持 Web Search」）。模型配置勾选「原生联网」且 API 地址为
    // DeepSeek 官方端点时注入服务端工具——模型自主判断调用搜索（agentic），
    // 搜索/解密/总结全在服务端完成，无需本地执行器。
    // 限定 DeepSeek 官方端点：OpenCode 等第三方 Anthropic 端点（Qwen/MiniMax）不保证
    // 支持 server_tool_use，注入会 400。
    try {
      const { useSettingsStore } = await import('@/store')
      const cfg = useSettingsStore.getState().configs.find(c => c.id === params.configId)
      const apiUrl = ((cfg as any)?.apiUrl || '').toLowerCase()
      // v16.0.3(审查修复): 注入条件与 BridgeContextBuilder.deepSeekAnthropicNative 对齐——
      // 原只查 apiUrl，不查模型名：非 deepseek 命名模型挂 DeepSeek 端点 + 原生联网时
      // 服务端 web_search 注入 + 软件内置 DDG 搜索同时执行（双通道联网，结果冲突/冗余计费）。
      // 统一判定：DeepSeek 官方端点 + deepseek 模型 + anthropic 协议 + 原生联网。
      // v16.3.0: 原生判定套会话级覆盖（三态循环切换原生/内置/关闭，不修改模型配置勾选）
      const { resolveNativeEnabled } = await import('./responsesRouter')
      const modelName = String((cfg as any)?.model || '').toLowerCase()
      if (resolveNativeEnabled(cfg, this.nativeOverride) && apiUrl.includes('deepseek.com')
          && /deepseek/i.test(modelName) && (cfg as any)?.protocol === 'anthropic') {
        anthropicTools.push({
          name: 'web_search',
          description: '搜索互联网获取最新信息。当用户的问题需要实时/网络信息时调用。',
          type: 'web_search_20250305',
          max_uses: 3,
        } as AnthropicToolDef)
      }
    } catch { /* 配置读取失败则回退无 web_search */ }

    // v11.7.0: Mark tools with cache_control — caches all tool definitions on first call
    // v15.5: 服务端工具（web_search）不支持 cache_control——只标记最后一个客户端自定义工具
    if (anthropicTools.length > 0) {
      const lastCustom = [...anthropicTools].reverse().find(t => !t.type)
      if (lastCustom) lastCustom.cache_control = { type: 'ephemeral' }
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
    // v15.5: 服务端工具（web_search）由服务端同响应内完成（搜索→结果回填→模型继续），
    // 保留在 toolCalls 让 runtime 正确识别为工具轮；本地 ToolExecutor 对 web_search
    // 跳过执行（见 ToolExecutor），不会误报"未知工具"
    const serverToolCalls = (streamResult.toolUses || []).filter(tu => tu.name === 'web_search')
    // v16.3.1(审计 F11): 兜底遍历全部 web_search 调用（原只取第一个——同轮多次搜索时
    // 后续调用的服务端块丢失，多轮回传不完整）
    const serverToolBlocks = streamResult.serverToolBlocks || (serverToolCalls.length > 0
      ? serverToolCalls.map(tu => ({
        type: 'server_tool_use',
        id: tu.id,
        name: 'web_search',
        input: tu.input,
      }))
      : undefined)
    return {
      text: streamResult.text || '',
      toolCalls: (streamResult.toolUses || []).map(tu => ({
        id: tu.id,
        name: tu.name,
        arguments: JSON.stringify(tu.input),
      })),
      finishReason: streamResult.stopReason || 'end_turn',
      // v15.5: 服务端工具块透传——runtime 挂到 assistant 消息供下轮回传
      serverToolBlocks,
      usage: {
        inputTokens: streamResult.usage?.input_tokens || 0,
        outputTokens: streamResult.usage?.output_tokens || 0,
        // v15.6: Anthropic 协议 usage 为互斥语义——input_tokens 不含 cache_read。
        // totalTokens 必须加上命中部分（= API 实际处理的总输入），否则 billedTokens
        // （total − cacheHit）低估、token 统计虚低
        // v16.0.3: 补 cache_creation——创建缓存同样占输入（全额计费），漏计使 token 统计偏低
        totalTokens: (streamResult.usage?.input_tokens || 0)
          + (streamResult.usage?.cache_read_input_tokens || 0)
          + (streamResult.usage?.cache_creation_input_tokens || 0)
          + (streamResult.usage?.output_tokens || 0),
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
