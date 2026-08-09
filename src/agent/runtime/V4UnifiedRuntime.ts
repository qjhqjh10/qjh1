// ── V4 Unified Runtime (v11.0) ──
// Claude-style: simple read→write loop. No phase machine, no hard blocks.
// Model has format knowledge embedded in system prompt → just work.

import { AgentEventEmitter } from './AgentEventEmitter'
import { ContextCompressor } from '../context/ContextCompressor'
import { ReadResultTracker } from '../context/ReadResultTracker'
// v11.3: skillRegistry removed
import { useAgentStore } from '../store/AgentStore'
import { diagnosticLogger } from '../diagnostics/DiagnosticLogger'
import { executeSingleTool, classifyToolCalls, WRITE_TOOLS, PARALLEL_READ_TOOLS, SERIAL_WRITE_TOOLS, SUBAGENT_WRITE_TOOLS } from './ToolExecutor'
import { isKnowledgeOnly, hasTaskKeywords } from '../utils/taskDetection'
import { extractTaskList, type TaskItem } from '../utils/taskExtraction'
import { SUBSEQUENT_TOOL_NAMES } from '../skills/tools/toolSearchTools'
import type {
  V4AgentConfig,
  V4AgentRunInput,
  V4AgentRunResult,
  ToolExecutorFn,
  ContextAssemblerFn,
  SubagentSummary,
} from './RuntimeTypes'
import type { ProtocolAdapter } from './adapters/ProtocolAdapter'
import type { Message } from '../state/types'

// v13.x: 超过 N 轮的 read_file 结果 → 保留摘要+前200字，可重读
const MAX_READ_RESULT_TURNS = 5

// ── v14 批处理: run 墙钟超时按迭代数动态估算 ──
// 每轮预算 60s；下限 5min（保底），上限 15min（防长任务 UI 锁定过久）。
// maxIterations 本身终止循环，此墙钟仅兜底"每轮都很快但总轮数拖死"之外的拖长场景；
// 中断由 taskProgress + [续跑] 机制恢复，宽松无害。
export function computeRunTimeoutMs(maxIterations: number): number {
  return Math.min(900_000, Math.max(300_000, maxIterations * 60_000))
}

// v14.3: 验收督促有界轮数（超过后放行——允许模型向用户汇报或继续修复，不卡死）
const MAX_VERIFY_FAIL_ROUNDS = 2
// v14.3: 子代理执行快照收集上限（防 run 内多次委托撑爆返回结果；UI 持久化还会再截 slice(-5)）
const MAX_SUBAGENT_SUMMARIES = 10

// ── v14.1.0: 任务清单完成检测正则 ──
// donePhrase: 原有完成声明（保留，仅作触发信号，验收依据是任务清单+工具证据）
// v14.9(审计): `任务完成` 加负向排除——"任务完成情况汇总"这类进度报告文本不再命中完成声明
const DONE_PHRASE_RE = /[Tt]ask\s*[Cc]omplete|全部完成|所有.*已完成|任务完成(?!情况|进度|汇报)|操作完毕|验证通过|最终.*完成|没有.*遗漏|都.*完成|已(?:经)?完成[了！。]?|完成了[！。]?|搞定[！。]?|已处理(?:完毕|完成)|上述.*完成|综上[^。！]*完成[。！]/
// 信任短语: 无 donePhrase 后缀约束的自然完成语（写过后 + 命中 → 接受）
const TRUST_DONE_RE = /(?:全部|都)?(?:做完了|搞定了|处理完了)/
// 清单模式严格全局完成声明: 锚定版——部分完成声明（"已完成N项"/"已完成3/6"）不命中。
// 原 donePhrase 的 `已(?:经)?完成` 是子串匹配，会误把部分声明当全局完成（"已完成1项，继续…"）
// v14.5.0: 删除 `完成[了！。]?$` 与 `搞定[了！。]?$` 两个裸尾部锚点——"第5项完成"/"任务2/3完成"
// 这类部分声明会命中，导致清单门控被确定性绕过；部分声明改由 PARTIAL_DONE_RE 在判定处排除。
// v14.9(审计): `任务完成` 加负向排除（同 DONE_PHRASE_RE）
const GLOBAL_DONE_RE = /[Tt]ask\s*[Cc]omplete|全部完成|所有.*已完成|任务完成(?!情况|进度|汇报)|操作完毕|验证通过|最终.*完成|没有.*遗漏|都.*完成|已处理(?:完毕|完成)|上述.*完成|综上[^。！]*完成[。！]|(?:做完了|处理完了)/
// v14.5.0: 部分进度声明检测（与 updateTaskProgressFromText 语义对齐）——
// "第N项(…12字内)完成" / "任务X/Y" / "已完成N/N" / "已完成N项"。
// 清单模式完成判定中，部分声明命中即排除全局声明（宁可多提示一轮，不漏放）。
// v14.6.1: 补汉字数字与 章/篇/部分/部 量词——"第2章都完成了""前三项都完成了"此前不命中
// PARTIAL（GLOBAL 的 `都.*完成` 命中 → 清单门控被确定性绕过，与 v14.5.0 修复的"部分声明"同族）
// v14.9(审计): 补"前N项"形态——"前三项都完成了""前面两步都完成了"（v14.6.1 只覆盖了 第N 形态）
const PARTIAL_DONE_RE = /第\s*(?:\d+|[一二三四五六七八九十百千两]+)\s*(?:项|个|步|件事?|章|篇|部分|部)\s*[^。！\n]{0,12}?(?:完成|搞定|做完|处理好)(?!情况|了[吗么]|没有)|前\s*(?:\d+|[一二三四五六七八九十百千两]+)\s*(?:项|个|步|件事?|章|篇|部分|部)\s*[^。！\n]{0,12}?(?:完成|搞定|做完|处理好)|任务\s*\d+\s*[\/／]\s*\d+|已(?:经)?完成\s*(?:\d+|[一二三四五六七八九十百千两]+)\s*(?:项|章|篇|部分)/
// v14.9(审计): 自愈出口的"合理拒绝"检测——必须带原因（为什么做不到），且仅在尝试 ≥8 轮后生效
const REFUSAL_RE = /无法(?:完成|继续|进行|做到|实现)|不能完成|做不到|不可完成|因为[^。！\n]{2,40}(?:失败|不存在|缺失|被删除|无权限|不支持)/
// v14.9(C3): 文件写工具子集——完成闸门"说完成但没写"只认文件写证据。
// 原 _hasWriteCall 含 http/browser/generate_image：模型只抓网页/生图后声明"完成"即可通过
// 闸门（铁律"口头描述≠操作完成"对文件任务打折）。网络类清单任务不经过该闸门（无文件关键词）。
const FILE_WRITE_TOOLS = new Set([
  'create_file', 'edit_file', 'batch_replace', 'delete_file', 'rename_file',
  'create_project', 'kb_append_file', 'kb_index_file', 'edit_file_task',
])
// 继续性文本: 模型还要继续行动的信号（刻意收窄，不含裸"然后"——
// 避免重演 v12.13.0 移除继续性检测时的"无限绕过 nudge 只读死锁"）
const CONTINUATION_RE = /接下来|下一步|下面|继续|我先|剩余|还有.{0,8}(?:任务|项|要做|需要做)/
// H1: 工具结果消息（role:'tool'）经 ContractExecutor 按契约过滤后只剩 status/summary/detail，
// 无 toolName 字段——从 assistant 消息的 tool_calls 建立 id → 工具名映射判断。
// 查不到映射（如历史被压缩/裁剪）时安全降级为不压缩。
// 职责边界（审查补充）: 生产 UI 路径（AIChatWindow.buildHistoryMessages）在送入 runtime 前
// 已把旧轮次替换为摘要且不保留 tool 消息，本函数对完整 tool 历史的调用方（集成测试/模拟/直接 setHistory）
// 才是主生效路径——作为防御层保留，主路径依赖 UI 侧摘要。
export function cleanOldReadResults(history: Message[]): Message[] {
  if (history.length === 0) return history

  const toolNameById = new Map<string, string>()
  for (const m of history) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<{ id?: string; name?: string; function?: { name?: string } }>) {
        // 双形状兼容: runtime 产 {type,id,function:{name}}, AnthropicAdapter 产 {id,name}
        const name = tc.function?.name ?? tc.name
        if (tc.id && name) toolNameById.set(tc.id, name)
      }
    }
  }

  // 从末尾向前数 user 消息（每轮一个 user）
  const userTurnIndices: number[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') userTurnIndices.push(i)
  }

  // 前 5 轮保持完整，更早的 read_file 结果压缩
  const keepFrom = userTurnIndices.length > MAX_READ_RESULT_TURNS
    ? userTurnIndices[MAX_READ_RESULT_TURNS - 1]
    : 0

  return history.map((m, i) => {
    if (i >= keepFrom) return m  // 最近 5 轮不动
    if (m.role !== 'tool') return m
    const toolName = m.tool_call_id ? toolNameById.get(m.tool_call_id) : undefined
    // v14.3: 纳入 analyze_file（子代理分析结果同样防旧轮占满上下文；verify_task 除外——
    // 其 detail 是紧凑 JSON，截 200 字破坏可读性）
    // v14.8: +kb_analyze（子代理知识库分析结果同为长 detail，旧轮纳入压缩）
    if (toolName !== 'read_file' && toolName !== 'analyze_file' && toolName !== 'kb_analyze') return m

    // 压缩: 保留概要信息+前200字，告知可重读
    let content = typeof m.content === 'string' ? m.content : ''
    try {
      const parsed = JSON.parse(content)
      const detail = parsed.detail || parsed.summary || ''
      const summary = parsed.summary || ''
      const preview = detail.length > 200 ? detail.slice(0, 200) + '…' : detail
      content = JSON.stringify({
        ...parsed,
        detail: `[历史轮次，完整内容已压缩。如需原文请 re-read。摘要: ${summary}]\n预览: ${preview}`,
      })
    } catch {
      const preview = content.length > 200 ? content.slice(0, 200) + '…' : content
      content = `[历史轮次，内容已压缩。如需原文请重新 read_file。预览: ${preview}]`
    }
    return { ...m, content }
  })
}

