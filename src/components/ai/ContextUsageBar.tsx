interface Props {
  usedTokens: number
  contextWindow: number
}

export function ContextUsageBar({ usedTokens, contextWindow }: Props) {
  const pct = usedTokens > 0 ? Math.min(100, (usedTokens / contextWindow) * 100) : 0
  const barColor = pct > 85 ? '#dc2626' : pct > 60 ? '#d97706' : '#16a34a'

  const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`

  return (
    <div style={{ padding: '6px 18px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', whiteSpace: 'nowrap', flexShrink: 0 }}>用量</span>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width 0.5s', minWidth: pct > 0 ? 4 : 0 }} />
      </div>
      <span style={{ fontSize: 10, color: barColor, whiteSpace: 'nowrap', fontWeight: 600, flexShrink: 0 }}>
        {usedTokens > 0 ? `${formatK(usedTokens)} / ${formatK(contextWindow)}` : `上限 ${formatK(contextWindow)}`}
      </span>
    </div>
  )
}
