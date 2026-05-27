import { describe, it, expect } from 'vitest'

// ── Categorize Error ──
// Test the error categorization logic (extracted for testability)

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

describe('categorizeError', () => {
  it('detects content policy errors', () => {
    expect(categorizeError(new Error('content_filter violation'))).toContain('CONTENT_POLICY')
    expect(categorizeError(new Error('SAFETY check failed'))).toContain('CONTENT_POLICY')
    expect(categorizeError(new Error('moderation flagged'))).toContain('CONTENT_POLICY')
    expect(categorizeError(new Error('refusal from model'))).toContain('CONTENT_POLICY')
    expect(categorizeError(new Error('content_policy'))).toContain('CONTENT_POLICY')
  })

  it('detects rate limit errors', () => {
    expect(categorizeError(new Error('rate_limit exceeded'))).toContain('RATE_LIMIT')
    expect(categorizeError(new Error('HTTP 429'))).toContain('RATE_LIMIT')
    expect(categorizeError(new Error('too many requests'))).toContain('RATE_LIMIT')
  })

  it('detects auth errors', () => {
    expect(categorizeError(new Error('invalid_api_key'))).toContain('AUTH_ERROR')
    expect(categorizeError(new Error('Unauthorized'))).toContain('AUTH_ERROR')
    expect(categorizeError(new Error('authentication failed'))).toContain('AUTH_ERROR')
    expect(categorizeError(new Error('HTTP 401'))).toContain('AUTH_ERROR')
    expect(categorizeError(new Error('HTTP 403'))).toContain('AUTH_ERROR')
  })

  it('detects network errors', () => {
    expect(categorizeError(new Error('ECONNREFUSED'))).toContain('NETWORK')
    expect(categorizeError(new Error('ENOTFOUND example.com'))).toContain('NETWORK')
    expect(categorizeError(new Error('connection timeout'))).toContain('NETWORK')
    expect(categorizeError(new Error('Network error'))).toContain('NETWORK')
    expect(categorizeError(new Error('ECONNRESET'))).toContain('NETWORK')
  })

  it('falls back to generic API_ERROR for unknown errors', () => {
    expect(categorizeError(new Error('Some random error'))).toContain('[API_ERROR]')
    expect(categorizeError('not an Error')).toContain('[API_ERROR]')
  })

  it('handles non-Error objects', () => {
    expect(categorizeError('string error')).toContain('[API_ERROR]')
    expect(categorizeError(123)).toContain('[API_ERROR]')
  })

  it('returns Chinese-language messages', () => {
    const msg = categorizeError(new Error('timeout'))
    // All user-facing messages should contain Chinese characters
    const hasChinese = /[一-鿿]/.test(msg)
    expect(hasChinese).toBe(true)
  })
})

// ── Validate Role ──

function validateRole(role: string): 'user' | 'assistant' | 'system' | 'tool' {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role
  console.warn(`[AI] Invalid message role "${role}", falling back to "user"`)
  return 'user'
}

describe('validateRole', () => {
  it('accepts valid roles', () => {
    expect(validateRole('user')).toBe('user')
    expect(validateRole('assistant')).toBe('assistant')
    expect(validateRole('system')).toBe('system')
    expect(validateRole('tool')).toBe('tool')
  })

  it('rejects invalid roles and falls back to user', () => {
    expect(validateRole('admin')).toBe('user')
    expect(validateRole('')).toBe('user')
    expect(validateRole('unknown')).toBe('user')
  })
})

// ── Normalize Content (multimodal) ──

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

describe('normalizeContent', () => {
  it('returns text for string input', () => {
    const result = normalizeContent('Hello world')
    expect(result.text).toBe('Hello world')
    expect(result.images).toEqual([])
  })

  it('handles array with text parts', () => {
    const result = normalizeContent([
      { type: 'text', text: 'Part 1' },
      { type: 'text', text: 'Part 2' },
    ])
    expect(result.text).toContain('Part 1')
    expect(result.text).toContain('Part 2')
    expect(result.images).toEqual([])
  })

  it('extracts base64 images from array', () => {
    const imgData = 'data:image/png;base64,iVBORw0KGgo='
    const result = normalizeContent([
      { type: 'text', text: 'Here is an image:' },
      { type: 'image_url', image_url: { url: imgData } },
    ])
    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toBe(imgData)
    expect(result.text).toContain('AI生成图片')
  })

  it('skips non-base64 image URLs', () => {
    const result = normalizeContent([
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
    ])
    expect(result.images).toEqual([])
  })

  it('handles non-string/non-array input', () => {
    expect(normalizeContent(123).text).toBe('123')
    expect(normalizeContent(null).text).toBe('')
    expect(normalizeContent(undefined).text).toBe('')
  })

  it('handles mixed content array', () => {
    const imgData = 'data:image/png;base64,abc'
    const result = normalizeContent([
      { type: 'text', text: 'Hello' },
      { type: 'image_url', image_url: { url: imgData } },
      { type: 'text', text: 'World' },
    ])
    expect(result.images).toHaveLength(1)
    expect(result.text).toContain('Hello')
    expect(result.text).toContain('World')
    expect(result.text).toContain('AI生成图片')
  })
})

// ── Calculate Cost ──

interface TestConfig {
  inputPricePerM: number
  cacheHitPricePerM: number
  outputPricePerM: number
}

function calculateCost(inputTokens: number, outputTokens: number, cacheHitTokens: number, config: TestConfig): number {
  const effectiveInput = Math.max(0, inputTokens - cacheHitTokens)
  const inputCost = (effectiveInput * config.inputPricePerM) / 1_000_000
  const cacheCost = (cacheHitTokens * config.cacheHitPricePerM) / 1_000_000
  const outputCost = (outputTokens * config.outputPricePerM) / 1_000_000
  return inputCost + cacheCost + outputCost
}

describe('calculateCost', () => {
  const config: TestConfig = { inputPricePerM: 2.5, cacheHitPricePerM: 1.25, outputPricePerM: 10 }

  it('calculates total cost', () => {
    const cost = calculateCost(1000, 500, 0, config)
    // input: 1000 * 2.5 / 1e6 = 0.0025
    // output: 500 * 10 / 1e6 = 0.005
    // total = 0.0075
    expect(cost).toBeCloseTo(0.0075, 5)
  })

  it('deducts cache hits from input cost', () => {
    const cost = calculateCost(1000, 500, 800, config)
    // effective input: 200 * 2.5 / 1e6 = 0.0005
    // cache: 800 * 1.25 / 1e6 = 0.001
    // output: 500 * 10 / 1e6 = 0.005
    expect(cost).toBeCloseTo(0.0065, 5)
  })

  it('handles zero tokens', () => {
    expect(calculateCost(0, 0, 0, config)).toBe(0)
  })

  it('cache hits cannot exceed input tokens (clamped)', () => {
    const cost = calculateCost(500, 100, 1000, config)
    // effective input should be 0 (clamped)
    expect(cost).toBeCloseTo(0.00225, 5)
  })

  it('handles zero prices gracefully', () => {
    const freeConfig = { inputPricePerM: 0, cacheHitPricePerM: 0, outputPricePerM: 0 }
    expect(calculateCost(1000, 500, 0, freeConfig)).toBe(0)
  })
})
