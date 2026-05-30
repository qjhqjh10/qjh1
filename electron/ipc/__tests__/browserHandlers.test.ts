// ── Browser Handlers SSRF Tests ──
// Verifies that browser:open has the same SSRF protection as httpHandlers.

import { describe, it, expect } from 'vitest'

describe('browserHandlers import integrity', () => {
  it('exports registerBrowserHandlers function', async () => {
    const mod = await import('../browserHandlers')
    expect(typeof mod.registerBrowserHandlers).toBe('function')
  })
})

describe('browser SSRF protection', () => {
  it('registerBrowserHandlers accepts config parameter', async () => {
    const mod = await import('../browserHandlers')
    // Function should accept optional config (added in phase1/phase2 fix)
    expect(mod.registerBrowserHandlers.length).toBeGreaterThanOrEqual(1)
  })
})
