import { useState, useEffect, useCallback } from 'react'
import { useAgentStore } from '@/agent/store/AgentStore'
import { fileService } from '@/services/fileService'
import { SkeletonCard } from '@/components/common/Skeleton'

const CIRCUIT_LABELS: Record<string, { text: string; color: string; bg: string; desc: string }> = {
  CLOSED: { text: '正常 (CLOSED)', color: '#16a34a', bg: 'rgba(22,163,74,0.06)', desc: '断路器关闭，所有请求正常通过' },
  OPEN: { text: '已断开 (OPEN)', color: '#dc2626', bg: 'rgba(220,38,38,0.06)', desc: '连续失败过多，请求被阻断，等待冷却后自动进入半开状态' },
  HALF_OPEN: { text: '恢复中 (HALF_OPEN)', color: '#e67e00', bg: 'rgba(230,126,0,0.06)', desc: '冷却结束，允许少量请求通过以测试恢复情况' },
}

interface SessionFile {
  id: string
  meta?: { title?: string; createdAt?: string; messageCount?: number }
}

export function ReliabilitySection() {
  const health = useAgentStore(s => s.health)
  const [sessions, setSessions] = useState<SessionFile[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const files = await fileService.listDir('agent-sessions')
      const loaded: SessionFile[] = []
      for (const f of files.filter(f => f.endsWith('.json')).slice(-10)) {
        try {
          const raw = await fileService.read(`agent-sessions/${f}`)
          const data = JSON.parse(raw)
          loaded.push({ id: f.replace('.json', ''), meta: data.meta })
        } catch { /* skip */ }
      }
      setSessions(loaded.reverse())
    } catch { /* no sessions */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const circuit = CIRCUIT_LABELS[health.circuitState] ?? CIRCUIT_LABELS.CLOSED

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Circuit breaker card */}
      <div style={{ padding: '14px 18px', borderRadius: 12, background: circuit.bg, border: `1px solid ${circuit.color}20` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: circuit.color }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: circuit.color }}>{circuit.text}</span>
        </div>
        <div style={{ fontSize: 12, color: '#6b5e54', lineHeight: 1.5 }}>{circuit.desc}</div>
        {health.circuitFailures > 0 && (
          <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 4 }}>连续失败: {health.circuitFailures} 次</div>
        )}
      </div>

      {/* Checkpoints */}
      <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)' }}>
        <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 4 }}>检查点</div>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#7c3aed' }}>{health.checkpointCount}</span>
        <span style={{ fontSize: 12, color: '#6b5e54', marginLeft: 6 }}>个已保存</span>
      </div>

      {/* Recent sessions */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>
          最近会话 ({sessions.length})
        </div>
        {sessions.length > 0 ? (
          <div className="custom-scrollbar" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {sessions.map(s => {
              const date = s.meta?.createdAt ? new Date(s.meta.createdAt) : null
              const dateStr = date ? `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}` : '--'
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderBottom: '1px solid rgba(0,0,0,0.03)', fontSize: 12 }}>
                  <span style={{ minWidth: 90, color: '#9b8e84', fontSize: 11 }}>{dateStr}</span>
                  <span style={{ flex: 1, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.meta?.title || s.id}
                  </span>
                  {s.meta?.messageCount != null && (
                    <span style={{ fontSize: 10, color: '#9b8e84' }}>{s.meta.messageCount}条</span>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          !loading && <p style={{ fontSize: 12, color: '#9b8e84' }}>暂无会话记录</p>
        )}
      </div>

      {loading && <div style={{ padding: 8 }}><SkeletonCard lines={4} /></div>}
    </div>
  )
}
