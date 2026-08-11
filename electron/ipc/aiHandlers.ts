import { IpcMain, SafeStorage, app, nativeImage } from 'electron'

import { logTokenUsage } from './statsHandlers'
import { getOpenAI, getConfigStore, localISOString, calculateCost, mergeConfigKeys, normalizeOpenAIBaseURL } from './utils'
import { executeFileTool, type ToolCallArgs } from './fileToolHandlers'
import { netFetch } from './netFetch'
import { convertMessages, convertTools, type ConverterMessage, type ResponseItem } from './responsesConverter'
import type { StoredConfig } from './utils'
import type { ModelConfig } from '../../src/types/settings'
import { parseOpenRouterModels, type ModelPricePreset } from '../../src/utils/modelPricing'

function categorizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unknown error'
  const lower = message.toLowerCase()
  if (lower.includes('content_filter') || lower.includes('content_policy') || lower.includes('safety') || lower.includes('moderation') || lower.includes('refusal'))
    return '[CONTENT_POLICY] 内容被安全策略拦截。建议关闭知识库或更换模型后重试。'
  if (lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests'))
    return '[RATE_LIMIT] 请求过于频繁，请稍后重试。'
  if (lower.includes('invalid_api_key') || lower.includes('unauthorized') || lower.includes('authentication') || lower.includes('401') || lower.includes('403'))
    return '[AUTH_ERROR] API 密钥无效或权限不足，请检查模型设置。'
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('timeout') || lower.includes('network') || lower.includes('econnreset') || lower.includes('connection'))
    return '[NETWORK] 网络连接失败，请检查 API 地址和网络。'
  if (lower.includes('unsupported') || lower.includes('not support') || lower.includes('not found') || lower.includes('404') || lower.includes('does not exist'))
    return '[UNSUPPORTED_OPERATION] 当前模型不支持此操作。请切换到支持该功能的模型。'
  return `[API_ERROR] ${message}`
}

// Parse multimodal content (GPT-4o, Gemini, etc.) — extract text + base64 images
function normalizeContent(content: unknown): { text: string; images: string[] } {
  if (typeof content === 'string') return { text: content, images: [] }
  if (!Array.isArray(content)) return { text: String(content || ''), images: [] }
  const textParts: string[] = []
  const images: string[] = []
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      textParts.push(part.text)
    } else if (part.type === 'image_url' && part.image_url?.url) {
      const url = part.image_url.url
      if (url.startsWith('data:image/')) {
        images.push(url)
        textParts.push(`![AI生成图片](${url})`)
      }
    }
  }
  return { text: textParts.join('\n'), images }
}

function validateRole(role: string): 'user' | 'assistant' | 'system' | 'tool' {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role
  console.warn(`[AI] Invalid message role "${role}", falling back to "user"`)
  return 'user'
}

// v16.3.0: 副模型仅用于多模态图片理解（vision-chat / analyze_image 共用）
// 语义：secondaryApiKey/ApiUrl 字段级回退主配置；未填独立地址时用主地址（OpenAI 兼容端点）
async function buildSecondaryClient(config: StoredConfig): Promise<import('openai').OpenAI> {
  const OpenAI = await getOpenAI()
  // v16.3.1(审计 D1): baseURL 归一化——secondaryApiUrl 回退主地址时同受 /anthropic 后缀 404 影响
  return new OpenAI({
    apiKey: config.secondaryApiKey || config.apiKey,
    baseURL: normalizeOpenAIBaseURL(config.secondaryApiUrl || config.apiUrl || '') || undefined,
    timeout: 180_000,
    maxRetries: 2,
    fetch: netFetch,  // v14.6.1: 系统代理/证书
  })
}

/**
 * v14.8: 共享 thinking 参数构造（DeepSeek V4 深度推理）— 双协议对称修复：
 * pipeline（ai:chat / ai:chat-stream）此前不启 thinking，Anthropic 端启用 → 不对称；
 * 现统一抽取，三处（含 ai:chat-with-tools）共用同一判定。
 * useThinking 为 true 时调用方应抑制 temperature（DeepSeek thinking 与 temperature 互斥）。
 */
// v15.5: effort 三档归一化（官方文档：OpenAI 格式 reasoning_effort 取值 low/high/max，
// 无 medium；Anthropic/Responses 格式另见各适配层映射）——任何历史残留值落回 max
const EFFORT_LEVELS = ['low', 'high', 'max'] as const
export function normalizeEffort(v: unknown): (typeof EFFORT_LEVELS)[number] {
  return EFFORT_LEVELS.includes(v as any) ? (v as any) : 'max'
}

function buildThinkingParams(config: { model: string; enableThinking?: boolean; reasoningEffort?: string }) {
  const isDeepSeek = /deepseek/i.test(config.model)
  const v4Model = isDeepSeek && /v4/i.test(config.model)
  // v15.5 修复: 思考开关双向生效——此前关闭时不传 disabled，而官方文档明确
  // 「思考模式默认打开」→ 关闭开关从未真正生效（模型仍在思考）。现显式 disabled。
  if (v4Model && config.enableThinking === false) {
    return { useThinking: false, patch: { extra_body: { thinking: { type: 'disabled' } } } }
  }
  const useThinking = v4Model && config.enableThinking !== false
  return {
    useThinking,
    patch: useThinking
      ? { extra_body: { thinking: { type: 'enabled' } }, reasoning_effort: normalizeEffort(config.reasoningEffort) }
      : {},
  }
}

