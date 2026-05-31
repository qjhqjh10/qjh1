import { useState } from 'react'

interface Props {
  usedTokens: number
  contextWindow: number
  onCompress?: () => void
  breakdown?: { label: string; chars: number }[]
}

export function ContextUsageBar({ usedTokens, contextWindow, onCompress, breakdown }: Props) {

  const [showBreakdown, setShowBreakdown] = useState(false)
  const pct = usedTokens > 0 ? Math.min(100, (usedTokens / contextWindow) * 100) : 0
  const barColor = pct > 85 ? '#dc2626' : pct > 60 ? '#d97706' : '#16a34a'

  const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`

  const estTokens = (chars: number) => Math.round(chars / 2)

  return (
    <div style={{ padding: '6px 18px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', whiteSpace: 'nowrap', flexShrink: 0, cursor: breakdown ? 'pointer' : 'default' }}
          onClick={() => breakdown && setShowBreakdown(!showBreakdown)}
          title={breakdown ? '点击查看Token分解' : undefined}
        >用量 {breakdown ? (showBreakdown ? '▾' : '▸') : ''}</span>
        <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width 0.5s', minWidth: pct > 0 ? 4 : 0 }} />
        </div>
        <span style={{ fontSize: 10, color: barColor, whiteSpace: 'nowrap', fontWeight: 600, flexShrink: 0 }}>
          {usedTokens > 0 ? `${formatK(usedTokens)} / ${formatK(contextWindow)}` : `上限 ${formatK(contextWindow)}`}
        </span>
      </div>
      {showBreakdown && breakdown && (
        <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.03)', fontSize: 10, color: '#6b5e54', lineHeight: 1.8 }}>
          {breakdown.map((b, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{b.label}</span>
              <span style={{ fontWeight: 600, color: '#4a3f38' }}>~{estTokens(b.chars).toLocaleString()} tokens ({b.chars.toLocaleString()} 字)</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
            <span>合计（估算）</span>
            <span>~{estTokens(breakdown.reduce((s, b) => s + b.chars, 0)).toLocaleString()} tokens</span>
          </div>
        </div>
      )}
      {pct > 70 && onCompress && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#d97706' }}>⚠️ 用量较高，建议压缩早期对话</span>
          <button onClick={onCompress} style={{
            padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(217,119,6,0.2)',
            background: 'rgba(217,119,6,0.06)', color: '#d97706', fontSize: 10,
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>智能压缩</button>
        </div>
      )}
    </div>
  )
}
