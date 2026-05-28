interface SkeletonProps {
  width?: number | string
  height?: number
  borderRadius?: number
  style?: React.CSSProperties
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 6, style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius, ...style }}
    />
  )
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 'var(--theme-radius-lg, 12px)', background: 'var(--theme-glass-bg-light, rgba(255,255,255,0.4))', border: '1px solid var(--theme-border, rgba(0,0,0,0.03))' }}>
      <Skeleton width="60%" height={14} style={{ marginBottom: 10 }} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '40%' : '85%'} height={10} style={{ marginBottom: 6 }} />
      ))}
    </div>
  )
}

export function SkeletonStat() {
  return (
    <div style={{ flex: 1, padding: '10px 14px', borderRadius: 'var(--theme-radius-lg, 12px)', background: 'var(--theme-bg-hover, rgba(0,0,0,0.02))' }}>
      <Skeleton width="50%" height={10} style={{ marginBottom: 6 }} />
      <Skeleton width="70%" height={20} />
    </div>
  )
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <Skeleton width={24} height={24} borderRadius={12} />
          <Skeleton width={`${60 + Math.random() * 30}%`} height={12} />
        </div>
      ))}
    </div>
  )
}
