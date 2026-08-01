// ── Electron Bridge Mock ──
// Shared mock for window.electron IPC bridge.
// Import in any test that calls IPC services.
// Usage: vi.mock('@/services/fileService', () => ({ ...require('@/tests/mocks/electron') }))

import { vi } from 'vitest'

/** Create a fully mocked window.electron object for testing */
export function createMockElectronBridge() {
  const mock = {
    files: {
      read: vi.fn().mockResolvedValue(''),
      write: vi.fn().mockResolvedValue(undefined),
      listDir: vi.fn().mockResolvedValue([]),
      ensureDir: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      deleteDir: vi.fn().mockResolvedValue(undefined),
      readBinary: vi.fn().mockResolvedValue(''),
      writeBinary: vi.fn().mockResolvedValue(undefined),
      saveImageUrl: vi.fn().mockResolvedValue(''),
      onExternalChange: vi.fn(() => () => {}), // returns unsubscribe
    },
    project: {
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      getMeta: vi.fn().mockResolvedValue({}),
      listProjects: vi.fn().mockResolvedValue([]),
      importProject: vi.fn().mockResolvedValue(undefined),
      updateCategory: vi.fn().mockResolvedValue(undefined),
    },
    ai: {
      chat: vi.fn().mockResolvedValue('{"text":"mock response"}'),
      chatStream: vi.fn().mockReturnValue({ abort: vi.fn() }),
      chatWithTools: vi.fn().mockResolvedValue('{"text":"mock","tool_calls":[]}'),
      chatWithUsage: vi.fn().mockResolvedValue({ text: 'mock', usage: undefined }),
      listModels: vi.fn().mockResolvedValue([]),
      generateImage: vi.fn().mockResolvedValue({ path: '', url: '', cost: 0 }),
      abortStream: vi.fn(),
    },
    http: {
      fetch: vi.fn().mockResolvedValue({ status: 'success', summary: '', detail: '' }),
      get: vi.fn().mockResolvedValue({ status: 'success', summary: '', detail: '' }),
    },
    browser: {
      open: vi.fn().mockResolvedValue({ status: 'success', summary: '', detail: '' }),
      search: vi.fn().mockResolvedValue({ status: 'success', summary: '', detail: '' }),
      screenshot: vi.fn().mockResolvedValue({ status: 'error', summary: 'not supported' }),
    },
    shell: {
      exec: vi.fn().mockResolvedValue({ status: 'success', summary: '', detail: '' }),
      runScript: vi.fn().mockResolvedValue({ status: 'success', summary: '' }),
    },
    mcp: {
      listServers: vi.fn().mockResolvedValue({ servers: [] }),
      listTools: vi.fn().mockResolvedValue({ detail: '[]' }),
      callTool: vi.fn().mockResolvedValue({ status: 'success', summary: '', detail: '' }),
      connectServer: vi.fn().mockResolvedValue(undefined),
      disconnectServer: vi.fn().mockResolvedValue(undefined),
      saveConfig: vi.fn().mockResolvedValue(undefined),
      loadConfig: vi.fn().mockResolvedValue([]),
    },
    agent: {
      optimize: vi.fn().mockResolvedValue('mock output'),
    },
    lsp: {
      diagnose: vi.fn().mockResolvedValue({ status: 'success', summary: '零错误', detail: '' }),
    },
    kb: {
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue(''),
      search: vi.fn().mockResolvedValue([]),
      selectFiles: vi.fn().mockResolvedValue([]),
      uploadFiles: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      index: vi.fn().mockResolvedValue(undefined),
      assignProject: vi.fn().mockResolvedValue(undefined),
      getEmbedding: vi.fn().mockResolvedValue([]),
      estimate: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue(undefined),
      append: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
    },
    notes: {
      search: vi.fn().mockResolvedValue([]),
    },
    export: {
      exportChapters: vi.fn().mockResolvedValue(undefined),
      exportSingleChapter: vi.fn().mockResolvedValue(undefined),
      exportProject: vi.fn().mockResolvedValue(undefined),
      exportEpub: vi.fn().mockResolvedValue(undefined),
    },
    dialog: {
      openFile: vi.fn().mockResolvedValue([]),
      openDirectory: vi.fn().mockResolvedValue(''),
    },
    app: {
      getProjectsBasePath: vi.fn().mockResolvedValue('/mock/projects'),
      getAppPath: vi.fn().mockReturnValue('/mock/app'),
      // v14.0.1: getSystemPrompt 已移除
    },
    settings: {
      loadConfigs: vi.fn().mockResolvedValue([]),
      saveConfigs: vi.fn().mockResolvedValue(undefined),
      loadPrompts: vi.fn().mockResolvedValue({}),
      savePrompts: vi.fn().mockResolvedValue(undefined),
    },
    stats: {
      getUsage: vi.fn().mockResolvedValue({}),
      getPrices: vi.fn().mockResolvedValue([]),
      savePrices: vi.fn().mockResolvedValue(undefined),
      deleteByLine: vi.fn().mockResolvedValue(undefined),
      getMonthCost: vi.fn().mockResolvedValue(0),
    },
    continuation: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    extraction: {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    },
    story: {
      load: vi.fn().mockResolvedValue({}),
      save: vi.fn().mockResolvedValue(undefined),
    },

  }

  // Stub window.electron for test environment
  if (typeof window !== 'undefined') {
    ;(window as any).electron = mock
  }

  return mock
}

export type MockElectronBridge = ReturnType<typeof createMockElectronBridge>
