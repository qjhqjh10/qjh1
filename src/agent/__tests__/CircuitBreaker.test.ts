import { describe, it, expect, beforeEach } from 'vitest'
import { CircuitBreaker } from '../circuit/CircuitBreaker'

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker

  beforeEach(() => {
    cb = new CircuitBreaker(3, 100) // 3 failures, 100ms cooldown for fast tests
  })

  it('starts in CLOSED state', () => {
    expect(cb.currentState).toBe('CLOSED')
    expect(cb.beforeCall().allowed).toBe(true)
  })

  it('opens after max consecutive failures', () => {
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.currentState).toBe('CLOSED')
    cb.recordFailure() // 3rd failure
    expect(cb.currentState).toBe('OPEN')
  })

  it('blocks calls when OPEN', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    expect(cb.beforeCall().allowed).toBe(false)
  })

  it('goes to HALF_OPEN after cooldown', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    expect(cb.currentState).toBe('OPEN')
    await new Promise(r => setTimeout(r, 150))
    expect(cb.currentState).toBe('HALF_OPEN')
    expect(cb.beforeCall().allowed).toBe(true)
  })

  it('recovers to CLOSED after success in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    await new Promise(r => setTimeout(r, 150))
    expect(cb.currentState).toBe('HALF_OPEN')
    cb.recordSuccess()
    expect(cb.currentState).toBe('CLOSED')
  })

  it('re-opens on failure in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    await new Promise(r => setTimeout(r, 150))
    expect(cb.currentState).toBe('HALF_OPEN')
    cb.recordFailure()
    expect(cb.currentState).toBe('OPEN')
  })

  it('reset clears all state', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    cb.reset()
    expect(cb.currentState).toBe('CLOSED')
    expect(cb.stats.failures).toBe(0)
  })

  it('success in CLOSED is idempotent', () => {
    cb.recordSuccess()
    cb.recordSuccess()
    expect(cb.currentState).toBe('CLOSED')
  })

  it('provides reason when blocked', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    const check = cb.beforeCall()
    expect(check.allowed).toBe(false)
    expect(check.reason).toContain('断路保护')
  })
})
