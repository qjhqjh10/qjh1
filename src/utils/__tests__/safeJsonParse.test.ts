import { describe, it, expect } from 'vitest'
import { safeJsonParse, safeJsonParseAs } from '../safeJsonParse'

describe('safeJsonParse', () => {
  it('parses valid JSON object directly', () => {
    expect(safeJsonParse('{"a":1,"b":"hello"}')).toEqual({ a: 1, b: 'hello' })
  })

  it('parses valid JSON array directly', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('handles trailing comma before }', () => {
    expect(safeJsonParse('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 })
  })

  it('handles trailing comma before ]', () => {
    expect(safeJsonParse('[1,2,3,]')).toEqual([1, 2, 3])
  })

  it('handles multiple trailing commas', () => {
    expect(safeJsonParse('{"a":1,  "b":[1,2,],  }')).toEqual({ a: 1, b: [1, 2] })
  })

  it('handles whitespace around trailing comma', () => {
    expect(safeJsonParse('{"a":1,\n  }')).toEqual({ a: 1 })
  })

  it('extracts first JSON object from text with surrounding content', () => {
    const result = safeJsonParse('Some text before {"name":"test","value":42} and after')
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('extracts first JSON array from text', () => {
    const result = safeJsonParse('prefix [10,20,30] suffix')
    expect(result).toEqual([10, 20, 30])
  })

  it('handles nested objects with trailing commas', () => {
    const result = safeJsonParse('{"outer":{"inner":1,},}')
    expect(result).toEqual({ outer: { inner: 1 } })
  })

  it('preserves commas inside string values', () => {
    const result = safeJsonParse('{"text":"hello, world","key":2,}')
    expect(result).toEqual({ text: 'hello, world', key: 2 })
  })

  it('handles strings containing comma-brace pattern', () => {
    // The old regex would incorrectly strip the comma from "he said,}"
    const result = safeJsonParse('{"msg":"he said,}","flag":true}')
    expect(result).toEqual({ msg: 'he said,}', flag: true })
  })

  it('returns null for non-JSON text', () => {
    expect(safeJsonParse('this is not json at all')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(safeJsonParse('')).toBeNull()
  })

  it('handles complex AI-generated JSON with multiple issues', () => {
    const input = `Here is the analysis:
{
  "characters": [{"name": "Alice", "role": "main", "traits": ["brave", "smart",]}],
  "summary": "Chapter about Alice's journey",
  "wordCount": 3000,
}`
    expect(safeJsonParse(input)).toEqual({
      characters: [{ name: 'Alice', role: 'main', traits: ['brave', 'smart'] }],
      summary: "Chapter about Alice's journey",
      wordCount: 3000,
    })
  })

  it('handles single quotes as fallback', () => {
    const result = safeJsonParse("{'name':'test','value':42,}")
    // Single-quote fix may or may not work depending on content, but should not crash
    // The direct parse fails, trailing-comma fix fails, single-quote fix is attempted
    // If all fail, returns null
    expect(result === null || result === undefined).toBeFalsy()
    if (result) {
      expect((result as any).name).toBe('test')
    }
  })
})

describe('safeJsonParseAs', () => {
  interface TestType {
    name: string
    value: number
  }

  it('returns typed object', () => {
    const result = safeJsonParseAs<TestType>('{"name":"test","value":42,}')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('test')
    expect(result!.value).toBe(42)
  })

  it('returns null for invalid input', () => {
    const result = safeJsonParseAs<TestType>('not json')
    expect(result).toBeNull()
  })
})
