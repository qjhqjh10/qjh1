// ── ReadResultTracker: read_file 结果去重层 + 文件版本感知（v15.6） ──
// 解决"同一文件多次讨论修改，旧版本信息重复上传"问题（用户反馈的主要痛点）。
//
// 核心语义（对齐 Claude Code FileRead 去重层，但增强版本感知）：
//   - 同 run 内（或历史可重建的跨 run）同文件同范围重复 read → 'dup'
//     → detail 替换为"已读取过，见前文第 N 轮"，不重发全文
//   - 文件在 read 之后被 write 工具修改过 → 'changed'
//     → detail 替换为"已修改+修改位置摘要"，引导模型精确读取新内容区段而非重读全文
//   - 前文内容已被压缩器清理（内容指纹不匹配）→ 放弃去重，完整回传
//   - 同一文件连续 dup ≥ 2 次 → 强制完整回传（防模型死板绕圈）
//
// 安全设计：
//   - 纯函数/无副作用，可单测
//   - FNV-1a 32bit 内容指纹（无依赖），碰撞概率对每轮几十条消息可忽略；
//     即便碰撞也只是"该去重没去成"（安全侧失败）
//   - 修改信息来自 write 工具参数（old_string/new_string），无需 mtime/hash 磁盘检测

import type { Message } from '../state/types'

// ── 路径归一化（复用 fileReadCache 语义：反斜杠→斜杠、小写、去 ../） ──
export function normalizeReadPath(raw: string): string {
  let p = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
  while (p.startsWith('../')) p = p.slice(3)
  if (p.endsWith('/')) p = p.slice(0, -1)
  return p.toLowerCase()
}

// ── FNV-1a 32bit hash（无依赖，内容指纹） ──
export function hashStr(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16)
}

// ── 记录类型 ──

export interface ReadRecord {
  filePath: string        // normalizeReadPath 后的 key
  rangeKey: string        // 'full' | 's:offset' | 's:offset:e:end'
  turnSeq: number         // ctx.iteration（"见前文第 N 轮"用）
  contentHash: string     // 对 JSON.stringify(最终注入的 tool content) 计算
}

export interface WriteRecord {
  filePath: string        // normalizeReadPath 后的 key
  turnSeq: number
  changeSummary: string   // edit_file: "old前60字 → new前60字"；batch_replace: "N 处替换"
}

export type ReadCheckStatus =
  | { status: 'new' }
  | { status: 'dup'; record: ReadRecord; stillInContext: boolean; forceReturnFull: boolean }
  | { status: 'changed'; writes: WriteRecord[]; stillInContext: boolean; forceReturnFull: boolean }

// ── 去重层 ──

export class ReadResultTracker {
  private readRecords = new Map<string, Map<string, ReadRecord>>()
  private writeRecords = new Map<string, WriteRecord[]>()
  private dupCounters = new Map<string, number>()

  /** rangeKey 判定：offset/limit 均缺省 → 'full'（全文）；否则按范围 */
  static rangeKeyOf(offset?: number, limit?: number): string {
    const o = Math.max(0, Number(offset) || 0)
    const l = Number(limit) || 0
    if (o === 0 && l === 0) return 'full'
    if (l === 0) return `s:${o}`
    return `s:${o}:e:${o + l}`
  }

  /** 从 args 提取 read 参数 */
  static readArgsOf(args: Record<string, unknown>): { filePath: string; rangeKey: string } | null {
    const fp = typeof args?.file_path === 'string' && args.file_path ? args.file_path : ''
    if (!fp) return null
    return {
      filePath: normalizeReadPath(fp),
      rangeKey: ReadResultTracker.rangeKeyOf(
        typeof args.offset === 'number' ? args.offset : undefined,
        typeof args.limit === 'number' ? args.limit : undefined,
      ),
    }
  }