export class V4UnifiedRuntime {
  private config: V4AgentConfig
  private adapter: ProtocolAdapter
  private emitter = new AgentEventEmitter()
  private toolExecutor: ToolExecutorFn | null = null
  private contextAssembler: ContextAssemblerFn | null = null
  private tools: unknown[] = []        // 首轮全量，后续轮次核心子集
  private fullTools: unknown[] = []    // v13.2.0: 始终保存全量工具，用于 tool_search 等需要完整列表的场景
  private messagesForApi: Message[] = []
  private historyMessages: Message[] = []
  private toolsUsed: string[] = []
  private toolCallSteps: Array<{
    tool: string; status: string; summary: string
    durationMs: number; iteration: number
    arguments?: string
    matchedTools?: string[]  // v13.2.0: tool_search 返回的匹配工具名
  }> = []
  private compressor: ContextCompressor
  private lastCompressLength = 0
  private _nudgeCount = 0       // 自愈恢复轮次计数
  private _consecutiveFailures = 0  // v12.4.0: detect path failure loops
  private _consecutivePathErrors = 0  // v12.6.0: track path-specific errors separately
  private _fileWriteDone = false  // v14.9(C3): 文件写成功标记（跨轮累积，完成闸门证据）
  private _userMessage = ''
  private _userRequestedFileOp = false  // v4: 用户是否明确要求文件操作
  private _discoveredToolNames = new Set<string>()  // v13.2.0: tool_search 发现的工具名，动态加入后续轮次
  private taskList: TaskItem[] | null = null  // v14.1.0: 本次 run 提取的任务清单（null = 无清单）
  private taskDone: boolean[] = []            // v14.1.0: 与 taskList 等长的完成标记（单调置位）
  private _verifyHintInjected = false         // v14.2.1: 验收提示只注入一次（不强制）
  private subagentSummaries: SubagentSummary[] = []  // v14.3: 子代理执行快照收集（随 run 结果返回）
  private _verifyFailed = false               // v14.3: 最近一次验收判定未通过（完成声明闸门依据）
  private _verifyFailedRounds = 0             // v14.3: 验收未通过轮数（每轮至多 +1；超过 MAX_VERIFY_FAIL_ROUNDS 放行）
  private _cleanExit = false                  // v14.6.1: 正常收尾标记（完成/提问/纯聊天 break 前置位）——防"迭代触顶"误标 interrupted
  private _dupReadHintInjected = false        // v14.6.1: 重复读取提醒每 run 只注入一次（原每工具轮重复注入）
  private kbInjectedFileIds: string[] = []    // v14.8: 本轮 KB 预注入文件 id（execCtx → kb_search 排除 + run 结果跨 run 持久化）
  private readTracker: ReadResultTracker | null = null  // v15.6: read_file 去重层（per-run 生命周期，历史重建覆盖跨 run）

  constructor(config: V4AgentConfig, adapter: ProtocolAdapter) {
    this.config = config
    this.adapter = adapter
    // v15.3.1: 压缩配置可注入（主 agent 85% 深度 / 子 agent 75% 渐进）；不传用默认 0.7/0.8/0.9
    this.compressor = new ContextCompressor(config.contextWindow ?? 1_000_000, {  // v14.9: 默认 1M
      thresholds: config.compressConfig?.thresholds,
      deepAt: config.compressConfig?.deepAt,
    })
  }

  // ── Dependency Injection ──
  setToolExecutor(fn: ToolExecutorFn): void { this.toolExecutor = fn }
  setContextAssembler(fn: ContextAssemblerFn): void { this.contextAssembler = fn }
  setTools(tools: unknown[]): void { this.fullTools = tools; this.tools = tools }  // v13.2.0: 首轮全量
  setHistory(messages: Message[]): void { this.historyMessages = messages }
  setMaxIterations(n: number): void { this.config.maxIterations = n }
  /** v11.3: skill system removed — kept as no-op for backward compat */
  setActiveSkill(_skill: unknown): void { /* no-op */ }

  getEmitter(): AgentEventEmitter { return this.emitter }
  getMessagesForApi(): Message[] { return [...this.messagesForApi] }

  abort(): void { this.emitter.abort() }

  // ── v14.1.0: 任务清单状态辅助 ──

  private allTasksDone(): boolean {
    return this.taskDone.length > 0 && this.taskDone.every(Boolean)
  }

  private markAllDone(): void {
    this.taskDone = this.taskDone.map(() => true)
  }

  /** 单调置位: 置前 count 项为已完成（只把 false 置 true，永不回退） */
  private setTaskDoneCount(count: number): void {
    if (!this.taskList || count <= 0) return
    for (let i = 0; i < this.taskDone.length && i < count; i++) {
      this.taskDone[i] = true
    }
  }

  /** 从模型文本解析进度声明（"已完成 3/6" / "已完成 4 项" / "第 5 项完成" / "任务 2/3 完成"） */
  private updateTaskProgressFromText(text: string): void {
    if (!this.taskList) return
    // v14.6.1: "检查/确认/核实第N项完成情况"是请求核查而非完成声明——误置位会跳过剩余任务 nudge
    if (/(?:检查|确认|核实|查看|看看).{0,10}(?:第\s*\d+|任务)/.test(text)) return
    let m: RegExpMatchArray | null
    if ((m = text.match(/已(?:经)?完成\s*(\d+)\s*[\/／、和及~至\-—]+\s*(\d+)/))) {
      this.setTaskDoneCount(parseInt(m[1], 10))
    } else if ((m = text.match(/已(?:经)?完成\s*(\d+)\s*项/))) {
      this.setTaskDoneCount(parseInt(m[1], 10))
    } else if ((m = text.match(/第\s*(\d+)\s*(?:项|个|步|件事?)\s*(?:已(?:经)?|都)?(?:完成|搞定|做完|处理好)/))) {
      const n = parseInt(m[1], 10)
      if (n >= 1 && n <= this.taskDone.length) this.taskDone[n - 1] = true
    } else if ((m = text.match(/任务\s*(\d+)\s*[\/／]\s*(\d+)\s*(?:已)?完成/))) {
      // multi-task.md 汇报约定: "✅任务X/Y完成"
      const n = parseInt(m[1], 10)
      if (n >= 1 && n <= this.taskDone.length) this.taskDone[n - 1] = true
    }
  }

