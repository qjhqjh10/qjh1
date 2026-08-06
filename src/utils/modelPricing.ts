// ── v15.2.1: 模型价格参考表 + 联网查价 ──
// 背景：DEFAULT_MODEL_CONFIG 曾把 DeepSeek 定价字段映射错位（输入 0.02/输出 1/缓存 2 →
// 应为 输入 1/输出 2/缓存命中 0.02）。本模块提供：
//   1. MODEL_PRICE_PRESETS — 主流模型内置参考价（2026-08 联网核实），选择模型时自动填入
//   2. lookupModelPrice    — 按模型名匹配内置价（精确 → 最长前缀）
//   3. parseOpenRouterModels / matchLiveModel — 联网查价（OpenRouter 免密钥公开目录，USD）
// 字段口径与 ModelConfig 一致：input=输入（缓存未命中）全价 / output=输出 / cacheHit=输入（缓存命中）折扣价，元/百万 tokens
// 价格会波动：内置表仅为参考（记录核实时间），"联网查价"按钮可拉取 OpenRouter 实时价覆盖。

export interface ModelPricePreset {
  currency: 'USD' | 'CNY'
  /** 输入（缓存未命中）— 元或美元/百万 tokens */
  input: number
  /** 输出 — 元或美元/百万 tokens */
  output: number
  /** 输入（缓存命中）折扣价 */
  cacheHit: number
  contextWindow?: number
  /** 数据来源/核实时间说明（UI 提示用） */
  source?: string
}

interface PriceTableEntry {
  keys: string[]
  preset: ModelPricePreset
}

