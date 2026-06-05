import { IpcMain, SafeStorage, app } from 'electron'

/** ISO timestamp with local timezone offset (e.g. 2026-05-31T10:34:09+08:00) */
function localISOString(): string {
  const d = new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' +
    pad(d.getMonth() + 1) + '-' +
    pad(d.getDate()) + 'T' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' +
    pad(d.getSeconds()) + sign +
    pad(Math.floor(off / 60)) + ':' +
    pad(off % 60)
}
import { logTokenUsage } from './statsHandlers'
import { decryptKey, encryptKey, MASKED_KEY, getOpenAI, getConfigStore } from './utils'
import { executeFileTool, type ToolCallArgs } from './fileToolHandlers'
import type { StoredConfig } from './utils'
import type { ModelConfig } from '../../src/types/settings'

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

function calculateCost(inputTokens: number, outputTokens: number, cacheHitTokens: number, config: StoredConfig): number {
  const effectiveInput = Math.max(0, inputTokens - cacheHitTokens)
  const inputPrice = config.inputPricePerM ?? 0
  const cachePrice = config.cacheHitPricePerM ?? 0
  const outputPrice = config.outputPricePerM ?? 0
  // #17: If all prices are zero, return -0.001 to signal "unset" (won't affect display much but flags it)
  const inputCost = (effectiveInput * inputPrice) / 1_000_000
  const cacheCost = (cacheHitTokens * cachePrice) / 1_000_000
  const outputCost = (outputTokens * outputPrice) / 1_000_000
  return inputCost + cacheCost + outputCost
}

