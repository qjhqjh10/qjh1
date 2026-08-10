// ── Anchor Match (v16.1.0) ──
// 编辑器协作改写的锚点定位降级匹配链（纯函数，可单测）。
//
// 锚 = 段落首尾各 20 字拼接（AI 改写通常保留首句引入/尾句收束，首尾最稳定）。
// 降级顺序（对 anchorStack 由新到旧逐版尝试）：
//   1. 精确匹配：全文 indexOf(anchor) 唯一命中
//   2. 首尾 20 字匹配：head/tail 各自定位，位置序约束防误配
//   3. 单首 20 字匹配：head 唯一命中
//   4. 全部失败 → null（executor 返回错误引导 AI 用 search_content 重试）

export interface AnchorMatchResult {
  from: number
  to: number
  matchedBy: 'exact' | 'headtail' | 'head' | null
}

/** 首尾 20 字锚生成：text.slice(0,20) + '……' + text.slice(-20)。短文本(<20)直接返回原文。 */
export function makeAnchor(text: string): string {
  const t = String(text || '').trim()
  if (!t) return ''
  if (t.length <= 20) return t
  return `${t.slice(0, 20)}……${t.slice(-20)}`
}

/** 头/尾 20 字（内部用——匹配时用未拼接的原始首尾，避免省略号干扰定位） */
function headOf(text: string): string {
  const t = String(text || '').trim()
  return t.length <= 20 ? t : t.slice(0, 20)
}

function tailOf(text: string): string {
  const t = String(text || '').trim()
  return t.length <= 20 ? t : t.slice(-20)
}

/** 单锚尝试：返回 {from,to} 或 null */
function tryAnchor(fullText: string, anchor: string): AnchorMatchResult | null {
  if (!anchor || !fullText) return null

  // 1. 精确匹配（唯一）
  const exactIdx = fullText.indexOf(anchor)
  if (exactIdx !== -1) {
    if (fullText.indexOf(anchor, exactIdx + 1) === -1) {
      return { from: exactIdx, to: exactIdx + anchor.length, matchedBy: 'exact' }
    }
    // 多命中：不满足唯一性，继续降级
  }

  const head = headOf(anchor)
  const tail = tailOf(anchor)
  if (!head || !tail) return null

  // 2. 首尾 20 字匹配（各自定位，位置序约束）
  //    短锚(≤20字)时 head === tail——等同精确匹配，必须唯一出现（多处出现=歧义，拒绝）
  if (head === tail) {
    const only = fullText.indexOf(head)
    if (only !== -1 && fullText.indexOf(head, only + 1) === -1) {
      return { from: only, to: only + head.length, matchedBy: 'exact' }
    }
    return null
  }
  const headIdx = fullText.indexOf(head)
  if (headIdx !== -1) {
    const tailIdx = fullText.lastIndexOf(tail)
    // 尾出现在头之后，且间距合理（≤ 原锚长 ×3 + 200 容忍——防跨章/跨段误配）
    if (tailIdx > headIdx) {
      const maxSpan = anchor.length * 3 + 200
      const span = tailIdx + tail.length - headIdx
      if (span <= maxSpan) {
        return { from: headIdx, to: tailIdx + tail.length, matchedBy: 'headtail' }
      }
    }
  }

  // 3. 单首 20 字匹配（唯一命中）
  if (head) {
    const onlyHead = fullText.indexOf(head)
    if (onlyHead !== -1 && fullText.indexOf(head, onlyHead + 1) === -1) {
      return { from: onlyHead, to: onlyHead + head.length, matchedBy: 'head' }
    }
  }

  return null
}

/** 降级匹配链：对 anchorStack 由新到旧逐版尝试，任一命中即返回。全失败 → { from: 0, to: 0, matchedBy: null } */
export function locateAnchor(fullText: string, anchorStack: string[]): AnchorMatchResult {
  if (!fullText || !anchorStack || anchorStack.length === 0) {
    return { from: 0, to: 0, matchedBy: null }
  }
  for (const anchor of anchorStack) {
    const r = tryAnchor(fullText, anchor)
    if (r) return r
  }
  return { from: 0, to: 0, matchedBy: null }
}

/** 给定段文本，返回编辑器 doc 中该段的 {from,to} 范围（扩展到整个段落——段首到段尾） */
export function locateParagraph(
  doc: { textBetween: (from: number, to: number, blockSeparator?: string) => string; content: { size: number } },
  matchFrom: number,
  matchTo: number,
): { from: number; to: number } | null {
  if (!doc || matchFrom < 0 || matchTo > doc.content.size) return null
  const fullText = doc.textBetween(0, doc.content.size, '\n\n')
  if (matchFrom < 0 || matchFrom > fullText.length) return null

  // 从匹配起点向前找段落首（上一个 \n\n 之后）
  let from = matchFrom
  while (from > 0 && fullText[from - 1] !== '\n') {
    // 若前两个字符是 \n\n 中的第二个 \n，from 已在段首（跳过 '\n\n' 两字符）
    if (from >= 2 && fullText[from - 2] === '\n' && fullText[from - 1] === '\n') break
    from--
  }
  // 跳过段首的 '\n\n' 分隔符
  while (from < fullText.length && fullText[from] === '\n') from++

  // 从匹配终点向后找段落尾（下一个 \n\n 之前）
  let to = matchTo
  while (to < fullText.length) {
    if (fullText[to] === '\n' && fullText[to + 1] === '\n') break
    to++
  }
  // 若整段就是匹配范围（中间无段落边界），to 自然停在匹配尾
  if (to <= matchTo) to = matchTo

  if (to <= from) return null
  return { from, to }
}
