// ── KB Embedding 记账纯函数测试（v14 批处理）──

import { describe, it, expect, vi } from 'vitest'
import { buildEmbeddingUsageEntry, embedChunks } from '../kbHandlers/helpers'

describe('buildEmbeddingUsageEntry', () => {
  it('projectId 取 file.projects[0]，无归属文件兜底 __global__', () => {
    const e1 = buildEmbeddingUsageEntry(
      { id: 'cfg1', name: '写作配置' },
      { id: 'f1', projects: ['剑道长生'] },
      'text-embedding-3-small',
      1234,
    )
    expect(e1.projectId).toBe('剑道长生')
    expect(e1.configId).toBe('cfg1')
    expect(e1.configName).toBe('写作配置')
    expect(e1.model).toBe('text-embedding-3-small')
    expect(e1.inputTokens).toBe(1234)
    expect(e1.source).toBe('embedding')
    expect(e1.cost).toBe(0)

    const e2 = buildEmbeddingUsageEntry({ id: 'cfg1' }, null, 'm', 10)
    expect(e2.projectId).toBe('__global__')
  })
})

// ── v16.0.1(审计 S3): 批量嵌入失败计数（假成功修复）──

describe('embedChunks (v16.0.1 S3)', () => {
  it('全部成功 → embeddings 全向量 + failedCount=0 + token 累计', async () => {
    const embedFn = vi.fn(async (text: string) => ({
      embedding: text.includes('a') ? [0.1, 0.2] : [0.3, 0.4],
      promptTokens: 10,
    }))
    const r = await embedChunks(
      [{ charStart: 0, content: 'aaa' }, { charStart: 3, content: 'bbb' }],
      embedFn,
    )
    expect(r.failedCount).toBe(0)
    expect(r.embeddings).toEqual([[0.1, 0.2], [0.3, 0.4]])
    expect(r.totalPromptTokens).toBe(20)
  })

  it('部分失败 → 失败的 chunk 为 null（不入 index）+ failedCount 如实', async () => {
    const embedFn = vi.fn(async (text: string) => {
      if (text === 'fail') throw new Error('API key invalid')
      return { embedding: [0.9], promptTokens: 5 }
    })
    const r = await embedChunks(
      [{ charStart: 0, content: 'ok' }, { charStart: 2, content: 'fail' }, { charStart: 4, content: 'ok2' }],
      embedFn,
    )
    expect(r.failedCount).toBe(1)
    expect(r.embeddings[0]).toEqual([0.9])
    expect(r.embeddings[1]).toBeNull()
    expect(r.embeddings[2]).toEqual([0.9])
    expect(r.totalPromptTokens).toBe(10)  // 只记成功的
  })

  it('端点返回空向量 → 视为失败（空向量无法检索，原假成功根因）', async () => {
    const embedFn = vi.fn(async () => ({ embedding: [] as number[], promptTokens: 3 }))
    const r = await embedChunks([{ charStart: 0, content: 'x' }], embedFn)
    expect(r.failedCount).toBe(1)
    expect(r.embeddings[0]).toBeNull()
    expect(r.totalPromptTokens).toBe(0)
  })
})