export function registerAiHandlers(ipcMain: IpcMain, safeStorage: SafeStorage, projectsPath?: string) {
  ipcMain.handle('ai:chat', async (_event, messages: { role: string; content: string }[], configId: string, projectId?: string) => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config) throw new Error('Model config not found')

    const apiKey = config.apiKey

    const OpenAI = await getOpenAI()
    // v14.6.1: fetch 走 Chromium 网络栈（系统代理 + 系统证书）——别人电脑在代理网络下可连通
    // v14.9(审计): timeout 120s→180s——原早于 IPC 180s 硬超时触发：thinking+大上下文长生成 >120s 被
    // SDK 掐断并内部静默重试（双计费），再叠加 runtime 瞬态重试最多计费 3 次
    const client = new OpenAI({
      apiKey,
      // v16.3.1(审计 D1): baseURL 归一化——剥 /anthropic、/v1/messages 后缀（DeepSeek 官方
      // Anthropic 端点形态），OpenAI 兼容端点请求不再 404
      baseURL: normalizeOpenAIBaseURL(config.apiUrl || '') || undefined,
      timeout: 180_000,
      maxRetries: 2,  // retry up to 2 times on network/5xx errors
      fetch: netFetch,
    })

    const apiMessages = [
      ...messages.map((m, i) => {
        const msg: Record<string, unknown> = { role: validateRole(m.role) as 'user' | 'assistant', content: m.content }
        if (i === 0 && m.role === 'system') msg.cache_control = { type: 'ephemeral' }
        return msg
      }),
    ]

    try {
      // v14.8: thinking 对称 — DeepSeek V4 开启深度推理（与 chat-with-tools / Anthropic 端一致）
      const { useThinking, patch } = buildThinkingParams(config)
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: apiMessages as any,
        ...(useThinking ? {} : { temperature: config.temperature }),
        max_tokens: config.maxTokens > 0 ? config.maxTokens : 16384,  // v14.3.1: OpenAI 协议兜底 16384（与 Anthropic 对齐，防章节输出截断；原 undefined 依赖供应商默认可能低至 4096）
        ...patch,
      } as any)

      // Log token usage (always, even without projectId)
      const usage = completion.usage
      if (usage) {
        logTokenUsage({
          timestamp: localISOString(),
          projectId: projectId || '__global__',
          configId: config.id,
          configName: config.name,
          model: config.model,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          cacheHitTokens: (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0,
          cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
          source: 'pipeline',  // v14.2.1: ai:chat 仅独立流水线（续写/仿写/角色生成等）使用
        }).catch((err) => { console.warn('[aiHandlers] logTokenUsage failed (ai:chat):', err) })
      }

      const choice = completion.choices[0]
      const result = choice?.message?.content || (choice ? '' : '[AI] 模型返回了空结果（可能被内容策略拦截）')
      // v16.0.1(审计 M5): usage 返回补 cached_tokens——pipeline 通道此前不返回，缓存命中费用按全价计
      // （日志侧已正确提取，返回 JSON 侧缺失 → 调用方拿不到缓存命中统计）
      const cachedTokens = (usage?.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0
      return JSON.stringify({
        text: result,
        usage: usage ? {
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: usage.completion_tokens || 0,
          total_tokens: usage.total_tokens || 0,
          cached_tokens: cachedTokens,
          cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, cachedTokens, config),
        } : undefined,
      })
    } catch (err) {
      throw new Error(categorizeError(err))
    }
  })

  // Track abort handlers per webContents
  const streamAbortHandlers = new Map<number, (_event: Electron.IpcMainEvent) => void>()
  const toolChatAbortHandlers = new Map<number, (_event: Electron.IpcMainEvent) => void>()
  // v16.2.0: 视觉分析 abort（v16.3.0: 文生图移除后仅存此通道）
  const visionAbortControllers = new Map<number, AbortController>()

  // Streaming chat: renders chunks via events
  ipcMain.handle('ai:chat-stream', async (event, messages: { role: string; content: string }[], configId: string, projectId?: string) => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config) {
      event.sender.send('ai:chat-error', { message: '[AUTH_ERROR] API 配置未找到，请检查模型设置。' })
      return
    }

    const apiKey = config.apiKey
    const OpenAI = await getOpenAI()
    // v14.6.1: netFetch（系统代理/证书）
    // v16.3.1(审计 D1): baseURL 归一化——剥 /anthropic、/v1/messages 后缀
    const client = new OpenAI({ apiKey, baseURL: normalizeOpenAIBaseURL(config.apiUrl || '') || undefined, timeout: 180_000, maxRetries: 1, fetch: netFetch })  // v14.9: 120s→180s（对齐 IPC 硬超时，见 ai:chat 注释）

    const apiMessages = [
      ...messages.map((m, i) => {
        const msg: Record<string, unknown> = { role: validateRole(m.role) as 'user' | 'assistant', content: m.content }
        if (i === 0 && m.role === 'system') msg.cache_control = { type: 'ephemeral' }
        return msg
      }),
    ]

    const abortController = new AbortController()
    const wcId = event.sender.id
    const onAbort = (_event: Electron.IpcMainEvent) => { if (_event.sender.id === wcId) abortController.abort() }
    if (streamAbortHandlers.has(wcId)) {
      ipcMain.removeListener('ai:abort-stream', streamAbortHandlers.get(wcId)!)
    }
    streamAbortHandlers.set(wcId, onAbort)
    ipcMain.on('ai:abort-stream', onAbort)
    // #20: Auto-cleanup when webContents is destroyed
    event.sender.once('destroyed' as any, () => {
      ipcMain.removeListener('ai:abort-stream', onAbort)
      streamAbortHandlers.delete(wcId)
    })

    try {
      // v14.8: thinking 对称 — DeepSeek V4 开启深度推理（与 chat-with-tools / Anthropic 端一致）
      // 注：对象 cast as any 后 SDK 重载无法解析（stream:true 分支），故结果显式标注流式 chunk 结构
      const { useThinking, patch } = buildThinkingParams(config)
      const stream = await client.chat.completions.create({
        model: config.model, messages: apiMessages as any,
        ...(useThinking ? {} : { temperature: config.temperature }),
        max_tokens: config.maxTokens > 0 ? config.maxTokens : 16384, stream: true,  // v14.3.1: OpenAI 协议兜底 16384（与 Anthropic 对齐，防章节输出截断；原 undefined 依赖供应商默认可能低至 4096）
        // v14.9(审计): 显式请求 usage——OpenAI 语义下流式 usage 需 include_usage 才返回，
        // 原依赖供应商默认 → 流水线费用可能漏记
        stream_options: { include_usage: true },
        ...patch,
      } as any, { signal: abortController.signal }) as unknown as AsyncIterable<{
        choices: Array<{ delta?: { content?: string | null } | null }>
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number } } | null
      }>

      let fullContent = ''
      let usageInfo: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens: number } | null = null

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || ''
        if (delta) {
          fullContent += delta
          event.sender.send('ai:chat-chunk', { chunk: delta, accumulated: fullContent })
        }
        // OpenAI sends usage in the final chunk
        if (chunk.usage) {
          usageInfo = {
            prompt_tokens: chunk.usage.prompt_tokens || 0,
            completion_tokens: chunk.usage.completion_tokens || 0,
            total_tokens: chunk.usage.total_tokens || 0,
            cached_tokens: (chunk.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens || 0,
          }
        }
      }

      ipcMain.removeListener('ai:abort-stream', onAbort)
      streamAbortHandlers.delete(wcId)
      if (usageInfo) {
        logTokenUsage({
          timestamp: localISOString(),
          projectId: projectId || '__global__',
          configId: config.id,
          configName: config.name,
          model: config.model,
          inputTokens: usageInfo.prompt_tokens,
          outputTokens: usageInfo.completion_tokens,
          cacheHitTokens: usageInfo.cached_tokens || 0,
          cost: calculateCost(usageInfo.prompt_tokens, usageInfo.completion_tokens, usageInfo.cached_tokens || 0, config),
          source: 'pipeline',  // v14.2.1: ai:chat-stream 仅独立流水线使用
        }).catch((err) => { console.warn('[aiHandlers] logTokenUsage failed (ai:chat-stream):', err) })
      }

      event.sender.send('ai:chat-done', {
        text: fullContent,
        usage: usageInfo ? {
          prompt_tokens: usageInfo.prompt_tokens,
          completion_tokens: usageInfo.completion_tokens,
          total_tokens: usageInfo.total_tokens,
          // v16.0.1(审计 M5): 补 cached_tokens（同 ai:chat）
          cached_tokens: usageInfo.cached_tokens,
          cost: calculateCost(usageInfo.prompt_tokens, usageInfo.completion_tokens, usageInfo.cached_tokens || 0, config),
        } : undefined,
      })
    } catch (err) {
      ipcMain.removeListener('ai:abort-stream', onAbort)
      streamAbortHandlers.delete(wcId)

      // Handle user-initiated abort
      if (err instanceof Error && err.name === 'AbortError') {
        event.sender.send('ai:chat-cancelled', { message: '生成已取消' })
        return
      }

      event.sender.send('ai:chat-error', { message: categorizeError(err) })
    }
  })

  ipcMain.handle('ai:listModels', async (_event, configId: string, scope?: string) => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config || !config.apiUrl) return []

    let apiKey: string
    let apiUrl: string
    // v16.2.0: scope='image'/'vision' 读 secondary* 配置。
    // v16.2.0(审查修复 C4): 字段级 fallback 与运行时一致（vision-chat 是
    // secondaryApiKey||apiKey、secondaryApiUrl||apiUrl 独立回退）——原要求地址+密钥同时存在
    // 才走副端点，配置「填了副地址、留空副密钥」时列表打主端点、实际请求打副端点，行为不一致。
    // v16.3.1(审计 D1): 统一走 normalizeOpenAIBaseURL——原内联仅 anthropic 协议分支归一化，
    // vision 分支漏归（/anthropic 后缀地址下 models.list 同样 404）；现无条件归一化
    // （regex 只剥 Anthropic 路径段，对合法 OpenAI 兼容 base 无害）
    if (scope === 'image' || scope === 'vision') {
      apiKey = config.secondaryApiKey || config.apiKey
      apiUrl = normalizeOpenAIBaseURL(config.secondaryApiUrl || config.apiUrl || '')
    } else {
      apiKey = config.apiKey
      // Anthropic 协议的地址含 /anthropic 或完整 /v1/messages（如 OpenCode zen/go），
      // /models 端点不存在于此路径——回退到供应商的 OpenAI 兼容基础地址
      apiUrl = normalizeOpenAIBaseURL(config.apiUrl || '')
    }

    if (!apiKey) {
      throw new Error(`API 密钥未设置。请在模型设置中填写 API 密钥后重试。\n当前地址: ${apiUrl}`)
    }

    // v15.1: 8s→15s——慢网络/代理环境下 models.list() 与 ping 均易在 8s 内超时，
    // 造成"无法连接模型"误报（首启无缓存 DNS + 系统代理握手可 >8s）
    const MODEL_LIST_TIMEOUT = 15_000
    try {
      const OpenAI = await getOpenAI()
      const client = new OpenAI({ apiKey, baseURL: apiUrl, timeout: MODEL_LIST_TIMEOUT, fetch: netFetch })
      const response = await client.models.list()
      return response.data.map(m => m.id)
    } catch {
      try {
        const OpenAI = await getOpenAI()
        const client = new OpenAI({ apiKey, baseURL: apiUrl, timeout: MODEL_LIST_TIMEOUT, fetch: netFetch })
        await client.chat.completions.create({
          model: config.model || 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        })
        return [config.model || 'deepseek-chat']
      } catch (err2) {
        const msg = err2 instanceof Error ? err2.message : String(err2)
        // v15.1: 提示补充可操作指引——对方是默认模板(gpt-4o/openai.com)时点明最可能原因
        const defaultHint = (!config.model || /gpt-4o/i.test(config.model)) && /openai\.com/i.test(apiUrl)
          ? '\n\n提示: 当前配置仍是默认的 OpenAI 地址(gpt-4o)。若你使用的是 DeepSeek 等其它服务商，\n请先在「服务商」下拉框选择对应服务商(如 DeepSeek)，并确保模型名正确。'
          : '\n\n请确认: ① API 地址与密钥正确(服务商处选对) ② 网络可访问该地址 ③ 系统代理/防火墙未拦截。'
        throw new Error(`无法连接 API\n地址: ${apiUrl}\n密钥: ${apiKey ? apiKey.slice(0,8)+'...' : '(未设置)'}\n错误: ${msg}${defaultHint}`)
      }
    }
  })

  // v15.2.1: 联网获取模型实时价格（OpenRouter 免密钥公开目录 https://openrouter.ai/api/v1/models）
  // 价格波动频繁（DeepSeek 2026-08-06 公告拟涨价）——设置页"联网查价"按钮拉取，覆盖内置参考价
  ipcMain.handle('ai:fetch-model-pricing', async () => {
    const PRICING_TIMEOUT = 15_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PRICING_TIMEOUT)
    try {
      const res = await netFetch('https://openrouter.ai/api/v1/models', { signal: controller.signal })
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`)
      const json: unknown = await res.json()
      const models: Record<string, ModelPricePreset> = parseOpenRouterModels(json)
      if (Object.keys(models).length === 0) throw new Error('响应中没有可解析的模型价格')
      return { models, source: 'OpenRouter', fetchedAt: Date.now() }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`联网查价失败（${msg}）。网络受限时请使用内置参考价。`)
    } finally {
      clearTimeout(timer)
    }
  })

  // Pexels API key — stored separately from model configs
  ipcMain.handle('settings:savePexelsKey', async (_event, key: string) => {
    const store = await getConfigStore(); (store as any).set('pexelsApiKey', key)
  })
  ipcMain.handle('settings:loadPexelsKey', async () => {
    const store = await getConfigStore(); return (store as any).get('pexelsApiKey', '')
  })

  // H5: 明文存储（v13.x 决策），MASKED_KEY 占位符/缺失字段保留磁盘旧密钥，防止占位符字面量覆写真实密钥
  ipcMain.handle('settings:saveConfigs', async (_event, configs: ModelConfig[]) => {
    const store = await getConfigStore()
    const existing = store.get('configs', []) as StoredConfig[]
    const toStore = configs.map(c => ({
      ...c,
      ...mergeConfigKeys(
        existing.find(e => e.id === c.id) as Record<string, unknown> | undefined,
        c as unknown as Record<string, unknown>,
      ),
      encrypted: false,
    })) as StoredConfig[]

    store.set('configs', toStore)
    return {}
  })

  ipcMain.handle('settings:loadConfigs', async () => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    return configs.map(c => ({
      ...c,
      inputPricePerM: c.inputPricePerM ?? 2.50,
      outputPricePerM: c.outputPricePerM ?? 10.00,
      cacheHitPricePerM: c.cacheHitPricePerM ?? 1.25,
    }))
  })

  ipcMain.handle('settings:clearConfigs', async () => {
    const store = await getConfigStore()
    store.set('configs', [])
  })

  // ── Tool-enabled chat (single turn) ──
  ipcMain.handle('ai:chat-with-tools',
    async (event, messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[],
      configId: string, projectId?: string, tools?: unknown[], temperature?: number,
      /** v14.2.1: 调用来源 — 子代理传 'subagent'，主 agent 不传（默认 main） */
      source?: string,
      /** v14.6.1: 请求标识 — per-request abort（并行子代理精确中止，不再单槽误杀） */
      requestId?: string,
    ) => {
      const store = await getConfigStore()
      const configs = store.get('configs', []) as StoredConfig[]
      const config = configs.find(c => c.id === configId)
      if (!config) throw new Error('Model config not found')

      const apiKey = config.apiKey
      const OpenAI = await getOpenAI()
      // v14.6.1: netFetch（系统代理/证书）
    // v16.3.1(审计 D1): baseURL 归一化——剥 /anthropic、/v1/messages 后缀
    const client = new OpenAI({ apiKey, baseURL: normalizeOpenAIBaseURL(config.apiUrl || '') || undefined, timeout: 180_000, maxRetries: 1, fetch: netFetch })  // v14.9: 120s→180s（对齐 IPC 硬超时，见 ai:chat 注释）

      // v14.6.1: per-request abort——每个请求独立注册监听器，按 requestId 匹配精确中止；
      // 不带 requestId 的中止（用户停止）命中该 webContents 全部在途请求
      const abortController = new AbortController()
      const wcId = event.sender.id
      const rid = typeof requestId === 'string' && requestId ? requestId : `req_${Date.now().toString(36)}`
      const onAbort = (ev: Electron.IpcMainEvent, target?: string) => {
        if (ev.sender.id !== wcId) return
        if (target !== undefined && target !== rid) return
        abortController.abort()
      }
      toolChatAbortHandlers.set(wcId, onAbort)
      ipcMain.on('ai:abort-tool-chat', onAbort)
      event.sender.once('destroyed' as any, () => {
        ipcMain.removeListener('ai:abort-tool-chat', onAbort)
        if (toolChatAbortHandlers.get(wcId) === onAbort) toolChatAbortHandlers.delete(wcId)
      })

      const apiMessages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string; cache_control?: { type: string } }> = messages
        // v16.0.2(F1): 孤儿 tool 消息（tool_call_id 无前置 assistant.tool_calls 配对，如 M11 跨 run
        // 还原的 hist_ 消息）转纯文本 user 消息——不能丢弃（ReadResultTracker.stillInContext 依赖
        // 其在 messagesForApi 做内容指纹），也不能保留 tool_call_id（chat/completions 对孤儿 tool 400）
        .flatMap(m => {
          if (m.role === 'tool' && m.tool_call_id) {
            const hasOwner = messages.some(am => am.role === 'assistant' && Array.isArray(am.tool_calls)
              && (am.tool_calls as Array<{ id?: string }>).some(tc => tc?.id === m.tool_call_id))
            if (!hasOwner) {
              return [{ role: 'user' as const, content: `[历史工具结果]\n${String(m.content || '').slice(0, 500)}` }]
            }
          }
          return [m]
        })
        .map((m, i) => {
          const msg: Record<string, unknown> = {
            role: validateRole(m.role),
            content: m.content,
          }
          if (m.tool_calls) {
            msg.tool_calls = (m.tool_calls as any[]).map(tc => ({
              ...tc,
              type: tc.type || 'function',
            }))
          }
          if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
          // v11.4: Preserve reasoning_content for DeepSeek V4 thinking mode
          // Required for multi-turn tool calling — model expects reasoning in history
          // v14.5.0: runtime 历史消息为 camelCase（reasoningContent），补 camel 兜底
          const reasoningContent = (m as Record<string, unknown>).reasoning_content
            ?? (m as Record<string, unknown>).reasoningContent
          if (reasoningContent) {
            msg.reasoning_content = reasoningContent
          }
          // v3.1: Mark first system message for prefix caching (DeepSeek supports cache_control)
          if (i === 0 && m.role === 'system') {
            msg.cache_control = { type: 'ephemeral' }
          }
          return msg as any
        })

      // 🔧 Dump API messages to file for debugging (env-guarded, safe path)
      try {
        if (process.env.QINGJIAN_DEBUG_PROMPT === '1') {
          const { writeFileSync, mkdirSync } = await import('fs')
          const { join } = await import('path')
          const debugDir = join(app.getPath('userData'), 'debug')
          const dump = apiMessages.map((m, i) =>
            `[${i}] ${m.role}${m.cache_control ? ' [CACHED]' : ''}\n${(m.content || '').slice(0, 4000)}${(m.content || '').length > 4000 ? '...' : ''}`
          ).join('\n\n---\n\n')
          mkdirSync(debugDir, { recursive: true })
          writeFileSync(join(debugDir, 'last-prompt.txt'), `API call at ${new Date().toISOString()}\nMessages: ${apiMessages.length}\n\n${dump}`)
        }
      } catch {}

      // Hard timeout: abort API call at the IPC level
      // v14.5.0: 90s → 180s，与 runtime 的 API_TIMEOUT(180s) 对齐——
      // 原 90s 先于 runtime 掐断长输出（大章节生成 max_tokens 16K 可超 90s），导致"无回复"误报
      const IPC_API_TIMEOUT = 180_000
      let hardTimeout: ReturnType<typeof setTimeout> | null = null

      try {
        // v14.8: DeepSeek V4 thinking 参数统一走共享构造（chat-with-tools 与 pipeline 对称）
        const { useThinking, patch } = buildThinkingParams(config)

        // v12.5.1: 阶段感知温度 — runtime 根据阶段传入，无传入时回退到 config.temperature
        // 创作轮: temperature = config.temperature (默认 1.0)
        // 执行轮: temperature = min(config.temperature, config.toolTemperature || 0.5)
        const effectiveTemperature = temperature ?? config.temperature

        const params: Record<string, unknown> = {
          model: config.model,
          messages: apiMessages,
          max_tokens: config.maxTokens > 0 ? config.maxTokens : 16384,  // v14.3.1: OpenAI 协议兜底 16384（与 Anthropic 对齐，防章节输出截断；原 undefined 依赖供应商默认可能低至 4096）
          ...(useThinking ? {} : { temperature: effectiveTemperature }),
          ...patch,
        }

        if (tools && tools.length > 0) {
          // v3.1: Mark last tool for prefix caching — DeepSeek caches from start to this point
          const cachedTools = tools.map((t: any, i: number) => {
            if (i === tools.length - 1) return { ...t, cache_control: { type: 'ephemeral' } }
            return t
          })
          params.tools = cachedTools
          if (!useThinking) {
            params.tool_choice = 'auto'
          }
        }

        hardTimeout = setTimeout(() => {
          abortController.abort()
        }, IPC_API_TIMEOUT)

        let completion: Awaited<ReturnType<typeof client.chat.completions.create>>
        try {
          completion = await client.chat.completions.create(params as any, { signal: abortController.signal })
        } finally {
          if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null }
        }

        const usage = completion.usage as Record<string, number> | undefined
        if (usage) {
          // v3.1: Log cache hit info (DeepSeek reports cached tokens in usage)
          const cachedInput = usage.prompt_cache_hit_tokens || usage.cache_read_input_tokens || 0
          const cacheMiss = usage.prompt_cache_miss_tokens || 0
          // v16.0.2(清理): 原 console.log 调试日志删除——缓存信息由 logTokenUsage 记账
          //（usage.jsonl 含 cacheHitTokens）+ anthropicHandlers 同类日志已并入诊断通道
          logTokenUsage({
            timestamp: localISOString(),
            projectId: projectId || '__global__',
            configId: config.id,
            configName: config.name,
            model: config.model,
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: usage.completion_tokens || 0,
            cacheHitTokens: (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0,
            cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
            // v14.2.1: 子代理委托的调用标 'subagent'；主 agent 不传 → 'main'
            source: source || 'main',
          }).catch((err) => { console.warn('[aiHandlers] logTokenUsage failed (ai:chat-with-tools):', err) })
        }

        const choice = completion.choices[0]
        const normalized = normalizeContent(choice?.message?.content)
        // Preserve reasoning_content for thinking models (DeepSeek)
        const reasoningContent = (choice?.message as unknown as Record<string, unknown>)?.reasoning_content as string | undefined
        return JSON.stringify({
          text: normalized.text,
          images: normalized.images.length > 0 ? normalized.images : undefined,
          tool_calls: choice?.message?.tool_calls || null,
          finish_reason: choice?.finish_reason || 'stop',
          reasoning_content: reasoningContent || undefined,
          usage: usage ? {
            prompt_tokens: usage.prompt_tokens || 0,
            completion_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || 0,
            // v14.9(审计): 键名改回 snake_case cached_tokens——原 camelCase 与 OpenAIAdapter 读取
            // (result.usage?.cached_tokens) 不匹配 → 主 agent 缓存命中显示恒 0（与 responses 通道键名对齐）
            cached_tokens: (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0,
            cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
          } : undefined,
        })
      } catch (err) {
        if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null }
        if (err instanceof Error && err.name === 'AbortError') {
          // v16.0.1(审计 M16): 中止时补记已消耗的输入 tokens——OpenAI 协议无 message_start 事件
          // 拿不到真实输入量，用 estimateTokens 估算（方向正确：原中止路径完全不记 → 成本低估）
          // 对齐 anthropicHandlers 中止分支的补记语义
          try {
            const { estimateTokens } = await import('../../src/agent/utils/tokenEstimation')
            const estInput = apiMessages.reduce((s, m) => s + estimateTokens(String(m.content || '')), 0)
            if (estInput > 0) {
              logTokenUsage({
                timestamp: localISOString(),
                projectId: projectId || '__global__',
                configId: config.id,
                configName: config.name,
                model: config.model,
                inputTokens: estInput,  // estimated（OpenAI 协议中止无 usage 事件，按消息估算）
                outputTokens: 0,
                cacheHitTokens: 0,
                cost: calculateCost(estInput, 0, 0, config),
                source: source || 'main',
              }).catch(() => {})
            }
          } catch { /* 估算失败不影响中止路径 */ }
          return JSON.stringify({ text: '', tool_calls: null, finish_reason: 'stop', aborted: true })
        }
        throw new Error(categorizeError(err))
      } finally {
        if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null }
        ipcMain.removeListener('ai:abort-tool-chat', onAbort)
        // v14.8 审查修复(P2): 带守卫删除——与 responses-chat 共用 map，无条件 delete 会误删并发兄弟请求条目
        if (toolChatAbortHandlers.get(wcId) === onAbort) toolChatAbortHandlers.delete(wcId)
      }
    })

  // ── v14.8: DeepSeek Responses API（原生联网搜索通道） ──
  // 路由条件见 responsesRouter.shouldUseResponses（模型配置勾选「原生联网搜索」+ DeepSeek V4）。
  // 实测约束（2026-08-02 真实 API 冒烟）：
  //   - web_search 工具服务端执行；thinking 模式下 tool_choice:{type:'function'} 被拒(400) → 只用 auto
  //   - 多轮回传需全量 items；function_call_output.call_id 必须 = function_call item 的 call_id
  //   - previous_response_id 不被支持；v4-pro 未上线 responses → UNSUPPORTED 族错误自动降级 chat.completions
  ipcMain.handle('ai:responses-chat',
    async (event, messages: unknown[], configId: string, projectId?: string,
      tools?: unknown[], temperature?: number, source?: string, requestId?: string) => {
      const store = await getConfigStore()
      const configs = store.get('configs', []) as StoredConfig[]
      const config = configs.find(c => c.id === configId)
      if (!config) throw new Error('Model config not found')

      const apiKey = config.apiKey
      const OpenAI = await getOpenAI()
      // v16.3.1(审计 D1): baseURL 归一化——剥 /anthropic、/v1/messages 后缀（降级路径复用同一 client）
      const client = new OpenAI({ apiKey, baseURL: normalizeOpenAIBaseURL(config.apiUrl || '') || undefined, timeout: 180_000, maxRetries: 1, fetch: netFetch })

      // per-request abort（同 ai:chat-with-tools — 精确中止并行子代理兄弟请求）
      const abortController = new AbortController()
      const wcId = event.sender.id
      const rid = typeof requestId === 'string' && requestId ? requestId : `req_${Date.now().toString(36)}`
      const onAbort = (ev: Electron.IpcMainEvent, target?: string) => {
        if (ev.sender.id !== wcId) return
        if (target !== undefined && target !== rid) return
        abortController.abort()
      }
      toolChatAbortHandlers.set(wcId, onAbort)
      ipcMain.on('ai:abort-tool-chat', onAbort)
      event.sender.once('destroyed' as any, () => {
        ipcMain.removeListener('ai:abort-tool-chat', onAbort)
        if (toolChatAbortHandlers.get(wcId) === onAbort) toolChatAbortHandlers.delete(wcId)
      })

      // v14.8 审查修复: useThinking 复用共享构造（P2——原内联复制 buildThinkingParams 判定，语义变更会漂移）
      const { useThinking } = buildThinkingParams(config)
      const logUsage = (usage: Record<string, number> | undefined, src: string) => {
        if (!usage) return
        logTokenUsage({
          timestamp: localISOString(),
          projectId: projectId || '__global__',
          configId: config.id,
          configName: config.name,
          model: config.model,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          cacheHitTokens: (usage as Record<string, unknown>).cached_tokens ? Number((usage as Record<string, unknown>).cached_tokens) : 0,
          cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0,
            (usage as Record<string, unknown>).cached_tokens ? Number((usage as Record<string, unknown>).cached_tokens) : 0, config),
          source: src || 'main',
        }).catch((err) => { console.warn('[aiHandlers] logTokenUsage failed (ai:responses-chat):', err) })
      }

      const IPC_API_TIMEOUT = 180_000
      let hardTimeout: ReturnType<typeof setTimeout> | null = null

      try {
        // ── 转换：canonical 消息 → items；tools → responses 形态（+web_search） ──
        const items = convertMessages(messages as ConverterMessage[])
        const convertedTools = convertTools(tools || [], !!config.nativeWebSearch)

        const params: Record<string, unknown> = {
          model: config.model,
          input: items,
          stream: true,
        }
        if (convertedTools.length > 0) params.tools = convertedTools
        if (useThinking) {
          // responses 无 'max' 档（实测 effort 取值 high/low/medium/minimal）→ max 映射 high
          params.reasoning = { effort: (config as any).reasoningEffort === 'max' ? 'high' : ((config as any).reasoningEffort || 'high') }
        } else if (/deepseek/i.test(config.model)) {
          // v15.5: 思考关闭时显式 effort:'none'——DeepSeek 官方文档「思考模式默认打开」，
          // 不传则原生联网通道仍走 thinking（开关失效）；none 表示关闭思考
          params.reasoning = { effort: 'none' }
          if (temperature !== undefined) {
            params.temperature = temperature
          }
        } else {
          // v15.5: 非 deepseek 的 responses 模型（如 OpenCode gpt-5.6-luna）不强制关闭推理——
          // OpenAI Responses 协议推理默认开启，显式 none 反而禁用其原生推理能力
          if (temperature !== undefined) {
            params.temperature = temperature
          }
        }

        let stream: AsyncIterable<{ type: string; delta?: string; item?: ResponseItem; response?: { usage?: Record<string, unknown> } }>
        try {
          hardTimeout = setTimeout(() => { abortController.abort() }, IPC_API_TIMEOUT)
          stream = await client.responses.create(params as any, { signal: abortController.signal }) as unknown as AsyncIterable<{ type: string; delta?: string; item?: ResponseItem; response?: { usage?: Record<string, unknown> } }>
        } catch (err) {
          // v4-pro 尚未上线 responses → UNSUPPORTED 族自动降级 chat.completions（tools 过滤 web_search）
          const msg = err instanceof Error ? err.message : ''
          const lower = msg.toLowerCase()
          if (lower.includes('unsupported') || lower.includes('not support') || lower.includes('not found') || lower.includes('404') || lower.includes('does not exist')) {
            const apiMessages = (messages as Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>)
              // v16.0.2(F1): 孤儿 tool 消息转纯文本（同 ai:chat-with-tools——降级路径同样会 400）
              .flatMap(m => {
                if (m.role === 'tool' && m.tool_call_id) {
                  const owners = messages as Array<{ role: string; tool_calls?: unknown[] }>
                  const hasOwner = owners.some(am => am.role === 'assistant' && Array.isArray(am.tool_calls)
                    && (am.tool_calls as Array<{ id?: string }>).some(tc => tc?.id === m.tool_call_id))
                  if (!hasOwner) {
                    return [{ role: 'user' as const, content: `[历史工具结果]\n${String(m.content || '').slice(0, 500)}` }]
                  }
                }
                return [m]
              })
              .map((m, i) => {
              const mm: Record<string, unknown> = { role: m.role, content: m.content }
              if (m.tool_calls) mm.tool_calls = m.tool_calls
              if (m.tool_call_id) mm.tool_call_id = m.tool_call_id
              // v14.8 审查修复(P1): 透传历史 reasoning_content——DeepSeek 多轮工具调用要求保留推理链
              // （对齐 ai:chat-with-tools 的 v11.4 行为；原缺失使降级路径多轮调用可能 400）
              const rc = (m as Record<string, unknown>).reasoning_content
                ?? (m as Record<string, unknown>).reasoningContent
              if (rc) mm.reasoning_content = rc
              if (i === 0 && m.role === 'system') mm.cache_control = { type: 'ephemeral' }
              return mm
            })
            const { useThinking: fbThinking, patch } = buildThinkingParams(config)
            const fbParams: Record<string, unknown> = {
              model: config.model,
              messages: apiMessages,
              max_tokens: config.maxTokens > 0 ? config.maxTokens : 16384,
              ...(fbThinking ? {} : { temperature: temperature ?? config.temperature }),
              ...patch,
            }
            if (tools && tools.length > 0) {
              // 降级路径剥除 web_search 工具（chat/completions 不接受该类型）
              const fbTools = (tools as Array<Record<string, unknown>>).filter(t => (t as Record<string, unknown>)?.type !== 'web_search')
              fbParams.tools = fbTools
              if (!fbThinking) fbParams.tool_choice = 'auto'
            }
            const fb = await client.chat.completions.create(fbParams as any, { signal: abortController.signal })
            const fbUsage = fb.usage as Record<string, number> | undefined
            logUsage({
              prompt_tokens: fbUsage?.prompt_tokens || 0,
              completion_tokens: fbUsage?.completion_tokens || 0,
              total_tokens: fbUsage?.total_tokens || 0,
              cached_tokens: (fbUsage?.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0,
            }, source || 'main')
            const choice = fb.choices[0]
            const fbCalls = (choice?.message?.tool_calls || []).map((tc: any) => ({
              id: tc.id, name: tc.function?.name || '', arguments: tc.function?.arguments || '',
            }))
            return JSON.stringify({
              text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
              tool_calls: fbCalls.length > 0 ? fbCalls : null,
              finish_reason: choice?.finish_reason || 'stop',
              // v14.9(审计): 降级路径透传 reasoning_content（原硬编码 undefined——v14.5.0 的
              // P1 修复只做了输入侧透传，输出侧遗漏 → 多轮工具调用丢推理链，有 thinking 400 风险）
              reasoning_content: (choice?.message as unknown as Record<string, unknown>)?.reasoning_content as string | undefined,
              usage: fbUsage ? {
                prompt_tokens: fbUsage.prompt_tokens || 0,
                completion_tokens: fbUsage.completion_tokens || 0,
                total_tokens: fbUsage.total_tokens || 0,
                cached_tokens: (fbUsage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0,
                cost: calculateCost(fbUsage.prompt_tokens || 0, fbUsage.completion_tokens || 0,
                  (fbUsage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
              } : undefined,
              fallbackUsed: true,
            })
          }
          throw err
        }

        // ── 流式聚合 ──
        let text = ''
        let reasoning = ''
        let truncated = false
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = []
        let usage: Record<string, unknown> | null = null
        try {
          for await (const ev of stream) {
            if (ev.type === 'response.output_text.delta' && ev.delta) text += ev.delta
            else if (ev.type === 'response.reasoning_text.delta' && ev.delta) reasoning += ev.delta
            else if (ev.type === 'response.output_item.done' && ev.item?.type === 'function_call') {
              toolCalls.push({
                id: ev.item.call_id || '',
                name: ev.item.name || '',
                arguments: ev.item.arguments || '',
              })
            } else if (ev.type === 'response.completed' && ev.response?.usage) {
              usage = ev.response.usage
            } else if (ev.type === 'response.incomplete') {
              // v14.8 审查修复(P2): 输出被截断时置位——runtime 按 finish_reason 'length' 识别截断并续写
              truncated = true
            }
          }
        } finally {
          if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null }
        }

        const u = usage as Record<string, number> | undefined
        const cachedTokens = (usage?.input_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0
        logUsage(u ? {
          prompt_tokens: u.input_tokens || 0,
          completion_tokens: u.output_tokens || 0,
          total_tokens: u.total_tokens || 0,
          cached_tokens: cachedTokens,
        } : undefined, source || 'main')

        return JSON.stringify({
          text,
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
          // v14.8 审查修复(P2): response.incomplete → 'length'（runtime 截断检测依赖此值）
          finish_reason: truncated ? 'length' : 'stop',
          reasoning_content: reasoning || undefined,
          usage: u ? {
            prompt_tokens: u.input_tokens || 0,
            completion_tokens: u.output_tokens || 0,
            total_tokens: u.total_tokens || 0,
            cached_tokens: cachedTokens,
            cost: calculateCost(u.input_tokens || 0, u.output_tokens || 0, cachedTokens, config),
          } : undefined,
        })
      } catch (err) {
        if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null }
        if (err instanceof Error && err.name === 'AbortError') {
          return JSON.stringify({ text: '', tool_calls: null, finish_reason: 'stop', aborted: true })
        }
        throw new Error(categorizeError(err))
      } finally {
        if (hardTimeout) { clearTimeout(hardTimeout); hardTimeout = null }
        ipcMain.removeListener('ai:abort-tool-chat', onAbort)
        // v14.8 审查修复(P2): 带守卫删除——map 与 chat-with-tools 共用，无条件 delete 会误删并发兄弟请求条目
        if (toolChatAbortHandlers.get(wcId) === onAbort) toolChatAbortHandlers.delete(wcId)
      }
    })

  // ── v16.3.0: AI Vision Chat（副模型多模态图片理解）──
  // 上传图片自动分析 / analyze_image 工具共用此通道：主进程读图（path 或 base64）→ nativeImage
  // 缩放（模板上限）→ base64 → OpenAI 兼容 content parts → 副模型 → 回传描述文本 + usage。
  // 设计：不进入主链路 Message 结构（content 恒 string），描述文本由调用方注入主模型上下文。
  // v16.3.0: 原 generate_image 文生图（OpenAI Images API）已整体移除——副模型定位纯多模态理解。

  // 图片处理策略模板（v16.2.0，默认 standard；用户可在设置修改）：
  // standard 1568px = OpenAI tile 基准（约 1-2 万图 token）；detail 精细长描述；eco 经济短描述
  const VISION_TEMPLATES: Record<'standard' | 'detail' | 'eco', { maxImageSize: number; maxOutputTokens: number }> = {
    standard: { maxImageSize: 1568, maxOutputTokens: 800 },
    detail: { maxImageSize: 2048, maxOutputTokens: 1500 },
    eco: { maxImageSize: 768, maxOutputTokens: 300 },
  }
  const VISION_MAX_INPUT_BYTES = 20 * 1024 * 1024 // 20MB 单图上限（读文件前拦截）

  ipcMain.on('ai:abort-vision', (event) => {
    const wcId = event.sender.id
    const ctrl = visionAbortControllers.get(wcId)
    if (ctrl) { ctrl.abort(); visionAbortControllers.delete(wcId) }
  })

  ipcMain.handle('ai:vision-chat',
    async (event, opts: {
      configId: string
      projectId?: string
      prompt: string
      images: Array<{ base64?: string; path?: string }>
      template?: string
    }) => {
      const wcId = event.sender.id
      const prevCtrl = visionAbortControllers.get(wcId)
      if (prevCtrl) { prevCtrl.abort(); visionAbortControllers.delete(wcId) }
      const abortCtrl = new AbortController()
      visionAbortControllers.set(wcId, abortCtrl)

      try {
        const store = await getConfigStore()
        const configs = store.get('configs', []) as StoredConfig[]
        const config = configs.find(c => c.id === opts.configId)
        if (!config) throw new Error('Model config not found')

        const secondaryModel = config.secondaryModel || ''
        if (!secondaryModel) {
          throw new Error('[UNSUPPORTED_OPERATION] 未配置副模型，无法分析图片。请在 设置→模型设置→副模型 填写支持图片理解的模型（如 MiniMax-M3 / qwen-vl-plus）。')
        }

        // 模板解析（非法值落回 standard）
        const templateName: 'standard' | 'detail' | 'eco' = VISION_TEMPLATES[opts.template as keyof typeof VISION_TEMPLATES]
          ? (opts.template as 'standard' | 'detail' | 'eco') : 'standard'
        const tmpl = VISION_TEMPLATES[templateName]

        // 1. 读取图片：path → 文件校验 + 读 buffer；base64 → 直接解
        // v16.2.0(审查修复): 路径解析改用 safeResolveArg（对齐 fileToolHandlers）——
        // 原 isSafePath(相对路径, projectsPath) 对相对路径必然拦截（相对不 startsWith 绝对 base），
        // 导致 analyze_image 传 "images/x.png" / "uploads/images/x.png" 全部误报 [SECURITY]。
        // safeResolveArg 语义：相对首段命中全局目录（uploads/notes/knowledge_base 等）→ appRoot，
        // 否则 → projectPath；绝对路径放行；系统目录/UNC 返回 null。
        const { safeResolveArg } = await import('./pathResolution')
        const { readFile } = await import('fs/promises')
        const buffers: Buffer[] = []
        for (const img of (opts.images || [])) {
          if (img.path) {
            const resolved = await safeResolveArg(String(img.path), projectsPath || '')
            if (!resolved) {
              throw new Error(`[SECURITY] 图片路径被拒绝（系统目录/UNC/不可解析）: ${img.path}`)
            }
            const stat = await import('fs/promises').then(m => m.stat(resolved)).catch(() => null)
            if (!stat) throw new Error(`图片文件不存在: ${img.path}`)
            if (stat.size > VISION_MAX_INPUT_BYTES) {
              throw new Error(`图片过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB，上限 20MB): ${img.path}`)
            }
            buffers.push(await readFile(resolved))
          } else if (img.base64) {
            const buf = Buffer.from(img.base64, 'base64')
            if (buf.length > VISION_MAX_INPUT_BYTES) throw new Error('图片 base64 过大（上限 20MB）')
            buffers.push(buf)
          }
        }
        if (buffers.length === 0) throw new Error('未提供任何图片')

        // 2. 缩放（nativeImage 主进程零依赖）→ PNG base64（data URL 供 image_url part）
        const encoded: string[] = []
        for (const buf of buffers) {
          let image = nativeImage.createFromBuffer(buf)
          if (image.isEmpty()) throw new Error('无法解码图片（格式不支持或文件损坏）')
          const size = image.getSize()
          const maxSide = Math.max(size.width, size.height)
          if (maxSide > tmpl.maxImageSize) {
            const scale = tmpl.maxImageSize / maxSide
            // v16.2.0(审查修复 C6): 极端窄图（宽≈1px）缩放后宽可为 0 → resize 报错/空图
            image = image.resize({
              width: Math.max(1, Math.round(size.width * scale)),
              height: Math.max(1, Math.round(size.height * scale)),
            })
          }
          const png = image.toPNG()
          if (png.length === 0) throw new Error('图片缩放失败（重采样后为空）')
          encoded.push(`data:image/png;base64,${png.toString('base64')}`)
        }

        // 3. 组装 OpenAI 兼容请求（content parts）
        // v16.2.0(审查修复 A2): 复用 buildSecondaryClient
        const client = await buildSecondaryClient(config)
        const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> =
          [{ type: 'text', text: opts.prompt || '请描述这张图片的内容。' }]
        for (const dataUrl of encoded) {
          content.push({ type: 'image_url', image_url: { url: dataUrl } })
        }
        // v16.3.0: 副模型参数补全（对齐 Main 卡片）——温度/最大输出/缓存命中价接线
        // 温度：secondaryTemperature ?? 1.0；最大输出：用户设置 >0 覆盖模板上限（0=跟随模板）；
        // 缓存命中价：secondaryCacheHitPricePerM >0 用之，否则沿用主模型
        const completion = await client.chat.completions.create({
          model: secondaryModel,
          messages: [{ role: 'user' as const, content }],
          temperature: config.secondaryTemperature ?? 1.0,
          max_tokens: (config.secondaryMaxTokens && config.secondaryMaxTokens > 0)
            ? config.secondaryMaxTokens : tmpl.maxOutputTokens,
        }, { signal: abortCtrl.signal } as any)

        const text = completion.choices?.[0]?.message?.content || ''
        const usage = completion.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined

        // 4. token 记账（source='vision' 独立统计；费用按副模型价格实算）
        const cacheHit = (usage as Record<string, unknown> | undefined)?.cached_tokens as number | undefined || 0
        const cost = calculateCost(usage?.prompt_tokens || 0, usage?.completion_tokens || 0, cacheHit, {
          inputPricePerM: config.secondaryInputPricePerM > 0 ? config.secondaryInputPricePerM : config.inputPricePerM,
          outputPricePerM: config.secondaryOutputPricePerM > 0 ? config.secondaryOutputPricePerM : config.outputPricePerM,
          // v16.3.0: 副模型缓存命中价独立可配（0=沿用主模型）
          cacheHitPricePerM: (config.secondaryCacheHitPricePerM && config.secondaryCacheHitPricePerM > 0)
            ? config.secondaryCacheHitPricePerM : config.cacheHitPricePerM,
          mainCurrency: config.mainCurrency || config.currency,
          currency: config.currency,
        } as StoredConfig)
        logTokenUsage({
          timestamp: localISOString(),
          projectId: opts.projectId || '__global__',
          configId: config.id,
          configName: config.name || '',
          model: secondaryModel,
          inputTokens: usage?.prompt_tokens || 0,
          outputTokens: usage?.completion_tokens || 0,
          cacheHitTokens: cacheHit,
          cost,
          source: 'vision',
        })

        return { text, usage: usage || null, cost }
      } catch (err) {
        // v16.2.0(审查修复 C2): 对齐 chat-stream——
        // ① AbortError 身份保留（用户停止时渲染层应显示"已取消"而非"分析失败"）
        // ② categorizeError 中文分类（网络/限流/鉴权错误不泄漏 SDK 英文原文）
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('视觉分析已取消')
        }
        throw new Error(categorizeError(err))
      } finally {
        visionAbortControllers.delete(wcId)
      }
    })

  // ── Execute file tools on main process ──
  // v14.6.1: 移除 DANGEROUS_TOOL_NAMES + confirmed 门闩——渲染层 executor 恒写 confirmed:true，
  // 该检查从不触发（死防御），且会给未来"改回 DANGEROUS_ASK"留下静默绕过的假安全感。
  // 实际防线：渲染层 V4SecurityFence（ToolRegistry needsApproval + 无审批路径拒绝）+ 主进程
  // isBlockedSystemPath 系统目录黑名单（任意盘符）——单一权威在 fence，主进程兜底路径。
  ipcMain.handle('ai:execute-file-tool',
    async (_event, calls: ToolCallArgs[]) => {
      if (!projectsPath) throw new Error('Projects path not configured')
      const results = []
      for (const call of calls) {
        const result = await executeFileTool(call, projectsPath)
        results.push(result)
      }
      return results
    })
}
