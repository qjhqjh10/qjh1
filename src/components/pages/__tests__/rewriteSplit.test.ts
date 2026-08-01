// H10: 自定义正则拆章（splitByCustomRegex）验证
import { describe, it, expect } from 'vitest'
import { splitByCustomRegex } from '../RewriteCreateWizard'

const SAMPLE = `第一卷 风云起
第一章 初入江湖
正文内容一...
第二章 客栈奇遇
正文内容二...
第三章 决战紫禁
正文内容三...`

describe('splitByCustomRegex (H10)', () => {
  it('无捕获组正则正常拆章，标题正确、正文完整', () => {
    const results = splitByCustomRegex(SAMPLE, '第[一二三四五六七八九十]+章')
    expect(results.length).toBe(3)
    expect(results[0].title).toBe('第一章 初入江湖')
    expect(results[0].content).toContain('正文内容一')
    expect(results[2].title).toBe('第三章 决战紫禁')
    expect(results[2].content).toContain('正文内容三')
  })

  it('带捕获组正则不再错位（原实现标题/正文互换）', () => {
    const results = splitByCustomRegex(SAMPLE, '(第[一二三四五六七八九十]+章|第[一二三四五六七八九十]+卷)')
    // 第一卷 也会被匹配为标题（按匹配文本），共 4 个匹配
    expect(results.length).toBe(4)
    expect(results[0].title).toBe('第一卷 风云起')
    expect(results[1].title).toBe('第一章 初入江湖')
    expect(results[1].content).toContain('正文内容一')
    expect(results[2].title).toBe('第二章 客栈奇遇')
  })

  it('行首 # 标记从标题剥离', () => {
    const md = '# 第一章\n\n正文一\n\n# 第二章\n\n正文二'
    const results = splitByCustomRegex(md, '#{1,6}\\s*第.+章')
    expect(results[0].title).toBe('第一章')
    expect(results[0].content).toContain('正文一')
    expect(results[1].title).toBe('第二章')
  })

  it('零长匹配（如 x*）被过滤，不产生空标题章节', () => {
    const results = splitByCustomRegex('第一章 你好\n正文内容', '第.*章')
    expect(results.length).toBeGreaterThanOrEqual(1)
    for (const r of results) {
      expect(r.title.length).toBeGreaterThan(0)
    }
  })

  it('纯零长匹配正则（x* 无实质匹配）全部过滤 → 回退全文（审查补强：真触发零长路径）', () => {
    const results = splitByCustomRegex('第一章 你好\n正文内容', 'x*')
    expect(results).toEqual([{ title: '全文', content: '第一章 你好\n正文内容' }])
  })

  it('无匹配回退"全文"', () => {
    const results = splitByCustomRegex('没有任何章节标题的正文', '第X章')
    expect(results).toEqual([{ title: '全文', content: '没有任何章节标题的正文' }])
  })

  it('空正则抛错', () => {
    expect(() => splitByCustomRegex('text', '')).toThrow('请输入自定义拆分正则')
  })
})
