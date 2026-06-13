/**
 * 共享双协议 chat 函数 — 供测试脚本使用。
 *
 * 用法:
 *   import { chat } from './lib/chat'
 *   const reply = await chat([{ role: 'user', content: '...' }], { maxTokens: 8192, model: 'deepseek-v4-flash' })
 *
 * 环境变量:
 *   AI_API_KEY    - API key (默认内置)
 *   AI_PROTOCOL   - anthropic(默认) | openai
 *   AI_TEMPERATURE - temperature (默认 1.0)
 *   AI_BASE_URL   - 自定义 API 地址
 */

const API_KEY = process.env.AI_API_KEY || 'sk-c9c30831df7243209435c60e811c879d'
const DEFAULT_MODEL = process.env.AI_MODEL || 'deepseek-v4-flash'
const PROTOCOL = (process.env.AI_PROTOCOL || 'anthropic').toLowerCase()
const TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '1.0')

export interface ChatOptions {
  maxTokens?: number
  model?: string
}

export async function chat(
  messages: { role: string; content: string }[],
  opts: ChatOptions = {},
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 4096
  const model = opts.model || DEFAULT_MODEL

  if (PROTOCOL === 'openai') {
    const baseUrl = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1'
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({ model, messages, temperature: TEMPERATURE, max_tokens: maxTokens }),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '').then(t => t.slice(0, 300))
      throw new Error(`OpenAI API ${res.status}: ${err}`)
    }
    return ((await res.json()) as any).choices?.[0]?.message?.content || ''
  }

  // Anthropic 协议（默认）
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
  const anthropicUrl = baseUrl.endsWith('/anthropic/v1/messages')
    ? baseUrl
    : baseUrl.replace(/\/v1$/, '') + '/anthropic/v1/messages'

  const systemMsg = messages.find(m => m.role === 'system')
  const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role,
    content: m.content,
  }))

  const body: Record<string, any> = {
    model,
    max_tokens: maxTokens,
    temperature: TEMPERATURE,
    messages: chatMessages,
    thinking: { type: 'disabled' },
  }
  if (systemMsg) body.system = systemMsg.content

  const res = await fetch(anthropicUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '').then(t => t.slice(0, 300))
    throw new Error(`Anthropic API ${res.status}: ${err}`)
  }
  const data = await res.json() as any
  const textBlock = data.content?.find?.((c: any) => c.type === 'text')
  return textBlock?.text || ''
}
