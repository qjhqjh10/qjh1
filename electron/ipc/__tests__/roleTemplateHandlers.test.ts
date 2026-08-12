// ── 角色模板文件夹 yaml round-trip 测试（v16.4.0）──
// 「一个模板=一个文件夹」：角色内容存 characters/<角色名>.yaml，
// 长文本/特殊字符序列化必须 round-trip 无损（导入不丢设定）。

import { describe, it, expect } from 'vitest'
import { buildCharYaml, parseCharYaml } from '../roleTemplateHandlers'

describe('buildCharYaml / parseCharYaml round-trip (v16.4.0)', () => {
  const full = {
    name: '女主',
    identity: '女主',
    gender: '女',
    isUser: false,
    avatar: '',
    personality: '外冷内热，说话带刺但关心人。\n喜欢用「哼」开头怼人。\n特殊符号: 【】「」「〜〜」&<>、"引号"、' + "'单引号'" + '、emoji 🎭、换行\n\t制表符、: 冒号后面接内容',
    relationship: '与男主是青梅竹马，表面互相嫌弃实则在意。\n对师父抱有愧疚（因为当年的事）。',
    firstMessage: '"你来了。"她头也不抬地说。',
    exampleDialogue: '女主：哼，你又迟到了。\n男主：路上遇到点事。\n女主：少找借口。',
  }

  it('完整字段 round-trip 无损（含长文本/特殊符号/换行/引号）', () => {
    const yaml = buildCharYaml(full)
    const parsed = parseCharYaml(yaml)
    expect(parsed).toEqual(full)
  })

  it('isUser 布尔值保持（false 不丢）', () => {
    const yaml = buildCharYaml({ ...full, isUser: false })
    expect(parseCharYaml(yaml)?.isUser).toBe(false)
    const yaml2 = buildCharYaml({ ...full, isUser: true })
    expect(parseCharYaml(yaml2)?.isUser).toBe(true)
  })

  it('损坏 yaml 返回 null（导入跳过该文件不崩溃）', () => {
    expect(parseCharYaml('{{{ 不是 yaml')).toBeNull()
    expect(parseCharYaml('')).toBeNull()
  })

  it('空字段序列化为空字符串（导出稳定）', () => {
    const empty = {
      name: '路人甲', identity: '路人', gender: '男', isUser: true,
      avatar: '', personality: '', relationship: '', firstMessage: '', exampleDialogue: '',
    }
    const parsed = parseCharYaml(buildCharYaml(empty))
    expect(parsed?.name).toBe('路人甲')
    expect(parsed?.personality).toBe('')
    expect(parsed?.exampleDialogue).toBe('')
  })
})