// 2026-08-06 联网核实（官方/主流比价站；DeepSeek 当日公告拟涨价，未生效前按现价）
export const MODEL_PRICE_PRESETS: PriceTableEntry[] = [
  // ── DeepSeek（CNY，官方 2026-08 平峰价；工作日高峰 9-12/14-18 点翻倍） ──
  { keys: ['deepseek-v4-flash'], preset: { currency: 'CNY', input: 1, output: 2, cacheHit: 0.02, contextWindow: 1000000, source: 'DeepSeek 官方 2026-08 平峰价（高峰翻倍）' } },
  { keys: ['deepseek-v4-pro'], preset: { currency: 'CNY', input: 3, output: 6, cacheHit: 0.025, contextWindow: 1000000, source: 'DeepSeek 官方 2026-08 平峰价（高峰翻倍）' } },
  { keys: ['deepseek-chat'], preset: { currency: 'CNY', input: 2, output: 3, cacheHit: 0.2, source: '旧版模型，2026-07-24 已退役' } },
  { keys: ['deepseek-reasoner'], preset: { currency: 'CNY', input: 4, output: 16, cacheHit: 1, source: '旧版模型，2026-07-24 已退役' } },
  { keys: ['deepseek'], preset: { currency: 'CNY', input: 1, output: 2, cacheHit: 0.02, contextWindow: 1000000, source: 'DeepSeek 通用（按 v4-flash 价）' } },

  // ── OpenAI（USD） ──
  { keys: ['gpt-4.1'], preset: { currency: 'USD', input: 2, output: 8, cacheHit: 0.5, contextWindow: 1000000, source: 'OpenAI 官方 2026' } },
  { keys: ['gpt-4.1-mini'], preset: { currency: 'USD', input: 0.4, output: 1.6, cacheHit: 0.1, contextWindow: 1000000, source: 'OpenAI 官方 2026' } },
  { keys: ['gpt-4.1-nano'], preset: { currency: 'USD', input: 0.1, output: 0.4, cacheHit: 0.025, contextWindow: 1000000, source: 'OpenAI 官方 2026' } },
  { keys: ['gpt-4o'], preset: { currency: 'USD', input: 2.5, output: 10, cacheHit: 1.25, source: 'OpenAI 官方 2026（老定价）' } },
  { keys: ['gpt-4o-mini'], preset: { currency: 'USD', input: 0.15, output: 0.6, cacheHit: 0.075, source: 'OpenAI 官方 2026' } },

  // ── Anthropic（USD） ──
  { keys: ['claude-fable-5', 'claude-fable'], preset: { currency: 'USD', input: 10, output: 50, cacheHit: 1, contextWindow: 1000000, source: 'Anthropic 官方 2026-07' } },
  { keys: ['claude-opus-5', 'claude-opus'], preset: { currency: 'USD', input: 5, output: 25, cacheHit: 0.5, contextWindow: 1000000, source: 'Anthropic 官方 2026-07' } },
  { keys: ['claude-sonnet-5'], preset: { currency: 'USD', input: 2, output: 10, cacheHit: 0.2, contextWindow: 1000000, source: 'Anthropic 2026-08 促销价（8月31日后恢复 $3/$15）' } },
  { keys: ['claude-sonnet'], preset: { currency: 'USD', input: 3, output: 15, cacheHit: 0.3, contextWindow: 1000000, source: 'Anthropic 官方 2026（4.x 标准价）' } },
  { keys: ['claude-haiku'], preset: { currency: 'USD', input: 1, output: 5, cacheHit: 0.1, contextWindow: 200000, source: 'Anthropic 官方 2026-07' } },
  { keys: ['claude-3-haiku', 'claude-haiku-3'], preset: { currency: 'USD', input: 0.25, output: 1.25, cacheHit: 0.025, source: 'Anthropic 旧版 Haiku 3' } },

  // ── Google Gemini（USD，2026-07 调价后） ──
  { keys: ['gemini-2.5-pro'], preset: { currency: 'USD', input: 1.25, output: 10, cacheHit: 0.125, contextWindow: 1000000, source: 'Google 官方 2026-07（≤200K 上下文价，超出加价）' } },
  { keys: ['gemini-2.5-flash'], preset: { currency: 'USD', input: 0.3, output: 2.5, cacheHit: 0.03, source: 'Google 官方 2026-07' } },
  { keys: ['gemini-2.5-flash-lite'], preset: { currency: 'USD', input: 0.1, output: 0.4, cacheHit: 0.01, source: 'Google 官方 2026-07' } },

  // ── 智谱 GLM（CNY，2026-04 按量价；新一代旗舰 USD） ──
  { keys: ['glm-4-plus'], preset: { currency: 'CNY', input: 5, output: 5, cacheHit: 5, source: '智谱 2026-04（统一计价）' } },
  { keys: ['glm-4-long'], preset: { currency: 'CNY', input: 1, output: 1, cacheHit: 1, contextWindow: 1000000, source: '智谱 2026-04' } },
  { keys: ['glm-4-air'], preset: { currency: 'CNY', input: 0.6, output: 0.6, cacheHit: 0.6, source: '智谱 2026-04' } },
  { keys: ['glm-4-flash'], preset: { currency: 'CNY', input: 0, output: 0, cacheHit: 0, source: '智谱 2026-04（免费）' } },
  { keys: ['glm-z1-air'], preset: { currency: 'CNY', input: 0.5, output: 0.5, cacheHit: 0.5, source: '智谱 2026-04' } },
  { keys: ['glm-5.2'], preset: { currency: 'USD', input: 1.4, output: 4.4, cacheHit: 0.26, contextWindow: 200000, source: '智谱 2026-07' } },
  { keys: ['glm-5'], preset: { currency: 'USD', input: 1, output: 3.2, cacheHit: 1, contextWindow: 200000, source: '智谱 2026-05（缓存价未知，暂按输入价）' } },

  // ── 通义千问（CNY，2026-04 百炼按量价） ──
  { keys: ['qwen3-max'], preset: { currency: 'CNY', input: 2.5, output: 10, cacheHit: 2.5, contextWindow: 252000, source: '阿里云 2026-04（0-32K 档价，32K+ 加价；缓存价未知）' } },
  { keys: ['qwen3.5-plus'], preset: { currency: 'CNY', input: 0.8, output: 4.8, cacheHit: 0.8, contextWindow: 1000000, source: '阿里云 2026-04（0-128K 档价）' } },
  { keys: ['qwen3.6-flash'], preset: { currency: 'CNY', input: 0.367, output: 2.936, cacheHit: 0.367, source: '阿里云 2026-04' } },
  { keys: ['qwen-turbo'], preset: { currency: 'CNY', input: 0.3, output: 0.6, cacheHit: 0.3, source: '阿里云 2026-04' } },
  { keys: ['qwen-long'], preset: { currency: 'CNY', input: 0.5, output: 2, cacheHit: 0.5, source: '阿里云 2026-04' } },
  { keys: ['qwen-plus'], preset: { currency: 'CNY', input: 0.4, output: 1.2, cacheHit: 0.4, source: '阿里云 2026-04' } },

  // ── 月之暗面 Kimi（CNY，2026-04 按量价；K3 USD） ──
  { keys: ['kimi-k2.6'], preset: { currency: 'CNY', input: 6.5, output: 27, cacheHit: 1.1, contextWindow: 256000, source: 'Moonshot 2026-04' } },
  { keys: ['kimi-k2-0905-preview'], preset: { currency: 'CNY', input: 4, output: 16, cacheHit: 1, contextWindow: 256000, source: 'Moonshot 2026-04' } },
  { keys: ['kimi-k2-turbo-preview'], preset: { currency: 'CNY', input: 8, output: 58, cacheHit: 1, contextWindow: 256000, source: 'Moonshot 2026-04' } },
  { keys: ['kimi-k3'], preset: { currency: 'USD', input: 3, output: 15, cacheHit: 0.3, contextWindow: 1050000, source: 'Moonshot 2026-07' } },
  { keys: ['moonshot-v1-8k'], preset: { currency: 'CNY', input: 2, output: 10, cacheHit: 2, contextWindow: 8000, source: 'Moonshot 2026-04' } },
  { keys: ['moonshot-v1-32k'], preset: { currency: 'CNY', input: 5, output: 20, cacheHit: 5, contextWindow: 32000, source: 'Moonshot 2026-04' } },
  { keys: ['moonshot-v1-128k'], preset: { currency: 'CNY', input: 10, output: 30, cacheHit: 10, contextWindow: 128000, source: 'Moonshot 2026-04' } },
]

