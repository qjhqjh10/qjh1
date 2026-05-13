import { IpcMain, SafeStorage } from 'electron'
import Store from 'electron-store'
import { logTokenUsage } from './statsHandlers'
import type { ModelConfig } from '../../src/types/settings'

interface StoredConfig extends Omit<ModelConfig, 'apiKey' | 'embeddingModel'> {
  apiKey: string
  encrypted: boolean
}

// Wrap store init in try/catch to prevent import-time crash
let store: Store<{ configs: StoredConfig[] }>
try {
  store = new Store<{ configs: StoredConfig[] }>({
    defaults: { configs: [] },
  })
} catch (err) {
  console.error('Failed to initialize config store:', err)
  // Fallback: in-memory only
  store = {
    get: () => [],
    set: () => {},
  } as unknown as Store<{ configs: StoredConfig[] }>
}

const MASKED_KEY = '••••••••'

function decryptKey(apiKey: string, encrypted: boolean, safeStorage: SafeStorage): string {
  if (!apiKey) return ''
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(apiKey, 'base64'))
    } catch {
      // If decryption fails, fall back to raw key (may have been stored plaintext before)
      return apiKey
    }
  }
  return apiKey
}

function encryptKey(apiKey: string, safeStorage: SafeStorage): { key: string; encrypted: boolean } {
  if (!apiKey) return { key: '', encrypted: false }
  if (apiKey === MASKED_KEY) return { key: apiKey, encrypted: false } // Placeholder, will be handled by caller
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return {
        key: safeStorage.encryptString(apiKey).toString('base64'),
        encrypted: true,
      }
    } catch {
      return { key: apiKey, encrypted: false }
    }
  }
  return { key: apiKey, encrypted: false }
}

// Lazy-load OpenAI client
let OpenAIClient: typeof import('openai').default | null = null
async function getOpenAI(): Promise<typeof import('openai').default> {
  if (!OpenAIClient) {
    OpenAIClient = (await import('openai')).default
  }
  return OpenAIClient
}

function validateRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'user' || role === 'assistant' || role === 'system') return role
  return 'user'
}

function calculateCost(inputTokens: number, outputTokens: number, cacheHitTokens: number, config: StoredConfig): number {
  const inputCost = ((inputTokens - cacheHitTokens) * (config.inputPricePerM || 0)) / 1_000_000
  const cacheCost = (cacheHitTokens * (config.cacheHitPricePerM || 0)) / 1_000_000
  const outputCost = (outputTokens * (config.outputPricePerM || 0)) / 1_000_000
  return inputCost + cacheCost + outputCost
}

