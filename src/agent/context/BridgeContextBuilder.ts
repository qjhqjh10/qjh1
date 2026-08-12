// ── Bridge Context Builder (v11.7.2) ──
// Shared context assembly logic.
//
// v11.7.2: 去掉全局文件索引 — 模型用 list_directory/find_files/search_content 动态探索
// v11.7.1: 首条全量规则，后续精简提醒。工具分层（核心+tool_search）

import { estimateTokens } from '../utils/tokenEstimation'
import type { Message } from '../state/types'
// v15.4.0: 阈值常量收敛到 knowledgePipeline（单一真源，agent 与生成场景共用）
import { KB_INJECT_SCORE_THRESHOLD } from '@/services/knowledgePipeline'

// ── Types ──

export interface ContextBuilderOptions {
  projectId: string | null
  configId: string
  kbEnabled: boolean
  webSearchEnabled: boolean
  /** v16.3.0: 联网会话级覆盖 — 'builtin'|'off' = 原生判定强制 false（临时用内置/关闭），
   * null/undefined = 跟随模型配置。原生不生效时内置 DDG 才注入（单一联网通道）。 */
  nativeOverride?: 'builtin' | 'off' | null
  selectedKbFileIds?: string[]
  /** v14.8: 跨 run 排除 — 历史 run 已注入过的知识库文件 id（来自上一条 assistant 消息的 kbInjectedFileIds），
   * 与本轮实例内已注入 id 并集后传给 kbService.search，避免同一文件跨 run 反复注入 */
  excludeKbFileIds?: string[]
  /** v16.1.0(审查修复 B6): 章节协作——本轮是否注入全文。false 只注入锚点+版本（成本优化） */
  chapterFullText?: boolean
  /** v16.4.0: 会话绑定的角色模板 id（聊天窗传会话锁定值；未传回退全局 activeRoleTemplateId——
   * 非聊天窗调用方（生成/子代理等）保持原语义） */
  roleTemplateId?: string
}

export interface ContextBuilderResult {
  systemMessages: Array<{ role: 'system'; content: string }>
  /** v13.x: 搜索上下文（KB+Web），注入 user message 而非 system → 保持缓存前缀稳定 */
  searchContext: string
  /**
   * v14.8: 本轮预注入的知识库文件 id。
   * 字段名与 ContextAssemblerFn 返回类型（RuntimeTypes.injectedKbFileIds）严格一致——
   * 审查修复：此前误写为 injectedFileIds，runtime 读取恒 undefined 使跨 run 去重静默失效。
   */
  injectedKbFileIds: string[]
  totalTokens: number
  domains: string[]
  breakdown: Array<{ domain: string; tokens: number }>
}

// ── Builder ──

export class BridgeContextBuilder {
  /** v14.8: 本轮已注入的知识库文件 id（实例字段，per-run 归属——原模块级单例被并发 run/子 agent 共享串扰） */
  private injectedFileIds = new Set<string>()

  constructor(private opts: ContextBuilderOptions) {}

