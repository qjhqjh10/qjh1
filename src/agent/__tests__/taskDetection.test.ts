import { describe, it, expect } from 'vitest'
import { isTaskMessage } from '../utils/taskDetection'

describe('isTaskMessage', () => {
  it('detects task-oriented messages', () => {
    expect(isTaskMessage('帮我创建一个新文件')).toBe(true)
    expect(isTaskMessage('请编辑第一章')).toBe(true)
    expect(isTaskMessage('删除旧的配置文件')).toBe(true)
    expect(isTaskMessage('搜索所有角色文件')).toBe(true)
    expect(isTaskMessage('查看大纲')).toBe(true)
    expect(isTaskMessage('列出所有笔记')).toBe(true)
    expect(isTaskMessage('生成一个新角色')).toBe(true)
  })

  it('detects novel-writing specific keywords', () => {
    expect(isTaskMessage('写一个大纲')).toBe(true)
    expect(isTaskMessage('帮我创建一个新文件')).toBe(true)
    expect(isTaskMessage('续写第二章')).toBe(true)
    expect(isTaskMessage('分析角色性格')).toBe(true)
    expect(isTaskMessage('润色这段文字')).toBe(true)
    expect(isTaskMessage('改写这段对话')).toBe(true)
    expect(isTaskMessage('仿写鲁迅的风格')).toBe(true)
  })

  it('does NOT trigger on casual chat', () => {
    expect(isTaskMessage('你好')).toBe(false)
    expect(isTaskMessage('今天天气怎么样')).toBe(false)
    expect(isTaskMessage('你觉得这个故事怎么样')).toBe(false)
    expect(isTaskMessage('写得好')).toBe(false)
    expect(isTaskMessage('改变主意了')).toBe(false)
    expect(isTaskMessage('帮我看看')).toBe(false)
    expect(isTaskMessage('谢谢')).toBe(false)
  })

  it('handles English messages (no Chinese keywords)', () => {
    expect(isTaskMessage('Hello, how are you?')).toBe(false)
    expect(isTaskMessage('Please help me')).toBe(false)
  })

  it('detects compound keywords with 帮我', () => {
    expect(isTaskMessage('帮我写一个角色')).toBe(true)
    expect(isTaskMessage('帮我改一下大纲')).toBe(true)
    expect(isTaskMessage('帮我创建项目')).toBe(true)
  })

  it('does NOT trigger on bare 写 or 改', () => {
    expect(isTaskMessage('写得好')).toBe(false)
    expect(isTaskMessage('改天再说')).toBe(false)
  })
})
