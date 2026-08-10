import { describe, it, expect, beforeEach } from 'vitest'
import { useChapterCollabStore } from '@/store/chapterCollabStore'

describe('chapterCollabStore', () => {
  beforeEach(() => {
    useChapterCollabStore.getState().detach()
  })

  it('attach 建立关联: 锚 + 权威源快照', () => {
    const s = useChapterCollabStore.getState()
    s.attach('chapter3', '段落首尾', '全文内容')
    const st = useChapterCollabStore.getState()
    expect(st.active).toBe(true)
    expect(st.chapterId).toBe('chapter3')
    expect(st.anchorStack).toEqual(['段落首尾'])
    expect(st.text).toBe('全文内容')
    expect(st.selectionAnchor).toBe('段落首尾')
    expect(st.chapterVersion).toBe(0)
  })

  it('detach 清空全部状态', () => {
    const s = useChapterCollabStore.getState()
    s.attach('chapter3', '锚', '文')
    s.pushAnchor('新锚')
    s.setText('新文')
    useChapterCollabStore.getState().detach()
    const st = useChapterCollabStore.getState()
    expect(st.active).toBe(false)
    expect(st.chapterId).toBeNull()
    expect(st.anchorStack).toEqual([])
    expect(st.text).toBe('')
    expect(st.chapterVersion).toBe(0)
  })

  it('pushAnchor: 栈容量 3 且最新在前 + 版本递增', () => {
    const s = useChapterCollabStore.getState()
    s.attach('c1', '锚0', '文')
    s.pushAnchor('锚1')
    s.pushAnchor('锚2')
    s.pushAnchor('锚3')  // 超出 → 截断
    const st = useChapterCollabStore.getState()
    expect(st.anchorStack).toEqual(['锚3', '锚2', '锚1'])
    expect(st.chapterVersion).toBe(3)
  })

  it('pushAnchor 相同锚只递增版本不重复入栈', () => {
    const s = useChapterCollabStore.getState()
    s.attach('c1', '锚0', '文')
    s.pushAnchor('锚0')
    const st = useChapterCollabStore.getState()
    expect(st.anchorStack).toEqual(['锚0'])
    expect(st.chapterVersion).toBe(1)
  })

  it('dispatchRewrite/consumeAction: 写入→消费→置空(幂等)', () => {
    const s = useChapterCollabStore.getState()
    s.attach('c1', '锚', '文')
    s.dispatchRewrite({ chapterId: 'c1', anchor: '锚', newText: '新文' })
    expect(useChapterCollabStore.getState().pendingAction).toEqual({ chapterId: 'c1', anchor: '锚', newText: '新文' })
    const a = useChapterCollabStore.getState().consumeAction()
    expect(a).toEqual({ chapterId: 'c1', anchor: '锚', newText: '新文' })
    expect(useChapterCollabStore.getState().pendingAction).toBeNull()
    expect(useChapterCollabStore.getState().consumeAction()).toBeNull()
  })

  it('setText 实时同步权威源', () => {
    const s = useChapterCollabStore.getState()
    s.attach('c1', '锚', '旧文')
    s.setText('新文')
    expect(useChapterCollabStore.getState().text).toBe('新文')
  })

  it('setStreaming 特效状态镜像', () => {
    useChapterCollabStore.getState().setStreaming(true)
    expect(useChapterCollabStore.getState().streaming).toBe(true)
    useChapterCollabStore.getState().setStreaming(false)
    expect(useChapterCollabStore.getState().streaming).toBe(false)
  })

  it('setLastRewriteApplied / setNeedsReload 状态写入', () => {
    const s = useChapterCollabStore.getState()
    s.setLastRewriteApplied(true)
    expect(useChapterCollabStore.getState().lastRewriteApplied).toBe(true)
    s.setNeedsReload(true)
    expect(useChapterCollabStore.getState().needsReload).toBe(true)
    // detach 时重置
    useChapterCollabStore.getState().detach()
    expect(useChapterCollabStore.getState().lastRewriteApplied).toBeNull()
    expect(useChapterCollabStore.getState().needsReload).toBe(false)
  })
})
