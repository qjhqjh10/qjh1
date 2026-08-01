// ── Task List Extraction Unit Tests ──
// 纯函数测试：extractTaskList 四重门控

import { describe, it, expect } from 'vitest'
import { extractTaskList } from '../utils/taskExtraction'

describe('extractTaskList', () => {
  it('S3 风格: 导语 + 编号三任务 → 提取 3 条', () => {
    const msg = '接下来一口气做三件事，别停：1）把outline/power_system.yaml填完整——九境修炼体系，每境名称、特征、突破条件写清楚，和古剑封印的解开挂钩；2）在characters里创建"江月白"，陆沉的青梅竹马，外表甜美但嘴特别毒的医修；3）看看陆沉的角色文件，如果灵根设定不对就改一下——他的灵根应该是被上古剑意震碎的，不是天生废材'
    const list = extractTaskList(msg)
    expect(list).not.toBeNull()
    expect(list!.length).toBe(3)
    expect(list![0].id).toBe(1)
    expect(list![0].desc).toContain('power_system.yaml')
    expect(list![1].desc).toContain('江月白')
    expect(list![2].desc).toContain('灵根')
  })

  it('纯编号: "1. 写… 2. 写… 3. 写…" → 3 条', () => {
    const msg = '1. 写完整的故事大纲 2. 创建三个角色卡 3. 生成第一章正文'
    const list = extractTaskList(msg)
    expect(list).not.toBeNull()
    expect(list!.length).toBe(3)
    expect(list!.map(t => t.desc)).toEqual(['写完整的故事大纲', '创建三个角色卡', '生成第一章正文'])
  })

  it('圈号: "① 填充… ② 填充… ③ 填充…" → 3 条', () => {
    const msg = '① 填充locations.yaml ② 填充factions.yaml ③ 填充emotion.yaml'
    const list = extractTaskList(msg)
    expect(list).not.toBeNull()
    expect(list!.length).toBe(3)
    expect(list![0].desc).toContain('locations')
  })

  it('单任务（无编号）→ null', () => {
    expect(extractTaskList('帮我写第3章')).toBeNull()
    expect(extractTaskList('写第3章，主角发现古墓')).toBeNull()
  })

  it('无任务关键词（聊天中的编号）→ null（门控 0）', () => {
    const msg = '你觉得1. 剧情和2. 角色哪个更吸引人'
    expect(extractTaskList(msg)).toBeNull()
  })

  it('条目过短/空条目 → null（门控 2）', () => {
    const msg = '1. 写大纲 2. 3. 写角色'
    expect(extractTaskList(msg)).toBeNull()
  })

  it('条目超长（>120 字）→ null（门控 2）', () => {
    const long = '写一个超长描述'.repeat(20)
    const msg = `1. ${long} 2. 创建角色卡 3. 生成章节`
    expect(extractTaskList(msg)).toBeNull()
  })

  it('条目无任务动词 → null（门控 3）', () => {
    const msg = '1. 大纲内容 2. 角色设定 3. 章节信息'
    expect(extractTaskList(msg)).toBeNull()
  })

  it('条目重复 → null（门控 4）', () => {
    const msg = '1. 写完整大纲 2. 写完整大纲'
    expect(extractTaskList(msg)).toBeNull()
  })

  it('编号非任务（"第1章 第2章"）→ null', () => {
    expect(extractTaskList('帮我看看第1章 第2章 第3章')).toBeNull()
  })

  it('编号跳号/不连续 → null', () => {
    expect(extractTaskList('1. 写完整大纲 3. 创建角色卡')).toBeNull()
  })

  it('边界: 恰好 2 条 → 返回；9 条 → null', () => {
    const two = '1. 写完整大纲 2. 创建角色卡'
    expect(extractTaskList(two)).not.toBeNull()
    expect(extractTaskList(two)!.length).toBe(2)
    const nine = Array.from({ length: 9 }, (_, i) => `${i + 1}. 写完整大纲${i + 1}`).join(' ')
    expect(extractTaskList(nine)).toBeNull()
  })

  it('句号数字（3.14）不误切 → null', () => {
    expect(extractTaskList('帮我计算 3.14 和 2.718 的和')).toBeNull()
  })
})
