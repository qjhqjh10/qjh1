import { describe, it, expect } from 'vitest'
import { HallucinationDetector } from '../runtime/HallucinationDetector'

describe('HallucinationDetector', () => {
  const detector = new HallucinationDetector()

  it('returns null for empty text', () => {
    expect(detector.detect('', new Set())).toBeNull()
    expect(detector.detect(null as any, new Set())).toBeNull()
  })

  it('returns null when no action claims detected', () => {
    expect(detector.detect('今天天气不错', new Set())).toBeNull()
    expect(detector.detect('Hello world', new Set())).toBeNull()
  })

  it('detects creation claim without corresponding tool', () => {
    const result = detector.detect('我已经创建了文件 test.md', new Set())
    expect(result).toContain('创建/生成')
  })

  it('passes when creation claim has create_file tool', () => {
    const result = detector.detect('我已经创建了文件 test.md', new Set(['create_file']))
    expect(result).toBeNull()
  })

  it('detects modification claim without corresponding tool', () => {
    const result = detector.detect('我已经修改了配置文件', new Set(['read_file']))
    expect(result).toContain('修改/编辑')
  })

  it('passes when modification claim has edit_file tool', () => {
    const result = detector.detect('我已经修改了配置文件', new Set(['edit_file']))
    expect(result).toBeNull()
  })

  it('detects deletion claim without corresponding tool', () => {
    const result = detector.detect('我已经删除了旧文件', new Set())
    expect(result).toContain('删除')
  })

  it('passes when deletion claim has delete_file tool', () => {
    const result = detector.detect('我已经删除了旧文件', new Set(['delete_file']))
    expect(result).toBeNull()
  })

  it('detects search claim without corresponding tool', () => {
    const result = detector.detect('我已经搜索了相关内容', new Set())
    expect(result).toContain('搜索')
  })

  it('detects English action claims', () => {
    const result = detector.detect('The file has been created successfully', new Set())
    expect(result).toContain('action claimed')
  })

  it('passes when English claim has matching tool', () => {
    const result = detector.detect('The file has been created successfully', new Set(['create_file']))
    expect(result).toBeNull()
  })

  it('returns null for partial claims that do not match patterns', () => {
    expect(detector.detect('我会帮你创建文件', new Set())).toBeNull()
    expect(detector.detect('需要修改一下', new Set())).toBeNull()
  })
})
