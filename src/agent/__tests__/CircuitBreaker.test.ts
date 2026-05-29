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
    // beforeCall triggers the OPEN → HALF_OPEN transition
    expect(cb.beforeCall().allowed).toBe(true)
    expect(cb.currentState).toBe('HALF_OPEN')
  })

  it('recovers to CLOSED after success in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    await new Promise(r => setTimeout(r, 150))
    cb.beforeCall() // trigger OPEN → HALF_OPEN
    expect(cb.currentState).toBe('HALF_OPEN')
    cb.recordSuccess()
    expect(cb.currentState).toBe('CLOSED')
  })

  it('re-opens on failure in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    await new Promise(r => setTimeout(r, 150))
    cb.beforeCall() // trigger OPEN → HALF_OPEN
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

  it('decays failure count on success in CLOSED state', () => {
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.stats.failures).toBe(2)
    cb.recordSuccess()
    expect(cb.stats.failures).toBe(1)
    cb.recordSuccess()
    expect(cb.stats.failures).toBe(0)
    // Should not go below 0
    cb.recordSuccess()
    expect(cb.stats.failures).toBe(0)
  })

  it('failure count decay prevents premature OPEN', () => {
    // 3 failures then 3 successes should reset, then 2 more failures should NOT open
    cb.recordFailure()
    cb.recordFailure()
    cb.recordSuccess() // decay to 1
    cb.recordSuccess() // decay to 0
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.currentState).toBe('CLOSED') // total effective failures = 2, max is 3
  })

  it('HALF_OPEN allows only one concurrent call', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    await new Promise(r => setTimeout(r, 150))

    // First call triggers OPEN → HALF_OPEN and should be allowed
    const first = cb.beforeCall()
    expect(first.allowed).toBe(true)
    expect(cb.currentState).toBe('HALF_OPEN')

    // Second concurrent call should be blocked
    const second = cb.beforeCall()
    expect(second.allowed).toBe(false)
    expect(second.reason).toContain('试探调用进行中')
  })

  it('HALF_OPEN resets concurrency flag after success', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    await new Promise(r => setTimeout(r, 150))
    cb.beforeCall() // trigger OPEN → HALF_OPEN, sets halfOpenCallInProgress
    cb.recordSuccess() // should reset the flag
    expect(cb.currentState).toBe('CLOSED')
  })

  it('HALF_OPEN resets concurrency flag after failure', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure()
    await new Promise(r => setTimeout(r, 150))
    cb.beforeCall() // trigger OPEN → HALF_OPEN, sets halfOpenCallInProgress
    cb.recordFailure() // should reset the flag and re-open
    expect(cb.currentState).toBe('OPEN')
  })
})
