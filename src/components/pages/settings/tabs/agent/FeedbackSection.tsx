import { useState, useEffect, useCallback } from 'react'
import { fileService } from '@/services/fileService'
import { SkeletonList } from '@/components/common/Skeleton'

interface ParsedSuggestion {
  id: number
  severity: string
  summary: string
  metric: string
  targetFile: string
  suggestion: string
}

const SEVERITY_STYLES: Record<string, { color: string; bg: string }> = {
  CRITICAL: { color: '#dc2626', bg: 'rgba(220,38,38,0.06)' },
  WARN: { color: '#e67e00', bg: 'rgba(230,126,0,0.06)' },
  INFO: { color: '#2563eb', bg: 'rgba(37,99,235,0.06)' },
}

function parseMarkdown(raw: string): ParsedSuggestion[] {
  const results: ParsedSuggestion[] = []
  const sections = raw.split('### ').filter(Boolean)
  let idx = 0
  for (const section of sections) {
    const lines = section.trim().split('\n')
    const header = lines[0] || ''
    const match = header.match(/^(CRITICAL|WARN|INFO):\s*(.+)$/)
    if (!match) continue
    const severity = match[1]
    const summary = match[2]
    let metric = '', targetFile = '', suggestion = ''
    for (const line of lines) {
      const m1 = line.match(/指标:\s*(.+)/)
      const m2 = line.match(/目标文件:\s*(.+)/)
      const m3 = line.match(/建议:\s*(.+)/)
      if (m1) metric = m1[1]
      if (m2) targetFile = m2[1]
      if (m3) suggestion = m3[1]
    }
    results.push({ id: idx++, severity, summary, metric, targetFile, suggestion })
  }
  return results
}

export function FeedbackSection() {
  const [suggestions, setSuggestions] = useState<ParsedSuggestion[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const raw = await fileService.read('.aiharness/feedback/auto-suggestions.md')
      setSuggestions(parseMarkdown(raw))
    } catch { /* no feedback yet */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54' }}>
        自动反馈建议 ({suggestions.length})
      </div>

      {suggestions.length > 0 ? (
        <div className="custom-scrollbar" style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {suggestions.map(s => {
            const style = SEVERITY_STYLES[s.severity] ?? SEVERITY_STYLES.INFO
            return (
              <div key={s.id} style={{
                padding: '10px 14px', borderRadius: 10,
                background: style.bg, border: `1px solid ${style.color}20`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#fff',
                    background: style.color, borderRadius: 4, padding: '1px 6px',
                  }}>
                    {s.severity}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>{s.summary}</span>
                </div>
                {s.metric && <div style={{ fontSize: 11, color: '#6b5e54', marginBottom: 2 }}>指标: {s.metric}</div>}
                {s.targetFile && <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 2 }}>目标: {s.targetFile}</div>}
                {s.suggestion && <div style={{ fontSize: 12, color: '#4a3f38', lineHeight: 1.5, marginTop: 4 }}>{s.suggestion}</div>}
              </div>
            )
          })}
        </div>
      ) : (
        !loading && (
          <p style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6 }}>
            暂无自动反馈建议。当 Agent 的指标（如工具成功率、幻觉率）触发阈值时，系统会自动生成改进建议并写入 `.aiharness/feedback/` 目录。
          </p>
        )
      )}

      {loading && <div style={{ padding: 8 }}><SkeletonList count={4} /></div>}
    </div>
  )
}
