// ── ElectronBridgeService ──
// Type-safe aggregation of all IPC service modules.
// Replaces the (fileService as any).xxx monkey-patch pattern
// found previously in fileService.ts:147-158.
//
// Usage: import { bridge } from '@/services/electronBridge'

import {
  fileService, projectService, exportService, aiService, httpService, kbService,
  statsService, styleProjectService, styleTemplateService, templateService,
  continuationService, extractionService, storyService,
} from './fileService'


// Browser, MCP, and LSP services — previously only accessible via (fileService as any)
function e() {
  if (!window.electron) throw new Error('Electron bridge not available - run in Electron environment')
  return window.electron
}

export const browserService = {
  open: (url: string) => e().browser.open(url),
  search: (query: string) => e().browser.search(query),
}

export const mcpService = {
  listServers: (): Promise<any> => e().mcp.listServers(),
  listTools: (server: string): Promise<any> => e().mcp.listTools(server),
  callTool: (server: string, tool: string, args: Record<string, unknown>) =>
    e().mcp.callTool(server, tool, args),
  connectServer: (name: string, config: { name: string; command: string; args: string[]; env?: Record<string, string> }) =>
    e().mcp.connectServer(name, config),
  disconnectServer: (name: string) => e().mcp.disconnectServer(name),
  saveConfig: (servers: Array<{ name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }>) =>
    e().mcp.saveConfig(servers),
  loadConfig: (): Promise<Array<{ name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }>> =>
    e().mcp.loadConfig(),
}

export const agentService = {
  optimize: (configId: string, command: string): Promise<string> =>
    e().agent.optimize(configId, command),
}

// lspService removed in v13.2.0 — lsp_diagnose tool deleted

// Centralized bridge — 主进程 IPC 服务聚合（file/project/export/ai/http/kb/stats/
// styleProject/styleTemplate/sceneTemplate/continuation/extraction/story/agent/browser/mcp；
// settings/dialog/app/rewrite 由 fileService 直接导出，各模块按需引用）
export const bridge = {
  file: fileService,
  project: projectService,
  export: exportService,
  ai: aiService,
  http: httpService,
  kb: kbService,
  stats: statsService,
  styleProject: styleProjectService,
  styleTemplate: styleTemplateService,
  sceneTemplate: templateService,
  continuation: continuationService,
  extraction: extractionService,
  story: storyService,

  agent: agentService,
  browser: browserService,
  mcp: mcpService,
  // lsp removed in v13.2.0
}

export type ElectronBridge = typeof bridge
