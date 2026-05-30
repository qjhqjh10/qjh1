// ── Intent Analyzer Tests ──
// Tests for the extracted analyzeIntent pure function.

import { describe, it, expect } from 'vitest'
import { analyzeIntent } from '../runtime/intentAnalyzer'

describe('analyzeIntent', () => {
  it('detects create_file intent from "创建" keyword', () => {
    const result = analyzeIntent('请创建一个新文件test.md')
    expect(result.steps.some(s => s.tool === 'create_file')).toBe(true)
  })

  it('detects edit_file intent from "编辑" keyword', () => {
    const result = analyzeIntent('请编辑现有文件的内容')
    expect(result.steps.some(s => s.tool === 'edit_file')).toBe(true)
  })

  it('detects read_file intent from "查看" keyword', () => {
    const result = analyzeIntent('请查看项目目录下的文件')
    expect(result.steps.some(s => s.tool === 'read_file')).toBe(true)
  })

  it('detects delete_file intent from "删除" keyword', () => {
    const result = analyzeIntent('删除不需要的临时文件')
    expect(result.steps.some(s => s.tool === 'delete_file')).toBe(true)
  })

  it('defaults to read_file when no keyword matches', () => {
    const result = analyzeIntent('你好，请帮我分析一下')
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].tool).toBe('read_file')
    expect(result.steps[0].action).toBe('分析需求')
  })

  it('truncates intent to 100 characters', () => {
    const long = 'A'.repeat(200)
    const result = analyzeIntent(long)
    expect(result.intent.length).toBeLessThanOrEqual(100)
  })

  it('sets timestamp to current time', () => {
    const before = Date.now()
    const result = analyzeIntent('测试')
    expect(result.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('returns 500 estimated tokens', () => {
    const result = analyzeIntent('测试消息')
    expect(result.estimatedTokens).toBe(500)
  })
})
