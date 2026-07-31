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
  /** v13.x: 搜索上下文（KB+Web），注入 user message 而非 system → 保持缓存前缀稳定 */
  searchContext: string
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
  ): Promise<ContextBuilderResult> {
    // ── 1. 始终全量规则（前缀缓存使重复传输几乎免费，且模型每轮都需要完整规则）──
    let effectivePrompt = corePrompt

    // ── 2. KB search + Web search（始终执行，动态内容）──
    // v13.x: 知识库检索不再要求项目内 — 未指定项目时检索全部文件
    let searchContext = ''
    if (this.opts.kbEnabled) {
      try {
        const { kbService } = await import('@/services/fileService')
        const { useSettingsStore } = await import('@/store')
        const kbSettings = useSettingsStore.getState().aiSettings.kbSettings
        const topK = Math.min(20, Math.max(1, kbSettings?.agent?.searchTopK || 5))
        const results = await kbService.search(
          msg.slice(0, 4000), this.opts.projectId || '', this.opts.configId, topK, this.opts.selectedKbFileIds,
        )
        if (Array.isArray(results) && results.length > 0) {
          searchContext += '\n[知识库]\n' +
            results.map((r: any) => `📄 ${r.fileName || '(未知文件)'}\n${r.content || ''}`).join('\n---\n')
        }
      } catch { /* unavailable */ }
    }
    if (this.opts.webSearchEnabled) {
      try {
        const { kbService } = await import('@/services/fileService')
        const { useSettingsStore } = await import('@/store')
        const aiSettings = useSettingsStore.getState().aiSettings
        const count = Math.min(10, Math.max(1, aiSettings.searchResultCount || 3))
        const results = await kbService.webSearch(msg.slice(0, 500), count, aiSettings.safeSearch || 'moderate')
        if (Array.isArray(results) && results.length > 0) {
          searchContext += '\n[网络搜索]\n' +
            results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
        }
      } catch { /* unavailable */ }
    }

    // ── 6. Token estimation (仅动态内容，核心提示词延后到项目信息注入后计算) ──
    const searchTokens = searchContext ? estimateTokens(searchContext) : 0
    const historyTokens = hist.reduce(
      (s, m) => s + estimateTokens(m.content || '') + 4, 0,
    )

    // ── 7. Assemble system messages — 角色身份 + 核心规则 ──
    const systemMessages: Array<{ role: 'system'; content: string }> = []

    // 读取 settings store（角色模板 + 旧 customRoles 共用）
    const { useSettingsStore, useStore } = await import('@/store')
    const aiSettings = useSettingsStore.getState().aiSettings

    // v13.0: 注入角色模板 — "语气外壳"，不替换写作助手内核
    const activeTplId = aiSettings.activeRoleTemplateId
    const activeTpl = activeTplId ? aiSettings.roleTemplates?.find(t => t.id === activeTplId) : undefined
    if (activeTpl && activeTpl.characters.length > 0) {
      const userChars = activeTpl.characters.filter(c => c.isUser)
      const aiChars = activeTpl.characters.filter(c => !c.isUser)

      if (aiChars.length > 0) {
        const charLines: string[] = []
        if (activeTpl.worldSetting) {
          charLines.push(`世界背景：${activeTpl.worldSetting}`)
        }
        if (activeTpl.scenarioSetting) {
          charLines.push(`场景设定：${activeTpl.scenarioSetting}`)
        }
        userChars.forEach(c => {
          const parts = [`"${c.name}"（${c.identity}，${c.gender}，由用户扮演）`]
          if (c.personality) parts.push(`- 设定：${c.personality}`)
          if (c.relationship) parts.push(`- 关系：${c.relationship}`)
          charLines.push(parts.join('\n'))
        })
        aiChars.forEach(c => {
          const parts = [`"${c.name}"（${c.identity}，${c.gender}，由你扮演）`]
          if (c.personality) parts.push(`- 设定：${c.personality}`)
          if (c.relationship) parts.push(`- 关系：${c.relationship}`)
          if (c.firstMessage) parts.push(`- 首次发言风格参考："${c.firstMessage}"`)
          charLines.push(parts.join('\n'))
        })

        charLines.unshift('[角色扮演设定 — 这是你的人格外壳，你的核心写作助手能力（文件操作、知识库搜索、章节创作等全部工具）保持不变]')
        systemMessages.push({ role: 'system', content: charLines.join('\n\n') })
      }
    }

    // 注入用户选择的角色身份（旧兼容，仅在没有角色模板时生效） + 当前项目信息
    const hasRoleTemplate = !!activeTplId && (aiSettings.roleTemplates?.some(t => t.id === activeTplId))
    if (!hasRoleTemplate) {
      const selectedRole = aiSettings.customRoles?.find(r => r.id === aiSettings.defaultRole)
      if (selectedRole?.prompt) {
        systemMessages.push({ role: 'system', content: selectedRole.prompt })
        effectivePrompt = effectivePrompt.replace(/^你是青剑，(?:一个)?小说创作对话助手。\n{0,2}/, '')
      }
    }

    // 注入当前项目信息 — 先算项目 token，再合并到 effectivePrompt
    let projectTokens = 0
    if (pid) {
      const storeState = useStore.getState()
      const project = storeState.projects.find(p => p.id === pid)
      const displayName = project?.name || pid
      const displayHint = displayName !== pid
        ? `项目名: ${displayName}  (目录名: ${pid})
- 用户可能用"${displayName}"称呼本项目，你需理解这个词指向此项目
- 文件路径以 "${pid}/" 开头，如 "${pid}/outline/"、"${pid}/chapters/"、"${pid}/summaries/"`
        : `项目名: ${displayName}
- 文件路径以 "${pid}/" 开头，如 "${pid}/outline/"、"${pid}/chapters/"、"${pid}/summaries/"`
      projectTokens = estimateTokens(`当前项目: ${displayHint}\n\n`)
      effectivePrompt = `当前项目: ${displayHint}\n\n` + effectivePrompt
    }

    systemMessages.push({ role: 'system', content: effectivePrompt })

    // ── 8. Token 统计 + Breakdown ──
    const coreTokens = estimateTokens(effectivePrompt)
    const fullTotal = coreTokens + searchTokens + historyTokens + estimateTokens(msg)
    const breakdown: Array<{ domain: string; tokens: number }> = [
      { domain: '核心规则(全量)', tokens: coreTokens - projectTokens },
      ...(projectTokens > 0 ? [{ domain: '项目信息', tokens: projectTokens }] : []),
      ...(searchContext ? [{ domain: '知识库/网络搜索', tokens: searchTokens }] : []),
      { domain: '对话历史', tokens: historyTokens },
      { domain: '当前消息', tokens: estimateTokens(msg) },
    ].filter(b => b.tokens > 0)

    return {
      systemMessages,
      searchContext,
      totalTokens: fullTotal,
      domains: breakdown.map(b => b.domain),
      breakdown,
    }
  }
}
