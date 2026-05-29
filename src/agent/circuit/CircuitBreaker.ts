// ── Circuit Breaker ──
// 3 states: CLOSED (normal) → OPEN (paused) → HALF_OPEN (trial)

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private failureCount = 0
  private lastFailureTime = 0
  private openedAt = 0
  private halfOpenCallInProgress = false
  private maxFailures: number
  private cooldownMs: number

  constructor(maxFailures = 5, cooldownMs = 30000) {
    this.maxFailures = maxFailures
    this.cooldownMs = cooldownMs
  }

  get currentState(): CircuitState {
    return this.state
  }

  /** Check if OPEN cooldown has expired and transition to HALF_OPEN if so */
  private tryRecover(): void {
    if (this.state === 'OPEN' && Date.now() - this.openedAt > this.cooldownMs) {
      this.state = 'HALF_OPEN'
      this.halfOpenCallInProgress = false
    }
  }

  beforeCall(): { allowed: boolean; reason?: string } {
    this.tryRecover()
    const s = this.state
    if (s === 'OPEN') {
      return { allowed: false, reason: `断路保护：连续 ${this.failureCount} 次失败，${Math.ceil((this.cooldownMs - (Date.now() - this.openedAt)) / 1000)}s 后重试` }
    }
    if (s === 'HALF_OPEN') {
      if (this.halfOpenCallInProgress) {
        return { allowed: false, reason: '断路半开：试探调用进行中，请等待结果' }
      }
      this.halfOpenCallInProgress = true
      return { allowed: true, reason: '断路半开：尝试恢复中' }
    }
    return { allowed: true }
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED'
      this.failureCount = 0
      this.halfOpenCallInProgress = false
    }
    // In CLOSED, decay failure count on success
    if (this.state === 'CLOSED' && this.failureCount > 0) {
      this.failureCount = Math.max(0, this.failureCount - 1)
    }
  }

  recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()
    if (this.state === 'CLOSED' && this.failureCount >= this.maxFailures) {
      this.state = 'OPEN'
      this.openedAt = Date.now()
    }
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN'
      this.openedAt = Date.now()
      this.halfOpenCallInProgress = false
    }
  }

  reset(): void {
    this.state = 'CLOSED'
    this.failureCount = 0
    this.lastFailureTime = 0
    this.openedAt = 0
    this.halfOpenCallInProgress = false
  }

  get stats(): { state: CircuitState; failures: number; openedAt: number } {
    return { state: this.currentState, failures: this.failureCount, openedAt: this.openedAt }
  }
}
