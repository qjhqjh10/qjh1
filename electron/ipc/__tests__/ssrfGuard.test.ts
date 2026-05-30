// ── SSRF Guard Tests ──
// The ssrfGuard module is the shared SSRF protection used by both
// httpHandlers and browserHandlers. These tests verify the two-layer
// defense: regex URL matching + DNS resolution.

import { describe, it, expect, vi } from 'vitest'
import { isPrivateIP, resolvesToPrivateIP, sanitizeUrl } from '../ssrfGuard'

describe('sanitizeUrl', () => {
  it('adds https:// prefix if missing', () => {
    expect(sanitizeUrl('example.com')).toBe('https://example.com')
    expect(sanitizeUrl('  api.example.com  ')).toBe('https://api.example.com')
  })

  it('preserves existing http:// scheme', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com')
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
  })
})

describe('isPrivateIP (Layer 1: regex)', () => {
  it('blocks 127.0.0.x loopback', () => {
    expect(isPrivateIP('http://127.0.0.1')).toBe(true)
    expect(isPrivateIP('http://127.0.0.2/api')).toBe(true)
    expect(isPrivateIP('https://127.0.0.255')).toBe(true)
  })

  it('blocks localhost', () => {
    expect(isPrivateIP('http://localhost')).toBe(true)
    expect(isPrivateIP('http://localhost:3000/api')).toBe(true)
  })

  it('blocks 192.168.x.x', () => {
    expect(isPrivateIP('http://192.168.1.1')).toBe(true)
    expect(isPrivateIP('http://192.168.0.1/admin')).toBe(true)
  })

  it('blocks 10.x.x.x', () => {
    expect(isPrivateIP('http://10.0.0.1')).toBe(true)
    expect(isPrivateIP('http://10.255.255.255')).toBe(true)
  })

  it('blocks 172.16-31.x.x (Docker/K8s)', () => {
    expect(isPrivateIP('http://172.16.0.1')).toBe(true)
    expect(isPrivateIP('http://172.31.255.255')).toBe(true)
  })

  it('blocks 0.0.0.0', () => {
    expect(isPrivateIP('http://0.0.0.0')).toBe(true)
  })

  it('blocks IPv6 loopback [::1]', () => {
    expect(isPrivateIP('http://[::1]')).toBe(true)
    expect(isPrivateIP('http://[::1]:8080')).toBe(true)
  })

  it('allows public IPs', () => {
    expect(isPrivateIP('http://93.184.216.34')).toBe(false)  // example.com
    expect(isPrivateIP('http://1.1.1.1')).toBe(false)
  })

  it('allows public domains', () => {
    expect(isPrivateIP('https://example.com')).toBe(false)
    expect(isPrivateIP('https://api.github.com')).toBe(false)
    expect(isPrivateIP('https://google.com/search')).toBe(false)
  })

  // Edge cases
  it('rejects 172.15.x.x (not private range)', () => {
    expect(isPrivateIP('http://172.15.0.1')).toBe(false)
  })

  it('rejects 172.32.x.x (not private range)', () => {
    expect(isPrivateIP('http://172.32.0.1')).toBe(false)
  })

  it('handles URLs with ports and paths', () => {
    expect(isPrivateIP('http://192.168.1.1:8080/api/v1')).toBe(true)
    expect(isPrivateIP('https://10.0.0.1/admin')).toBe(true)
  })
})

describe('resolvesToPrivateIP (Layer 2: DNS)', () => {
  it('returns false for well-known public domains', async () => {
    // These are real DNS lookups — tested in CI with network access
    const result = await resolvesToPrivateIP('https://example.com')
    expect(result).toBe(false)
  })

  it('returns true for localhost (skipped DNS lookup)', async () => {
    const result = await resolvesToPrivateIP('http://localhost:3000')
    expect(result).toBe(true)
  })

  it('returns true for IP literals without DNS', async () => {
    const result = await resolvesToPrivateIP('http://192.168.1.1')
    expect(result).toBe(true)
  })

  it('gracefully handles invalid hostnames', async () => {
    // DNS will fail — falls back to regex
    const result = await resolvesToPrivateIP('http://')
    expect(result).toBe(false) // empty host = no private match
  })
})
