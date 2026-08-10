import { describe, it, expect } from 'vitest'
import { locateAnchor, makeAnchor, locateParagraph } from '@/utils/anchorMatch'

describe('makeAnchor', () => {
  it('短文本(<20字)直接返回原文', () => {
    expect(makeAnchor('你好世界')).toBe('你好世界')
    expect(makeAnchor('')).toBe('')
  })
  it('长文本取首尾各20字', () => {
    const text = '春'.repeat(50)
    const anchor = makeAnchor(text)
    expect(anchor).toBe('春'.repeat(20) + '……' + '春'.repeat(20))
  })
})

describe('locateAnchor', () => {
  it('精确匹配唯一命中', () => {
    const full = '第一章开始。这是锚点内容。第二章继续。'
    const r = locateAnchor(full, ['这是锚点内容'])
    expect(r.matchedBy).toBe('exact')
    expect(full.slice(r.from, r.to)).toBe('这是锚点内容')
  })
  it('多命中精确不匹配 → 降级首尾', () => {
    const full = '锚点内容 锚点内容'
    const r = locateAnchor(full, ['锚点内容'])
    // 短锚(≤20字) head===tail 且多处出现 → 歧义拒绝
    expect(r.matchedBy).toBe(null)
  })
  it('锚被改写后旧锚不精确命中 → 首尾定位', () => {
    // 旧锚 >20 字 → makeAnchor 语义(首尾20字) — head 与 tail 不同，headtail 分支生效
    const oldAnchor = '旧锚点开头的这一段文字内容很长很详细中间部分被改写了旧锚点结尾这一段文字也很长'
    const head = oldAnchor.slice(0, 20)
    const tail = oldAnchor.slice(-20)
    const full = `${head}中间内容完全不同了${tail}`
    const r = locateAnchor(full, [oldAnchor])
    expect(r.matchedBy).toBe('headtail')
    expect(full.slice(r.from, r.to)).toContain(head)
    expect(full.slice(r.from, r.to)).toContain(tail)
  })
  it('头位置>尾位置(内容倒序) → 拒绝', () => {
    const full = '尾巴在前头在后'
    const r = locateAnchor(full, ['头尾巴'])
    expect(r.matchedBy).toBe(null)
  })
  it('空栈/空文本 → null', () => {
    expect(locateAnchor('', ['x']).matchedBy).toBe(null)
    expect(locateAnchor('内容', []).matchedBy).toBe(null)
    expect(locateAnchor('内容', ['不存在']).matchedBy).toBe(null)
  })
  it('锚栈降级: 最新锚失败 → 旧锚兜底', () => {
    const full = '这是最新版本的内容段落内容完全不一样了'
    const r = locateAnchor(full, ['完全不存在的锚', '这是最新版本的内容'])
    expect(r.matchedBy).toBe('exact')
  })
})

describe('locateParagraph', () => {
  // 真实 TipTap: doc.textBetween(0, size, '\n\n') 返回块间以 '\n\n' 连接、位置索引一致。
  // mock 直接透传（文本本身含 '\n\n' 分隔），保证 from/to 与 fullText 索引对齐。
  const makeDoc = (text: string) => ({
    textBetween: (from: number, to: number) => text.slice(from, to),
    content: { size: text.length },
  })

  it('扩展到整个段落(段首到段尾)', () => {
    const text = '第一段内容\n\n第二段锚点在这\n\n第三段'
    const doc = makeDoc(text) as any
    const m = locateAnchor(text, ['锚点在这'])
    const para = locateParagraph(doc, m.from, m.to)
    expect(para).not.toBeNull()
    expect(text.slice(para!.from, para!.to)).toBe('第二段锚点在这')
  })
  it('匹配在段中时 from 向前扩到段首', () => {
    const text = '段首文字AAAA锚点BBBB段尾'
    const doc = makeDoc(text) as any
    const m = locateAnchor(text, ['锚点'])
    const para = locateParagraph(doc, m.from, m.to)
    expect(para).not.toBeNull()
    expect(text.slice(para!.from, para!.to)).toBe('段首文字AAAA锚点BBBB段尾')
  })
  it('越界 → null', () => {
    const doc = makeDoc('短文本') as any
    expect(locateParagraph(doc, -1, 5)).toBeNull()
    expect(locateParagraph(doc, 0, 999)).toBeNull()
  })
})
