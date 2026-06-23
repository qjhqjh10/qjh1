import { describe, it, expect } from 'vitest'
import { stripHtml, countChineseWords, countCJKChars, formatWordCount } from '@/utils/textUtils'

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello</p>')).toBe('Hello')
  })

  it('removes nested tags', () => {
    expect(stripHtml('<div><p>Nested</p></div>')).toBe('Nested')
  })

  it('returns plain text unchanged', () => {
    expect(stripHtml('plain text')).toBe('plain text')
  })

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('')
  })
})

describe('countChineseWords', () => {
  it('counts Chinese characters', () => {
    expect(countChineseWords('你好世界')).toBe(4)
  })

  it('strips HTML before counting', () => {
    expect(countChineseWords('<p>你好</p>')).toBe(2)
  })

  it('counts all non-whitespace characters after stripping HTML', () => {
    expect(countChineseWords('你好，世界！')).toBe(6)
  })

  it('returns 0 for empty string', () => {
    expect(countChineseWords('')).toBe(0)
  })

  it('counts mixed content', () => {
    expect(countChineseWords('Hello世界')).toBe(7)
  })
})

describe('countCJKChars', () => {
  it('counts Chinese characters only', () => {
    expect(countCJKChars('你好世界')).toBe(4)
  })

  it('excludes ASCII characters', () => {
    expect(countCJKChars('Hello世界')).toBe(2)
  })

  it('excludes Chinese punctuation', () => {
    expect(countCJKChars('你好，世界！')).toBe(4)
  })

  it('returns 0 for empty string', () => {
    expect(countCJKChars('')).toBe(0)
  })

  it('returns 0 for pure ASCII', () => {
    expect(countCJKChars('Hello')).toBe(0)
  })
})

describe('formatWordCount', () => {
  it('formats small numbers as-is', () => {
    expect(formatWordCount(500)).toBe('500')
  })

  it('formats numbers >= 10000 as "万"', () => {
    expect(formatWordCount(50000)).toBe('5.0万')
  })

  it('handles zero', () => {
    expect(formatWordCount(0)).toBe('0')
  })
})