export function registerAiHandlers(ipcMain: IpcMain, safeStorage: SafeStorage, projectsPath?: string) {
  ipcMain.handle('ai:chat', async (_event, messages: { role: string; content: string }[], configId: string, projectId?: string) => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config) throw new Error('Model config not found')

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)

    const OpenAI = await getOpenAI()
    const client = new OpenAI({
      apiKey,
      baseURL: config.apiUrl || undefined,
      timeout: 120_000,
      maxRetries: 2,  // retry up to 2 times on network/5xx errors
    })

    const apiMessages = [
      ...messages.map((m, i) => {
        const msg: Record<string, unknown> = { role: validateRole(m.role) as 'user' | 'assistant', content: m.content }
        if (i === 0 && m.role === 'system') msg.cache_control = { type: 'ephemeral' }
        return msg
      }),
    ]

    try {
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: apiMessages as any,
        temperature: config.temperature,
        max_tokens: config.maxTokens > 0 ? config.maxTokens : undefined,
      })

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
        }).catch((err) => { console.warn('[aiHandlers] logTokenUsage failed (ai:chat):', err) })
      }

      const choice = completion.choices[0]
      const result = choice?.message?.content || (choice ? '' : '[AI] 模型返回了空结果（可能被内容策略拦截）')
      return JSON.stringify({
        text: result,
        usage: usage ? {
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: usage.completion_tokens || 0,
          total_tokens: usage.total_tokens || 0,
          cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
        } : undefined,
      })
    } catch (err) {
      throw new Error(categorizeError(err))
    }
  })

  // Track abort handlers per webContents
  const streamAbortHandlers = new Map<number, (_event: Electron.IpcMainEvent) => void>()
  const toolChatAbortHandlers = new Map<number, (_event: Electron.IpcMainEvent) => void>()
  const imageAbortControllers = new Map<number, AbortController>()

  // Streaming chat: renders chunks via events
  ipcMain.handle('ai:chat-stream', async (event, messages: { role: string; content: string }[], configId: string, projectId?: string) => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config) {
      event.sender.send('ai:chat-error', { message: '[AUTH_ERROR] API 配置未找到，请检查模型设置。' })
      return
    }

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
    const OpenAI = await getOpenAI()
    const client = new OpenAI({ apiKey, baseURL: config.apiUrl || undefined, timeout: 120_000, maxRetries: 1 })

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
      const stream = await client.chat.completions.create({
        model: config.model, messages: apiMessages as any, temperature: config.temperature,
        max_tokens: config.maxTokens > 0 ? config.maxTokens : undefined, stream: true,
      }, { signal: abortController.signal })

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
        }).catch((err) => { console.warn('[aiHandlers] logTokenUsage failed (ai:chat-stream):', err) })
      }

      event.sender.send('ai:chat-done', {
        text: fullContent,
        usage: usageInfo ? {
          prompt_tokens: usageInfo.prompt_tokens,
          completion_tokens: usageInfo.completion_tokens,
          total_tokens: usageInfo.total_tokens,
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

    // ── scope='image': 使用图片专用 API 配置（如果用户填写了独立的图片提供商） ──
    // 未填写图片 API 配置时回退到 Main 配置，支持多模态模型（如 GPT-4o 同时输出文本和图片）
    let apiKey: string
    let apiUrl: string
    if (scope === 'image' && config.imageApiUrl && config.imageApiKey) {
      const imageKey = decryptKey(config.imageApiKey, config.imageEncrypted ?? false, safeStorage)
      if (imageKey) {
        apiKey = imageKey
        apiUrl = config.imageApiUrl
      } else {
        apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
        apiUrl = config.apiUrl
      }
    } else {
      apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
      // Anthropic 协议的地址含 /anthropic，/models 端点不存在于此路径
      // 自动回退到供应商的 OpenAI 兼容基础地址
      const protocol = (config as any).protocol
      apiUrl = (protocol === 'anthropic')
        ? (config.apiUrl || '').replace(/\/anthropic(\/.*)?$/, '').replace(/\/+$/, '')
        : config.apiUrl
    }

    if (!apiKey) {
      throw new Error(`API 密钥未设置。请在模型设置中填写 API 密钥后重试。\n当前地址: ${apiUrl}`)
    }

    try {
      const OpenAI = await getOpenAI()
      const client = new OpenAI({ apiKey, baseURL: apiUrl, timeout: 8000 })
      const response = await client.models.list()
      return response.data.map(m => m.id)
    } catch {
      try {
        const OpenAI = await getOpenAI()
        const client = new OpenAI({ apiKey, baseURL: apiUrl, timeout: 8000 })
        await client.chat.completions.create({
          model: config.model || 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        })
        return [config.model || 'deepseek-chat']
      } catch (err2) {
        const msg = err2 instanceof Error ? err2.message : String(err2)
        throw new Error(`无法连接 API\n地址: ${apiUrl}\n密钥: ${apiKey ? apiKey.slice(0,8)+'...' : '(未设置)'}\n错误: ${msg}`)
      }
    }
  })

  // Pexels API key — stored separately from model configs
  ipcMain.handle('settings:savePexelsKey', async (_event, key: string) => {
    const store = await getConfigStore(); (store as any).set('pexelsApiKey', key)
  })
  ipcMain.handle('settings:loadPexelsKey', async () => {
    const store = await getConfigStore(); return (store as any).get('pexelsApiKey', '')
  })

  // Save configs from renderer (encrypt keys, preserve existing keys for masked placeholders)
  ipcMain.handle('settings:saveConfigs', async (_event, configs: ModelConfig[]) => {
    const store = await getConfigStore()
    const existingConfigs = store.get('configs', []) as StoredConfig[]
    const existingMap = new Map(existingConfigs.map(c => [c.id, c]))

    const encryptionAvailable = safeStorage.isEncryptionAvailable()

    const toStore = configs.map(c => {
      // Preserve existing key if: masked placeholder OR empty (user clicked away without typing)
      if ((c.apiKey === MASKED_KEY || !c.apiKey) && existingMap.has(c.id)) {
        const existing = existingMap.get(c.id)!
        return { ...c, apiKey: existing.apiKey, encrypted: existing.encrypted }
      }
      // New or changed key - encrypt it
      const { key, encrypted } = encryptKey(c.apiKey, safeStorage)
      return { ...c, apiKey: key, encrypted }
    })

    store.set('configs', toStore)

    // Warn renderer if platform doesn't support encryption
    if (!encryptionAvailable && configs.some(c => c.apiKey && c.apiKey !== MASKED_KEY)) {
      return { warning: '当前系统不支持安全加密存储，API 密钥将以明文方式保存。建议使用 Windows 或 macOS 以保证密钥安全。' }
    }
    return {}
  })

  ipcMain.handle('settings:loadConfigs', async () => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    return configs.map(c => ({
      ...c,
      apiKey: c.apiKey ? MASKED_KEY : '',
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
      configId: string, projectId?: string, tools?: unknown[],
    ) => {
      const store = await getConfigStore()
      const configs = store.get('configs', []) as StoredConfig[]
      const config = configs.find(c => c.id === configId)
      if (!config) throw new Error('Model config not found')

      const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
      const OpenAI = await getOpenAI()
      const client = new OpenAI({ apiKey, baseURL: config.apiUrl || undefined, timeout: 120_000, maxRetries: 1 })

      // AbortController for tool-chat, uses dedicated channel to avoid conflict with stream
      const abortController = new AbortController()
      const wcId = event.sender.id
      const onAbort = (ev: Electron.IpcMainEvent) => { if (ev.sender.id === wcId) abortController.abort() }
      if (toolChatAbortHandlers.has(wcId)) {
        ipcMain.removeListener('ai:abort-tool-chat', toolChatAbortHandlers.get(wcId)!)
      }
      toolChatAbortHandlers.set(wcId, onAbort)
      ipcMain.on('ai:abort-tool-chat', onAbort)
      event.sender.once('destroyed' as any, () => {
        ipcMain.removeListener('ai:abort-tool-chat', onAbort)
        toolChatAbortHandlers.delete(wcId)
      })

      const apiMessages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string; cache_control?: { type: string } }> = messages.map((m, i) => {
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
          // v3.1: Strip reasoning_content — never re-send to API (wastes 1K-5K tokens)
          // if ((m as Record<string, unknown>).reasoning_content) msg.reasoning_content = ...
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

      // Hard timeout: abort API call after 90 seconds at the IPC level
      const IPC_API_TIMEOUT = 90000
      let hardTimeout: ReturnType<typeof setTimeout> | null = null

      try {
        const params: Record<string, unknown> = {
          model: config.model,
          messages: apiMessages,
          temperature: config.temperature,
          max_tokens: config.maxTokens > 0 ? config.maxTokens : undefined,
        }

        if (tools && tools.length > 0) {
          // v3.2: Cache tool definitions too — mark last tool for prefix caching
          const cachedTools = tools.map((t: any, i: number) => {
            if (i === tools.length - 1) return { ...t, cache_control: { type: 'ephemeral' } }
            return t
          })
          params.tools = cachedTools
          params.tool_choice = 'auto'
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
          if (cachedInput > 0) {
            console.log(`[Cache] ✅ ${cachedInput.toLocaleString()} cached input tokens (90% discount)`)
          }
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
            cacheHitTokens: (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0,
            cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
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
        toolChatAbortHandlers.delete(wcId)
      }
    })

  // ── AI Image Generation ──

  // Abort in-progress image generation
  ipcMain.on('ai:abort-image', (event) => {
    const wcId = event.sender.id
    const ctrl = imageAbortControllers.get(wcId)
    if (ctrl) { ctrl.abort(); imageAbortControllers.delete(wcId) }
  })

  ipcMain.handle('ai:generateImage',
    async (event, prompt: string, configId: string, projectId?: string, size?: string, style?: string) => {
      const wcId = event.sender.id
      // Cancel any previous image generation for this window
      const prevCtrl = imageAbortControllers.get(wcId)
      if (prevCtrl) { prevCtrl.abort(); imageAbortControllers.delete(wcId) }
      const abortCtrl = new AbortController()
      imageAbortControllers.set(wcId, abortCtrl)

      try {
      const store = await getConfigStore()
      const configs = store.get('configs', []) as StoredConfig[]
      const config = configs.find(c => c.id === configId)
      if (!config) throw new Error('Model config not found')

      // Image model: use image-specific config, fall back to main config
      const imageApiKey = config.imageApiKey || config.apiKey
      const imageEncrypted = config.imageEncrypted ?? config.encrypted
      const apiKey = decryptKey(imageApiKey, imageEncrypted, safeStorage)
      const OpenAI = await getOpenAI()
      const client = new OpenAI({
        apiKey,
        baseURL: config.imageApiUrl || config.apiUrl || undefined,
        timeout: 180_000,
        maxRetries: 2,
      })

      const imageSize = size || '1024x1024'
      const imageStyle = style || 'vivid'
      const imageModel = config.imageModel || 'dall-e-3'

      // Build generate params — size/style are DALL-E specific, omit for other models
      const genParams: Record<string, unknown> = {
        model: imageModel,
        prompt,
        n: 1,
        response_format: 'url',
      }
      if (imageSize) genParams.size = imageSize
      if (imageStyle && imageModel.includes('dall-e')) genParams.style = imageStyle

      let response: { data?: { url?: string; b64_json?: string }[] }
      try {
        response = await client.images.generate(genParams as any, { signal: abortCtrl.signal }) as { data?: { url?: string; b64_json?: string }[] }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : ''
        const status = (err as { status?: number })?.status
        if (status === 404 || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('unsupported')) {
          throw new Error(`[UNSUPPORTED_OPERATION] 图片模型 "${imageModel}" 不支持图片生成。请使用 dall-e-3 或在设置中配置支持图片生成的模型。`)
        }
        throw new Error(categorizeError(err))
      }

      // 兼容两类响应：url（OpenAI 原生）和 b64_json（NovelAI 等第三方代理）
      const imageUrl = response?.data?.[0]?.url
      const imageB64 = response?.data?.[0]?.b64_json
      if (!imageUrl && !imageB64) throw new Error('图片生成返回空结果')

      // 图片统一保存到根目录 images/
      const { join, dirname } = await import('path')
      const { mkdir, writeFile } = await import('fs/promises')
      const timestamp = Date.now().toString(36)
      const fileName = `gen_${timestamp}.png`
      if (!projectsPath) throw new Error('Projects path not configured')
      const imagesDir = join(dirname(projectsPath), 'images')
      await mkdir(imagesDir, { recursive: true })
      const imagePath = join(imagesDir, fileName)
      const relativePath = `images/${fileName}`

      let buf: Buffer
      if (imageUrl) {
        const imgRes = await fetch(imageUrl)
        if (!imgRes.ok) throw new Error(`下载图片失败: HTTP ${imgRes.status}`)
        buf = Buffer.from(await imgRes.arrayBuffer())
      } else {
        // b64_json 响应 — 直接解码写入磁盘
        buf = Buffer.from(imageB64!, 'base64')
      }
      await writeFile(imagePath, buf)

      // 图片定价：优先使用 imageInputPricePerM（用户填入的值即为每张图价格，如 DALL-E $0.04/张），
      // 若未填写则回退到 Main 模型的输入价格估算。字段名含 "PerM" 仅为兼容旧版结构。
      const pricePerImage = config.imageInputPricePerM > 0
        ? config.imageInputPricePerM
        : config.inputPricePerM > 0 ? config.inputPricePerM / 1000 : 0.04
      const imageCurrency = config.mainCurrency || config.currency
      const cost = imageCurrency === 'CNY' ? pricePerImage * 7.2 : pricePerImage

      // Log token usage for stats
      logTokenUsage({
        timestamp: localISOString(),
        projectId: projectId || '__global__',
        configId: config.id,
        configName: config.name || '',
        model: config.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheHitTokens: 0,
        cost,
      })

      return { path: relativePath, url: imageUrl, cost, prompt }
      } finally {
        imageAbortControllers.delete(wcId)
      }
    })

  // ── Execute file tools on main process ──
  // #9: Backend enforcement — dangerous tools must be confirmed by frontend
  const DANGEROUS_TOOL_NAMES = new Set(['create_file', 'edit_file', 'delete_file', 'restore_backup', 'rename_file', 'create_project', 'delete_project'])
  ipcMain.handle('ai:execute-file-tool',
    async (_event, calls: ToolCallArgs[]) => {
      if (!projectsPath) throw new Error('Projects path not configured')
      const results = []
      for (const call of calls) {
        if (DANGEROUS_TOOL_NAMES.has(call.toolName) && !(call as unknown as Record<string, unknown>).confirmed) {
          results.push({ callId: call.callId, toolName: call.toolName, status: 'error' as const, summary: '操作未获用户确认' })
          continue
        }
        const result = await executeFileTool(call, projectsPath)
        results.push(result)
      }
      return results
    })
}
