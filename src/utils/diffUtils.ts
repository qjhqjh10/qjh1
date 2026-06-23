// LCS-based line diff algorithm with DP table. Capped at 500 lines to prevent O(n*m) freeze.
export function lineDiff(oldText: string, newText: string): { type: 'same' | 'removed' | 'added'; text: string }[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  const MAX_LINES = 500
  if (oldLines.length > MAX_LINES || newLines.length > MAX_LINES) {
    const truncated: { type: 'same' | 'removed' | 'added'; text: string }[] = []
    const maxLen = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxLen && i < MAX_LINES; i++) {
      const o = oldLines[i], n = newLines[i]
      if (o === n && o !== undefined) {
        truncated.push({ type: 'same', text: o })
      } else {
        if (o !== undefined) truncated.push({ type: 'removed', text: o })
        if (n !== undefined) truncated.push({ type: 'added', text: n })
      }
    }
    if (maxLen > MAX_LINES) {
      truncated.push({ type: 'added', text: `… (${maxLen - MAX_LINES} 行已省略)` })
    }
    return truncated
  }

  const result: { type: 'same' | 'removed' | 'added'; text: string }[] = []
  const m = oldLines.length; const n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  let i = m, j = n
  const temp: { type: 'same' | 'removed' | 'added'; text: string }[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.unshift({ type: 'same', text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.unshift({ type: 'added', text: newLines[j - 1] })
      j--
    } else {
      temp.unshift({ type: 'removed', text: oldLines[i - 1] })
      i--
    }
  }

  for (const line of temp) {
    const last = result[result.length - 1]
    if (last && last.type === line.type) {
      last.text += '\n' + line.text
    } else {
      result.push(line)
    }
  }
  return result
}

// ── Paragraph-level diff for rewrite compare view ──

/** Simple bigram similarity between two strings */
export function paragraphSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const bigramsA = new Set<string>()
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2))
  const bigramsB = new Set<string>()
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2))
  const intersection = new Set([...bigramsA].filter(x => bigramsB.has(x)))
  const union = new Set([...bigramsA, ...bigramsB])
  return union.size === 0 ? 0 : intersection.size / union.size
}

export interface DiffParagraph { text: string; changed: boolean }

/** Compute paragraph-level diff between original and rewritten text */
export function computeParagraphDiff(original: string, rewritten: string): {
  originalPars: DiffParagraph[]
  rewrittenPars: DiffParagraph[]
} {
  // Normalize paragraph separators — AI may output paragraphs separated only by 　　on same line
  const normalizeParas = (text: string): string[] => {
    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([^　\n])(　　)/g, '$1\n\n$2')
      .split(/\n+/)
      .map(p => p.replace(/^[　]+/, '').trim())
      .filter(Boolean)
  }

  const op = normalizeParas(original)
  const rp = normalizeParas(rewritten)

  const origResult: DiffParagraph[] = op.map(text => {
    const found = rp.some(r => paragraphSimilarity(text, r) > 0.35)
    return { text, changed: !found }
  })

  const rewResult: DiffParagraph[] = rp.map(text => {
    const found = op.some(o => paragraphSimilarity(text, o) > 0.35)
    return { text, changed: !found }
  })

  return { originalPars: origResult, rewrittenPars: rewResult }
}
