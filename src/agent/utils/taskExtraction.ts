// ── Task List Extraction (v14.1.0) ──
// 从用户消息提取显式编号任务清单（1. 2. 3. / 1）2）/ ①②③）。
// 宁漏勿错：四重门控全部通过才返回清单；任一不通过 → null（单任务/聊天/提取失败 → runtime 走原逻辑）。
// v1 限制（文档化）：不处理顿号枚举（"做三件事：…、…、…"）与中文序号（一、二、三）——
// 边界不可靠，宁可不提取，避免误把单任务拆成清单导致错误 nudge。

import { hasTaskKeywords } from './taskDetection'

export interface TaskItem {
  id: number
  desc: string
}

/** 任务条目动词字符集（门控 3）— 从 TASK_KEYWORDS_FOR_INDEX 的多字动词提取 */
const TASK_VERB_CHARS = '写改创建生成修删追填导整替换续仿润扩精存增补复'

/** 门控 3: 条目是否包含任务动词字符 */
function hasTaskVerb(desc: string): boolean {
  for (const ch of TASK_VERB_CHARS) {
    if (desc.includes(ch)) return true
  }
  return false
}

/** 门控 4: 条目两两去重（归一化空白后） */
function hasDuplicate(descs: string[]): boolean {
  const seen = new Set<string>()
  for (const d of descs) {
    const norm = d.replace(/\s+/g, '')
    if (seen.has(norm)) return true
    seen.add(norm)
  }
  return false
}

/** 清理条目文本：去首尾空白、合并内部换行为空格 */
function cleanDesc(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * 按编号位置切分条目。编号必须从 1 开始严格连续才接受。
 * @param re    编号正则（全局，捕获编号文本本身）
 * @param numOf 从匹配文本解析编号
 * @returns 清理后的条目文本数组；不满足条件返回 null
 */
function splitByNumbered(
  text: string,
  re: RegExp,
  numOf: (matchText: string) => number | null,
): string[] | null {
  const matches: Array<{ num: number; index: number; end: number }> = []
  let m: RegExpExecArray | null
  re.lastIndex = 0
  while ((m = re.exec(text)) !== null) {
    const n = numOf(m[0])
    if (n === null) continue
    matches.push({ num: n, index: m.index, end: re.lastIndex })
  }
  if (matches.length < 2) return null
  // 编号必须从 1 开始严格连续（跳号/乱序 → 放弃，宁漏勿错）
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].num !== i + 1) return null
  }
  const descs: string[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    descs.push(cleanDesc(text.slice(start, end)))
  }
  return descs
}

// Pattern A: 阿拉伯编号 — 前缀限行首/空白/中文标点（避免误切 "3.14"、"第1章"），
// 分隔符后要求非数字（避免 "1)2)" 连续编号粘连）
const ARABIC_RE = /(?:^|[\s:：;；,，。！？、…（(])(\d+)\s*[.)、）]\s*(?!\d)/g

function arabicNum(matchText: string): number | null {
  const m = matchText.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

// Pattern B: 圈号 ①-⑧
const CIRCLED_RE = /[①-⑧]/g
const CIRCLED_MAP: Record<string, number> = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8,
}

function circledNum(matchText: string): number | null {
  return CIRCLED_MAP[matchText] ?? null
}

/**
 * 从用户消息提取任务清单。
 * @returns TaskItem[] 多任务清单（≥2 条）；null = 无清单（单任务/聊天/提取失败）
 */
export function extractTaskList(userMessage: string): TaskItem[] | null {
  // 门控 0: 必须有文件操作意图（杜绝聊天误提取）
  if (!hasTaskKeywords(userMessage)) return null

  // 门控 1: 编号格式提取（Pattern A 阿拉伯编号优先，失败再试 Pattern B 圈号）
  let descs = splitByNumbered(userMessage, ARABIC_RE, arabicNum)
  if (descs === null) {
    descs = splitByNumbered(userMessage, CIRCLED_RE, circledNum)
  }
  if (descs === null) return null

  // 门控 2: 条目数 ∈ [2,8]；每条长度 ∈ [4,120]（全有或全无）
  if (descs.length < 2 || descs.length > 8) return null
  for (const d of descs) {
    if (d.length < 4 || d.length > 120) return null
  }

  // 门控 3: 每条必须含任务动词字符
  for (const d of descs) {
    if (!hasTaskVerb(d)) return null
  }

  // 门控 4: 条目两两去重
  if (hasDuplicate(descs)) return null

  return descs.map((d, i) => ({ id: i + 1, desc: d }))
}
