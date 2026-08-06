// v15.4.0: knowledgePipeline 单测——searchKBMulti / injectKnowledgeForScene / buildKBBlock / 阈值过滤
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { searchMock, readMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  readMock: vi.fn(),
}))

vi.mock('@/services/fileService', () => ({
  kbService: {
    search: (...args: unknown[]) => searchMock(...args),
    read: (...args: unknown[]) => readMock(...args),
  },
}))

import {
  searchKBMulti, injectKnowledgeForScene, buildKBBlock, getSceneKb,
  KB_INJECT_SCORE_THRESHOLD, injectChunks,
} from '../knowledgePipeline'
import type { KBSceneSettings, KBSettings } from '@/types/settings'

const SCENE: KBSceneSettings = { injectMode: 'full', searchTopK: 5, fallbackPerFileMaxChars: 500, fallbackTotalMaxChars: 1000 }
const OPTS = {
  mode: 'chunk' as const,
  keywords: '剑术, 宗门',
  projectId: 'proj1',
  configId: 'cfg1',
  scene: SCENE,
}

beforeEach(() => {
  searchMock.mockReset()
  readMock.mockReset()
})

describe('searchKBMulti（多关键词语义检索）', () => {
  it('多关键词分别检索、去重、score 降序、总数 ≤ topK', async () => {
    searchMock
      .mockResolvedValueOnce([
        { fileId: 'f1', fileName: 'a.md', content: '剑术描述A', score: 0.8 },
        { fileId: 'f2', fileName: 'b.md', content: '剑术描述B', score: 0.6 },
      ])
      .mockResolvedValueOnce([
        { fileId: 'f3', fileName: 'c.md', content: '宗门描述C', score: 0.9 },
        { fileId: 'f1', fileName: 'a.md', content: '剑术描述A', score: 0.8 },  // 与第一次重复（去重）
      ])
    const chunks = await searchKBMulti(['剑术', '宗门'], 'proj1', 'cfg1', ['f1', 'f2', 'f3'], 3)
    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(chunks.map(c => c.content)).toEqual(['宗门描述C', '剑术描述A', '剑术描述B'])  // score 降序 + 去重
    expect(chunks.length).toBeLessThanOrEqual(3)
  })

  it('空输入/全空字符串返回空数组', async () => {
    expect(await searchKBMulti([], 'p', 'c')).toEqual([])
    expect(await searchKBMulti(['  ', ''], 'p', 'c')).toEqual([])
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('检索抛错不抛出（单关键词失败不影响其余）', async () => {
    searchMock.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([{ fileId: 'f', fileName: 'x.md', content: '内容', score: 0.7 }])
    const chunks = await searchKBMulti(['剑术', '宗门'], 'p', 'c', undefined, 4)
    expect(chunks.length).toBe(1)
  })
})

describe('injectKnowledgeForScene（生成场景统一注入入口）', () => {
  it('full 模式：走全量截断注入，注入在【创作要求】之前', async () => {
    readMock.mockResolvedValue({ file: { originalName: '世界观.md' }, content: '完整世界观内容'.repeat(200) })
    const { prompt, chunksInjected } = await injectKnowledgeForScene(
      '【第2层剧情】...\n【创作要求】\n写正文', ['f1'],
      { ...OPTS, mode: 'full' },
    )
    expect(chunksInjected).toBe(1)
    expect(prompt.indexOf('【知识库参考】')).toBeLessThan(prompt.indexOf('【创作要求】'))
    expect(prompt).toContain('必须融合进正文')  // 使用指引文案
    // 截断：perFile 500 字符
    const block = prompt.slice(prompt.indexOf('【知识库参考】'), prompt.indexOf('【创作要求】'))
    expect(block.length).toBeLessThan(700)
  })

  it('chunk 模式：关键词检索 + score 阈值过滤（<0.3 不注入）', async () => {
    searchMock.mockResolvedValue([
      { fileId: 'f1', fileName: 'a.md', content: '高相关剑术', score: 0.72 },
      { fileId: 'f2', fileName: 'b.md', content: '低相关噪音', score: 0.12 },
    ])
    const { prompt, chunksInjected } = await injectKnowledgeForScene('【创作要求】\n写', ['f1', 'f2'], OPTS)
    expect(chunksInjected).toBe(1)
    expect(prompt).toContain('高相关剑术')
    expect(prompt).not.toContain('低相关噪音')
    expect(searchMock.mock.calls[0][4]).toEqual(['f1', 'f2'])  // fileIds 限定
    // topK 取设置（多关键词时每词均分：ceil(5/2)=3；总条数受 searchTopK=5 约束）
    expect(searchMock.mock.calls[0][3]).toBe(Math.ceil(SCENE.searchTopK / 2))
  })

  it('chunk 模式关键词为空：退回 full 全量注入', async () => {
    readMock.mockResolvedValue({ file: { originalName: '设定.md' }, content: '设定内容' })
    const { chunksInjected } = await injectKnowledgeForScene('【创作要求】\n写', ['f1'], { ...OPTS, keywords: '  ,  ' })
    expect(chunksInjected).toBe(1)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('chunk 模式零结果：原样返回不注入（不静默回退全量）', async () => {
    searchMock.mockResolvedValue([])
    const prompt = '【创作要求】\n写正文'
    const { prompt: out, chunksInjected } = await injectKnowledgeForScene(prompt, ['f1'], OPTS)
    expect(chunksInjected).toBe(0)
    expect(out).toBe(prompt)
  })

  it('fileIds 为空：原样返回', async () => {
    const prompt = '【创作要求】\n写'
    expect((await injectKnowledgeForScene(prompt, [], OPTS)).prompt).toBe(prompt)
  })
})

describe('buildKBBlock（批量预取 / 角色生成用）', () => {
  it('full 模式返回块文本（无定位副作用）', async () => {
    readMock.mockResolvedValue({ file: { originalName: '角色设定.md' }, content: '角色完整设定' })
    const block = await buildKBBlock(['f1'], { ...OPTS, mode: 'full' })
    expect(block).toContain('【知识库参考】')
    expect(block).toContain('角色完整设定')
  })

  it('chunk 模式零结果返回 null', async () => {
    searchMock.mockResolvedValue([])
    expect(await buildKBBlock(['f1'], OPTS)).toBeNull()
  })

  it('chunk 模式无关键词返回 null', async () => {
    expect(await buildKBBlock(['f1'], { ...OPTS, keywords: '' })).toBeNull()
  })

  it('fileIds 为空返回 null', async () => {
    expect(await buildKBBlock([], OPTS)).toBeNull()
  })
})

describe('getSceneKb（场景设置读取，含 generation 兜底）', () => {
  it('新键存在时读取新键', () => {
    const kb: KBSettings = {
      agent: { ...SCENE },
      chapterGen: { ...SCENE, searchTopK: 9 },
      characterGen: { ...SCENE },
    }
    expect(getSceneKb(kb, 'chapterGen').searchTopK).toBe(9)
  })

  it('新键缺失时回退旧 generation 键（双保险）', () => {
    const kb = { generation: { ...SCENE, searchTopK: 6 } } as unknown as KBSettings
    expect(getSceneKb(kb, 'chapterGen').searchTopK).toBe(6)
  })

  it('完全缺失时返回默认值', () => {
    expect(getSceneKb(undefined, 'chapterGen').injectMode).toBe('full')
  })
})

describe('injectChunks 定位', () => {
  it('无【创作要求】标记时追加末尾（回归保护）', () => {
    const { prompt } = injectChunks('纯文本 prompt', [{ content: '片段', fileName: 'x.md', score: 0.9 }], 'before-writing')
    expect(prompt.endsWith('片段')).toBe(true)
  })
})

describe('KB_INJECT_SCORE_THRESHOLD', () => {
  it('阈值为 0.3（与 agent 场景一致）', () => {
    expect(KB_INJECT_SCORE_THRESHOLD).toBe(0.3)
  })
})
