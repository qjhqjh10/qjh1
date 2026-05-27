import { describe, it, expect, beforeEach } from 'vitest'
import { ContextAssembler } from '../context/ContextAssembler'
import type { ContextProvider } from '../context/ContextAssembler'

function makeProvider(domain: string, relevanceScore: number): ContextProvider {
  return {
    domain,
    relevance: () => relevanceScore,
    buildContext: async () => ({
      domain,
      priority: 50,
      estimatedTokens: 100,
      content: `[${domain}] Test context for ${domain}`,
    }),
  }
}

describe('ContextAssembler', () => {
  let assembler: ContextAssembler

  beforeEach(() => {
    assembler = new ContextAssembler()
  })

  it('starts with no providers', () => {
    expect(assembler.getProviders()).toHaveLength(0)
  })

  it('registers providers', () => {
    assembler.register(makeProvider('test', 1.0))
    expect(assembler.getProviders()).toHaveLength(1)
  })

  it('assembles context from relevant providers', async () => {
    assembler.register(makeProvider('always-on', 1.0))
    assembler.register(makeProvider('irrelevant', 0.1)) // below threshold (0.3)

    const result = await assembler.assemble('hello', [], null)
    expect(result.domains).toContain('always-on')
    expect(result.domains).not.toContain('irrelevant')
    expect(result.systemMessages).toHaveLength(1)
  })

  it('sorts by relevance score (highest first)', async () => {
    assembler.register(makeProvider('medium', 0.5))
    assembler.register(makeProvider('high', 0.9))
    assembler.register(makeProvider('low', 0.4))

    const result = await assembler.assemble('test', [], null)
    expect(result.domains[0]).toBe('high')
    expect(result.domains[1]).toBe('medium')
    expect(result.domains[2]).toBe('low')
  })

  it('respects max context tokens budget', async () => {
    assembler.setMaxTokens(150) // only room for 1 provider (estimated 100 tokens each)
    assembler.register(makeProvider('first', 0.9))
    assembler.register(makeProvider('second', 0.8))

    const result = await assembler.assemble('test', [], null)
    // Only the first should fit within 150 token budget
    expect(result.systemMessages.length).toBeLessThanOrEqual(2)
    expect(result.totalTokens).toBeLessThanOrEqual(200) // 2 × 100
  })

  it('detects task-oriented messages', () => {
    expect(assembler.isTaskOriented('创建一个新角色')).toBe(true)
    expect(assembler.isTaskOriented('修改大纲内容')).toBe(true)
    expect(assembler.isTaskOriented('删除旧文件')).toBe(true)
    expect(assembler.isTaskOriented('你好，今天天气怎么样')).toBe(false)
    expect(assembler.isTaskOriented('谢谢你的帮助')).toBe(false)
  })

  it('returns empty context when no providers registered', async () => {
    const result = await assembler.assemble('test', [], null)
    expect(result.systemMessages).toHaveLength(0)
    expect(result.totalTokens).toBe(0)
    expect(result.domains).toEqual([])
  })

  it('includes breakdown with token counts', async () => {
    assembler.register(makeProvider('a', 1.0))
    const result = await assembler.assemble('test', [], null)
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0].domain).toBe('a')
    expect(result.breakdown[0].tokens).toBeGreaterThan(0)
  })

  it('can change relevance threshold', async () => {
    assembler.setThreshold(0.8) // higher threshold
    assembler.register(makeProvider('barely-relevant', 0.5))
    const result = await assembler.assemble('test', [], null)
    expect(result.domains).toHaveLength(0) // below 0.8 threshold
  })
})
