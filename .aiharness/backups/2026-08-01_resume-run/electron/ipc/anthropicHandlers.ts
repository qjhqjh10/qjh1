// ── Anthropic Messages API Handler ──
// 独立的 Anthropic 协议 IPC handler，不修改 aiHandlers.ts。
// 使用 fetch + SSE 解析呼叫 DeepSeek /anthropic/v1/messages 端点。
//
// IPC 通道（与 OpenAI 通道完全独立，避免交叉污染）：
//   ai:anthropic-messages → ipcMain.handle（流式 content blocks）
//   ai:abort-anthropic     → ipcMain.on（中止流式请求）

import { IpcMain, SafeStorage } from 'electron'
import { getConfigStore, localISOString, calculateCost } from './utils'
import type { StoredConfig } from './utils'
import { logTokenUsage } from './statsHandlers'

// ── v11.7.0: system block 类型（与 anthropicService.ts 同步） ──

interface SystemContentBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

// ── 错误分类（与 aiHandlers.ts 逻辑相近但文案/判定不同——保留各自实现，统一会改变用户可见错误提示） ──

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
        // v11.7.0: system 支持 string 或 content block（含 cache_control）
        system: Array<string | SystemContentBlock>
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
        /** v12.5.1: 阶段感知温度 */
        temperature?: number
        /** v14.2.1: 调用来源（main/subagent/pipeline）— 供 token 统计区分 */
        source?: string
      },
    ) => {
      // 1. 加载配置，解密 API key
      const store = await getConfigStore()
      const configs = store.get('configs', []) as StoredConfig[]
      const config = configs.find(c => c.id === params.configId)
      if (!config) {
        // M3: 错误经 invoke 返回值下发（error 字段），与其余错误路径文案统一（categorizeError）
        return JSON.stringify({ text: '', toolUses: [], stopReason: 'error', error: '[AUTH_ERROR] API 配置未找到' })
      }

      const apiKey = config.apiKey
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
        // v11.7.0: 将 system 统一为 content block 格式，透传 cache_control
        const systemContentBlocks = params.system.map(s => {
          if (typeof s === 'string') return { type: 'text' as const, text: s }
          const block: Record<string, unknown> = { type: s.type, text: s.text }
          if (s.cache_control) block.cache_control = s.cache_control
          return block
        })
        const body: Record<string, unknown> = {
          model: config.model,
          system: systemContentBlocks,
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
              // v13.x: 透传 cache_control（历史消息分段缓存）
              if ((block as any).cache_control) {
                b.cache_control = (block as any).cache_control
              }
              return b
            }),
          })),
          max_tokens: config.maxTokens > 0 ? config.maxTokens : 16384,
          stream: true,
        }
        // v11.4: Enable extended thinking for DeepSeek V4 (Anthropic protocol, configurable)
        const isDeepSeekV4 = /deepseek.*v4/i.test(config.model) && (config as any).enableThinking !== false
        if (isDeepSeekV4) {
          body.thinking = { type: 'enabled', budget_tokens: 8192 }
        }
        // v12.5.1: 阶段感知温度 — runtime 传入时使用，否则回退到 config.temperature
        const effectiveTemperature = params.temperature ?? config.temperature
        if (!isDeepSeekV4 && effectiveTemperature !== undefined) {
          body.temperature = effectiveTemperature
        }
        if (params.tools && params.tools.length > 0) {
          // v11.7.0: 透传 cache_control in tool definitions
          body.tools = params.tools.map((t: any) => {
            const tool: Record<string, unknown> = {
              name: t.name,
              description: t.description,
              input_schema: t.input_schema,
            }
            if (t.cache_control) tool.cache_control = t.cache_control
            return tool
          })
        }

        // 4. 发起请求
        // ── DEBUG: 保存最后一次请求体（排查问题用）— v13.x: 需 QINGJIAN_DEBUG_PROMPT=1 才落盘（防提示词泄露）──
        if (process.env.QINGJIAN_DEBUG_PROMPT === '1') {
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
              systemLen: params.system?.reduce((sum: number, s) => sum + (typeof s === 'string' ? s.length : s.text.length), 0) || 0,
              systemPreview: (() => { const s0 = params.system?.[0]; return (typeof s0 === 'string' ? s0 : s0?.text || '').slice(0, 300) })(),
              msgCount: params.messages?.length || 0,
              toolCount: params.tools?.length || 0,
            }, null, 2))
          } catch {}
        }
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

        // 5. 增量解析 SSE 流（H6: 边读边解析边发送 ai:anthropic-chunk，实时预览恢复）
        const reader = response.body?.getReader()
        if (!reader) throw new Error('SSE 响应无流')

        const contentBlocks: Array<{
          type: string
          index: number
          text?: string
          id?: string
          name?: string
          input?: Record<string, unknown>
          inputJson?: string  // 累积的 JSON 片段
          thinking?: string   // v11.5.1: extended thinking
          signature?: string  // v11.5.1: extended thinking
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
        let eventCount = 0

        const handleEvent = (evt: SSEEvent) => {
          eventCount++
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
                // v11.5.1: Capture initial thinking/signature for extended thinking support
                if (block.type === 'thinking') {
                  cb.thinking = block.thinking || ''
                  cb.signature = block.signature || ''
                }
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
              // v11.5.1: Fix thinking/signature accumulation for multi-turn support
              if (delta?.type === 'thinking_delta' && delta.thinking) {
                cb.thinking = (cb.thinking || '') + delta.thinking
              }
              if (delta?.type === 'signature_delta' && delta.signature) {
                cb.signature = delta.signature
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

        // 增量读取主循环
        const decoder = new TextDecoder()
        let sseBuffer = ''
        for (;;) {
          if (abortController.signal.aborted) break
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const { events, rest } = feedSSE(sseBuffer, chunk)
          sseBuffer = rest
          for (const evt of events) {
            if (abortController.signal.aborted) break
            handleEvent(evt)
          }
        }
        // 冲刷尾部残留事件（feedSSE 以 \n\n 切分——补终止空行让未以空行结尾的最终事件被解析，
        // 否则 message_stop 等末事件会滞留在 rest 被静默丢弃）
        const tail = feedSSE(sseBuffer, '\n\n')
        for (const evt of tail.events) handleEvent(evt)
        decoder.decode() // flush 流式解码残留的多字节尾字符

        // v11.5.1: Extract thinking blocks from SSE content blocks for multi-turn support
        const thinkingBlocks = contentBlocks
          .filter((cb: any) => cb.type === 'thinking' && cb.thinking)
          .map((cb: any) => ({ thinking: cb.thinking, signature: cb.signature || '' }))

        // 6. 记录 token 用量
        // ── DEBUG: 保存响应摘要 — v13.x: 需 QINGJIAN_DEBUG_PROMPT=1 才落盘 ──
        if (process.env.QINGJIAN_DEBUG_PROMPT === '1') {
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
              eventsReceived: eventCount,
            }, null, 2))
          } catch {}
        }
        // ── END DEBUG ──

        // v14.2.1: 统计口径修复 — cacheHit 只统计真实命中（cache_read），
        // 不再混入 cache_creation（创建按正常输入价计费：calculateCost 的
        // effectiveInput = input − cacheHit，creation 自然落入输入价档）。
        // 修复前 creation 按命中价（约输入价 1/10）计费 → 成本低估、缓存统计虚高。
        const cacheHitTotal = cacheReadTokens
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
            // v14.2.1: 子代理委托标 'subagent'；主 agent 不传 → 'main'；chatAI 流水线传 'pipeline'
            source: params.source || 'main',
          }).catch((err) => {
            console.warn('[anthropicHandlers] logTokenUsage failed:', err)
          })
        }

        // 7. 清理并返回
        ipcMain.removeListener('ai:abort-anthropic', onAbort)
        abortHandlers.delete(wcId)

        // M3: usage/cost 随 invoke 返回值下发（下方 JSON），冗余的 ai:anthropic-done 事件已删除
        return JSON.stringify({
          text: fullText,
          toolUses,
          stopReason,
          thinkingBlocks: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreationTokens,
            cache_read_input_tokens: cacheReadTokens,
            // v13.x: 补 cost——此前渲染层 chatWithUsage/chatStream 的 cost 恒为 0
            cost: calculateCost(inputTokens, outputTokens, cacheHitTotal, config),
          },
        })

      } catch (err) {
        ipcMain.removeListener('ai:abort-anthropic', onAbort)
        abortHandlers.delete(wcId)

        if (err instanceof Error && err.name === 'AbortError') {
          // 中止时 text 必须为空——H6 增量解析后 fullText 携带部分文本，
          // 若回传会被 onDone 当作完成内容提交（写编辑器+存版本+自动摘要），与 v14.0.0 行为不符
          return JSON.stringify({
            text: '',
            toolUses: [],
            stopReason: 'aborted',
          })
        }

        const errMsg = categorizeError(err)
        // M3: 错误信息随 invoke 返回值下发（下方 JSON 的 error 字段），冗余的 ai:anthropic-error 事件已删除
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

// ── SSE 解析（H6: 增量版，支持流式喂入）──

export interface SSEEvent {
  type: string
  data: unknown
}

export interface SSEFeedResult {
  events: SSEEvent[]
  rest: string
}

/** 解析单个 SSE 块（event:/data: 行；跳过注释行；多行 data 行 join）。解析失败返回 null。 */
function parseSSEChunk(chunk: string): SSEEvent | null {
  const lines = chunk.split('\n')
  let dataLine = ''
  let eventType = ''
  for (const line of lines) {
    if (line.startsWith(':')) continue // SSE 注释行（keep-alive ping）
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      const seg = line.slice(5).trim()
      dataLine = dataLine ? dataLine + '\n' + seg : seg // 多行 data 累积
    }
  }
  if (!dataLine) return null
  try {
    const parsed = JSON.parse(dataLine)
    return { type: eventType || parsed.type || 'unknown', data: parsed }
  } catch {
    return null // 跳过无法解析的行
  }
}

/**
 * 增量喂入 SSE 文本：把 buffer+新文本 按 \n\n 切出完整事件，残留保留在 rest。
 * CRLF（\r\n）归一化为 \n —— 原一次性解析对 \r\n\r\n 分隔的流找不到分隔符会整段丢失。
 */
export function feedSSE(buffer: string, text: string): SSEFeedResult {
  const combined = buffer + text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const chunks = combined.split('\n\n')
  const rest = chunks.pop() ?? ''
  const events: SSEEvent[] = []
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const evt = parseSSEChunk(chunk)
    if (evt) events.push(evt)
  }
  return { events, rest }
}
