// ── Token Estimation ──
// Character-aware token estimator for Chinese/English mixed text.
// 系数实测校准（2026-08-01，DeepSeek 真实 usage 反推，见
// .aiharness/design/token-estimation-data-2026-08-01.md）：
//   CJK 1.2 字符/token —— 真实中文小说文本实测 1.19（含标点），纯汉字 1.72、标点密集 1.08；
//   原 1.8 低估约 1.5 倍 → 压缩触发晚于真实越界（API 400/静默截断风险），已修正。
//   Latin 4.5 字符/token —— 实测纯英文 4.49。
// 高估方向安全（压缩略早触发），低估方向危险（越界）。

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
  return Math.ceil(cjk / 1.2 + latin / 4.5)
}

/** Estimate total tokens across an array of messages (includes ~4 tokens per message for role overhead) */
export function estimateMessages(messages: Array<{ content?: string }>): number {
  let total = 0
  for (const m of messages) {
    total += estimateTokens(m.content || '') + 4
  }
  return total
}