  /**
   * 从历史消息重建 tracker——覆盖跨 run 场景。
   * 扫描 history 中 read_file 的 tool 结果（内容 hash）与 write 工具的调用（修改摘要）。
   * 注意：历史已被 buildHistoryMessages 折叠（5 轮外 read 结果不保留）→ 只能重建"仍在上下文的"，
   * 与模型实际可见内容一致，安全。
   */
  static rebuildFromHistory(history: Message[]): ReadResultTracker {
    const t = new ReadResultTracker()
    if (!Array.isArray(history)) return t
    // 建立 tool_call_id → 工具名/参数映射（assistant 消息的 tool_calls）
    const callInfo = new Map<string, { name: string; args: Record<string, unknown>; turnSeq: number }>()
    let turn = 0
    for (const m of history) {
      if (m.role === 'user') turn++
      if (m.role === 'assistant' && Array.isArray((m as any).tool_calls)) {
        for (const tc of (m as any).tool_calls as Array<{ id?: string; name?: string; function?: { name?: string; arguments?: string } }>) {
          const name = tc.function?.name ?? tc.name ?? ''
          let args: Record<string, unknown> = {}
          try {
            const a = tc.function?.arguments
            args = typeof a === 'string' ? JSON.parse(a) : (a || {})
          } catch { /* 参数非 JSON */ }
          if (tc.id && name) callInfo.set(tc.id, { name, args, turnSeq: turn })
        }
      }
    }
    // 扫描 tool 消息：read_file → readRecords；写工具 → writeRecords
    for (const m of history) {
      if (m.role !== 'tool' || !m.tool_call_id) continue
      const info = callInfo.get(m.tool_call_id)
      if (!info) continue
      if (info.name === 'read_file') {
        const ra = ReadResultTracker.readArgsOf(info.args)
        if (!ra) continue
        const content = typeof m.content === 'string' ? m.content : ''
        const rec: ReadRecord = {
          filePath: ra.filePath,
          rangeKey: ra.rangeKey,
          turnSeq: info.turnSeq,
          contentHash: hashStr(content),
        }
        if (!t.readRecords.has(ra.filePath)) t.readRecords.set(ra.filePath, new Map())
        t.readRecords.get(ra.filePath)!.set(ra.rangeKey, rec)
      } else if (t.isWriteTool(info.name)) {
        const fp = normalizeReadPath(String(info.args?.file_path || info.args?.path || info.args?.new_path || info.args?.targetPath || ''))
        if (!fp) continue
        const summary = t.writeSummary(info.name, info.args)
        if (!t.writeRecords.has(fp)) t.writeRecords.set(fp, [])
        t.writeRecords.get(fp)!.push({ filePath: fp, turnSeq: info.turnSeq, changeSummary: summary })
      }
    }
    return t
  }

  isWriteTool(name: string): boolean {
    return WRITE_TOOL_NAMES.has(name)
  }

  /** 生成修改摘要（唯一实现——ToolExecutor 与 rebuildFromHistory 共用，防两处漂移） */
  writeSummary(name: string, args: Record<string, unknown>): string {
    if (name === 'edit_file') {
      const oldS = typeof args.old_string === 'string' ? args.old_string : ''
      const newS = typeof args.new_string === 'string' ? args.new_string : ''
      const clip = (s: string, n = 60) => s.length > n ? s.slice(0, n) + '…' : s
      return `"${clip(oldS)}" → "${clip(newS)}"`
    }
    if (name === 'batch_replace') {
      const n = Array.isArray(args.replacements) ? args.replacements.length : '多'
      return `批量替换 ${n} 处`
    }
    if (name === 'create_file') return '新建文件'
    if (name === 'delete_file') return '删除文件'
    if (name === 'rename_file') return '重命名/移动'
    if (name === 'kb_append_file') return '知识库追加'
    if (name === 'edit_file_task') return '子代理修改'
    return '文件修改'
  }

  /** 记录一次成功读取（filePath 内部归一化，大小写/斜杠差异视为同文件） */
  recordRead(filePath: string, rangeKey: string, turnSeq: number, contentHash: string): void {
    const key = normalizeReadPath(filePath)
    if (!this.readRecords.has(key)) this.readRecords.set(key, new Map())
    this.readRecords.get(key)!.set(rangeKey, { filePath: key, rangeKey, turnSeq, contentHash })
  }

