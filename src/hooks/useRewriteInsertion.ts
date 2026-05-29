import { useEffect } from 'react'
import { useStore } from '@/store'

/**
 * 统一的 AI 改写注入处理 hook。
 * RewritePage 和 ChapterWritingPage 共用此逻辑，
 * 避免在两个页面中重复 ~25 行相同的 insertionAction 处理代码。
 *
 * @param getContent - 获取当前编辑器内容的函数
 * @param setContent - 设置编辑器内容的函数
 * @param onApplied - 可选：内容变更后的回调（如自动保存）
 */
export function useRewriteInsertion(
  getContent: () => string,
  setContent: (text: string) => void,
  onApplied?: () => void,
) {
  const insertionAction = useStore(s => s.insertionAction)
  const setInsertionAction = useStore(s => s.setInsertionAction)

  useEffect(() => {
    if (insertionAction === null) return
    const { keyword, content: insContent, position, mode } = insertionAction
    const isRewrite = mode === 'rewrite'
    const currentContent = getContent()
    if (!insContent || !keyword) return

    const idx = currentContent.indexOf(keyword)
    if (idx < 0) return // keyword not found in current content

    let newText: string
    if (isRewrite) {
      const before = currentContent.slice(0, idx)
      const original = currentContent.slice(idx, idx + keyword.length)
      const after = currentContent.slice(idx + keyword.length)
      newText = before
        + '<span style="color: #dc2626; background: rgba(220,38,38,0.06); padding: 0 2px; border-radius: 2px;">' + original + '</span>'
        + '\n\n'
        + '<span style="color: #3b82f6; background: rgba(59,130,246,0.06); padding: 2px 4px; border-radius: 2px;">【改写建议】\n' + insContent + '</span>'
        + after
    } else if (position === 'before') {
      newText = currentContent.slice(0, idx) + '\n\n' + insContent + '\n\n' + currentContent.slice(idx)
    } else {
      newText = currentContent.slice(0, idx) + '\n\n' + insContent + '\n\n' + currentContent.slice(idx)
    }

    setContent(newText)
    setInsertionAction(null)
    onApplied?.()
  }, [insertionAction])
}
