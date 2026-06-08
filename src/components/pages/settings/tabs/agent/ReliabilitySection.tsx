import { useAgentStore } from '@/agent/store/AgentStore'

const CIRCUIT_LABELS: Record<string, { text: string; color: string; bg: string; desc: string }> = {
  CLOSED: { text: '正常 (CLOSED)', color: '#16a34a', bg: 'rgba(22,163,74,0.06)', desc: '断路器关闭，所有请求正常通过' },
  OPEN: { text: '已断开 (OPEN)', color: '#dc2626', bg: 'rgba(220,38,38,0.06)', desc: '连续失败过多，请求被阻断，等待冷却后自动进入半开状态' },
  HALF_OPEN: { text: '恢复中 (HALF_OPEN)', color: '#e67e00', bg: 'rgba(230,126,0,0.06)', desc: '冷却结束，允许少量请求通过以测试恢复情况' },
}

export function ReliabilitySection() {
  const health = useAgentStore(s => s.health)
  const circuit = CIRCUIT_LABELS[health.circuitState] ?? CIRCUIT_LABELS.CLOSED

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
    </div>
  )
}
