import { describe, it, expect } from 'vitest'
import { BudgetManager } from '../budget/BudgetManager'

describe('BudgetManager', () => {
  it('initializes with context window and reserve', () => {
    const bm = new BudgetManager(128000, 4096)
    expect(bm.budget.contextWindow).toBe(128000)
    expect(bm.budget.reserved).toBe(4096)
    expect(bm.budget.available).toBe(123904) // 128000 - 0 - 4096
    expect(bm.budget.used).toBe(0)
  })

  it('estimates message tokens', () => {
    const bm = new BudgetManager(128000)
    const messages = [
      { role: 'system', content: '你是一个助手。' },
      { role: 'user', content: '你好，请帮我写一个角色。' },
    ]
    const estimated = bm.estimateMessages(messages)
    expect(estimated).toBeGreaterThan(0)
  })

  it('estimates tool definition tokens', () => {
    const bm = new BudgetManager(128000)
    const tools = [{ type: 'function', function: { name: 'test', description: 'a test tool', parameters: {} } }]
    expect(bm.estimateTools(tools)).toBeGreaterThan(0)
  })

  it('tracks usage correctly', () => {
    const bm = new BudgetManager(128000)
    bm.addUsage(5000)
    expect(bm.budget.used).toBe(5000)
    bm.addUsage(3000)
    expect(bm.budget.used).toBe(8000)
  })

  it('resets usage', () => {
    const bm = new BudgetManager(128000)
    bm.addUsage(10000)
    bm.reset()
    expect(bm.budget.used).toBe(0)
  })

  it('detects when compression is needed (70% usage)', () => {
    const bm = new BudgetManager(10000)
    // Create messages that would exceed 70% of 10000
    const messages = [
      { role: 'user', content: 'x'.repeat(8000) }, // ~2666 tokens
      { role: 'assistant', content: 'y'.repeat(16000) }, // ~5333 tokens
    ]
    // Total: ~8000 tokens > 7000 (70% of 10000)
    expect(bm.shouldCompress(messages)).toBe(true)
  })

  it('does not compress when under 70% usage', () => {
    const bm = new BudgetManager(100000)
    const messages = [
      { role: 'user', content: 'hello' },
    ]
    expect(bm.shouldCompress(messages)).toBe(false)
  })

  it('truncates tool results', () => {
    const bm = new BudgetManager(128000)
    const long = 'a'.repeat(15000)
    const truncated = bm.truncateToolResult(long, 10000)
    expect(truncated.length).toBeLessThanOrEqual(10100) // roughly 10000 + truncation message
    expect(truncated).toContain('截断')
  })

  it('returns original detail when within limits', () => {
    const bm = new BudgetManager(128000)
    const short = 'short result'
    expect(bm.truncateToolResult(short, 10000)).toBe(short)
  })

  it('selects correct truncation strategy', () => {
    const bm = new BudgetManager(128000)
    expect(bm.selectTruncationStrategy(undefined)).toBe('none')
    expect(bm.selectTruncationStrategy('short')).toBe('none')
    expect(bm.selectTruncationStrategy('a'.repeat(15000))).toBe('trim')
    expect(bm.selectTruncationStrategy('a'.repeat(60000))).toBe('summarize')
  })
})
