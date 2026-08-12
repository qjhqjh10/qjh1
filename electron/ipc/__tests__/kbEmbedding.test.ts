// ── KB Embedding 记账纯函数测试（v14 批处理）──

import { describe, it, expect, vi } from 'vitest'
import { buildEmbeddingUsageEntry, embedChunks, applySceneKeywordActivation } from '../kbHandlers/helpers'

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

// ── v16.4.0: 场景标记触发（酒馆世界书式）──

describe('applySceneKeywordActivation (v16.4.0)', () => {
  function mk(content: string) { return { content } }

  it('query 命中「## 场景：关键词」→ 标题块 score=1 置顶', () => {
    const scored = [
      { chunk: mk('普通无关片段'), score: 0.2 },
      { chunk: mk('## 场景：酒馆\n小二对话规则'), score: 0.1 },
    ]
    const out = applySceneKeywordActivation(scored, '我们来到了酒馆门口')
    expect(out[0].score).toBe(1)
    expect(out[0].chunk.content).toContain('酒馆')
    expect(out.length).toBe(2)
  })

  it('命中后激活标题块 + 后续连续块（至下一个场景标题截断）', () => {
    const scored = [
      { chunk: mk('## 场景：酒馆\n规则A'), score: 0.1 },
      { chunk: mk('规则B：小二的态度'), score: 0.05 },
      { chunk: mk('## 场景：集市\n规则C'), score: 0.05 },
      { chunk: mk('规则D'), score: 0.05 },
    ]
    const out = applySceneKeywordActivation(scored, '到酒馆喝一杯')
    // 置顶两个块（酒馆标题块 + 其后一块），集市块不被激活
    expect(out.slice(0, 2).every(s => s.score === 1)).toBe(true)
    expect(out.slice(0, 2).map(s => s.chunk.content)).toEqual(['## 场景：酒馆\n规则A', '规则B：小二的态度'])
    expect(out[2].chunk.content).toBe('## 场景：集市\n规则C')
  })

  it('未命中关键词 → 原样返回（不改变排序）', () => {
    const scored = [
      { chunk: mk('## 场景：酒馆\n规则'), score: 0.9 },
      { chunk: mk('普通内容'), score: 0.5 },
    ]
    const out = applySceneKeywordActivation(scored, '今天天气不错')
    expect(out).toEqual(scored)
  })

  it('单字关键词不触发（误触发面太大）', () => {
    const scored = [
      { chunk: mk('## 场景：市\n规则'), score: 0.2 },
    ]
    const out = applySceneKeywordActivation(scored, '市场里人很多')
    expect(out).toEqual(scored)
  })

  it('多关键词「、」分隔，任一命中即激活', () => {
    const scored = [
      { chunk: mk('## 场景：酒馆、茶馆\n规则'), score: 0.1 },
    ]
    expect(applySceneKeywordActivation(scored, '去茶馆坐坐')[0].score).toBe(1)
    expect(applySceneKeywordActivation(scored, '酒馆打烊了')[0].score).toBe(1)
  })
})
