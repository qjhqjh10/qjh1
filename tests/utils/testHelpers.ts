// ── Test Helpers ──
// Shared utility functions for test setup.

import { vi } from 'vitest'

/** Create a controlled Promise that can be resolved/rejected externally */
export function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Wait for next microtask tick (flushes pending promises) */
export function tick(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}

/** Create a minimal project fixture path */
export function mockProjectPath(name = 'test-project'): string {
  return `/mock/projects/${name}`
}

/** Spy on console.error and console.warn during a test, restore after */
export function spyConsole() {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  return {
    errorSpy,
    warnSpy,
    restore: () => { errorSpy.mockRestore(); warnSpy.mockRestore() },
  }
}
