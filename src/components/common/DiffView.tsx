import { useMemo } from 'react'
import { lineDiff } from '@/utils/diffUtils'

export function DiffView({ oldText, newText, oldLabel, newLabel }: {
  oldText: string; newText: string; oldLabel: string; newLabel: string
}) {
  const diff = useMemo(() => lineDiff(oldText, newText), [oldText, newText])
  const removedCount = diff.filter(d => d.type === 'removed').reduce((s, d) => s + d.text.split('\n').length, 0)
  const addedCount = diff.filter(d => d.type === 'added').reduce((s, d) => s + d.text.split('\n').length, 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 11 }}>
        <span style={{ color: '#6b5e54' }}>{oldLabel}</span>
        <span style={{ color: '#9b8e84' }}>→</span>
        <span style={{ color: '#6b5e54' }}>{newLabel}</span>
        <span style={{ color: '#dc2626', marginLeft: 8 }}>−{removedCount}行</span>
        <span style={{ color: '#16a34a' }}>+{addedCount}行</span>
      </div>
      <div style={{
        maxHeight: 400, overflowY: 'auto', borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, lineHeight: 1.6,
        fontFamily: 'monospace',
      }} className="custom-scrollbar">
        {diff.map((d, i) => (
          <div key={i} style={{
            padding: '1px 12px',
            background: d.type === 'removed' ? 'rgba(220,38,38,0.08)' :
                        d.type === 'added' ? 'rgba(22,163,74,0.08)' :
                        'transparent',
            color: d.type === 'removed' ? '#991b1b' :
                   d.type === 'added' ? '#166534' :
                   '#6b5e54',
            whiteSpace: 'pre-wrap',
            borderLeft: d.type === 'removed' ? '3px solid #dc2626' :
                        d.type === 'added' ? '3px solid #16a34a' :
                        '3px solid transparent',
          }}>
            <span style={{ marginRight: 8, fontSize: 10, opacity: 0.5 }}>
              {d.type === 'removed' ? '−' : d.type === 'added' ? '+' : ' '}
            </span>
            {d.text}
          </div>
        ))}
      </div>
    </div>
  )
}
