// ── Anthropic Messages API Handler ──
// 独立的 Anthropic 协议 IPC handler，不修改 aiHandlers.ts。
// 使用 fetch + SSE 解析呼叫 DeepSeek /anthropic/v1/messages 端点。
//
// IPC 通道（与 OpenAI 通道完全独立，避免交叉污染）：
//   ai:anthropic-messages → ipcMain.handle（流式 content blocks）
//   ai:abort-anthropic     → ipcMain.on（中止流式请求）

import { IpcMain, SafeStorage } from 'electron'
import { decryptKey, getConfigStore } from './utils'
import type { StoredConfig } from './utils'
import { logTokenUsage } from './statsHandlers'

// ── 费用计算（与 aiHandlers.ts 中相同逻辑） ──

function calculateCost(
  inputTokens: number,
  outputTokens: number,
  cacheHitTokens: number,
  config: StoredConfig,
): number {
  const effectiveInput = Math.max(0, inputTokens - cacheHitTokens)
  const inputPrice = config.inputPricePerM ?? 0
  const cachePrice = config.cacheHitPricePerM ?? 0
  const outputPrice = config.outputPricePerM ?? 0
  const inputCost = (effectiveInput * inputPrice) / 1_000_000
  const cacheCost = (cacheHitTokens * cachePrice) / 1_000_000
  const outputCost = (outputTokens * outputPrice) / 1_000_000
  return inputCost + cacheCost + outputCost
}

// ── 错误分类（与 aiHandlers.ts 中相同逻辑） ──

function categorizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unknown error'
  const lower = message.toLowerCase()
  if (/content_filter|content_policy|safety|moderation|refusal/.test(lower))
    return '[CONTENT_POLICY] 内容被安全策略拦截。建议更换模型后重试。'
  if (/rate_limit|rate limit|429|too many requests/.test(lower))
    return '[RATE_LIMIT] 请求过于频繁，请稍后重试。'
  if (/invalid_api_key|unauthorized|authentication|401|403/.test(lower))
    return '[AUTH_ERROR] API 密钥无效或权限不足，请检查模型设置。'
  if (/econnrefused|enotfound|timeout|network|econnreset/.test(lower))
    return '[NETWORK] 网络连接失败，请检查 API 地址和网络。'
  if (/unsupported|not support|not found|404|does not exist/.test(lower))
    return '[UNSUPPORTED_OPERATION] 当前模型不支持此操作。'
  return `[API_ERROR] ${message}`
}

// ── ISO 本地时间 ──

function localISOString(): string {
  const d = new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getFullYear() +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) + 'T' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' +
    pad(d.getSeconds()) + sign +
    pad(Math.floor(off / 60)) + ':' +
    pad(off % 60)
  )
}

// ── 构建 Anthropic API 端点 URL ──

function buildAnthropicUrl(apiUrl: string): string {
  // 如果 URL 已含 'anthropic' → 检查是否已经是完整路径
  if (apiUrl.includes('anthropic')) {
    const cleaned = apiUrl.replace(/\/+$/, '')
    // 如果已经以 /v1/messages 结尾 → 不再追加
    if (cleaned.endsWith('/v1/messages')) return cleaned
    return cleaned + '/v1/messages'
  }
  // 否则：去掉 /v1 后缀（如果有），追加 /anthropic/v1/messages
  let base = apiUrl.replace(/\/+$/, '')
  base = base.replace(/\/v1$/, '')
  return base + '/anthropic/v1/messages'
}

// ── 注册 ──