export function registerAiHandlers(ipcMain: IpcMain, safeStorage: SafeStorage) {
  ipcMain.handle('ai:chat', async (_event, messages: { role: string; content: string }[], configId: string, projectId?: string) => {
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config) throw new Error('Model config not found')

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)

    const OpenAI = await getOpenAI()
    const client = new OpenAI({
      apiKey,
      baseURL: config.apiUrl || undefined,
    })

    const systemMessage = config.systemPrompt
      ? { role: 'system' as const, content: config.systemPrompt }
      : null

    const apiMessages = [
      ...(systemMessage ? [systemMessage] : []),
      ...messages.map(m => ({ role: validateRole(m.role) as 'user' | 'assistant', content: m.content })),
    ]

    try {
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: apiMessages,
        temperature: config.temperature,
        max_tokens: config.maxTokens ?? undefined,
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
      const message = err instanceof Error ? err.message : 'Unknown API error'
      const lower = message.toLowerCase()

      if (lower.includes('content_filter') || lower.includes('content_policy') || lower.includes('safety') || lower.includes('moderation') || lower.includes('refusal')) {
        throw new Error('[CONTENT_POLICY] 内容被安全策略拦截。建议关闭知识库或更换模型后重试。')
      }
      if (lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
        throw new Error('[RATE_LIMIT] 请求过于频繁，请稍后重试。')
      }
      if (lower.includes('invalid_api_key') || lower.includes('unauthorized') || lower.includes('authentication') || lower.includes('401') || lower.includes('403')) {
        throw new Error('[AUTH_ERROR] API 密钥无效或权限不足，请检查模型设置。')
      }
      if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('timeout') || lower.includes('network') || lower.includes('econnreset')) {
        throw new Error('[NETWORK] 网络连接失败，请检查 API 地址和网络。')
      }

      throw new Error(`[API_ERROR] ${message}`)
    }
  })

  // Streaming chat: renders chunks via events
  ipcMain.handle('ai:chat-stream', async (event, messages: { role: string; content: string }[], configId: string, projectId?: string) => {
    const configs = store.get('configs', []) as StoredConfig[]
    const config = configs.find(c => c.id === configId)
    if (!config) {
      event.sender.send('ai:chat-error', { message: '[AUTH_ERROR] API 配置未找到，请检查模型设置。' })
      return
    }

    const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
    const OpenAI = await getOpenAI()
    const client = new OpenAI({ apiKey, baseURL: config.apiUrl || undefined })

    const systemMessage = config.systemPrompt
      ? { role: 'system' as const, content: config.systemPrompt }
      : null

    const apiMessages = [
      ...(systemMessage ? [systemMessage] : []),
      ...messages.map(m => ({ role: validateRole(m.role) as 'user' | 'assistant', content: m.content })),
    ]

    const abortController = new AbortController()
    const onAbort = () => { abortController.abort() }
    event.sender.on('ai:abort-stream', onAbort)

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: apiMessages,
        temperature: config.temperature,
        max_tokens: config.maxTokens ?? undefined,
        stream: true,
      }, { signal: abortController.signal })

      let fullContent = ''
      let usageInfo: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null

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
          }
        }
      }

      event.sender.removeListener('ai:abort-stream', onAbort)

      // Log usage (always, even without projectId)
      if (usageInfo) {
        logTokenUsage({
          timestamp: new Date().toISOString(),
          projectId: projectId || '__global__',
          configId: config.id,
          configName: config.name,
          model: config.model,
          inputTokens: usageInfo.prompt_tokens,
          outputTokens: usageInfo.completion_tokens,
          cacheHitTokens: 0,
          cost: calculateCost(usageInfo.prompt_tokens, usageInfo.completion_tokens, 0, config),
        }).catch(() => {})
      }

      event.sender.send('ai:chat-done', {
        text: fullContent,
        usage: usageInfo ? {
          prompt_tokens: usageInfo.prompt_tokens,
          completion_tokens: usageInfo.completion_tokens,
          total_tokens: usageInfo.total_tokens,
          cost: calculateCost(usageInfo.prompt_tokens, usageInfo.completion_tokens, 0, config),
        } : undefined,
      })
    } catch (err) {
      event.sender.removeListener('ai:abort-stream', onAbort)

      // Handle user-initiated abort
      if (err instanceof Error && err.name === 'AbortError') {
        event.sender.send('ai:chat-cancelled', { message: '生成已取消' })
        return
      }

      const message = err instanceof Error ? err.message : 'Stream failed'
      const lower = message.toLowerCase()
      let msg: string
      if (lower.includes('content_filter') || lower.includes('content_policy') || lower.includes('safety')) {
        msg = '[CONTENT_POLICY] 内容被安全策略拦截。建议关闭知识库或更换模型后重试。'
      } else if (lower.includes('rate_limit') || lower.includes('429')) {
        msg = '[RATE_LIMIT] 请求过于频繁，请稍后重试。'
      } else if (lower.includes('invalid_api_key') || lower.includes('unauthorized') || lower.includes('401')) {
        msg = '[AUTH_ERROR] API 密钥无效或权限不足，请检查模型设置。'
      } else if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('timeout')) {
        msg = '[NETWORK] 网络连接失败，请检查 API 地址和网络。'
      } else {
        msg = `[API_ERROR] ${message}`
      }
      event.sender.send('ai:chat-error', { message: msg })
    }
  })

  ipcMain.handle('ai:listModels', async (_event, configId: string) => {
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
    const existingConfigs = store.get('configs', []) as StoredConfig[]
    const existingMap = new Map(existingConfigs.map(c => [c.id, c]))

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
  })

  ipcMain.handle('settings:loadConfigs', async () => {
    const configs = store.get('configs', []) as StoredConfig[]
    return configs.map(c => ({
      ...c,
      apiKey: c.apiKey ? MASKED_KEY : '',
      inputPricePerM: c.inputPricePerM ?? 2.50,
      outputPricePerM: c.outputPricePerM ?? 10.00,
      cacheHitPricePerM: c.cacheHitPricePerM ?? 1.25,
    }))
  })
}
