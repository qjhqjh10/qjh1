export 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeItemName(i: unknown): string {
  if (typeof i === 'string') return i
  if (i && typeof i === 'object') return (i as Record<string, unknown>).name as string || (i as Record<string, unknown>).title as string || String(i)
  return String(i)
}
