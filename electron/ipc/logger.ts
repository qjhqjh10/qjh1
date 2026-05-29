const PREFIX = '[青剑]'

export function logError(context: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`${PREFIX} ${context}: ${msg}`)
}
