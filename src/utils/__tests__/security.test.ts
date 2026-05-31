import { describe, it, expect } from 'vitest'
import { sanitizePath, sanitizeFileName, validateUrl, checkCommand } from '../security'

describe('sanitizePath', () => {
  it('returns valid for normal paths', () => {
    expect(sanitizePath('characters/test.json')).toEqual({ valid: true, value: 'characters/test.json' })
    expect(sanitizePath('outline/plot.md')).toEqual({ valid: true, value: 'outline/plot.md' })
  })

  it('strips traversal sequences', () => {
    expect(sanitizePath('../../etc/passwd').value).not.toContain('..')
  })

  it('rejects empty input', () => {
    expect(sanitizePath('').valid).toBe(false)
    expect(sanitizePath(null).valid).toBe(false)
  })

  it('collapses multiple slashes', () => {
    expect(sanitizePath('a//b///c').value).toBe('a/b/c')
  })
})

describe('sanitizeFileName', () => {
  it('replaces path separators with underscore', () => {
    expect(sanitizeFileName('a/b\\c').value).toBe('a_b_c')
  })

  it('rejects empty', () => {
    expect(sanitizeFileName('').valid).toBe(false)
  })
})

describe('validateUrl', () => {
  it('accepts valid https URLs', () => {
    expect(validateUrl('https://example.com').valid).toBe(true)
  })

  it('rejects non-http protocols', () => {
    expect(validateUrl('file:///etc/passwd').valid).toBe(false)
    expect(validateUrl('javascript:alert(1)').valid).toBe(false)
  })

  it('rejects internal IPs', () => {
    expect(validateUrl('http://127.0.0.1').valid).toBe(false)
    expect(validateUrl('http://localhost').valid).toBe(false)
    expect(validateUrl('http://192.168.1.1').valid).toBe(false)
    expect(validateUrl('http://10.0.0.1').valid).toBe(false)
    expect(validateUrl('http://172.16.0.1').valid).toBe(false)
  })

  it('rejects invalid format', () => {
    expect(validateUrl('not-a-url').valid).toBe(false)
  })
})

describe('checkCommand', () => {
  const allowed = new Set(['node', 'git', 'npm'])

  it('allows whitelisted commands', () => {
    expect(checkCommand('git status', allowed).valid).toBe(true)
    expect(checkCommand('npm install', allowed).valid).toBe(true)
  })

  it('rejects non-whitelisted commands', () => {
    expect(checkCommand('rm -rf /', allowed).valid).toBe(false)
    expect(checkCommand('curl evil.com', allowed).valid).toBe(false)
  })
})