  /** 记录写操作（文件变更） */
  recordWrite(filePath: string, turnSeq: number, changeSummary: string): void {
    if (!this.writeRecords.has(filePath)) this.writeRecords.set(filePath, [])
    this.writeRecords.get(filePath)!.push({ filePath, turnSeq, changeSummary })
    // 文件变更 → 之前的 dup 计数清零（内容变了，重读是合理的）
    this.dupCounters.delete(filePath)
  }

  /** 文件失效（delete/rename 等） */
  invalidateFile(filePath: string): void {
    const key = normalizeReadPath(filePath)
    this.readRecords.delete(key)
    this.writeRecords.delete(key)
    this.dupCounters.delete(key)
  }

  /** 目录前缀失效（KB 场景） */
  invalidateDir(prefix: string): void {
    const key = normalizeReadPath(prefix)
    for (const fp of [...this.readRecords.keys()]) {
      if (fp.startsWith(key)) this.readRecords.delete(fp)
    }
    for (const fp of [...this.writeRecords.keys()]) {
      if (fp.startsWith(key)) this.writeRecords.delete(fp)
    }
    for (const fp of [...this.dupCounters.keys()]) {
      if (fp.startsWith(key)) this.dupCounters.delete(fp)
    }
  }

  /** 内容指纹是否仍完整在上下文中（免疫压缩器移动消息位置） */
  stillInContext(contentHash: string, messagesForApi: Message[]): boolean {
    if (!Array.isArray(messagesForApi)) return false
    for (const m of messagesForApi) {
      if (m.role !== 'tool') continue
      const c = typeof m.content === 'string' ? m.content : ''
      if (c && hashStr(c) === contentHash) return true
    }
    return false
  }

  /**
   * 查询去重判定（read_file 结果注入前调用）。
   * 返回三种状态：
   *   'new'     — 首次读该文件该范围，正常回传 + recordRead
   *   'dup'     — 已读取过且未被修改，发"已读取过"提示
   *   'changed' — 已读取过但文件被修改过，发"已修改+位置"提示
   */
  checkRead(
    filePath: string,
    rangeKey: string,
    contentHash: string,
    messagesForApi: Message[],
    turnSeq: number,
  ): ReadCheckStatus {
    const key = normalizeReadPath(filePath)
    const fileRecs = this.readRecords.get(key)
    const rec = fileRecs?.get(rangeKey)
    if (!rec) return { status: 'new' }

    const writes = this.writeRecords.get(key) || []
    const inCtx = this.stillInContext(rec.contentHash, messagesForApi)

    // 防呆：同一文件连续 dup ≥ 2 次 → 强制完整回传
    const dupN = (this.dupCounters.get(key) || 0) + 1
    this.dupCounters.set(key, dupN)
    const force = dupN >= 3

    if (writes.length > 0) {
      return { status: 'changed', writes: writes.slice(-3), stillInContext: inCtx, forceReturnFull: force }
    }
    return { status: 'dup', record: rec, stillInContext: inCtx, forceReturnFull: force }
  }
}

/** 写工具集合（与 ToolExecutor.WRITE_TOOLS 同语义，本地镜像避免循环依赖） */
const WRITE_TOOL_NAMES = new Set([
  'create_file', 'edit_file', 'batch_replace', 'delete_file', 'rename_file',
  'create_project', 'delete_project', 'kb_append_file', 'kb_index_file',
  'generate_image', 'http_get', 'http_fetch', 'browser_open', 'browser_search',
  'edit_file_task',
])

/** 去重提示文案（"已读取过"） */
export function buildDupDetail(record: ReadRecord, summary: string): string {
  return `[已读取过该文件此范围：完整内容见前文第 ${record.turnSeq} 轮工具结果（内容较长，为避免重复占用上下文已省略）。摘要: ${summary}。若该轮内容已被压缩清理而看不到原文，请重新 read_file 读取。]`
}

/** 去重提示文案（"已修改"） */
export function buildChangedDetail(writes: WriteRecord[], summary: string): string {
  const changeList = writes.map(w => `第 ${w.turnSeq} 轮 ${w.changeSummary}`).join('；')
  return `[该文件已修改（${changeList}）。历史中的旧版本内容仍在上下文但已过时。当前新版本请用 search_content 定位修改处，或 read_file(file_path, offset, limit) 精确读取目标区段——无需重读全文。摘要: ${summary}。]`
}
