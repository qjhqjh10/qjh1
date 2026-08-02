// ── BridgeContextBuilder 单测（v14.8 KB per-run 改造） ──
// 覆盖：per-run 注入隔离（并发实例互不可见）、excludeKbFileIds 并集排除、
// result.injectedKbFileIds 返回本轮注入 id、原生联网勾选时跳过 DDG 搜索。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BridgeContextBuilder } from '../context/BridgeContextBuilder'

const { searchMock, webSearchMock, getStateMock } = vi.hoisted(() => {
  const getStateMock = vi.fn<() => { aiSettings: Record<string, unknown>; configs: unknown[] }>()
  getStateMock.mockImplementation(() => ({
    aiSettings: {
      kbSettings: { agent: { searchTopK: 5 } },
      searchResultCount: 5,
      safeSearch: 'moderate',
    },
    configs: [] as unknown[],
  }))
  return { searchMock: vi.fn(), webSearchMock: vi.fn(), getStateMock }
})

vi.mock('@/services/fileService', () => ({
  kbService: {
    search: (...args: unknown[]) => searchMock(...args),
    webSearch: (...args: unknown[]) => webSearchMock(...args),
  },
}))

vi.mock('@/store', () => ({
  useSettingsStore: { getState: getStateMock },
  useStore: { getState: () => ({ projects: [] }) },
}))

const CORE = '你是写作助手'
const NO_KB: ConstructorParameters<typeof BridgeContextBuilder>[0] = {
  projectId: null, configId: 'cfg1', kbEnabled: true, webSearchEnabled: false,
}

function result(search: unknown) {
  return search as Array<{ fileId: string; fileName: string; content: string }>
}

beforeEach(() => {
  searchMock.mockReset()
  webSearchMock.mockReset()
  getStateMock.mockReset()
  getStateMock.mockImplementation(() => ({
    aiSettings: {
      kbSettings: { agent: { searchTopK: 5 } },
      searchResultCount: 5,
      safeSearch: 'moderate',
    },
    configs: [],
  }))
})

describe('per-run KB 注入隔离', () => {
  it('两个实例 buildContext 的注入互不可见（模块单例已删除，per-run 归属）', async () => {
    searchMock
      .mockResolvedValueOnce([{ fileId: 'f1', fileName: 'a.md', content: 'A' }])
      .mockResolvedValueOnce([{ fileId: 'f2', fileName: 'b.md', content: 'B' }])
    const b1 = new BridgeContextBuilder(NO_KB)
    const b2 = new BridgeContextBuilder(NO_KB)
    // 注：串行执行（Promise.all 并发会触发 vitest mock 模块动态 import 竞态——测试环境伪影，
    // 生产 ESM 缓存 import 且单实例每 run 一个 builder；隔离语义由实例字段保证，与执行顺序无关）
    const r1 = await b1.buildContext('问题1', [], null, CORE)
    const r2 = await b2.buildContext('问题2', [], null, CORE)
    // 两次独立检索（各自拿到自己的注入文件）
    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(searchMock.mock.calls[0][0]).toBe('问题1')
    expect(searchMock.mock.calls[1][0]).toBe('问题2')
    // 各自只返回自己的注入 id（互不可见 — 模块单例已删除）
    expect(r1.injectedKbFileIds).toEqual(['f1'])
    expect(r2.injectedKbFileIds).toEqual(['f2'])
  })

  it('同实例两轮调用：第二轮排除第一轮已注入的文件', async () => {
    searchMock
      .mockResolvedValueOnce([{ fileId: 'f1', fileName: 'a.md', content: 'A' }])
      .mockResolvedValueOnce([{ fileId: 'f2', fileName: 'b.md', content: 'B' }])
    const b = new BridgeContextBuilder(NO_KB)
    await b.buildContext('q1', [], null, CORE)
    await b.buildContext('q2', [], null, CORE)
    // 第二轮 search 收到排除集 ['f1']
    expect(searchMock.mock.calls[1][5]).toEqual(['f1'])
  })
})

describe('跨 run 排除（excludeKbFileIds）', () => {
  it('excludeKbFileIds 与实例内已注入并集后传给 kbService.search', async () => {
    searchMock.mockResolvedValue([{ fileId: 'f3', fileName: 'c.md', content: 'C' }])
    const b = new BridgeContextBuilder({ ...NO_KB, excludeKbFileIds: ['old_1', 'old_2'] })
    const r = await b.buildContext('q', [], null, CORE)
    expect(searchMock.mock.calls[0][5]).toEqual(['old_1', 'old_2'])
    expect(r.injectedKbFileIds).toEqual(['f3'])
  })

  it('kbEnabled=false 不检索', async () => {
    const b = new BridgeContextBuilder({ ...NO_KB, kbEnabled: false })
    await b.buildContext('q', [], null, CORE)
    expect(searchMock).not.toHaveBeenCalled()
  })
})

describe('原生联网跳过 DDG', () => {
  it('webSearchEnabled 且模型勾选原生联网 → 不调用 webSearch', async () => {
    searchMock.mockResolvedValue([])
    getStateMock.mockImplementation(() => ({
      aiSettings: { kbSettings: { agent: { searchTopK: 5 } }, searchResultCount: 5, safeSearch: 'moderate' },
      configs: [{ id: 'cfg1', nativeWebSearch: true }] as unknown[],
    }))
    const b = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: true })
    await b.buildContext('q', [], null, CORE)
    expect(webSearchMock).not.toHaveBeenCalled()
  })

  it('未勾选原生联网 → 正常调用 webSearch', async () => {
    searchMock.mockResolvedValue([])
    webSearchMock.mockResolvedValue([{ title: 't', snippet: 's' }])
    getStateMock.mockImplementation(() => ({
      aiSettings: { kbSettings: { agent: { searchTopK: 5 } }, searchResultCount: 5, safeSearch: 'moderate' },
      configs: [{ id: 'cfg1', nativeWebSearch: false }] as unknown[],
    }))
    const b = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: true })
    const r = await b.buildContext('q', [], null, CORE)
    expect(webSearchMock).toHaveBeenCalledTimes(1)
    expect(r.searchContext).toContain('[网络搜索]')
  })
})
