import { IpcMain, SafeStorage } from 'electron'
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
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('timeout') || lower.includes('network') || lower.includes('econnreset'))
    return '[NETWORK] 网络连接失败，请检查 API 地址和网络。'
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
      ...messages.map(m => ({ role: validateRole(m.role) as 'user' | 'assistant', content: m.content })),
    ]

    try {
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: apiMessages,
        temperature: config.temperature,
        max_tokens: config.maxTokens > 0 ? config.maxTokens : undefined,
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } as any : {}),
      })

      // Log token usage (always, even without projectId)
      const usage = completion.usage
      if (usage) {
        logTokenUsage({
          timestamp: new Date().toISOString(),
          projectId: projectId || '__global__',
          configId: config.id,
          configName: config.name,
          model: config.model,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          cacheHitTokens: (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0,
          cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
        }).catch(() => {})
      }

      const result = completion.choices[0]?.message?.content || ''
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

  // Track abort handlers per webContents (stream and tool-chat use separate maps/channels)
  const streamAbortHandlers = new Map<number, (_event: Electron.IpcMainEvent) => void>()
  const toolChatAbortHandlers = new Map<number, (_event: Electron.IpcMainEvent) => void>()

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
      ...messages.map(m => ({ role: validateRole(m.role) as 'user' | 'assistant', content: m.content })),
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
      // @ts-ignore TS2769 — reasoning_effort not in OpenAI SDK types yet
      const stream = await client.chat.completions.create({
        model: config.model, messages: apiMessages, temperature: config.temperature,
        max_tokens: config.maxTokens > 0 ? config.maxTokens : undefined, stream: true,
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
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
          timestamp: new Date().toISOString(),
          projectId: projectId || '__global__',
          configId: config.id,
          configName: config.name,
          model: config.model,
          inputTokens: usageInfo.prompt_tokens,
          outputTokens: usageInfo.completion_tokens,
          cacheHitTokens: usageInfo.cached_tokens || 0,
          cost: calculateCost(usageInfo.prompt_tokens, usageInfo.completion_tokens, usageInfo.cached_tokens || 0, config),
        }).catch(() => {})
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

  ipcMain.handle('ai:listModels', async (_event, configId: string) => {
    const store = await getConfigStore()
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config || !config.apiUrl) return []

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)

    try {
      const OpenAI = await getOpenAI()
      const client = new OpenAI({ apiKey, baseURL: config.apiUrl })
      const response = await client.models.list()
      return response.data.map(m => m.id)
    } catch {
      return []
    }
  })

  // Save configs from renderer (encrypt keys, preserve existing keys for masked placeholders)
  ipcMain.handle('settings:saveConfigs', async (_event, configs: ModelConfig[]) => {
    const store = await getConfigStore()
    const existingConfigs = store.get('configs', []) as StoredConfig[]
    const existingMap = new Map(existingConfigs.map(c => [c.id, c]))

    const encryptionAvailable = safeStorage.isEncryptionAvailable()

    const toStore = configs.map(c => {
      // If renderer sent the masked placeholder, preserve the existing stored key
      if (c.apiKey === MASKED_KEY && existingMap.has(c.id)) {
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

      const apiMessages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string }> = [
        ...messages.map(m => {
          const msg: Record<string, unknown> = {
            role: validateRole(m.role),
            content: m.content,
          }
          if (m.tool_calls) msg.tool_calls = m.tool_calls
          if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
          if ((m as Record<string, unknown>).reasoning_content) msg.reasoning_content = (m as Record<string, unknown>).reasoning_content
          return msg as { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }
        }),
      ]

      try {
        const params: Record<string, unknown> = {
          model: config.model,
          messages: apiMessages,
          temperature: config.temperature,
          max_tokens: config.maxTokens > 0 ? config.maxTokens : undefined,
          ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
        }

        if (tools && tools.length > 0) {
          params.tools = tools
          params.tool_choice = 'auto'
        }

        const completion = await client.chat.completions.create(params as any, { signal: abortController.signal })

        const usage = completion.usage
        if (usage) {
          logTokenUsage({
            timestamp: new Date().toISOString(),
            projectId: projectId || '__global__',
            configId: config.id,
            configName: config.name,
            model: config.model,
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: usage.completion_tokens || 0,
            cacheHitTokens: (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0,
            cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
          }).catch(() => {})
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
            cost: calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, (usage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens || 0, config),
          } : undefined,
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return JSON.stringify({ text: '', tool_calls: null, finish_reason: 'stop', aborted: true })
        }
        throw new Error(categorizeError(err))
      } finally {
        ipcMain.removeListener('ai:abort-tool-chat', onAbort)
        toolChatAbortHandlers.delete(wcId)
      }
    })

  // ── AI Image Generation ──

  ipcMain.handle('ai:generateImage',
    async (_event, prompt: string, configId: string, projectId?: string, size?: string, style?: string) => {
      const store = await getConfigStore()
      const configs = store.get('configs', []) as StoredConfig[]
      const config = configs.find(c => c.id === configId)
      if (!config) throw new Error('Model config not found')

      const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
      const OpenAI = await getOpenAI()
      const client = new OpenAI({
        apiKey,
        baseURL: config.apiUrl || undefined,
        timeout: 180_000,
        maxRetries: 2,
      })

      const imageSize = size || '1024x1024'
      const imageStyle = style || 'vivid'
      const imageModel = config.model || 'dall-e-3'

      // Build generate params — size/style are DALL-E specific, omit for other models
      const genParams: Record<string, unknown> = {
        model: imageModel,
        prompt,
        n: 1,
        response_format: 'url',
      }
      if (imageSize) genParams.size = imageSize
      if (imageStyle && imageModel.includes('dall-e')) genParams.style = imageStyle

      const response = await client.images.generate(genParams as any)

      const imageUrl = response?.data?.[0]?.url
      if (!imageUrl) throw new Error('图片生成返回空结果')

      // Download image to project
      const { join } = await import('path')
      const { mkdir, writeFile } = await import('fs/promises')
      const timestamp = Date.now().toString(36)
      const fileName = `gen_${timestamp}.png`
      const imagesDir = join(projectsPath || '', projectId || '', 'images')
      await mkdir(imagesDir, { recursive: true })
      const imagePath = join(imagesDir, fileName)

      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) throw new Error(`下载图片失败: HTTP ${imgRes.status}`)
      const buf = Buffer.from(await imgRes.arrayBuffer())
      await writeFile(imagePath, buf)

      const relativePath = `images/${fileName}`
      // Use config pricing or default estimate
      const costPerImage = config.inputPricePerM > 0 ? config.inputPricePerM / 1000 : 0.04
      const cost = config.currency === 'CNY' ? costPerImage * 7.2 : costPerImage

      // Log token usage for stats
      logTokenUsage({
        timestamp: new Date().toISOString(),
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
    })

  // ── Execute file tools on main process ──
  // #9: Backend enforcement — dangerous tools must be confirmed by frontend
  const DANGEROUS_TOOL_NAMES = new Set(['create_file', 'delete_file', 'restore_backup', 'rename_file', 'create_project', 'delete_project'])
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
