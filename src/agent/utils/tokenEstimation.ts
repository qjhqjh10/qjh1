// ── Token Estimation ──
// Character-aware token estimator for Chinese/English mixed text.
// Chinese/CJK characters are ~1.5-2 chars per token (vs ~4 for Latin).
// Using 1.8 as a balanced divisor for Chinese-dominant novel text.

export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0, latin = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    // CJK Unified Ideographs + Extensions + Punctuation range
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF)) {
      cjk++
    } else {
      latin++
    }
  }
  return Math.ceil(cjk / 1.8 + latin / 4)
}

/** Estimate total tokens across an array of messages (includes ~4 tokens per message for role overhead) */
export function estimateMessages(messages: Array<{ content?: string }>): number {
  let total = 0
  for (const m of messages) {
    total += estimateTokens(m.content || '') + 4
  }
  return total
}
