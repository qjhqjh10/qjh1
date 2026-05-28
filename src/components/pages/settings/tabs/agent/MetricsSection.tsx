import { useState, useEffect, useCallback } from 'react'
import { MetricsCollector } from '@/agent/metrics/MetricsCollector'
import type { SessionMetrics, AggregateMetrics } from '@/agent/metrics/MetricsCollector'
import { SkeletonList } from '@/components/common/Skeleton'

const TREND_LABELS: Record<string, { text: string; color: string }> = {
  improving: { text: '持续改善', color: '#16a34a' },
  stable: { text: '保持稳定', color: '#6b5e54' },
  declining: { text: '有所下降', color: '#dc2626' },
}

export function MetricsSection() {
  const [sessions, setSessions] = useState<SessionMetrics[]>([])
  const [aggregate, setAggregate] = useState<AggregateMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const collector = new MetricsCollector()
      await collector.load()
      setSessions(collector.getRecentSessions(10))
      setAggregate(collector.getAggregate(20))
    } catch { /* best-effort */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Tool breakdown sorted by total calls
  const toolRanking = aggregate
    ? Object.entries(aggregate.toolBreakdown)
        .map(([name, d]) => ({ name, success: d.success, failure: d.failure, total: d.success + d.failure, rate: d.success + d.failure > 0 ? d.success / (d.success + d.failure) : 0 }))
        .sort((a, b) => b.total - a.total)
    : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Aggregate summary */}
      {aggregate && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120, padding: '10px 14px', borderRadius: 12, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
            <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 2 }}>总会话</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#2563eb' }}>{aggregate.totalSessions}</div>
          </div>
          <div style={{ flex: 1, minWidth: 120, padding: '10px 14px', borderRadius: 12, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.15)' }}>
            <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 2 }}>平均Token/会话</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a' }}>{Math.round(aggregate.avgTokensPerSession).toLocaleString()}</div>
          </div>
          <div style={{ flex: 1, minWidth: 120, padding: '10px 14px', borderRadius: 12, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}>
            <div style={{ fontSize: 10, color: '#9b8e84', marginBottom: 2 }}>趋势</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: TREND_LABELS[aggregate.trend]?.color ?? '#6b5e54' }}>
              {TREND_LABELS[aggregate.trend]?.text ?? aggregate.trend}
            </div>
          </div>
        </div>
      )}

      {/* Tool success ranking */}
      {toolRanking.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>工具成功率排行</div>
          <div className="custom-scrollbar" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {toolRanking.map(t => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderBottom: '1px solid rgba(0,0,0,0.03)', fontSize: 12 }}>
                <span style={{ flex: 1, fontWeight: 500, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ fontSize: 10, color: '#9b8e84', minWidth: 40, textAlign: 'right' }}>{t.total}次</span>
                <div style={{ width: 80, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.04)', overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ height: '100%', borderRadius: 3, background: t.rate >= 0.8 ? '#16a34a' : t.rate >= 0.5 ? '#e67e00' : '#dc2626', width: `${(t.rate * 100).toFixed(0)}%` }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: t.rate >= 0.8 ? '#16a34a' : t.rate >= 0.5 ? '#e67e00' : '#dc2626', minWidth: 38, textAlign: 'right' }}>
                  {(t.rate * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent sessions */}
      {sessions.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>近 {sessions.length} 次会话</div>
          <div className="custom-scrollbar" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {sessions.map(s => {
              const rate = s.toolCalls > 0 ? s.toolSuccesses / s.toolCalls : 1
              const date = new Date(s.timestamp)
              const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
              return (
                <div key={s.sessionId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderBottom: '1px solid rgba(0,0,0,0.03)', fontSize: 11 }}>
                  <span style={{ minWidth: 90, color: '#9b8e84' }}>{dateStr}</span>
                  <span style={{ color: '#2563eb', minWidth: 50 }}>{s.toolCalls}次调用</span>
                  <span style={{ color: rate >= 0.8 ? '#16a34a' : rate >= 0.5 ? '#e67e00' : '#dc2626', minWidth: 50 }}>
                    成功 {(rate * 100).toFixed(0)}%
                  </span>
                  {s.hallucinationTriggers > 0 && (
                    <span style={{ color: '#dc2626' }}>幻觉×{s.hallucinationTriggers}</span>
                  )}
                  <span style={{ color: '#6b5e54', marginLeft: 'auto' }}>{s.iterationCycles}轮</span>
                  {s.firstPassSuccess && (
                    <span style={{ color: '#16a34a', fontSize: 10 }}>首过</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!loading && !aggregate && sessions.length === 0 && (
        <p style={{ fontSize: 12, color: '#9b8e84', lineHeight: 1.6 }}>
          暂无会话指标数据。Agent 执行任务后会自动记录每次会话的工具调用、成功率、迭代轮次等指标。
        </p>
      )}

      {loading && <div style={{ padding: 8 }}><SkeletonList count={5} /></div>}
    </div>
  )
}