// 索引：按 key 长度降序 → 前缀匹配时最长 key 优先（gpt-4.1-mini 不会命中 gpt-4.1/gpt-4o）
const PRICE_INDEX: { key: string; preset: ModelPricePreset }[] = (() => {
  const list: { key: string; preset: ModelPricePreset }[] = []
  for (const entry of MODEL_PRICE_PRESETS) {
    for (const k of entry.keys) list.push({ key: k.toLowerCase(), preset: entry.preset })
  }
  return list.sort((a, b) => b.key.length - a.key.length)
})()

function normalizeModel(model: string): string {
  return (model || '').trim().toLowerCase()
}

/** 按模型名匹配内置参考价（精确 → 最长前缀） */
export function lookupModelPrice(model: string): ModelPricePreset | undefined {
  const name = normalizeModel(model)
  if (!name) return undefined
  for (const { key, preset } of PRICE_INDEX) {
    if (name === key || name.startsWith(key)) return preset
  }
  return undefined
}

// ── 联网查价：OpenRouter 免密钥公开模型目录（https://openrouter.ai/api/v1/models） ──

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && isFinite(parseFloat(v))) return parseFloat(v)
  return undefined
}

/**
 * 解析 OpenRouter /api/v1/models 响应 → { 模型id小写: ModelPricePreset }
 * OpenRouter 价格字段为每 token 美元价（如 0.00000025 = $0.25/M）→ ×1e6 转每百万
 * 缓存命中价：优先 input_cache_read 字段，缺失时按输入的 10% 估算（官方缓存惯例，非精确）
 */
export function parseOpenRouterModels(json: unknown): Record<string, ModelPricePreset> {
  const out: Record<string, ModelPricePreset> = {}
  if (!json || typeof json !== 'object') return out
  const data = (json as { data?: unknown }).data
  if (!Array.isArray(data)) return out
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const { id, pricing, context_length } = item as { id?: unknown; pricing?: unknown; context_length?: unknown }
    if (typeof id !== 'string' || !id || !pricing || typeof pricing !== 'object') continue
    const p = pricing as Record<string, unknown>
    const input = numOrUndef(p.prompt)
    const output = numOrUndef(p.completion)
    if (input === undefined || output === undefined) continue
    const cacheHitRaw = numOrUndef(p.input_cache_read)
    const cacheHit = cacheHitRaw !== undefined ? cacheHitRaw : input * 0.1
    out[id.toLowerCase()] = {
      currency: 'USD',
      input: Math.round(input * 1_000_000 * 10000) / 10000,
      output: Math.round(output * 1_000_000 * 10000) / 10000,
      cacheHit: Math.round(cacheHit * 1_000_000 * 10000) / 10000,
      contextWindow: typeof context_length === 'number' ? context_length : undefined,
      source: 'OpenRouter 实时价（USD）',
    }
  }
  return out
}

/**
 * 在联网结果中匹配模型：OpenRouter id 形如 "openai/gpt-4o"（服务商前缀）。
 * 匹配顺序：完整 id 精确 → 去服务商前缀精确 → 按 key 的模型后缀最长前缀。
 */
export function matchLiveModel(models: Record<string, ModelPricePreset>, model: string): ModelPricePreset | undefined {
  const name = normalizeModel(model)
  if (!name) return undefined
  if (models[name]) return models[name]
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  if (models[base]) return models[base]
  const keys = Object.keys(models).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    const suffix = k.includes('/') ? k.slice(k.lastIndexOf('/') + 1) : k
    if (base.startsWith(suffix)) return models[k]
  }
  return undefined
}
