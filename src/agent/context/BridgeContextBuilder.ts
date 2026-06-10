// ── Bridge Context Builder (v11.7.2) ──
// Shared context assembly logic.
//
// v11.7.2: 去掉全局文件索引 — 模型用 list_directory/find_files/search_content 动态探索
// v11.7.1: 首条全量规则，后续精简提醒。工具分层（核心+tool_search）

import { estimateTokens } from '../utils/tokenEstimation'
import type { Message } from '../state/types'

// ── Types ──

export interface ContextBuilderOptions {
  projectId: string | null
  configId: string
  kbEnabled: boolean
  webSearchEnabled: boolean
  selectedKbFileIds?: string[]
  enableThinkingPlan?: boolean
}

export interface ContextBuilderResult {
  systemMessages: Array<{ role: 'system'; content: string }>
  totalTokens: number
  domains: string[]
  breakdown: Array<{ domain: string; tokens: number }>
}

// ── Builder ──

export class BridgeContextBuilder {
  constructor(private opts: ContextBuilderOptions) {}

  async buildContext(
    msg: string,
    hist: Message[],
    pid: string | null,
    corePrompt: string,
    /** v11.7.1: 是否首条消息（首条发全量规则，后续精简） */
    isFirstMessage: boolean,
  ): Promise<ContextBuilderResult> {
    // ── 1. 确定是否发全量规则 ──
    const sendFullRules = isFirstMessage
    let effectivePrompt = sendFullRules ? corePrompt : (await import('../V4SystemPrompt')).MINIMAL_SYSTEM_PROMPT

    // ── 2. KB search + Web search（始终执行，动态内容）──
    let searchContext = ''
    if (this.opts.kbEnabled && this.opts.projectId) {
      try {
        const { kbService } = await import('@/services/fileService')
        const results = await kbService.search(
          msg, this.opts.projectId, this.opts.configId, 3, this.opts.selectedKbFileIds,
        )
        if (Array.isArray(results) && results.length > 0) {
          searchContext += '\n[知识库]\n' +
            results.map((r: any) => r.content || '').join('\n---\n')
        }
      } catch { /* unavailable */ }
    }
    if (this.opts.webSearchEnabled) {
      try {
        const { kbService } = await import('@/services/fileService')
        const results = await kbService.webSearch(msg.slice(0, 500), 3)
        if (Array.isArray(results) && results.length > 0) {
          searchContext += '\n[网络搜索]\n' +
            results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
        }
      } catch { /* unavailable */ }
    }

    // ── 6. Token estimation ──
    const coreTokens = estimateTokens(effectivePrompt)
    const searchTokens = searchContext ? estimateTokens(searchContext) : 0
    const historyTokens = hist.reduce(
      (s, m) => s + estimateTokens(m.content || '') + 4, 0,
    )
    const fullTotal = coreTokens + searchTokens + historyTokens + estimateTokens(msg)

    // ── 7. Assemble system messages — 角色身份 + 核心规则 ──
    const systemMessages: Array<{ role: 'system'; content: string }> = []

    // 注入用户选择的角色身份（预设或自定义）
    const { useSettingsStore } = await import('@/store')
    const aiSettings = useSettingsStore.getState().aiSettings
    const selectedRole = aiSettings.customRoles?.find(r => r.id === aiSettings.defaultRole)
    if (selectedRole?.prompt) {
      systemMessages.push({ role: 'system', content: selectedRole.prompt })
      // 去掉核心规则的默认身份行，让角色 prompt 成为唯一身份定义
      effectivePrompt = effectivePrompt.replace(/^你是青剑，一个小说创作对话助手。\n\n?/, '')
      effectivePrompt = effectivePrompt.replace(/^你是青剑，小说创作对话助手。/, '')
    }

    systemMessages.push({ role: 'system', content: effectivePrompt })

    // ── 8. Breakdown ──
    const breakdown: Array<{ domain: string; tokens: number }> = [
      { domain: sendFullRules ? '核心规则(全量)' : '核心规则(精简)', tokens: coreTokens },
      ...(searchContext ? [{ domain: '知识库/网络搜索', tokens: searchTokens }] : []),
      { domain: '对话历史', tokens: historyTokens },
      { domain: '当前消息', tokens: estimateTokens(msg) },
    ].filter(b => b.tokens > 0)

    return {
      systemMessages,
      totalTokens: fullTotal,
      domains: ['core-prompt'],
      breakdown,
    }
  }
}