  /**
   * 替换式注入任务状态 system 消息（每轮调用，最新状态在末尾保护区：
   * summarizePairs 按 user 段整段删除时，旧副本被删但最新状态始终保留；同时避免旧副本累积）
   */
  private injectTaskStatus(): void {
    if (!this.taskList) return
    // 替换式去重: 从末尾向前删除旧的 [当前任务] 消息
    for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
      const msg = this.messagesForApi[i]
      if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.startsWith('[当前任务]')) {
        this.messagesForApi.splice(i, 1)
      }
    }
    const doneCount = this.taskDone.filter(Boolean).length
    const remaining = this.taskList
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !this.taskDone[i])
      .map(({ t }) => `${t.id})${t.desc.slice(0, 60)}`)
      .join('; ')
    const status = remaining.length > 0
      ? `[当前任务] 进度 ${doneCount}/${this.taskList.length}。剩余: ${remaining}`
      : `[当前任务] 进度 ${doneCount}/${this.taskList.length}。全部完成。`
    this.messagesForApi.push({ role: 'system', content: status })
  }

  /**
   * v14.9(审计): nudge/自愈前回写模型本轮文本——原文本轮不 push assistant 消息，
   * nudge 循环中模型看不到自己说过什么 → 重复道歉 + 上下文被连续 user nudge 撑大（token 浪费）。
   * 工具轮已有回写（assistant tool_calls），这里只覆盖纯文本轮。
   */
  private pushRoundText(text: string): void {
    if (text.trim()) this.messagesForApi.push({ role: 'assistant', content: text })
  }

  /**
   * v14.9(审计): 同轮同名工具多次调用时按出现次序匹配 step——原 find 恒取第一条：
   * 先败后成被计为"本轮全失败"（_consecutiveFailures 虚增，可能提前触发 8 轮强停）。
   * 注：并行只读工具按完成顺序入栈，次序匹配是近似（优于恒取第一条的错误归因）。
   */
  private findStepForCall(toolName: string, iteration: number, callIndex: number) {
    let seen = 0
    for (const s of this.toolCallSteps) {
      if (s.tool === toolName && s.iteration === iteration) {
        if (seen === callIndex) return s
        seen++
      }
    }
    return undefined
  }

  // v14.5.0: 渐进披露按 adapter capabilities 门控 + 动态发现每轮生效。
  // 双协议（OpenAI/Anthropic，progressiveDisclosure=true）→ 安全收窄：核心15 + 已发现 +
  // 已用过的工具（toolsUsed 保留——历史 tool_use 始终有 schema，防 400）；
  // 子代理（isolatedStore）→ 恒全量（角色工具集 ≤7，收窄会误裁角色专属工具）。
  private refreshToolSet(): void {
    if (!this.adapter.capabilities?.progressiveDisclosure) return
    // v14.5.0: 子代理恒全量——角色工具集本就 ≤7（analyze/edit/verify 各 5-7 个），
    // 收窄收益小、且角色专属工具（如 analyze_text_style）不在核心 15 内会被误裁
    if (this.config.isolatedStore) return
    // v14.5.0 审查修复: 历史消息（含跨 run 注入的 buildHistoryMessages）中出现的 tool_use
    // 一并保留——收窄后其 schema 仍在请求 tools 中，严格 Anthropic 端点也不 400
    const historicTools = new Set<string>()
    for (const m of this.messagesForApi) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls as Array<{ function?: { name?: string }; name?: string }>) {
          const n = tc.function?.name ?? tc.name
          if (n) historicTools.add(n)
        }
      }
    }
    this.tools = (this.fullTools as any[]).filter((t: any) => {
      const name = t.function?.name || ''
      return SUBSEQUENT_TOOL_NAMES.has(name)
        || this._discoveredToolNames.has(name)
        || this.toolsUsed.includes(name)
        || historicTools.has(name)
    })
  }

  // ── Run ──

  async run(input: V4AgentRunInput): Promise<V4AgentRunResult> {
    // v15: 子 agent 无头运行 — 不触碰共享 store（隔离 UI 状态与熔断器）
    const isolated = !!this.config.isolatedStore
    const store = isolated ? null : useAgentStore.getState()
    const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const runStartTime = Date.now()
    // v14.6.1: 工具开关 — 关闭时本轮 tools 传空（模型只能纯文本对话）
    if (input.toolsEnabled === false) {
      this.tools = []
    } else if (this.tools.length === 0 && this.fullTools.length > 0) {
      // 上一轮关闭开关后恢复开启 → 恢复全量工具
      this.tools = this.fullTools
    }

    if (this.config.maxIterations < 1) {
      this.config.maxIterations = 30
    }
    // v14 批处理: RUN_TIMEOUT 按 maxIterations 动态估算（每轮 60s 预算），替代 5 分钟硬墙——
    // 批量任务（30 轮）从 5min 提到 15min 封顶；子代理（10 轮）10min；4 轮以内保持 5min 下限。
    // 轮间墙钟兜底 + maxIterations 终止循环 + [续跑] 中断恢复，宽松无害。
    const RUN_TIMEOUT = computeRunTimeoutMs(this.config.maxIterations)
    if (!this.toolExecutor) {
      return {
        success: false, text: '工具执行器未配置',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR', toolsUsed: [], toolCallSteps: [], iterationCount: 0,
        cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0,
      }
    }

    // 熔断器（isolated 子 agent 视为允许——其失败只影响当次任务，父 agent 自身仍在熔断保护内）
    const circuitCheck = store ? store.checkCircuit() : { allowed: true }
    if (!circuitCheck.allowed) {
      return {
        success: false, text: circuitCheck.reason || '服务暂时不可用',
        toolCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
        phase: 'ERROR', toolsUsed: [], toolCallSteps: [], iterationCount: 0,
        cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0,
      }
    }

    store?.startRun(runId)
    store?.setPhase('EXECUTE')

    // ── ① Assemble context ──
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalCacheHitTokens = 0  // v11.5.1: track cache read hits
    let totalCacheCreationTokens = 0  // v11.7.0: track cache creation (still charged)
    let totalCost = 0            // v11.5.1: track cost
    // v16: API 逐轮明细（分析用）——每次调用记 input/output/cache_read/cache_creation/耗时/工具轮
    const apiCallDetails: NonNullable<V4AgentRunResult['apiCallDetails']> = []
    let toolCallsCount = 0
    let collectedText = ''
    let collectedReasoning = ''  // v14.6.1: 本轮推理链累计（UI 思考过程面板数据源）
    this.toolsUsed = []
    this.toolCallSteps = []
    this._nudgeCount = 0      // reset per run
    this._verifyHintInjected = false  // v14.2.1: reset per run
    this.subagentSummaries = []  // v14.3: reset per run
    this._verifyFailed = false   // v14.3: reset per run
    this._verifyFailedRounds = 0 // v14.3: reset per run
    this._cleanExit = false      // v14.6.1: reset per run
    this._dupReadHintInjected = false  // v14.6.1: reset per run
    this._discoveredToolNames = new Set()  // v13.2.0: reset per run
    this._consecutiveFailures = 0
    this._consecutivePathErrors = 0
    this._fileWriteDone = false  // v14.9(C3): reset per run
    this._userMessage = input.userMessage
    // v12.14.0: 统一使用 hasTaskKeywords 判断文件操作意图
    this._userRequestedFileOp = hasTaskKeywords(input.userMessage)
    // v14.9(审计): 续跑场景强制视为文件操作——"继续"消息不含任务关键词 → _userRequestedFileOp=false
    // 会使"说完成但没写"闸门（完成判定处）失效：模型口头声明进度即可 cleanExit，剩余任务被静默丢弃
    if (input.resumeTaskProgress && !input.resumeTaskProgress.allDone) this._userRequestedFileOp = true
    // v14.1.0: 提取任务清单（null = 单任务/聊天/提取失败 → 走原逻辑）
    // v14.5.0: 续跑时新消息可能不含编号（如"继续"）→ 从 resumeTaskProgress 快照恢复清单与进度，
    // 使清单门控（未清空不接受完成）与进度注入在续跑场景保持正确语义
    this.taskList = extractTaskList(input.userMessage)
    const resumeSnapshot = input.resumeTaskProgress && !input.resumeTaskProgress.allDone ? input.resumeTaskProgress : undefined
    const restoredFromSnapshot = !this.taskList && !!resumeSnapshot
    if (restoredFromSnapshot) {
      this.taskList = resumeSnapshot.tasks.map(t => ({ id: t.id, desc: t.desc }))
    }
    // v14.9(审计): taskDone 仅当清单确实来自快照时才按快照置位——新消息自带新编号清单时
    // 按 index 对齐旧快照会错位（旧"1)写A✓"误标到新"1)改X"）
    this.taskDone = restoredFromSnapshot && this.taskList
      ? this.taskList.map((_, i) => !!resumeSnapshot?.tasks[i]?.done)
      : (this.taskList ? this.taskList.map(() => false) : [])
    // v14.2.0: 跨 run 续跑 — 记录是否"中断未完成"（abort/超时/API失败/迭代耗尽）
    // v14.3.1: 无任务清单时也会置位（truncated 标记无论有无清单都返回）
    let interrupted = false
    let _hasWriteCall = false
    // v15: 子 agent 委托用量累加器（analyze_file/edit_file_task 上报）
    const subUsageAccum = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheCreationTokens: 0, cost: 0, calls: 0 }

    // v12.5.1: 阶段感知温度 — 初始为创作阶段
    let isExecutionPhase = false

    const contextResult = this.contextAssembler
      ? await this.contextAssembler(input.userMessage, this.historyMessages, this.config.projectId)
      : { systemMessages: [] as Array<{ role: 'system'; content: string }>, totalTokens: 0, domains: [] as string[], breakdown: [] as Array<{ domain: string; tokens: number }> }

    // v14.8: 本轮 KB 预注入文件 id（子 agent isolatedStore 无 contextAssembler → 空数组，天然无排除）
    this.kbInjectedFileIds = contextResult.injectedKbFileIds || []

    // v13.x: 清除超过 5 轮的 read_file 结果 → 旧文件内容不再占用上下文
    const cleanedHistory = cleanOldReadResults(this.historyMessages)

    // v15.6: read_file 去重层 — per-run 新建，从"模型实际可见的历史"重建（覆盖跨 run 场景；
    // 5 轮外已被折叠的 read 结果重建不到 → 重读全文是合理行为）。run 结束即弃，
    // GUI 手动编辑发生在 run 之间 → 与去重记录天然无冲突。
    this.readTracker = ReadResultTracker.rebuildFromHistory(cleanedHistory)

    // v13.x: 搜索上下文注入 user message（保持 system 前缀稳定 → 缓存命中）
    const userContent = contextResult.searchContext
      ? `[参考信息]\n${contextResult.searchContext}\n\n[用户消息]\n${input.userMessage}`
      : input.userMessage

    // v14.6.1: 续跑场景不注入 [任务边界]——UI 已注入 "[续跑] 请直接继续完成剩余任务"，
    // 两条指令语义相反（边界说"不要继续"，续跑说"继续"），同场会互相抵消且可能让模型放弃续跑。
    // v14.6.1: [续跑] 现为 user role 注入（Anthropic 顶层 system 远端问题），按内容前缀检测
    const hasResumeHint = cleanedHistory.some(m =>
      typeof m.content === 'string' && m.content.startsWith('[续跑]'))
    this.messagesForApi = [
      ...contextResult.systemMessages,
      ...cleanedHistory,
      ...(cleanedHistory.length > 0 && !hasResumeHint
        ? [{ role: 'system' as const, content: '[任务边界] 以上是之前的对话历史，下面是用户的新请求。你可以参考历史中的信息（如已读取的文件内容、已创建的角色设定），但不要自动继续之前未完成的工具操作——只响应当前的新请求。' }]
        : []),
      { role: 'user', content: userContent },
    ]

    // v14.9(审计): run 起始清理历史中的孤儿 tool_use（旧版本持久化数据可能携带无对应 tool 结果
    // 的 tool_calls）——原只在 abort/超时分支清理，起始不清理 → Anthropic 严格端点 400 风险

    // ── ② Main loop ──
    let iteration = 0

    // v13.x: 清理不完整的 assistant 消息（有 tool_calls 但缺 tool_result），
    // 顺带删除其孤儿 tool 结果（否则 API 因 tool 消息无对应 tool_use 报错）
    const removeIncompleteToolTurn = () => {
      for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
        const m = this.messagesForApi[i]
        if (m.role === 'assistant' && m.tool_calls && (m.tool_calls as unknown[]).length > 0) {
          const callIds = new Set((m.tool_calls as Array<{ id: string }>).map(tc => tc.id))
          this.messagesForApi.splice(i, 1)
          for (let j = this.messagesForApi.length - 1; j >= 0; j--) {
            const tm = this.messagesForApi[j]
            if (tm.role === 'tool' && tm.tool_call_id && callIds.has(tm.tool_call_id)) {
              this.messagesForApi.splice(j, 1)
            }
          }
          break
        }
      }
    }

    // v14.9(审计): 历史孤儿 tool_use 起始清理——原只在 abort/超时分支执行，起始不清理 →
    // 旧持久化数据（assistant 带 tool_calls 但无对应 tool 结果）会 400。必须在 removeIncompleteToolTurn
    // 定义之后调用（const TDZ）。
    removeIncompleteToolTurn()

    while (iteration < this.config.maxIterations) {
      if (this.config.abortSignal.aborted) {
        interrupted = true  // v14.2.0: 用户中止 → 标记中断未完成（供跨 run 续跑）
        removeIncompleteToolTurn()  // abort 同样清理（V1 遗漏，v2 补上）
        break
      }
      if (Date.now() - runStartTime > RUN_TIMEOUT) {
        interrupted = true  // v14.2.0: 超时中断 → 可续跑
        collectedText = collectedText || '运行超时'
        removeIncompleteToolTurn()
        break
      }

      iteration++
      store?.setIteration(iteration)
      this.emitter.emit('thinking:start', {
        intent: `第 ${iteration} 轮`, steps: [], filesNeeded: [], estimatedTokens: 0, timestamp: Date.now(),
      })

      // v13.2.0: 渐进披露 — 首轮全量，后续核心15 + tool_search动态发现的工具
      // v14.5.0: 按 adapter capabilities 门控（Anthropic 安全收窄/子代理恒全量），并纳入已用过的工具名
      if (iteration === 2) {
        this.refreshToolSet()
      }

      // ── Context Compression ──
      const estimatedTokens = this.compressor.estimateMessages(this.messagesForApi)
      if (this.compressor.needsCompression(estimatedTokens)) {
        const newSinceCompress = this.lastCompressLength > 0
          ? this.messagesForApi.length - this.lastCompressLength : 0
        // v15.3.1: 达到深度压缩阈值（主 agent 85%）→ 链式一次到底（Claude Code 式回退 ~15%）；
        // 否则渐进三阶段。v14 批处理: 第 4 参保护最近 2 轮 tool detail（strip_detail 阶段不截断）
        this.messagesForApi = this.compressor.shouldDeepCompress(estimatedTokens)
          ? this.compressor.compressDeep(this.messagesForApi, estimatedTokens, Math.max(5, newSinceCompress), 2)
          : this.compressor.compress(this.messagesForApi, estimatedTokens, Math.max(5, newSinceCompress), 2)
        this.lastCompressLength = this.messagesForApi.length
      }

      // ── 读操作计数：连续 N 次读取无写入时注入提醒 ──
      // v13.x: 写工具集合统一引用 ToolExecutor.WRITE_TOOLS（单一来源，含网络/图片工具）
      const READ_TOOLS_RE = /^(read_file|list_directory|search_content|find_files)$/
      let consecutiveReads = 0
      let hasWritten = false
      for (let s = this.toolCallSteps.length - 1; s >= 0; s--) {
        const step = this.toolCallSteps[s]
        if (WRITE_TOOLS.has(step.tool)) { hasWritten = true; break }
        if (READ_TOOLS_RE.test(step.tool)) consecutiveReads++
        else break  // non-read, non-write tool → stop counting
      }
      // v14.3.1: 阈值放宽（3→5 / 5→8）——写作任务合法需要读多个文件（大纲/细纲/角色/前章）才动笔，
      // 原 3 次即催写会在多文件探索中途打断；仍保留兜底防"只读不写"死循环
      const readNudge8 = `[系统提醒] 已连续读取 ${consecutiveReads} 次。项目结构是标准模板——outline/有8个tab, characters/存角色YAML, summaries/存摘要, chapters/存正文。不要再探索，直接基于你的知识写入内容。先有再改。`
      const readNudge5 = `[系统提醒] 已读取 ${consecutiveReads} 次。信息应该足够了——项目结构是标准模板。现在开始写入，不要再读了。`
      // v13.x: 按 content 去重——压缩可能移动 system 消息位置，不能按位置判断
      // v14.5.0: 文案内嵌 consecutiveReads 数字导致精确匹配恒失败 → 改为前缀匹配
      const hasReadNudge = (prefix: string) => this.messagesForApi.some(
        m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(prefix),
      )
      if (!hasWritten && consecutiveReads >= 8 && this._userRequestedFileOp && !hasReadNudge('[系统提醒] 已连续读取')) {
        this.messagesForApi.push({ role: 'system', content: readNudge8 })
      } else if (!hasWritten && consecutiveReads >= 5 && this._userRequestedFileOp
        && !hasReadNudge('[系统提醒] 已读取') && !hasReadNudge('[系统提醒] 已连续读取')) {
        // v14.9(审计): 已注入 8 次提醒的轮次后不再补注 5 次提醒（两前缀互不覆盖 → 双重提醒）
        this.messagesForApi.push({ role: 'system', content: readNudge5 })
      }

      // v14.1.0: 每轮注入任务状态（替换式，模型随时知道还剩什么任务）
      this.injectTaskStatus()

      // ── API Call (with single retry for transient failures) ──
      const API_TIMEOUT = 180_000  // v12.16.4: 大型上下文需要更多响应时间
      let response = undefined
      let lastApiErr: Error | null = null

      if (!isolated) diagnosticLogger.recordApiCallStart()

      // v12.5.1: 阶段感知温度
      // 创作轮: 用户设定的创作温度 (默认 1.0)
      // 执行轮: min(创作温度, 工具执行温度上限 (默认 0.5))
      const creativeTemp = this.config.temperature ?? 1.0
      const toolCap = this.config.toolTemperature ?? 0.5
      const effectiveTemperature = isExecutionPhase
        ? Math.min(creativeTemp, toolCap)
        : creativeTemp

      // v16: 逐轮明细——本次迭代的调用起始时间（retry 循环外声明，成功/失败共用；
      // 重试更新，最终记录以最后一次尝试为准）
      let callStartMs = Date.now()
      for (let retry = 0; retry <= 1; retry++) {
        if (this.config.abortSignal.aborted) break
        // v14.5.1: 每次调用独立 AbortController——超时或用户中止时真正取消底层流。
        // 原实现 timeoutPromise 只 reject，在途流无人取消 → 超时后重试产生双请求双计费。
        // 现在超时 → controller.abort() → 适配器 abortStream() → 流以 aborted 结束 → 中断可续跑，无重试。
        const callController = new AbortController()
        const onAbort = () => callController.abort()
        this.config.abortSignal.addEventListener('abort', onAbort, { once: true })
        const timeoutId = setTimeout(() => callController.abort(), API_TIMEOUT)
        callStartMs = Date.now()
        try {
          response = await this.adapter.callModel({
            messages: this.messagesForApi,
            tools: this.tools,
            configId: this.config.configId,
            projectId: this.config.projectId || undefined,
            signal: callController.signal,
            temperature: effectiveTemperature,
          })
          clearTimeout(timeoutId)
          this.config.abortSignal.removeEventListener('abort', onAbort)
          break
        } catch (apiErr) {
          clearTimeout(timeoutId)
          this.config.abortSignal.removeEventListener('abort', onAbort)
          lastApiErr = apiErr instanceof Error ? apiErr : new Error('API 调用失败')
          const isTransient = /超时|timeout|network|ECONNREFUSED|ETIMEDOUT|429|503|502/.test(lastApiErr.message)
          if (retry < 1 && isTransient) {
            await new Promise(r => setTimeout(r, 2000 * (retry + 1)))
            continue
          }
          break
        }
      }

      if (!response) {
        interrupted = true  // v14.2.0: API 失败中断 → 可续跑
        collectedText = `错误: ${lastApiErr?.message || 'API 调用失败'}`
        store?.recordApiFailure()
        // v14.9(接线): 反馈横幅——API 错误事件（UI 顶部横幅数据源）
        this.emitter.emit('hook:blocked', {
          hookName: 'API 错误',
          feedback: (lastApiErr?.message || 'API 调用失败').slice(0, 200),
          timestamp: Date.now(),
        })
        break
      }

      store?.recordApiSuccess()
      totalPromptTokens += response.usage.inputTokens
      totalCompletionTokens += response.usage.outputTokens
      totalCacheHitTokens += response.usage.cacheHitTokens || 0
      totalCacheCreationTokens += (response.usage as any).cacheCreationTokens || 0
      totalCost += response.usage.cost || 0
      // v16: 逐轮明细——每次成功调用记一条（缓存命中率/耗时/工具轮从原始数据可算）
      apiCallDetails.push({
        iteration,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadTokens: response.usage.cacheHitTokens || 0,
        cacheCreationTokens: (response.usage as any).cacheCreationTokens || 0,
        durationMs: Math.max(0, Date.now() - callStartMs),
        toolCall: response.toolCalls.length > 0,
        model: this.config.model || '',
        finishReason: response.finishReason || 'end_turn',
      })
      // Token 累计由 UI 层（AIChatWindow）统一管理，避免双重计数
      if (!isolated) diagnosticLogger.recordApiCallEnd(response.usage.totalTokens, response.toolCalls.length > 0)
      // v14 批处理: 审计接线 — 会话统计（readSessionStats）由此获得 api:call 的 cost/model
      this.config.auditTrail?.recordApiCall(response.usage.inputTokens, response.usage.outputTokens,
        { cost: response.usage.cost || 0, model: this.config.model })

      // ── finishReason: truncated → 标记（处理下移到对应分支：回写部分输出 + 强制继续）──
      // v14.3.1: 修复两个缺陷：① 截断文本此前不进上下文 → 续写时模型看不到自己写了什么，导致分叉/重复；
      // ② 截断尾部若含"完成"字样会命中完成检测 → 残缺内容被当作正常收尾。
      const wasTruncated = response.finishReason === 'max_tokens' || response.finishReason === 'length'

      // v14.5.0: 用户点击"停止生成"（OpenAI: IPC aborted:true；Anthropic: stopReason='aborted'）→
      // 标记中断退出，不再走空响应兜底（原行为：注入"请用中文直接生成文本回复"垃圾消息，
      // UI 显示"AI 未生成回复（可能 API 超时）"误导文案）
      if (response.aborted) {
        interrupted = true
        if (response.text && response.text.trim()) {
          this.messagesForApi.push({ role: 'assistant', content: response.text })
        }
        break
      }

      // ── No tool calls → model is speaking. Trust what it says. ──
      if (response.toolCalls.length === 0) {
        isExecutionPhase = false  // v12.5.1: 回到创作阶段
        collectedText = response.text || ''

        // v14.3.1: 输出截断 → 把部分输出回写为 assistant 消息（模型续写时可见已写内容，从断点继续），
        // 并跳过完成检测强制继续（截断尾部可能含"完成"字样，不能作为收尾依据）
        if (wasTruncated) {
          if (!isolated) diagnosticLogger.recordInfo(`输出截断: ${response.finishReason}`)
          if (collectedText.trim()) {
            this.messagesForApi.push({ role: 'assistant', content: collectedText })
          }
          this.messagesForApi.push({ role: 'user', content: '[系统] 上一轮输出因token限制被截断。请从上次断点继续完成，不要重新开始。' })
          continue
        }

        // H5: Empty response fallback
        // v14.5.0: 角色动态选择——Anthropic 协议要求消息角色交替，前一条是 user 时兜底改为 assistant
        if (!collectedText.trim()) {
          const last = this.messagesForApi[this.messagesForApi.length - 1]
          this.messagesForApi.push({
            role: last?.role === 'user' ? 'assistant' : 'user',
            content: '请用中文直接生成文本回复。',
          })
          continue
        }

        // ── Done detection (v11.5.1 ~ v14.1.0: 完成判定) ──
        // v12.16.2: 必须实际执行了写工具才接受"完成"声明
        // v14.1.0: 有任务清单时完成判定对照清单（未清空绝不接受）；无清单保留原正则逻辑
        const completionDeclared = DONE_PHRASE_RE.test(collectedText) || TRUST_DONE_RE.test(collectedText)

        // ── v14.3: 验收失败督促闸门（有界：最多注入 MAX_VERIFY_FAIL_ROUNDS 次督促后放行）──
        // 防"验收未通过却被'完成'声明放行"：产物不合格时强制修复→复验闭环。
        // 问句不拦截（"全部完成了吗？"含"全部完成"子串）；无验收失败时 _verifyFailed 恒 false，零干扰。
        // _verifyFailedRounds 在每次注入督促时 +1（每轮完成检测至多一次）→ 有界，不卡死。
        if (completionDeclared && this._verifyFailed && this._verifyFailedRounds < MAX_VERIFY_FAIL_ROUNDS
            && !/[？?]/.test(collectedText)) {
          this._verifyFailedRounds++
          this.messagesForApi.push({
            role: 'user',
            content: `[验收督促] 验收子代理判定产物未通过验收（第 ${this._verifyFailedRounds} 次督促）。请用 edit_file_task 修复未满足项（详见上文验收结果），然后再次调用 verify_task 验收；验收通过后才能声明完成。`,
          })
          continue
        }

        // ── ① 有任务清单: 完成判定对照清单（现象B修复: "完成 4/6 就停"不再被接受）──
        if (this.taskList) {
          this.updateTaskProgressFromText(collectedText)
          // 严格全局完成声明 + 写过文件 → 信任全局完成（部分声明"已完成N项"不触发）
          // v14.5.0: PARTIAL_DONE_RE 排除"第N项完成/任务X/Y完成"等部分声明形态
          if (GLOBAL_DONE_RE.test(collectedText) && !PARTIAL_DONE_RE.test(collectedText) && _hasWriteCall) this.markAllDone()
          if (this.allTasksDone()) {
            // 说了"完成"但没写 → 不通过，进入自愈恢复（v14.9(C3): 证据 = 文件写成功，非"尝试过"）
            if (this._userRequestedFileOp && !this._fileWriteDone) {
              this.pushRoundText(collectedText)
              this.messagesForApi.push({
                role: 'user',
                content: '你说"完成"了，但工具调用记录显示没有实际写入任何文件。任务未完成——请用 create_file / edit_file / batch_replace 实际执行写入。',
              })
              continue
            }
            // v14.2.1: 验收提示（功能 3）— 清单完成且写过文件时注入一次（不强制）：
            // 建议用 verify_task（只读子代理）对照验收标准逐项核对产物；模型可拒绝直接收尾。
            // 提示后模型再答"完成" → _verifyHintInjected=true → 直接 break，不会死循环。
            if (!this._verifyHintInjected && _hasWriteCall) {
              this._verifyHintInjected = true
              this.messagesForApi.push({
                role: 'system',
                content: '[验收提示] 任务清单已全部完成。若产物文件较多或验收标准明确，建议调用 verify_task（只读子代理，不占你的上下文）对照标准逐项验收产物质量；如无必要可直接回复完成。',
              })
              continue
            }
            // v14.9(接线): 续跑完成反馈横幅（绿色 ✓）
            if (restoredFromSnapshot && _hasWriteCall) {
              this.emitter.emit('hook:passed', {
                hookName: '续跑',
                passed: true,
                feedback: '中断任务已全部完成',
                timestamp: Date.now(),
              })
            }
            this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问），迭代触顶不再误标 interrupted
            this.emitter.emit('response:streaming', {
              text: collectedText, accumulated: collectedText, timestamp: Date.now(),
            })
            break
          }
          // 向用户提问 → 不干预（等用户回答），防止"要继续吗？"被 nudge 死循环
          if (/[？?]/.test(collectedText)) {
            this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问），迭代触顶不再误标 interrupted
            this.emitter.emit('response:streaming', {
              text: collectedText, accumulated: collectedText, timestamp: Date.now(),
            })
            break
          }
          // 未全部完成 → 注入剩余任务 nudge，继续
          this.pushRoundText(collectedText)
          this._nudgeCount++
          const remainingItems = this.taskList
            .map((t, i) => ({ t, i }))
            .filter(({ i }) => !this.taskDone[i])
            .map(({ t }) => `${t.id})${t.desc.slice(0, 60)}`)
            .join('; ')
          this.messagesForApi.push({
            role: 'user',
            content: `任务尚未全部完成：还有 ${remainingItems ? remainingItems.split('; ').length : 0} 项未完成（${remainingItems}）。请继续调用工具完成剩余任务，不要停下。全部完成后再说"全部完成"。`,
          })
          continue
        }

        // ── ② 无任务清单: 原有 donePhrase 完成检测（保留）──
        // v14.5.1: 声明"完成"但同时有继续性文本（"已完成第1章，接下来写第2章"）→ 非收尾，
        // 落入下方③继续性检测（v14.1.0 只修了清单模式，无清单路径原会提前 break 丢失剩余工作）
        // v14.9(C3): 证据 = 文件写成功（原 _hasWriteCall 网络写也放行）
        if (completionDeclared && !CONTINUATION_RE.test(collectedText) && (this._fileWriteDone || !this._userRequestedFileOp)) {
          this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问/纯聊天），迭代触顶不再误标 interrupted
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }
        // 说了"完成"但没写 → 不通过，进入自愈恢复（v14.9(C3): 证据 = 文件写成功）
        if (completionDeclared && this._userRequestedFileOp && !this._fileWriteDone) {
          this.pushRoundText(collectedText)
          this.messagesForApi.push({
            role: 'user',
            content: '你说"完成"了，但工具调用记录显示没有实际写入任何文件。任务未完成——请用 create_file / edit_file / batch_replace 实际执行写入。',
          })
          continue
        }

        // ── 分支1B: 分析/讨论型请求（非文件操作）→ 模型已读文件并输出文本 = 分析完成，接受 ──
        // v14.1.1: 修复"检查第3章/看看大纲"类请求读完文件输出短分析被自愈阶梯误 nudge 的问题
        //（旧逻辑仅长文本(>200字)会被接受，短分析会进入"未完成"nudge 循环）
        if (!this._userRequestedFileOp && this.toolsUsed.length > 0 && !_hasWriteCall) {
          this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问/纯聊天），迭代触顶不再误标 interrupted
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // ── No tools used → 模型自己选择不调工具 ──
        // v12.16.3: 用户要求了文件操作 → 不能接受"不用工具"，推入自愈恢复
        // 之前这里直接 break，导致模型说"全部完成"但没调任何工具也被接受
        if (this.toolsUsed.length === 0 && !this._userRequestedFileOp) {
          // 纯聊天 → 接受模型的选择
          this._cleanExit = true  // v14.6.1: 正常收尾
          break
        }
        if (this.toolsUsed.length === 0 && this._userRequestedFileOp) {
          // 用户要求了文件操作但模型完全没调工具 → 推入自愈恢复
          this.pushRoundText(collectedText)
          this.messagesForApi.push({
            role: 'user',
            content: `用户要求了文件操作：「${this._userMessage.slice(0, 200)}」。你必须调用 create_file 或 edit_file 实际执行。不要只输出文字描述——真的去创建或修改文件。`,
          })
          this._nudgeCount++
          continue
        }

        // ── v14.9(审计): 自愈出口——尝试 ≥8 轮后模型明确说明"无法完成"（带原因）→ 接受收尾。
        // 原无出口：客观不可完成的任务（依赖文件被删等）解释性文本被下方长文本闸门无限 nudge
        // 至迭代触顶（30 轮 token 全烧 + truncated 标记让用户反复续跑同一失败任务）。
        if (this._nudgeCount >= 8 && this._userRequestedFileOp && !this._fileWriteDone
            && collectedText.length > 50 && REFUSAL_RE.test(collectedText)) {
          this.emitter.emit('hook:blocked', {
            hookName: '任务困难',
            feedback: '多轮尝试后模型判定任务无法完成（已向用户说明原因）',
            timestamp: Date.now(),
          })
          this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问/纯聊天），迭代触顶不再误标 interrupted
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // ── Model used tools, now speaking text ──

        // v14.9(审计): 删除原 toolsUsed 置位——"尝试过写工具"（无论成败）也算已写，会撤销工具轮
        // 末尾的成功门控：edit_file 失败后下一轮长文本被当作"写过后收尾"直接 break（幻觉完成漏放）。
        // _hasWriteCall 只在工具轮末尾按实际成功置位（见 writeCalls 处理）。

        // ── v12.16.0: 自愈恢复系统（替换梯度 Nudge）──
        // 思路: 不催促"快做！"，而是帮助模型分析问题、找到解决方案。
        // 模型按 System Prompt 的"操作失败处理"自我恢复 → Runtime 只在必要时提供诊断。
        if (collectedText.length > 200) {
          // 长文本回复 → 如果用户要求的文件操作还没做，不接受（v14.9(C3): 证据 = 文件写成功）
          if (this._userRequestedFileOp && !this._fileWriteDone) {
            this.pushRoundText(collectedText)
            this.messagesForApi.push({
              role: 'user',
              content: `你输出了长文本，但用户要求的文件操作还没有执行。请调用 create_file 或 edit_file 实际写入内容。不要只描述你会做什么——真的去做。`,
            })
            this._nudgeCount++
            continue
          }
          // v14.1.0: 写过后长文本不再直接 break——落入下方③继续性检测判断
          // 非文件操作的长文本（分析/讨论）→ 收尾接受（保持原行为）
          if (!this._userRequestedFileOp) {
            this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问），迭代触顶不再误标 interrupted
            this.emitter.emit('response:streaming', {
              text: collectedText, accumulated: collectedText, timestamp: Date.now(),
            })
            break
          }
        }

        // ── ③ v14.1.0: 写过后 → 继续性文本检测（替代旧的 `if (_hasWriteCall) break`）──
        // 现象A/B修复: 模型写完一部分后说"继续/接下来…" → 不结束，督促其执行剩余工作
        // v14.9(C3): 判定用文件写证据（原含网络/生图写——文件任务只抓了网页也被当"已写"收尾）
        if (this._fileWriteDone) {
          // 向用户提问 → 不干预（等用户回答）
          if (/[？?]/.test(collectedText)) {
            this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问），迭代触顶不再误标 interrupted
            this.emitter.emit('response:streaming', {
              text: collectedText, accumulated: collectedText, timestamp: Date.now(),
            })
            break
          }
          if (CONTINUATION_RE.test(collectedText) && (this._userRequestedFileOp || !!this.taskList)) {
            this._nudgeCount++
            const continuationNudge = this._nudgeCount >= 5
              ? `已尝试 ${this._nudgeCount} 轮。你提到了继续/接下来，但本轮没有调用工具。请直接调用工具执行剩余工作；若已全部完成，请明确说"全部完成"。`
              : `你提到"继续/接下来/下一步"，但本轮没有调用任何工具。剩余工作请直接调用 create_file / edit_file 执行，不要只输出文字描述。若已全部完成，请明确说"全部完成"。`
            this.pushRoundText(collectedText)
            this.messagesForApi.push({ role: 'user', content: continuationNudge })
            continue
          }
          // 写过后普通文本 = 收尾 → 接受（与旧 `if (_hasWriteCall) break` 行为等价）
          this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问/纯聊天），迭代触顶不再误标 interrupted
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        // ── 以下: 用户要求了文件操作，但模型还没写 ──
        this._nudgeCount++

        // 向用户提问 → 不干预（等用户回答）
        if (/[？?]/.test(collectedText)) {
          this._cleanExit = true  // v14.6.1: 正常收尾（完成/提问/纯聊天），迭代触顶不再误标 interrupted
          this.emitter.emit('response:streaming', {
            text: collectedText, accumulated: collectedText, timestamp: Date.now(),
          })
          break
        }

        const userReq = this._userMessage.length > 200
          ? this._userMessage.slice(0, 200) + '…'
          : this._userMessage

        // 诊断数据
        const failedTools = this.toolCallSteps.filter(s => s.status === 'error')
        const readTools = this.toolCallSteps.filter(s => /^(read_file|list_directory|search_content|find_files)$/.test(s.tool))
        // v13.x: 统一 WRITE_TOOLS——此前统计正则缺 create_project/kb_append_file
        const writeTools = this.toolCallSteps.filter(s => WRITE_TOOLS.has(s.tool))

        let recoveryMsg: string

        if (this._nudgeCount >= 8) {
          // 8 轮仍未写入 → 最后诊断
          const errSummary = failedTools.slice(-3).map(s => `${s.tool}: ${s.summary.slice(0, 80)}`).join(' | ')
          recoveryMsg = `[自愈诊断-最终] 用户要求：「${userReq}」。已尝试 ${this._nudgeCount} 轮（${readTools.length} 读/${writeTools.length} 写），${failedTools.length} 个失败。${errSummary ? '失败摘要: ' + errSummary : ''}
请坦诚回复：如果任务可以完成 → 现在就做。如果确实无法完成 → 明确说明原因（不是"我做不到"而是"因为X导致Y所以无法Z"），让用户决定下一步。`
          // v14.9(接线): 反馈横幅——多轮未完成的醒目提示
          this.emitter.emit('hook:blocked', {
            hookName: '自愈诊断',
            feedback: '多轮尝试未完成，已要求模型说明原因或换方法',
            timestamp: Date.now(),
          })
        } else if (failedTools.length >= 2 && this._nudgeCount >= 4) {
          // 重复失败 → 诊断分析
          const errSummary = failedTools.slice(-3).map(s => `${s.tool}: ${s.summary.slice(0, 80)}`).join(' | ')
          recoveryMsg = `[自愈诊断] 多个工具调用失败：${errSummary}
请分析失败原因，换一种完全不同的方法。例如：
- edit_file 匹配失败 → 用 __FULL_REPLACE__ 覆盖全文
- 路径错误 → list_directory() 确认目录结构后修正
- 文件不存在 → 直接用 create_file 新建
- 重复尝试相同参数无效 → 改变策略。分析后立即行动，不要重复同样的错误。`
        } else if (readTools.length >= 5 && writeTools.length === 0 && this._nudgeCount >= 3) {
          // 读太多不写
          recoveryMsg = `[自愈诊断] 已读取 ${readTools.length} 个文件但还未写入。用户要求：「${userReq}」。
信息应该已经足够。现在基于已有信息 + 你的知识直接创建内容。不确定的地方用你的判断填充——先有再改。不要再读文件了。`
        } else if (this._nudgeCount >= 5) {
          // 多轮无进展
          recoveryMsg = `[自愈诊断] 已尝试 ${this._nudgeCount} 轮，用户要求：「${userReq}」。
请分析当前状态：哪些成功了？哪些失败了？换一种方法继续推进。不要重复已经失败的操作。`
        } else {
          // 前几轮: 不干预，让 System Prompt 的自我恢复逻辑工作
          continue
        }

        this.pushRoundText(collectedText)
        this.emitter.emit('response:streaming', {
          text: collectedText, accumulated: collectedText, timestamp: Date.now(),
        })
        this.messagesForApi.push({ role: 'user', content: recoveryMsg })
        continue
      }

      // ── Has tool calls → execute ──
      isExecutionPhase = true  // v12.5.1: 进入工具执行阶段
      toolCallsCount += response.toolCalls.length

      // v2.0: 混合响应 — 模型同时输出了文本分析和工具调用
      // 先 emit 文本到 UI（用户立即看到分析），再执行工具操作
      if (response.text && response.text.trim().length > 0) {
        collectedText = response.text
        this.emitter.emit('response:streaming', {
          text: response.text, accumulated: response.text, timestamp: Date.now(),
        })
      }

      // Build assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.text,
        tool_calls: response.toolCalls.map(tc => ({
          type: 'function' as const,
          id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
        })),
        thinkingBlocks: response.thinkingBlocks,  // v11.5.1: preserve for multi-turn
        // v15.5: 服务端工具块（server_tool_use / web_search_tool_result）随消息持久化，
        // 下轮 messagesToAnthropic 原样回传（DeepSeek Anthropic 端点原生联网要求）
        serverToolBlocks: (response as any).serverToolBlocks,
        // v14.5.0: 推理内容随消息历史回传（OpenAI 协议 aiHandlers 据此保留 reasoning_content，
        // 多轮工具调用时模型可见自己的推理链）
        reasoning_content: response.reasoningContent,
      } as Message
      if (response.reasoningContent) {
        store?.setStreamingText(response.reasoningContent)
        collectedReasoning += (collectedReasoning ? '\n\n' : '') + response.reasoningContent
      }
      this.messagesForApi.push(assistantMsg)

      // Execute tools: reads parallel, writes sequential
      const { readOnlyCalls, writeCalls } = classifyToolCalls(response.toolCalls)

      const execCtx = {
        toolExecutor: this.toolExecutor!,
        projectId: this.config.projectId,
        configId: this.config.configId,
        abortSignal: this.config.abortSignal,
        messagesForApi: this.messagesForApi,
        toolsUsed: this.toolsUsed,
        toolCallSteps: this.toolCallSteps,
        emitter: this.emitter,
        // v15.6: read_file 去重层实例（同 run 共享；子代理独立 runtime 各自持有）
        readTracker: this.readTracker || undefined,
        iteration,
        // v14.5.0: 子代理（isolatedStore）内部工具调用跳过全局操作历史写入
        skipOpHistory: !!this.config.isolatedStore,
        // v14.8: 本轮 KB 预注入文件 id（kb_search 工具排除集；子代理恒空）
        injectedKbFileIds: this.kbInjectedFileIds,
        // v14.3: 子代理执行快照收集器（ToolExecutor 在委托成功后 push）
        subagentSummaries: this.subagentSummaries,
        store: {
          addToolExecution: (id: string, name: string) => store?.addToolExecution(id, name),
          completeTool: (id: string, status: 'success' | 'error', summary: string, detail?: string) =>
            store?.completeTool(id, status, summary, detail),
          setStreamingText: (text: string) => store?.setStreamingText(text),
          // v15: 子 agent 委托用量上报（isolated 下同样累加，供父 runtime 统计）
          reportSubAgentUsage: (usage: NonNullable<import('../state/types').ToolResult['subAgentUsage']>) => {
            subUsageAccum.promptTokens += usage.promptTokens
            subUsageAccum.completionTokens += usage.completionTokens
            subUsageAccum.totalTokens += usage.totalTokens
            subUsageAccum.cacheHitTokens += usage.cacheHitTokens
            subUsageAccum.cacheCreationTokens += usage.cacheCreationTokens
            subUsageAccum.cost += usage.cost
            subUsageAccum.calls += usage.calls
          },
        },
      }

      // v14.2.1: 批量并行分析（功能 2）—
      // 普通只读：全量并行（原行为）；analyze_file 只读子代理：分片 ≤3 并行（防 API 限流，
      // isolatedStore 保证并发安全）；edit_file_task 写子代理：串行（写操作共享文件状态）
      const serialReads = readOnlyCalls.filter(tc => SERIAL_WRITE_TOOLS.has(tc.name))
      const parallelReads = readOnlyCalls.filter(tc => !SERIAL_WRITE_TOOLS.has(tc.name))
      const subReads = parallelReads.filter(tc => PARALLEL_READ_TOOLS.has(tc.name))
      const plainReads = parallelReads.filter(tc => !PARALLEL_READ_TOOLS.has(tc.name))
      if (plainReads.length > 0 && !this.config.abortSignal.aborted) {
        await Promise.all(plainReads.map(tc => executeSingleTool(tc, execCtx)))
      }
      const SUBAGENT_CONCURRENCY = 3
      for (let i = 0; i < subReads.length; i += SUBAGENT_CONCURRENCY) {
        if (this.config.abortSignal.aborted) break
        const batch = subReads.slice(i, i + SUBAGENT_CONCURRENCY)
        await Promise.all(batch.map(tc => executeSingleTool(tc, execCtx)))
      }
      for (const tc of serialReads) {
        if (this.config.abortSignal.aborted) break
        await executeSingleTool(tc, execCtx)
      }
      // Sequential writes
      for (const tc of writeCalls) {
        if (this.config.abortSignal.aborted) break
        await executeSingleTool(tc, execCtx)
      }
      // v14.6.1: _hasWriteCall 按"本轮写工具实际成功"置位——原只看是否发起调用，
      // 写工具全部失败后模型说"完成"仍能过完成闸门（幻觉完成防不住）
      if (writeCalls.length > 0 && writeCalls.some(tc =>
        this.toolCallSteps.some(s => s.tool === tc.name && s.iteration === iteration && s.status === 'success'))) {
        _hasWriteCall = true
      }
      // v15: 子 agent 委托完成文件操作（edit_file_task）也视为"已写"（同样要求成功）
      if (serialReads.some(tc => SUBAGENT_WRITE_TOOLS.has(tc.name) &&
        this.toolCallSteps.some(s => s.tool === tc.name && s.iteration === iteration && s.status === 'success'))) {
        _hasWriteCall = true
      }
      // v14.9(C3): 文件写成功标记（跨轮累积）——完成闸门只认文件写证据
      if (this.toolCallSteps.some(s => FILE_WRITE_TOOLS.has(s.tool) && s.status === 'success')) {
        this._fileWriteDone = true
      }
      // v14.3.1: 截断 + 工具调用轮 → 继续消息插在工具结果之后（tool 结果已 push，顺序合法），
      // 引导模型继续完成剩余工作
      if (wasTruncated) {
        this.messagesForApi.push({ role: 'user', content: '[系统] 上一轮输出因token限制被截断。请继续完成剩余工作。' })
      }

      // ── v14.3: 本轮 verify_task 结果扫描（按 iteration 过滤）──
      // summary 由 verify_task executor 构造（非模型文本）："验收未通过" = 判定失败（完成闸门置位），
      // "验收通过" = 闸门释放；"验收完成"（非 JSON 降级）与"验收失败"（执行错误）不触发。
      // 注：督促次数（_verifyFailedRounds）不在本处递增——只在闸门注入督促时 +1（督促本身有界，
      // 防"模型不修复反复说完成"时计数不涨导致无限拦截）。
      let verifyFailedThisRound = false
      let verifyPassedThisRound = false
      for (const s of this.toolCallSteps) {
        if (s.tool !== 'verify_task' || s.iteration !== iteration) continue
        if (s.summary.includes('验收未通过')) verifyFailedThisRound = true
        else if (s.summary.includes('验收通过')) verifyPassedThisRound = true
      }
      if (verifyFailedThisRound) {
        // 同轮多文件验收：任一未通过 → 严格语义
        this._verifyFailed = true
      } else if (verifyPassedThisRound) {
        this._verifyFailed = false  // 通过 → 闸门释放（rounds 保留，无碍）
      }

      // v13.2.0: 跟踪 tool_search 发现的工具 → 动态加入后续轮次可用集
      // v14.5.0: 收集后立即刷新工具集（原实现只在 iteration===2 过滤一次，之后发现的工具永不生效）
      const tsStep = this.toolCallSteps.find(s => s.tool === 'tool_search' && s.iteration === iteration)
      if (tsStep?.status === 'success' && tsStep.matchedTools?.length) {
        for (const name of tsStep.matchedTools) this._discoveredToolNames.add(name)
        this.refreshToolSet()
      }

      // v12.6.0: 分级失败检测 + 路径错误单独追踪 + 自动目录诊断
      const PATH_ERROR_RE = /ENOENT|文件不存在|not found|no such file|路径|directory|path/i
      const allToolCalls = [...readOnlyCalls, ...writeCalls]
      if (allToolCalls.length > 0) {
        // ── 分类统计 ──
        const thisIterationFullFailed = allToolCalls.every((tc, k) => {
          const callIndex = allToolCalls.slice(0, k).filter(t => t.name === tc.name).length
          const step = this.findStepForCall(tc.name, iteration, callIndex)
          return step?.status === 'error'
        })
        let pathErrorsThisIteration = 0
        let lastFailedPath = ''
        allToolCalls.forEach((tc, k) => {
          const callIndex = allToolCalls.slice(0, k).filter(t => t.name === tc.name).length
          const step = this.findStepForCall(tc.name, iteration, callIndex)
          if (step?.status === 'error' && PATH_ERROR_RE.test(step.summary)) {
            pathErrorsThisIteration++
            // Extract failed path from arguments for diagnostic
            try { const a = JSON.parse(step.arguments || '{}'); lastFailedPath = a.file_path || a.dir_path || lastFailedPath } catch {}
          }
        })

        // ── 连续全失败计数（保持兼容）──
        if (thisIterationFullFailed) {
          this._consecutiveFailures++
        } else {
          this._consecutiveFailures = 0
        }

        // ── 路径错误单独计数（不受部分成功归零影响）──
        if (pathErrorsThisIteration > 0) {
          this._consecutivePathErrors += pathErrorsThisIteration
        } else if (writeCalls.length > 0) {
          this._consecutivePathErrors = 0  // 写操作成功→重置
        }
        // 注意: 只读成功+只读路径失败 不重置 _consecutivePathErrors

        // ── 干预 0: 单次路径失败 → 快速提示，不中断流程 ──
        if (pathErrorsThisIteration === 1 && lastFailedPath) {
          const hasProjectPrefix = lastFailedPath.includes('projects/')
          const hint = hasProjectPrefix
            ? `路径错误：不要用 "projects/" 前缀。直接用项目名开头，如 "${this.config.projectId || '项目名'}/outline/plot.md"。修正后继续。`
            : `路径 "${lastFailedPath}" 未找到。list_directory() 看目录结构，修正后继续。不要停下来向我汇报。`
          this.messagesForApi.push({ role: 'user', content: `⚠️ ${hint}` })
        }

        // ── 干预 1: 连续 2 次路径错误 → 强制诊断，仍然继续 ──
        if (this._consecutivePathErrors >= 2) {
          this.messagesForApi.push({
            role: 'user',
            content: `已连续 ${this._consecutivePathErrors} 次路径错误。立即 list_directory() 看目录结构——看完你就知道正确路径了。不要停，继续。`,
          })
          this._consecutivePathErrors = 0
        }

        // ── 干预 2: 连续 5 次全失败 → 提醒 AI 自主恢复 ──
        if (this._consecutiveFailures === 5) {
          const recentErrors = this.toolCallSteps.filter(s => s.status === 'error').slice(-3)
            .map(s => s.tool + ': ' + s.summary).join('\n')
          this.messagesForApi.push({
            role: 'user',
            content: '⚠️ 已连续 ' + this._consecutiveFailures + ' 轮工具调用全部失败。最近的错误：\n' + recentErrors + '\n\n请先 list_directory() 了解目录结构，然后换一种完全不同的方法重试。如果所有方法都失败，直接输出文字回复告知用户。',
          })
        }

        // ── 干预 3: 连续 8 次全失败 → 强制终止 ──
        if (this._consecutiveFailures >= 8) {
          const failedTools = this.toolCallSteps.filter(s => s.status === 'error').slice(-3)
            .map(s => s.tool + ': ' + s.summary).join('; ')
          collectedText = '抱歉，连续 ' + this._consecutiveFailures + ' 次工具调用都失败了。最近的错误：' + failedTools + '。\n\n请给我更具体的信息——比如准确的文件路径、你想做什么操作，或者直接把相关的内容粘贴到对话中，我来帮你处理。'
          if (!isolated) diagnosticLogger.recordInfo('连续失败强制终止: ' + this._consecutiveFailures + '次 (' + failedTools + ')')
          // v14.9(审计): 强停是"有界求助"而非中断——置 cleanExit 防恰逢迭代触顶时重复标记
          // truncated（UI 建议续跑同一失败任务，重复计费）；同时发反馈横幅（红色 ✗）
          this._cleanExit = true
          this.emitter.emit('hook:blocked', {
            hookName: '连续失败',
            feedback: '连续 8 轮工具调用失败，已停止并向用户求助',
            timestamp: Date.now(),
          })
          break
        }
      }

      // v12.16.5: 重复读取提醒 — 同一文件被读2次以上 → 提醒直接引用历史
      const readFilePaths = this.toolCallSteps
        .filter(s => (s.tool === 'read_file' || s.tool === 'list_directory') && s.status === 'success')
        .map(s => { try { return JSON.parse(s.arguments || '{}').file_path || JSON.parse(s.arguments || '{}').dir_path } catch { return '' } })
        .filter(Boolean)
      const dupReads = readFilePaths.filter((p, i) => readFilePaths.indexOf(p) !== i)
      // v14.6.1: 每 run 只注入一次（原每工具轮重复 push 相同提醒，长 run 累积几十条）
      if (dupReads.length > 0 && this._userRequestedFileOp && !_hasWriteCall && !this._dupReadHintInjected) {
        const dupSet = [...new Set(dupReads)].join('、')
        this.messagesForApi.push({
          role: 'user',
          // v14.3.1: 文案修正——压缩机制（70% 阈值/5 轮清理）会销毁历史内容，
          // "直接引用历史"可能要求模型引用已不存在的内容；明确区分两种情形
          content: `已重复读取: ${dupSet}。若对话历史中该文件内容仍然完整（未被压缩清理），直接引用不要重复读取；若历史已被压缩丢失细节，重新读取是必要的。读取后请用 create_file 或 edit_file 写入产物。`,
        })
        this._dupReadHintInjected = true
      }
    }

    // v14.2.0: 迭代耗尽 — 循环自然结束（iteration 触顶）且任务未全部完成 → 中断未完成（可续跑）
    // 正常 break 的完成/提问路径不会走到这里（清单完成即 break，interrupted 保持 false）
    // v14.3.1: 无任务清单时同样标记（子代理场景——迭代触顶 = 部分完成，防"假成功"：
    // 此前子代理 6 轮耗尽 success 仍为 true，主代理把不完整结果当完成）
    // v14.6.1: _cleanExit 排除——模型恰好在最后一轮完成/提问/收尾时不再误标 interrupted
    // （原实现把"第 10 轮正常完成"的子代理判为 truncated → 主代理重复委托，多付一次费用）
    if (iteration >= this.config.maxIterations && !this._cleanExit) {
      interrupted = true
    }

    // ── ③ Done ──
    store?.setIsStreaming(false)
    store?.endRun()

    // v13.2.0: 估算下一次 API 请求的上下文 token 数（进度条用）
    const estimatedContextTokens = this.compressor.estimateMessages(this.messagesForApi)

    // Fallback text: prefer last assistant message with actual content
    if (!collectedText) {
      for (let i = this.messagesForApi.length - 1; i >= 0; i--) {
        const m = this.messagesForApi[i]
        if (m.role === 'assistant' && m.content && typeof m.content === 'string' && m.content.trim()) {
          collectedText = m.content
          break
        }
      }
    }
    if (!collectedText && toolCallsCount > 0) {
      const toolsSummary = this.toolCallSteps.slice(-3).map(s => s.summary).filter(Boolean)
      if (toolsSummary.length > 0) {
        // Knowledge/chat question that triggered exploration → guide model to actually answer
        if (isKnowledgeOnly(this._userMessage)) {
          collectedText = `已查看项目状态。请问你需要什么帮助？`
        } else {
          collectedText = `操作完成：${toolsSummary.reverse().join('；')}。`
        }
      } else {
        collectedText = `操作完成（${toolCallsCount} 次工具调用）。`
      }
    }

    return {
      success: !this.config.abortSignal.aborted,
      text: collectedText,
      toolCalls: toolCallsCount,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cacheHitTokens: totalCacheHitTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      cost: totalCost,
      // v16: API 逐轮明细（分析用）——同 run 内多次调用的缓存/耗时/工具轮
      apiCallDetails,
      phase: this.config.abortSignal.aborted ? 'ABORTED' : 'DONE',
      toolsUsed: this.toolsUsed,
      toolCallSteps: this.toolCallSteps,
      contextBreakdown: contextResult.breakdown,
      estimatedContextTokens,
      iterationCount: iteration,
      // v15: 子 agent 委托用量（仅实际发生过委托时携带；不并入 totalTokens，主/子分开统计）
      ...(subUsageAccum.calls > 0 ? { subAgentUsage: subUsageAccum } : {}),
      // v14.3: 子代理执行快照（仅实际委托过时携带；供 UI 持久化 + 跨 run 注入复用）
      ...(this.subagentSummaries.length > 0 ? { subagentSummaries: this.subagentSummaries.slice(0, MAX_SUBAGENT_SUMMARIES) } : {}),
      // v14.2.0: 任务清单进度快照（仅提取到任务清单时返回；供跨 run 续跑持久化）
      ...(this.taskList ? {
        taskProgress: {
          tasks: this.taskList.map((t, i) => ({ id: t.id, desc: t.desc, done: !!this.taskDone[i] })),
          allDone: this.allTasksDone(),
          interrupted,
        },
      } : {}),
      // v14.3.1: 中断标记（迭代耗尽/超时/API失败/abort）— 无论有无任务清单都返回；
      // 子代理据此判定"部分完成"（success 仍可能为 true）
      ...(interrupted ? { truncated: true } : {}),
      // v14.6.1: 本轮推理链（UI 思考过程面板数据源）
      ...(collectedReasoning ? { reasoningContent: collectedReasoning } : {}),
      // v14.8: 本轮 KB 预注入文件 id（跨 run 去重持久化；上限 20 防消息膨胀）
      ...(this.kbInjectedFileIds.length > 0 ? { kbInjectedFileIds: this.kbInjectedFileIds.slice(0, 20) } : {}),
    }
  }
}

// v11.5.1: _isChatQuestion removed — use isKnowledgeOnly from taskDetection.ts
