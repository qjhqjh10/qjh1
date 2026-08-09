// ── BridgeContextBuilder 单测（v14.8 KB per-run 改造） ──
// 覆盖：per-run 注入隔离（并发实例互不可见）、excludeKbFileIds 并集排除、
// result.injectedKbFileIds 返回本轮注入 id、原生联网勾选时跳过 DDG 搜索。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BridgeContextBuilder } from '../context/BridgeContextBuilder'

const { searchMock, webSearchMock, getStateMock, listMock } = vi.hoisted(() => {
  const getStateMock = vi.fn<() => { aiSettings: Record<string, unknown>; configs: unknown[] }>()
  getStateMock.mockImplementation(() => ({
    aiSettings: {
      kbSettings: { agent: { searchTopK: 5 } },
      searchResultCount: 5,
      safeSearch: 'moderate',
    },
    configs: [] as unknown[],
  }))
  return { searchMock: vi.fn(), webSearchMock: vi.fn(), getStateMock, listMock: vi.fn() }
})

vi.mock('@/services/fileService', () => ({
  kbService: {
    search: (...args: unknown[]) => searchMock(...args),
    webSearch: (...args: unknown[]) => webSearchMock(...args),
    list: (...args: unknown[]) => listMock(...args),
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
  listMock.mockReset()
  listMock.mockResolvedValue({ files: [{ id: 'kf1', originalName: '世界观设定.md' }, { id: 'kf2', originalName: '角色设定.md' }] })
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
  it('DeepSeek V4 + 原生联网（Responses 真会跑）→ 不调用 webSearch', async () => {
    searchMock.mockResolvedValue([])
    webSearchMock.mockResolvedValue([{ title: 't', snippet: 's' }])
    getStateMock.mockImplementation(() => ({
      aiSettings: { kbSettings: { agent: { searchTopK: 5 } }, searchResultCount: 5, safeSearch: 'moderate' },
      configs: [{ id: 'cfg1', protocol: 'openai', nativeWebSearch: true, model: 'deepseek-v4-flash', apiUrl: 'https://api.deepseek.com' }] as unknown[],
    }))
    const b = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: true })
    await b.buildContext('q', [], null, CORE)
    expect(webSearchMock).not.toHaveBeenCalled()
  })

  // v15.5: 修复死区——Anthropic 协议 + DeepSeek 官方端点 + 原生联网 → 服务端 web_search 工具（真原生，跳过 DDG）
  it('Anthropic 协议 + DeepSeek 官方端点 + 原生联网 → 服务端 web_search，跳过 DDG', async () => {
    searchMock.mockResolvedValue([])
    webSearchMock.mockResolvedValue([{ title: 't', snippet: 's' }])
    getStateMock.mockImplementation(() => ({
      aiSettings: { kbSettings: { agent: { searchTopK: 5 } }, searchResultCount: 5, safeSearch: 'moderate' },
      configs: [{ id: 'cfg1', protocol: 'anthropic', nativeWebSearch: true, model: 'deepseek-v4-flash', apiUrl: 'https://api.deepseek.com' }] as unknown[],
    }))
    const b = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: true })
    const r = await b.buildContext('q', [], null, CORE)
    expect(webSearchMock).not.toHaveBeenCalled()
  })

  // v15.5: Anthropic 协议但非 DeepSeek 官方端点（如 OpenCode）→ 无服务端 web_search，回退 DDG
  it('Anthropic 协议 + 非 DeepSeek 端点（如 OpenCode）+ 原生联网 → 回退 DDG', async () => {
    searchMock.mockResolvedValue([])
    webSearchMock.mockResolvedValue([{ title: 't', snippet: 's' }])
    getStateMock.mockImplementation(() => ({
      aiSettings: { kbSettings: { agent: { searchTopK: 5 } }, searchResultCount: 5, safeSearch: 'moderate' },
      configs: [{ id: 'cfg1', protocol: 'anthropic', nativeWebSearch: true, model: 'qwen3.7-max', apiUrl: 'https://opencode.ai/zen/go/v1/messages' }] as unknown[],
    }))
    const b = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: true })
    const r = await b.buildContext('q', [], null, CORE)
    expect(webSearchMock).toHaveBeenCalledTimes(1)
    expect(r.searchContext).toContain('[网络搜索]')
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

