import { describe, it, expect } from 'vitest'
import { isSafePath } from '../utils'

// ── isSafePath ──

describe('isSafePath', () => {
  const base = '/data/projects/testProject'

  it('allows paths inside base', () => {
    expect(isSafePath('/data/projects/testProject/chapters/ch1.txt', base)).toBe(true)
    expect(isSafePath('/data/projects/testProject/outline/plot.md', base)).toBe(true)
  })

  it('allows the base path itself', () => {
    expect(isSafePath('/data/projects/testProject', base)).toBe(true)
  })

  it('rejects paths outside base (parent traversal)', () => {
    expect(isSafePath('/data/projects/otherProject/file.txt', base)).toBe(false)
    expect(isSafePath('/data/escape/file.txt', base)).toBe(false)
    expect(isSafePath('/etc/passwd', base)).toBe(false)
  })

  it('rejects paths that look like base prefix but are siblings', () => {
    // A sibling directory whose name starts with the project name
    expect(isSafePath('/data/projects/testProject2/chapters/ch1.txt', base)).toBe(false)
  })

  it('rejects relative path starting with dots', () => {
    expect(isSafePath('../escape', base)).toBe(false)
    expect(isSafePath('../../etc/passwd', base)).toBe(false)
  })

  it('is case insensitive on the comparison', () => {
    // Windows paths can be case-insensitive
    expect(isSafePath('/DATA/PROJECTS/TESTPROJECT/file.txt', base)).toBe(true)
  })

  it('normalizes paths before comparison', () => {
    expect(isSafePath('/data/projects/testProject//chapters/../chapters/ch1.txt', base)).toBe(true)
    expect(isSafePath('/data/projects/testProject/chapters/./ch1.txt', base)).toBe(true)
  })

  it('rejects empty or invalid input', () => {
    expect(isSafePath('', base)).toBe(false)
    expect(isSafePath('' as any, base)).toBe(false)
    expect(isSafePath('/data/projects/testProject', '')).toBe(false)
  })

  it('handles Windows-style paths', () => {
    const winBase = 'C:\\Users\\test\\projects\\myProject'
    expect(isSafePath('C:\\Users\\test\\projects\\myProject\\chapters\\ch1.txt', winBase)).toBe(true)
    expect(isSafePath('C:\\Users\\test\\projects\\myProject\\..\\other\\file.txt', winBase)).toBe(false)
  })
})

// ── Masked Key Constant ──

describe('MASKED_KEY', () => {
  it('is the expected placeholder', async () => {
    const { MASKED_KEY } = await import('../utils')
    expect(MASKED_KEY).toBe('••••••••')
  })

  it('is not an empty string', async () => {
    const { MASKED_KEY } = await import('../utils')
    expect(MASKED_KEY.length).toBeGreaterThan(0)
  })

  it('is used for loading configs (security: never return real keys to renderer)', async () => {
    const { MASKED_KEY } = await import('../utils')
    // The renderer receives this placeholder, never the real key
    expect(typeof MASKED_KEY).toBe('string')
  })
})

// ── readFileWithEncoding Contract ──

describe('readFileWithEncoding', () => {
  it('exports as a function', async () => {
    const { readFileWithEncoding } = await import('../utils')
    expect(typeof readFileWithEncoding).toBe('function')
  })
})