  async buildContext(
    msg: string,
    hist: Message[],
    pid: string | null,
    corePrompt: string,
  ): Promise<ContextBuilderResult> {
    // ── 1. 始终全量规则（前缀缓存使重复传输几乎免费，且模型每轮都需要完整规则）──
    let effectivePrompt = corePrompt

    // 读取 settings store（角色模板 + 旧 customRoles 共用）——提前到 KB 检索前，
    // v15.3.1: 角色模板勾选的设定文件（kbFileIds）独立于渲染层「知识库」开关，勾选即检索
    // v16.4.0: 模板解析优先会话绑定值（opts.roleTemplateId，聊天窗传会话锁定值）——
    // 修复绑定错位：原恒读全局 activeRoleTemplateId，设置页改全局/删模板会静默改变已锁定会话的人设。
    const { useSettingsStore, useStore } = await import('@/store')
    const aiSettings = useSettingsStore.getState().aiSettings
    const activeTplId = this.opts.roleTemplateId || aiSettings.activeRoleTemplateId
    const activeTpl = activeTplId ? aiSettings.roleTemplates?.find(t => t.id === activeTplId) : undefined
    // v15.3.1: 设定文件分两组——世界观设定文件 / 场景对话设定文件（互斥，AI 按需求定位到正确文件组）
    const tplWorldFileIds = activeTpl?.worldKbFileIds || []
    const tplScenarioFileIds = activeTpl?.scenarioKbFileIds || []
    const tplKbFileIds = [...tplWorldFileIds, ...tplScenarioFileIds]

    // ── 2. KB search + Web search（动态内容）──
    // v13.x: 知识库检索不再要求项目内 — 未指定项目时检索全部文件
    let searchContext = ''
    // v16.0.1(审计 M4): kbActive 补 selectedKbFileIds——原仅 kbEnabled || 模板设定文件，
    // 用户 @引用（selectedKbFileIds）在 KB 开关关闭时整个检索块被跳过（静默失效），
    // 与 UI 注释"显式引用优先于 kbEnabled 开关"矛盾
    const kbActive = this.opts.kbEnabled || tplKbFileIds.length > 0
      || (this.opts.selectedKbFileIds?.length ?? 0) > 0
    // v15.3.1: 角色设定文件名映射（仅勾选设定文件时查一次，轻量元数据 IPC）——
    // 提示词点名文件名，AI 才能直接 read_file("../knowledge_base/files/xxx.md") 定位读取
    let kbIdNameMap = new Map<string, string>()
    if (tplKbFileIds.length > 0) {
      try {
        const { kbService } = await import('@/services/fileService')
        const meta = await kbService.list() as { files?: { id: string; originalName: string }[] }
        for (const f of (meta?.files || [])) kbIdNameMap.set(f.id, f.originalName)
      } catch { /* 查不到文件名时提示词只显示数量 */ }
    }
    if (kbActive) {
      try {
        const { kbService } = await import('@/services/fileService')
        const kbSettings = aiSettings.kbSettings
        const topK = Math.min(20, Math.max(1, kbSettings?.agent?.searchTopK || 5))
        // v14.8: 排除集 = 跨 run 历史已注入（excludeKbFileIds）+ 本轮实例已注入（per-run 归属，消除并发串扰）
        const exclude = new Set(this.opts.excludeKbFileIds ?? [])
        for (const id of this.injectedFileIds) exclude.add(id)
        // v15.3.1: 检索范围 = 渲染层勾选（@引用/知识库文件）∪ 角色模板设定文件
        const fileIds = [...(this.opts.selectedKbFileIds ?? []), ...tplKbFileIds]
        const results = await kbService.search(
          msg.slice(0, 4000), this.opts.projectId || '', this.opts.configId, topK,
          fileIds.length > 0 ? fileIds : undefined,
          exclude.size > 0 ? [...exclude] : undefined,
        )
        if (Array.isArray(results) && results.length > 0) {
          // v15.3.1(优化): score 阈值过滤——低相关片段不注入（对齐酒馆世界书"不激活不注入"；
          // 缺 score 的旧数据视为相关默认注入；kb_search 工具不受此限制，AI 可自行查阅）
          const filtered = results.filter((r: any) => (r.score ?? 1) >= KB_INJECT_SCORE_THRESHOLD)
          if (filtered.length > 0) {
            searchContext += '\n[知识库]\n' +
              filtered.map((r: any) => `📄 ${r.fileName || '(未知文件)'}\n${r.content || ''}`).join('\n---\n')
            // v14.8: 记录本轮注入文件 id（供 kb_search 工具排除 + 随 run 结果跨 run 持久化）
            for (const r of filtered) {
              if (r.fileId) this.injectedFileIds.add(String(r.fileId))
            }
          }
        }
      } catch { /* unavailable */ }
    }
    if (this.opts.webSearchEnabled) {
      try {
        const { useSettingsStore } = await import('@/store')
        // v15.5: 跳过内置 DDG 仅当「原生联网真会跑」——三条件之一：
        //   A) shouldUseResponses（DeepSeek V4+OpenAI 原生联网 / OpenCode gpt responses）
        //   B) DeepSeek 官方端点 + Anthropic 协议 + 原生联网（服务端 web_search 工具）
        // 修复死区：原逻辑仅看 nativeWebSearch 字段——Anthropic 协议或非 deepseek 模型时
        // 原生通道不跑、DDG 又被跳过 → 联网开关形同虚设。
        const { shouldUseResponses, resolveNativeEnabled } = await import('@/agent/runtime/adapters/responsesRouter')
        const activeCfg = useSettingsStore.getState().configs.find(c => c.id === this.opts.configId)
        const model = (activeCfg?.model || '').toLowerCase()
        const apiUrl = (activeCfg?.apiUrl || '').toLowerCase()
        // v16.3.0: 原生判定套会话级覆盖（聊天窗三态循环不再修改模型配置勾选）
        const nativeOn = resolveNativeEnabled(activeCfg, this.opts.nativeOverride)
        const deepSeekAnthropicNative = nativeOn && apiUrl.includes('deepseek.com')
          && /deepseek/i.test(model) && activeCfg?.protocol === 'anthropic'
        if (!shouldUseResponses({ ...activeCfg, nativeWebSearch: nativeOn }) && !deepSeekAnthropicNative) {
          const { kbService } = await import('@/services/fileService')
          const aiSettings = useSettingsStore.getState().aiSettings
          const count = Math.min(10, Math.max(1, aiSettings.searchResultCount || 5))
          const results = await kbService.webSearch(msg.slice(0, 500), count, aiSettings.safeSearch || 'moderate')
          if (Array.isArray(results) && results.length > 0) {
            searchContext += '\n[网络搜索]\n' +
              results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
          }
        }
      } catch { /* unavailable */ }
    }

    // ── 3. 章节协作改写上下文（v16.1.0 关联模式激活时注入；走 user 消息管道，system 前缀稳定）──
    // 权威源 = 编辑器内存态(collab.text，随 onChange 实时同步)；磁盘文件可能落后于编辑器。
    // 取消关联(collab.active=false) → 整块消失，不背 tokens。
    let chapterTokens = 0
    if (!searchContext.startsWith('[章节协作]')) {
      try {
        const { useChapterCollabStore } = await import('@/store/chapterCollabStore')
        const collab = useChapterCollabStore.getState()
        if (collab.active && collab.chapterId && collab.text) {
          const chapterNum = String(collab.chapterId).match(/(\d+)/)?.[1] || collab.chapterId
          const anchor = collab.anchorStack[0] || collab.selectionAnchor || ''
          const chapterBlock =
            `\n[章节协作]\n` +
            `当前关联: 第${chapterNum}章（编辑器内存态，权威源）\n` +
            `锚点: ${anchor}\n` +
            `锚点版本: ${collab.anchorStack.length}/3（最新在前，改写成功后自动更新）\n` +
            `已改写次数: ${collab.chapterVersion}\n` +
            `只读规则: 本章文件只读，禁止 create_file/edit_file/batch_replace/delete_file/rename_file 写入本章路径（系统会拦截）；改写请用 editor_rewrite 工具。\n` +
            `⚠️ 磁盘文件可能落后于编辑器（自动保存有延迟）：不要用 read_file 读取本章文件获取内容——一律以本注入块的本章全文为准。锚点定位也以本全文为准。\n` +
            `其他文件不受此限制，可正常读写。\n` +
            // v16.1.0(审查修复 B6): 未变化轮不注入全文（成本优化）——历史 user 消息中已有全文，
            // 模型按需参考；章节内容变更后下一轮才会重新注入
            (this.opts.chapterFullText !== false
              ? `本章全文:\n${collab.text}`
              : `本章全文已在之前的参考信息中给出（内容未变），直接基于已有内容工作；如需最新全文请说明「重载章节」。`)
          searchContext += chapterBlock
          chapterTokens = estimateTokens(chapterBlock)
        }
      } catch { /* store 不可用(测试)时跳过 */ }
    }

    // ── 6. Token estimation (仅动态内容，核心提示词延后到项目信息注入后计算) ──
    const searchTokens = searchContext ? estimateTokens(searchContext) : 0
    const historyTokens = hist.reduce(
      (s, m) => s + estimateTokens(m.content || '') + 4, 0,
    )

    // ── 7. Assemble system messages — 角色身份 + 核心规则 ──
    const systemMessages: Array<{ role: 'system'; content: string }> = []

    // v13.0: 注入角色模板 — "语气外壳"，不替换写作助手内核
    // v15.3.1: 模板勾选的设定文件（kbFileIds）→ 提示词告知模型深度设定存于文件，
    // 需要时自主 kb_search / kb_analyze 精确查阅（检索结果已随本轮注入，但片段未必覆盖全部设定）
    // v16.4.0(长文本边界): 文件夹化后 worldSetting/personality 可写得很长——注入有界，
    // 超出部分提示 read_file 模板文件夹文件查阅（完整注入每轮占上下文，缓存也贵）
    if (activeTpl && activeTpl.characters.length > 0) {
      const userChars = activeTpl.characters.filter(c => c.isUser)
      const aiChars = activeTpl.characters.filter(c => !c.isUser)

      // v16.4.0: 有界注入助手——长设定截断到提示上限，并附"完整内容在文件里"的指引
      const boundText = (label: string, text: string, max: number, fileRef: string): string | null => {
        if (!text) return null
        if (text.length <= max) return text
        return `${text.slice(0, max)}\n（以上为节选，完整${label}在 ${fileRef}，需要时 read_file 查阅全文）`
      }

      if (aiChars.length > 0) {
        const charLines: string[] = []
        // v16.4.0: 文件夹化——worldSetting/scenarioSetting 与模板文件夹文件互为镜像：
        // 对话框写入后自动导出到 role_templates/<id>/，AI 可按路径 read_file 读全文。
        // 路径净化与主进程 roleTemplateHandlers.safeTplId/safeFileName 对齐（提示路径与磁盘一致）
        const tplFolder = activeTpl.id.replace(/[\\/:*?"<>|]/g, '_').slice(0, 64)
        const charFileOf = (name: string) =>
          `../role_templates/${tplFolder}/characters/${(name || '角色').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60)}.yaml`
        const worldSetting = boundText('世界观背景', activeTpl.worldSetting, 2500, `../role_templates/${tplFolder}/世界观.md`)
        if (worldSetting) {
          charLines.push(`世界背景：${worldSetting}`)
        } else if (tplWorldFileIds.length > 0) {
          // v16.4.0(角色扮演实测 S10 发现): 文本框留空但勾选了世界观文件时——AI 信息薄弱
          // 会退化为"小说创作模式"（替用户角色行动/写叙事，不回应）。注入占位声明，
          // 明确"设定在文件里、对话中需要时查阅"，防止回归写作模式
          charLines.push(`世界背景：未在模板填写——完整世界观在下方[世界观设定文件]，对话中遇到不了解的设定时先查阅文件再回答，不要凭空编造。`)
        }
        const scenarioSetting = boundText('场景对话设定', activeTpl.scenarioSetting, 2500, `../role_templates/${tplFolder}/场景对话设定.md`)
        if (scenarioSetting) {
          // v16.4.0(用户决策): 文本框内容 = 用户写的「触发情况 +（可选）具体细节」——
          // 何时触发由你按对话情境自行判断（如"在酒馆/喝酒时"），不必等系统关键词
          charLines.push(`场景设定（用户写的触发情况与规则——对话进行到符合触发情况的情境时应用对应规则，由你自行判断触发；未写细节的触发情况可自由完善细节）：${scenarioSetting}`)
        }
        userChars.forEach(c => {
          const parts = [`"${c.name}"（${c.identity}，${c.gender}，由用户扮演）`]
          const personality = boundText('角色设定', c.personality, 900, charFileOf(c.name))
          if (personality) parts.push(`- 设定：${personality}`)
          const relationship = boundText('关系设定', c.relationship, 500, charFileOf(c.name))
          if (relationship) parts.push(`- 关系：${relationship}`)
          charLines.push(parts.join('\n'))
        })
        aiChars.forEach(c => {
          const parts = [`"${c.name}"（${c.identity}，${c.gender}，由你扮演）`]
          const personality = boundText('角色设定', c.personality, 900, charFileOf(c.name))
          if (personality) parts.push(`- 设定：${personality}`)
          const relationship = boundText('关系设定', c.relationship, 500, charFileOf(c.name))
          if (relationship) parts.push(`- 关系：${relationship}`)
          if (c.firstMessage) parts.push(`- 首次发言风格参考："${c.firstMessage}"`)
          charLines.push(parts.join('\n'))
        })

        // v16.4.0: 发言格式约束（修复多角色混音）——AI 角色>1 时必须按"角色名：台词"分行标注；
        // 关键语义（用户澄清）：不是"轮流/全员发言"——谁参与当前场景、谁该说话才由谁发言，
        // 未出场的角色保持沉默；用户点名/要求某角色时优先由该角色回应。
        // 用户消息 [扮演: X] 前缀 = 用户以该角色身份说话（v16.4.1: 扮演选择器已移除——
        // 无 UI 注入，但用户可手动写前缀声明以角色身份发言；AI 按用户要求+角色信息直接扮演）
        // v16.4.0(举一反三·无例外强制修复): 「不要自造角色名」限指模板内角色不能叫错名，
        // 剧情需要的临时新角色（客栈小二/路人/神秘客）必须可以即兴创造
        charLines.push('【发言格式】')
        if (aiChars.length > 1) {
          charLines.push(
            `- 你同时扮演 ${aiChars.map(c => `"${c.name}"`).join('、')} 等多个角色。谁参与当前场景、谁该说话，就由谁发言——未出场的角色保持沉默，不要强行安排所有角色轮流发言或全员开口；用户要求/点名某个角色时（如"让${aiChars[0].name}说说看法"），优先由该角色回应。每当有 AI 角色发言（无论一人还是多人），每句发言都以「角色名：内容」分行开头（如"${aiChars[0].name}：……"），一行一名角色，角色名必须使用上面列出的姓名，不要把所有角色混成一个声音；「不要自造角色名」指上面列出的角色不能叫错名字——剧情需要的临时新角色（客栈小二、路人、神秘客等）可以即兴创造并正常标注，不要拒绝创造新角色。`
          )
        } else {
          charLines.push(`- 你以"${aiChars[0].name}"的身份直接回答（无需带角色名前缀）。`)
        }
        charLines.push(
          `- 用户消息以「[扮演: 角色名]」开头时，表示用户正以该角色身份说话——你以对方的视角理解并回应，与该角色正常互动；未标注时用户是旁白/作者视角。`
        )
        // v16.4.0(角色扮演实测发现): 用户扮演的角色（isUser）由用户自己说话——AI 不得替
        // 他们发言、做决定或推进他们的行动（如"李青：（……）"），除非用户明确要求代写。
        if (userChars.length > 0) {
          charLines.push(
            `- 用户扮演的角色${userChars.map(c => `"${c.name}"`).join('、')}由用户自己发言——不要替他们开口说话、替他们做决定或代推进他们的行动（例如不要写"${userChars[0].name}：（……）"），他们的言行由用户自己给出；你只需扮演自己的角色并与其互动。`
          )
        }
        // v16.4.0(角色扮演实测 S10 发现): 设定信息薄弱时 AI 会退化为"小说创作模式"——
        // 把用户消息当创作素材续写叙事而非回应。明确"这是对话不是创作"，防回归写作模式
        charLines.push(
          `- 当前是角色扮演对话而非小说创作：以你自己的角色身份**直接回应**对方的话，不要替用户角色写动作/内心独白/推进剧情，不要输出大段旁白叙事；只有在用户明确要求"写一段/续写/创作"时才切换到创作模式。`
        )

        // v15.3.1: 设定文件提示分两段——世界观文件 / 场景对话文件各归各（AI 按需求定位对应文件组）。
        // v16.4.0(用户决策·模型能力为主): 使用原则修正——设定是"约束补充"不是"创作枷锁"：
        // ① 文件未覆盖的细节（场景氛围/临时元素/即兴情节）AI 自由发挥完善（模型能力为主）
        // ② 文件明确写了的设定（人物背景/势力关系/规则）不确定时查阅，不凭空编造
        // ③ 冲突时以文件设定为准；用户明确要求查阅/重查/即兴创作时听用户的
        const SETTING_FILE_USE_RULE =
          `使用原则（模型能力为主，设定为约束补充）：设定文件约束核心设定——与文件设定冲突时以文件为准；`
          + `文件未覆盖的细节（场景氛围、临时元素、即兴情节）由你自由发挥完善，不必生硬照搬或处处查阅；`
          + `文件里明确写了的细节（人物背景、势力关系、规则禁忌）不确定时才查阅：先用 kb_search 定位相关段落，`
          + `小文件用 read_file 读取全文（文件在 ../knowledge_base/files/ 目录），大文件优先 kb_analyze 深度分析（回传精简总结，避免全文占用大量上下文）；`
          + `委托 kb_analyze 分析设定文件时，请在 query/focus 中说明分析角度——按角色扮演设定要点提炼：角色性格/关系/说话风格/世界观约束/行为准则与禁忌，而非泛泛的资料摘要（子代理看不到本角色的扮演设定，角度需由你传入）；`
          + `不要凭空编造文件里明确写了的设定细节。用户的明确指令优先于以上所有规则：要求查阅/重查时直接照做，要求即兴创作/自由发挥时不受设定约束。`
        if (tplWorldFileIds.length > 0) {
          const names = tplWorldFileIds.map(id => kbIdNameMap.get(id)).filter(Boolean) as string[]
          charLines.push(
            `[世界观设定文件] 本角色勾选 ${tplWorldFileIds.length} 个世界观设定文件${names.length > 0 ? `（${names.join('、')}）` : ''}，完整世界观存于其中。${SETTING_FILE_USE_RULE}`
          )
        }
        if (tplScenarioFileIds.length > 0) {
          const names = tplScenarioFileIds.map(id => kbIdNameMap.get(id)).filter(Boolean) as string[]
          // v16.4.0: 场景标记语义——设定文件内「## 场景：X」条目在对话提到 X 时会被系统自动激活注入
          charLines.push(
            `[场景对话设定文件] 本角色勾选 ${tplScenarioFileIds.length} 个场景与对话设定文件${names.length > 0 ? `（${names.join('、')}）` : ''}，完整场景/对话设定存于其中。文件中以「## 场景：地点或关键词」开头的条目是场景触发规则——对话进行到对应场景时系统会自动注入该条目，你无需主动翻找；未注入且确需时才自行查阅。${SETTING_FILE_USE_RULE}`
          )
        }

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
      // v16.4.1(审查修复): 章节协作块走 searchContext 管道（searchTokens 已含）——不重复单列
      ...(searchContext ? [{ domain: '知识库/网络搜索/章节协作', tokens: searchTokens }] : []),
      { domain: '对话历史', tokens: historyTokens },
      { domain: '当前消息', tokens: estimateTokens(msg) },
    ].filter(b => b.tokens > 0)

    return {
      systemMessages,
      searchContext,
      // v14.8: 本轮注入文件 id（runtime 持久化 + kb_search 排除）
      injectedKbFileIds: [...this.injectedFileIds],
      totalTokens: fullTotal,
      domains: breakdown.map(b => b.domain),
      breakdown,
    }
  }
}
