// ── Rewrite Effect (v16.1.0) ──
// 编辑器协作改写的三阶段特效状态机（DOM 直接操作 + 单次真实 transaction）。
//
// 设计:
//   - Phase 1 旧文字淡出: 定位含锚点的段落 DOM 节点（view.domAtPos(from) 向上找块节点），
//     加 .rewrite-vanish class（CSS opacity→0 + blur，~400ms）
//   - Phase 2 新文字打字机: 在该段落后插入 .rewrite-typewriter 容器（零 dispatch），
//     定时逐字 append（~12ms/字，每帧 2-4 字），尾部 .rewrite-typewriter-caret 闪烁
//   - Phase 3 提交: 一次真实 transaction replaceWith(from, to, text) → onUpdate 触发一次
//     → Ctrl+Z 单步撤销;提交后 prosemirror 重建 DOM，装饰 span 自然消失
//   - 全程 editor.setEditable(false) + view.dom pointer-events:none;提交后恢复
//   - 超长 newText(>5000 字符) 跳过打字机只保留淡出（防长文特效卡死）
//   - 特效期间零 dispatch → doc 状态不变 → from/to 始终有效 → 不触发 onContentChange
//
// 不触发 onContentChange 循环：Phase 2 零 dispatch；Phase 3 一次 dispatch → onUpdate 一次 →
// ChapterWritingPage setContent → RichTextEditor 内容同步 effect 中 currentHtml === content 时不再 setContent。

import type { Editor } from '@tiptap/react'

export interface RewriteEffectCallbacks {
  /** 特效开始（store.setStreaming(true)） */
  onStart?: () => void
  /** 特效成功提交（store 锚点更新 + 版本 +1） */
  onCommitted?: () => void
  /** 特效结束/失败/取消（store.setStreaming(false)） */
  onFinished?: () => void
  /** v16.1.0(修复): 特效中断标志读取——放弃改写/切章时置 true，特效各阶段检查并中止 */
  isAborted?: () => boolean
}

export const REWRITE_MAX_CHARS = 5000

/** 超长文本是否跳过打字机（只淡出 + 立即提交） */
export function shouldSkipTypewriter(text: string): boolean {
  return String(text || '').length > REWRITE_MAX_CHARS
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 从 DOM 位置向上找块级节点（段落 P 或编辑区顶层的 div），作为特效作用容器 */
function findBlockEl(dom: HTMLElement, node: Node): HTMLElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement
  while (el && el !== dom) {
    const tag = el.tagName.toUpperCase()
    if (tag === 'P' || tag === 'DIV' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'LI') {
      return el
    }
    el = el.parentElement
  }
  return null
}

/**
 * 特效状态机入口。返回 Promise<boolean>——成功提交 = true，锚点未找到/异常 = false。
 * 由 RichTextEditor 的 applyRewrite 调用（需要 editor 实例 + 已挂载 DOM）。
 */
export async function runRewriteEffect(
  editor: Editor,
  from: number,
  to: number,
  newText: string,
  callbacks?: RewriteEffectCallbacks,
): Promise<boolean> {
  if (!editor || !editor.view || !editor.view.dom) return false
  const view = editor.view
  const dom = view.dom as HTMLElement
  if (dom.querySelector('.rewrite-vanish, .rewrite-typewriter')) return false  // 幂等守卫

  callbacks?.onStart?.()
  editor.setEditable(false)
  dom.style.pointerEvents = 'none'

  let cancelled = false
  const timers: ReturnType<typeof setTimeout>[] = []

  const cleanup = () => {
    timers.forEach(t => clearTimeout(t))
    timers.length = 0
    dom.querySelectorAll('.rewrite-vanish').forEach(el => el.classList.remove('rewrite-vanish'))
    dom.querySelectorAll('.rewrite-typewriter').forEach(el => el.remove())
    if (!cancelled) {
      editor.setEditable(true)
      dom.style.pointerEvents = ''
    }
    callbacks?.onFinished?.()
  }

  try {
    // ── 定位目标段落 DOM（含 from 位置的块节点）──
    let domAt: { node: Node; offset: number } | null = null
    try { domAt = view.domAtPos(from) } catch { /* 位置越界 */ }
    const blockEl = domAt ? findBlockEl(dom, domAt.node) : null

    // ── Phase 1: 旧文字淡出（~400ms）──
    if (blockEl) blockEl.classList.add('rewrite-vanish')
    await delay(400)
    if (callbacks?.isAborted?.()) { cleanup(); return false }  // 放弃改写 → 中止(不提交)

    // ── Phase 2: 新文字打字机（仅短文本;超长跳过直接提交）──
    const textStr = String(newText || '')
    const skipTyping = shouldSkipTypewriter(textStr)
    let typewriterEl: HTMLElement | null = null

    if (!skipTyping && textStr) {
      typewriterEl = document.createElement('span')
      typewriterEl.className = 'rewrite-typewriter'
      const caret = document.createElement('span')
      caret.className = 'rewrite-typewriter-caret'
      typewriterEl.appendChild(caret)
      // v16.1.0(审查修复 B1/B3): 打字机原位显示——淡出后清空旧段文字，打字机显示在
      // 段内原位（替代原 afterend 下方插入）。提交时旧段原位替换，视觉无跳动。
      if (blockEl) {
        // 移除旧段的淡出 class（已不可见），清空其文字（保持块结构与位置），原地追加打字机
        blockEl.classList.remove('rewrite-vanish')
        while (blockEl.firstChild) blockEl.removeChild(blockEl.firstChild)
        blockEl.appendChild(typewriterEl)
      } else {
        dom.appendChild(typewriterEl)
      }

      const chars = Array.from(textStr)
      let idx = 0
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (callbacks?.isAborted?.()) { resolve(); return }  // 放弃改写 → 中止
          if (!typewriterEl) { resolve(); return }
          const batch = Math.min(4, chars.length - idx)
          if (batch <= 0) { resolve(); return }
          const textNode = document.createTextNode(chars.slice(idx, idx + batch).join(''))
          typewriterEl.insertBefore(textNode, caret)
          idx += batch
          timers.push(setTimeout(tick, 12))
        }
        tick()
      })
    }

    if (callbacks?.isAborted?.()) { cleanup(); return false }  // 打字机后放弃 → 中止(不提交)

    // ── Phase 3: 提交真实 transaction（单步，Ctrl+Z 可撤销）──
    // 提交内容 = 打字机容器当前文本（用户看到什么就提交什么），否则用 newText
    const committed = typewriterEl
      ? (typewriterEl.textContent || '').replace(/​/g, '')
      : textStr
    if (!committed) {
      cleanup()
      return false
    }

    cleanup()  // 移除装饰 DOM + 恢复可编辑（dispatch 前，防 prosemirror 因 DOM 残留报错）
    cancelled = true  // cleanup 已恢复可编辑,避免 finally 重复

    const tr = editor.state.tr.replaceWith(from, to, editor.state.schema.text(committed))
    view.dispatch(tr)
    callbacks?.onCommitted?.()
    return true
  } catch {
    cleanup()
    return false
  }
}
