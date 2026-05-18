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
