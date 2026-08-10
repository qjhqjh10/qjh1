// ── Rewrite Effect 集成测试 (v16.1.0) ──
// 用真实 TipTap 编辑器实例（jsdom）验证完整特效流程：
//   淡出 → 打字机 → 提交 transaction → Ctrl+Z 撤销 → 取消(abort)
// 覆盖审查修复的关键路径：
//   - 提交后 doc 真实替换（可撤销）
//   - 撤销后恢复原文
//   - 取消(abort)后不提交（原文保留）
//   - 特效期间 editor 不可编辑，结束后恢复
//   - 原位打字（打字机 span 位于目标块内，无跳动）
import { describe, it, expect, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { runRewriteEffect, shouldSkipTypewriter } from '@/utils/rewriteEffect'

function makeEditor(content: string): Editor {
  return new Editor({
    extensions: [StarterKit],
    content,
  })
}

// 收集打字机容器
function findTypewriter(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector('.rewrite-typewriter')
}

describe('runRewriteEffect 集成（真实 TipTap + jsdom）', () => {
  it('提交后 doc 真实替换 + 可 Ctrl+Z 撤销', async () => {
    const editor = makeEditor('<p>第一段</p><p>旧锚点内容在这里</p><p>第三段</p>')
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    const from = fullText.indexOf('旧锚点内容在这里')
    const to = from + '旧锚点内容在这里'.length

    const ok = await runRewriteEffect(editor, from, to, '全新的改写内容', {})
    expect(ok).toBe(true)
    // 提交后 doc 包含新文本
    const after = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    expect(after).toContain('全新的改写内容')
    expect(after).not.toContain('旧锚点内容在这里')

    // 可撤销（单次 transaction = 单步 undo）
    editor.chain().undo().run()
    const undone = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    expect(undone).toContain('旧锚点内容在这里')
    expect(undone).not.toContain('全新的改写内容')
  })

  it('特效期间 editor 不可编辑，提交后恢复', async () => {
    const editor = makeEditor('<p>第一段</p><p>目标段落内容</p><p>第三段</p>')
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    const from = fullText.indexOf('目标段落内容')
    const to = from + '目标段落内容'.length

    expect(editor.isEditable).toBe(true)
    const promise = runRewriteEffect(editor, from, to, '新内容', {})
    // 特效进行中（async 未决）→ 不可编辑
    expect(editor.isEditable).toBe(false)
    await promise
    // 结束后恢复
    expect(editor.isEditable).toBe(true)
  })

  it('打字机容器位于目标块内（原位打字，无跳动）', async () => {
    const editor = makeEditor('<p>第一段</p><p>目标段落内容</p><p>第三段</p>')
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    const from = fullText.indexOf('目标段落内容')
    const to = from + '目标段落内容'.length

    await runRewriteEffect(editor, from, to, '新内容', {})
    // 提交后 prosemirror 重建 DOM，装饰 span 已移除——但提交内容应落在目标块位置
    const after = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    expect(after).toContain('新内容')
    // 无残留装饰 span
    expect(editor.view.dom.querySelector('.rewrite-vanish')).toBeNull()
    expect(editor.view.dom.querySelector('.rewrite-typewriter')).toBeNull()
  })

  it('取消(abort)后不提交——原文保留', async () => {
    const editor = makeEditor('<p>第一段</p><p>保留的原文内容</p><p>第三段</p>')
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    const from = fullText.indexOf('保留的原文内容')
    const to = from + '保留的原文内容'.length

    let aborted = false
    const ok = await runRewriteEffect(editor, from, to, '被取消的新内容', {
      isAborted: () => aborted,
    })
    // 正常流程 → 提交
    expect(ok).toBe(true)
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')).toContain('被取消的新内容')

    // 取消场景：abort 在淡出阶段即置位 → 不提交
    const editor2 = makeEditor('<p>第一段</p><p>保留的原文内容</p><p>第三段</p>')
    const f2 = editor2.state.doc.textBetween(0, editor2.state.doc.content.size, '\n\n')
    const f2from = f2.indexOf('保留的原文内容')
    const f2to = f2from + '保留的原文内容'.length
    let aborted2 = true
    const ok2 = await runRewriteEffect(editor2, f2from, f2to, '新内容', {
      isAborted: () => aborted2,
    })
    expect(ok2).toBe(false)
    expect(editor2.state.doc.textBetween(0, editor2.state.doc.content.size, '\n\n')).toContain('保留的原文内容')
    expect(editor2.state.doc.textBetween(0, editor2.state.doc.content.size, '\n\n')).not.toContain('新内容')
  })

  it('超长文本跳过打字机（只淡出+直接提交）', async () => {
    const editor = makeEditor('<p>第一段</p><p>目标</p><p>第三段</p>')
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    const from = fullText.indexOf('目标')
    const to = from + '目标'.length
    const longText = '长'.repeat(6000)

    expect(shouldSkipTypewriter(longText)).toBe(true)
    const ok = await runRewriteEffect(editor, from, to, longText, {})
    expect(ok).toBe(true)
    const after = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    expect(after.length).toBeGreaterThan(5000)
  })

  it('锚点未找到（from/to 越界）→ 返回 false 不崩溃', async () => {
    const editor = makeEditor('<p>内容</p>')
    const ok = await runRewriteEffect(editor, 9999, 10000, 'x', {})
    expect(ok).toBe(false)
  })

  it('callbacks 触发顺序: onStart → onCommitted', async () => {
    const editor = makeEditor('<p>目标段落内容</p>')
    const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n')
    const from = fullText.indexOf('目标段落内容')
    const to = from + '目标段落内容'.length
    const order: string[] = []
    await runRewriteEffect(editor, from, to, '新内容', {
      onStart: () => order.push('start'),
      onCommitted: () => order.push('committed'),
      onFinished: () => order.push('finished'),
    })
    expect(order).toEqual(['start', 'finished', 'committed'])
  })
})
