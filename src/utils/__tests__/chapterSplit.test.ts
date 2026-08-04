// v15.1: 章节拆分误判排除验证 — 正文段落以「第X」开头（第二节课/第三回合/第三集结尾等）
// 不得被当作章节标题；真实章节标题（第X章/卷/节/回/集 + 番外/楔子/尾声）正常识别
import { describe, it, expect } from 'vitest'
import { splitChaptersByHeadings, CHAPTER_FALSE_POSITIVE_HEAD, CHAPTER_FALSE_POSITIVE_TAIL } from '../textUtils'

describe('章节拆分误判排除 (v15.1)', () => {
  it('正文段落以「第二节课」「第三天」等开头 → 不拆出伪章节', () => {
    const content = [
      '第一章 初入学院',
      '第二天早上，林晓来到学院门口，看到高先正在等她。',
      '第二节课开始，老师走进教室，开始点名。',
      '第三章 期中考试',
      '第三回合，两人再次交手，剑光闪烁。',
    ].join('\n')
    const chapters = splitChaptersByHeadings(content)
    expect(chapters.map(c => c.title)).toEqual(['第一章 初入学院', '第三章 期中考试'])
    expect(chapters[0].content).toContain('第二天早上')
    expect(chapters[0].content).toContain('第二节课开始')
    expect(chapters[1].content).toContain('第三回合')
  })

  it('「第X集+正文延续词」「第X卷+正文词」开头 → 不拆出伪章节', () => {
    const content = [
      '第一章 开篇',
      '第三集结尾，主角终于看到了真相，泪流满面。',
      '第一集播出后，反响热烈，收视率创新高。',
      '第二章 转折',
      '第二卷土重来，他发誓要讨回公道。',
    ].join('\n')
    const chapters = splitChaptersByHeadings(content)
    expect(chapters.map(c => c.title)).toEqual(['第一章 开篇', '第二章 转折'])
  })

  it('以句号结尾的行不算章节（正文句子保护）', () => {
    const content = [
      '第一章 开篇',
      '第七回合结束后，裁判宣布比赛结果，全场掌声雷动。',
      '第二章 继续',
      '他收拾好行囊，踏上了新的旅程。',
    ].join('\n')
    const chapters = splitChaptersByHeadings(content)
    expect(chapters.map(c => c.title)).toEqual(['第一章 开篇', '第二章 继续'])
    expect(chapters[0].content).toContain('第七回合结束后')
  })

  it('正常章节标题（含分隔符与标题内容）不受影响', () => {
    const content = [
      '第一章：初入江湖',
      '正文内容一。',
      '第二章-客栈奇遇',
      '正文内容二。',
      '番外一 夏日祭',
      '正文内容三。',
      '尾声',
      '故事在这里结束了，所有人都获得了幸福。',
    ].join('\n')
    const chapters = splitChaptersByHeadings(content)
    expect(chapters.map(c => c.title)).toEqual(['第一章：初入江湖', '第二章-客栈奇遇', '番外一 夏日祭', '尾声'])
  })

  it('排除正则自身语义正确', () => {
    expect(CHAPTER_FALSE_POSITIVE_HEAD.test('第二节课开始，老师走进教室。')).toBe(true)
    expect(CHAPTER_FALSE_POSITIVE_HEAD.test('第三回合，两人再次交手。')).toBe(true)
    expect(CHAPTER_FALSE_POSITIVE_HEAD.test('第七场比赛中，他获得了胜利。')).toBe(true)
    expect(CHAPTER_FALSE_POSITIVE_TAIL.test('第三集结尾，主角看到了真相。')).toBe(true)
    expect(CHAPTER_FALSE_POSITIVE_TAIL.test('第二卷土重来，他发誓讨回公道。')).toBe(true)
    // 真实章节标题不应命中排除
    expect(CHAPTER_FALSE_POSITIVE_HEAD.test('第一章 初入学院')).toBe(false)
    expect(CHAPTER_FALSE_POSITIVE_HEAD.test('第三章 决战紫禁')).toBe(false)
    expect(CHAPTER_FALSE_POSITIVE_TAIL.test('第一章 初入学院')).toBe(false)
  })
})
