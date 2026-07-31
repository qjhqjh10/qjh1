import { describe, it, expect } from 'vitest'
import { sanitizeFileName, validateUrl } from '../security'

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