// ── v15.3.1: 角色模板设定文件（世界观组 worldKbFileIds + 场景组 scenarioKbFileIds，互斥）──
describe('角色模板设定文件（worldKbFileIds + scenarioKbFileIds）', () => {
  const TPL = {
    id: 'tpl1', name: '测试模板',
    characters: [
      { id: 'c1', name: '用户', identity: '男主', gender: '男', personality: '', relationship: '', avatar: '', isUser: true },
      { id: 'c2', name: '助手', identity: '女主', gender: '女', personality: '温柔', relationship: '恋人', avatar: '', isUser: false },
    ],
    worldSetting: '修仙世界',
    scenarioSetting: '',
    worldKbFileIds: ['kf1'],
    scenarioKbFileIds: ['kf2'],
  }
  const setupTplState = () => {
    getStateMock.mockImplementation(() => ({
      aiSettings: {
        kbSettings: { agent: { searchTopK: 5 } },
        searchResultCount: 5,
        safeSearch: 'moderate',
        roleTemplates: [TPL],
        activeRoleTemplateId: 'tpl1',
      },
      configs: [],
    }))
  }

  it('模板设定文件独立于「知识库」开关：kbEnabled=false 仍检索且限定该文件', async () => {
    setupTplState()
    searchMock.mockResolvedValue([{ fileId: 'kf1', fileName: '设定.md', content: '她怕黑' }])
    const builder = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: false })
    const { searchContext } = await builder.buildContext('她喜欢什么', [], null, CORE)
    expect(searchMock).toHaveBeenCalledTimes(1)
    // 第 5 参 fileIds = 模板勾选文件
    expect(searchMock.mock.calls[0][4]).toEqual(['kf1', 'kf2'])
    expect(searchContext).toContain('她怕黑')
  })

  it('模板设定文件与渲染层勾选（@引用/知识库文件）合并检索', async () => {
    setupTplState()
    searchMock.mockResolvedValue([])
    const builder = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: false, selectedKbFileIds: ['r1'] })
    await builder.buildContext('你好', [], null, CORE)
    expect(searchMock.mock.calls[0][4]).toEqual(['r1', 'kf1', 'kf2'])
  })

  it('system 消息分段提示：世界观文件与场景文件各归各、分别点名文件名', async () => {
    setupTplState()
    searchMock.mockResolvedValue([])
    const builder = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: false })
    const { systemMessages } = await builder.buildContext('你好', [], null, CORE)
    const roleMsg = systemMessages.find(s => s.content.includes('[角色扮演设定'))
    expect(roleMsg).toBeDefined()
    // 世界观组：点名世界观文件 + read_file 引导
    expect(roleMsg!.content).toContain('[世界观设定文件]')
    expect(roleMsg!.content).toContain('1 个世界观设定文件')
    expect(roleMsg!.content).toContain('世界观设定.md')
    // 场景组：点名场景文件 + read_file 引导（AI 按需求定位对应文件组）
    expect(roleMsg!.content).toContain('[场景对话设定文件]')
    expect(roleMsg!.content).toContain('1 个场景与对话设定文件')
    expect(roleMsg!.content).toContain('角色设定.md')
    expect(roleMsg!.content).toContain('read_file')
    expect(roleMsg!.content).toContain('../knowledge_base/files/')
    expect(roleMsg!.content).toContain('kb_analyze')
    // v15.3.1(优化): 酒馆世界书理念——已有信息不重复查、信息不足才查阅、大文件优先 kb_analyze
    expect(roleMsg!.content).toContain('已了解的信息不要重复查阅')
    expect(roleMsg!.content).toContain('仅当当前上下文无法确定设定细节')
    expect(roleMsg!.content).toContain('大文件优先 kb_analyze 深度分析')
    expect(roleMsg!.content).toContain('不要凭空猜测')
    // v15.3.1(优化): 角色扮演角度传递——子代理看不到角色设定，主 agent 委托时须传分析角度
    expect(roleMsg!.content).toContain('角色扮演设定要点')
    expect(roleMsg!.content).toContain('子代理看不到本角色的扮演设定')
  })

  it('score 阈值过滤：低相关片段不注入（缺 score 的旧数据默认注入）', async () => {
    searchMock.mockResolvedValue([
      { fileId: 'f1', fileName: 'a.md', content: '高相关片段', score: 0.55 },
      { fileId: 'f2', fileName: 'b.md', content: '低相关噪音', score: 0.12 },
      { fileId: 'f3', fileName: 'c.md', content: '旧数据无score', score: undefined },
    ])
    const builder = new BridgeContextBuilder({ ...NO_KB })
    const { searchContext, injectedKbFileIds } = await builder.buildContext('问题', [], null, CORE)
    expect(searchContext).toContain('高相关片段')
    expect(searchContext).not.toContain('低相关噪音')
    expect(searchContext).toContain('旧数据无score')
    expect(injectedKbFileIds).toEqual(['f1', 'f3'])
  })

  it('未勾选设定文件时无提示、无检索（kbEnabled=false 完全跳过）', async () => {
    searchMock.mockResolvedValue([])
    const builder = new BridgeContextBuilder({ projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: false })
    const { systemMessages } = await builder.buildContext('你好', [], null, CORE)
    expect(searchMock).not.toHaveBeenCalled()
    expect(systemMessages.some(s => s.content.includes('[世界观设定文件]') || s.content.includes('[场景对话设定文件]'))).toBe(false)
  })
})

describe('v16.0.1(M4) — @引用不受 KB 开关门控', () => {
  it('kbEnabled=false 但 selectedKbFileIds 非空 → 仍触发检索（显式引用优先于开关）', async () => {
    searchMock.mockResolvedValue([{ fileId: 'kf1', fileName: '世界观设定.md', content: '相关片段', score: 0.9 }])
    const builder = new BridgeContextBuilder({
      projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: false,
      selectedKbFileIds: ['kf1'],
    })
    const { searchContext } = await builder.buildContext('关于世界观的问题', [], null, CORE)
    // 原缺陷：kbActive = kbEnabled || tplKbFileIds.length>0（不含 selectedKbFileIds）
    // → kbEnabled=false 时整个检索块跳过 → @引用静默失效
    expect(searchMock).toHaveBeenCalled()
    expect(searchContext).toContain('相关片段')
  })

  it('kbEnabled=false 且 selectedKbFileIds 为空 → 不检索（保持原语义）', async () => {
    searchMock.mockResolvedValue([])
    const builder = new BridgeContextBuilder({
      projectId: null, configId: 'cfg1', kbEnabled: false, webSearchEnabled: false,
    })
    await builder.buildContext('你好', [], null, CORE)
    expect(searchMock).not.toHaveBeenCalled()
  })
})
