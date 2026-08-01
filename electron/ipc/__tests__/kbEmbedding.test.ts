// ── KB Embedding 记账纯函数测试（v14 批处理）──

import { describe, it, expect } from 'vitest'
import { buildEmbeddingUsageEntry } from '../kbHandlers/helpers'

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