export function registerAnthropicHandlers(
  ipcMain: IpcMain,
  safeStorage: SafeStorage,
  projectsPath?: string,
) {
  // 按 webContents ID 管理 abort handlers（与 aiHandlers 中模式一致）
  const abortHandlers = new Map<number, (_event: Electron.IpcMainEvent) => void>()

  // ── 流式 Anthropic Messages ──
  ipcMain.handle(
    'ai:anthropic-messages',
    async (
      event,
      params: {
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
        tools?: Array<{
          name: string
          description: string
          input_schema: Record<string, unknown>
        }>
      },
    ) => {
      // 1. 加载配置，解密 API key
      const store = await getConfigStore()
      const configs = store.get('configs', []) as StoredConfig[]
      const config = configs.find(c => c.id === params.configId)
      if (!config) {
        event.sender.send('ai:anthropic-error', { message: '[AUTH_ERROR] API 配置未找到' })
        return JSON.stringify({ text: '', toolUses: [], stopReason: 'error', error: 'Config not found' })
      }

      const apiKey = decryptKey(config.apiKey, config.encrypted, safeStorage)
      const apiUrl = buildAnthropicUrl(config.apiUrl)

      // 2. AbortController
      const abortController = new AbortController()
      const wcId = event.sender.id
      const onAbort = (ev: Electron.IpcMainEvent) => {
        if (ev.sender.id === wcId) abortController.abort()
      }
      if (abortHandlers.has(wcId)) {
        ipcMain.removeListener('ai:abort-anthropic', abortHandlers.get(wcId)!)
      }
      abortHandlers.set(wcId, onAbort)
      ipcMain.on('ai:abort-anthropic', onAbort)
      event.sender.once('destroyed' as any, () => {
        ipcMain.removeListener('ai:abort-anthropic', onAbort)
        abortHandlers.delete(wcId)
      })

      let fullText = ''
      try {
        // 3. 构建 Anthropic 请求体
        const body: Record<string, unknown> = {
          model: config.model,
          // DeepSeek 要求 system 为 content block 数组格式
          system: params.system.map(s => ({ type: 'text', text: s })),
          messages: params.messages.map(m => ({
            role: m.role,
            content: m.content.map(block => {
              const b: Record<string, unknown> = { type: block.type }
              if (block.type === 'text' && block.text) b.text = block.text
              if (block.type === 'tool_use') {
                if (block.id) b.id = block.id
                if (block.name) b.name = block.name
                b.input = block.input || {}
              }
              if (block.type === 'tool_result') {
                b.tool_use_id = block.tool_use_id
                b.content = block.content || ''
              }
              if (block.type === 'thinking') {
                b.thinking = block.thinking || ''
                b.signature = block.signature || ''
              }
              return b
            }),
          })),
          max_tokens: config.maxTokens > 0 ? config.maxTokens : 4096,
          stream: true,
        }
        if (config.temperature !== undefined) body.temperature = config.temperature
        if (params.tools && params.tools.length > 0) {
          body.tools = params.tools
        }

        // 4. 发起请求
        // ── DEBUG: 保存最后一次请求体（排查问题用）──
        try {
          const { app } = await import('electron')
          const { writeFileSync, mkdirSync } = await import('fs')
          const { join } = await import('path')
          const dd = join(app.getPath('userData'), 'debug')
          mkdirSync(dd, { recursive: true })
          writeFileSync(join(dd, 'last-anthropic-request.json'), JSON.stringify({
            time: new Date().toISOString(),
            url: apiUrl,
            model: config.model,
            systemLen: params.system?.join('').length || 0,
            systemPreview: (params.system?.[0] || '').slice(0, 300),
            msgCount: params.messages?.length || 0,
            toolCount: params.tools?.length || 0,
          }, null, 2))
        } catch {}
        // ── END DEBUG ──

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errText = await response.text().catch(() => '')
          throw new Error(
            `HTTP ${response.status}: ${errText.slice(0, 200)}`,
          )
        }

        // 5. 解析 SSE 流
        const text = await response.text()
        const events = parseSSEStream(text)

        const contentBlocks: Array<{
          type: string
          index: number
          text?: string
          id?: string
          name?: string
          input?: Record<string, unknown>
          inputJson?: string  // 累积的 JSON 片段
        }> = []
        const toolUses: Array<{
          id: string
          name: string
          input: Record<string, unknown>
        }> = []
        fullText = ''
        let stopReason = 'end_turn'
        let inputTokens = 0
        let outputTokens = 0
        let cacheCreationTokens = 0
        let cacheReadTokens = 0

        for (const evt of events) {
          if (abortController.signal.aborted) break

          switch (evt.type) {
            case 'message_start': {
              const usage = (evt.data as any)?.message?.usage
              if (usage) {
                inputTokens = usage.input_tokens || 0
                outputTokens = usage.output_tokens || 0
                cacheCreationTokens = usage.cache_creation_input_tokens || 0
                cacheReadTokens = usage.cache_read_input_tokens || 0
              }
              break
            }

            case 'content_block_start': {
              const block = (evt.data as any)?.content_block
              if (block) {
                const cb: any = { type: block.type, index: (evt.data as any).index ?? contentBlocks.length }
                if (block.type === 'tool_use') {
                  cb.id = block.id
                  cb.name = block.name
                  cb.input = block.input || {}
                  cb.inputJson = ''
                }
                if (block.type === 'text') cb.text = block.text || ''
                contentBlocks.push(cb)
              }
              break
            }

            case 'content_block_delta': {
              const delta = (evt.data as any)?.delta
              const idx = (evt.data as any)?.index ?? (contentBlocks.length > 0 ? contentBlocks.length - 1 : 0)
              const cb = contentBlocks.find(b => b.index === idx)
              if (!cb) break
              if (delta?.type === 'text_delta' && delta.text) {
                cb.text = (cb.text || '') + delta.text
                fullText = fullText + delta.text
                // 实时发送文本块到渲染进程
                event.sender.send('ai:anthropic-chunk', {
                  chunk: delta.text,
                  accumulated: fullText,
                })
              }
              if (delta?.type === 'input_json_delta' && delta.partial_json) {
                cb.inputJson = (cb.inputJson || '') + delta.partial_json
                // 尝试解析完整的 JSON（可能还是部分的，解析失败就跳过）
                try {
                  cb.input = JSON.parse(cb.inputJson)
                } catch { /* 部分 JSON，继续累积 */ }
              }
              if (delta?.type === 'thinking_delta' && delta.thinking) {
                // thinking content — 静默累积（不发给 UI）
              }
              break
            }

            case 'content_block_stop': {
              // 工具块完成 → 添加到 toolUses
              const idx = (evt.data as any)?.index ?? (contentBlocks.length > 0 ? contentBlocks.length - 1 : 0)
              const cb = contentBlocks.find(b => b.index === idx)
              if (cb?.type === 'tool_use' && cb.id && cb.name) {
                toolUses.push({
                  id: cb.id,
                  name: cb.name,
                  input: cb.input || {},
                })
              }
              break
            }

            case 'message_delta': {
              const d = (evt.data as any)?.delta
              if (d?.stop_reason) stopReason = d.stop_reason
              const usage = (evt.data as any)?.usage
              if (usage) {
                outputTokens = usage.output_tokens || outputTokens
              }
              break
            }

            case 'message_stop':
              // 流结束
              break

            case 'error': {
              const errMsg = (evt.data as any)?.error?.message || 'Anthropic API 错误'
              throw new Error(errMsg)
            }
          }
        }

        // 6. 记录 token 用量
        // ── DEBUG: 保存响应摘要 ──
        try {
          const { app } = await import('electron')
          const { writeFileSync, mkdirSync } = await import('fs')
          const { join } = await import('path')
          const dd = join(app.getPath('userData'), 'debug')
          mkdirSync(dd, { recursive: true })
          writeFileSync(join(dd, 'last-anthropic-response.json'), JSON.stringify({
            time: new Date().toISOString(),
            textLen: fullText.length,
            textPreview: fullText.slice(0, 300),
            toolCount: toolUses.length,
            toolNames: toolUses.map(t => t.name),
            inputTokens,
            outputTokens,
            stopReason,
            eventsReceived: events.length,
          }, null, 2))
        } catch {}
        // ── END DEBUG ──

        const cacheHitTotal = cacheCreationTokens + cacheReadTokens
        if (inputTokens > 0 || outputTokens > 0) {
          logTokenUsage({
            timestamp: localISOString(),
            projectId: params.projectId || '__global__',
            configId: config.id,
            configName: config.name,
            model: config.model,
            inputTokens,
            outputTokens,
            cacheHitTokens: cacheHitTotal,
            cost: calculateCost(inputTokens, outputTokens, cacheHitTotal, config),
          }).catch((err) => {
            console.warn('[anthropicHandlers] logTokenUsage failed:', err)
          })
        }

        // 7. 清理并返回
        ipcMain.removeListener('ai:abort-anthropic', onAbort)
        abortHandlers.delete(wcId)

        event.sender.send('ai:anthropic-done', {
          text: fullText,
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
            cost: calculateCost(inputTokens, outputTokens, cacheHitTotal, config),
            cacheHitTokens: cacheHitTotal,
          },
        })

        return JSON.stringify({
          text: fullText,
          toolUses,
          stopReason,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreationTokens,
            cache_read_input_tokens: cacheReadTokens,
          },
        })

      } catch (err) {
        ipcMain.removeListener('ai:abort-anthropic', onAbort)
        abortHandlers.delete(wcId)

        if (err instanceof Error && err.name === 'AbortError') {
          return JSON.stringify({
            text: fullText || '',
            toolUses: [],
            stopReason: 'aborted',
          })
        }

        const errMsg = categorizeError(err)
        event.sender.send('ai:anthropic-error', { message: errMsg })
        return JSON.stringify({
          text: '',
          toolUses: [],
          stopReason: 'error',
          error: errMsg,
        })
      }
    },
  )
}

// ── SSE 解析 ──

interface SSEEvent {
  type: string
  data: unknown
}

function parseSSEStream(text: string): SSEEvent[] {
  const events: SSEEvent[] = []
  // SSE events are separated by double newlines
  const chunks = text.split(/\n\n/)
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const lines = chunk.split('\n')
    let dataLine = ''
    let eventType = ''
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim()
      }
    }
    if (!dataLine) continue
    try {
      const parsed = JSON.parse(dataLine)
      events.push({ type: eventType || parsed.type || 'unknown', data: parsed })
    } catch {
      // 跳过无法解析的行
    }
  }
  return events
}
