import { useState, useEffect, useCallback } from 'react'
import { useAgentStore } from '@/agent/store/AgentStore'
import { MetricsCollector } from '@/agent/metrics/MetricsCollector'
import { SkillLearner } from '@/agent/evolution/SkillLearner'
import type { AggregateMetrics } from '@/agent/metrics/MetricsCollector'
import type { LearnedRule } from '@/agent/evolution/SkillLearner'
import { StatCard } from '../../shared'
import { SkeletonStat } from '@/components/common/Skeleton'

const TREND_LABELS: Record<string, { text: string; color: string }> = {
  improving: { text: '持续改善', color: '#16a34a' },
  stable: { text: '保持稳定', color: '#6b5e54' },
  declining: { text: '有所下降', color: '#dc2626' },
}

const CIRCUIT_LABELS: Record<string, { text: string; color: string; bg: string }> = {
  CLOSED: { text: '正常', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  OPEN: { text: '已断开', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  HALF_OPEN: { text: '恢复中', color: '#e67e00', bg: 'rgba(230,126,0,0.08)' },
}

export function OverviewSection() {
  const health = useAgentStore(s => s.health)
  const [metrics, setMetrics] = useState<AggregateMetrics | null>(null)
  const [rules, setRules] = useState<LearnedRule[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const collector = new MetricsCollector()
      await collector.load()
      const agg = collector.getAggregate(20)
      setMetrics(agg)

      const learner = new SkillLearner('.aiharness')
      const learned = await learner.loadLearned()
      setRules(learned)
    } catch { /* best-effort */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const circuit = CIRCUIT_LABELS[health.circuitState] ?? CIRCUIT_LABELS.CLOSED
  const trend = health.lastSessionMetrics?.trend
    ? TREND_LABELS[health.lastSessionMetrics.trend] ?? TREND_LABELS.stable
    : null

  // Use health.lastSessionMetrics as fallback if aggregate not loaded
  const successRate = metrics?.avgToolSuccessRate ?? health.lastSessionMetrics?.toolSuccessRate
  const hallucinationRate = metrics?.hallucinationRate ?? health.lastSessionMetrics?.hallucinationRate
  const iterationCycles = metrics?.avgIterationCycles ?? health.lastSessionMetrics?.iterationCycles
  const firstPassRate = metrics?.firstPassRate
  const totalSessions = metrics?.totalSessions

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Metric cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard
          label="工具成功率"
          value={successRate != null ? `${(successRate * 100).toFixed(1)}%` : '--'}
          color={successRate != null && successRate < 0.5 ? '#dc2626' : '#16a34a'}
        />
        <StatCard
          label="幻觉触发率"
          value={hallucinationRate != null ? `${(hallucinationRate * 100).toFixed(1)}%` : '--'}
          color={hallucinationRate != null && hallucinationRate > 0.5 ? '#dc2626' : '#2563eb'}
        />
        <StatCard
          label="首过成功率"
          value={firstPassRate != null ? `${(firstPassRate * 100).toFixed(1)}%` : '--'}
          color="#7c3aed"
        />
        <StatCard
          label="平均迭代数"
          value={iterationCycles != null ? iterationCycles.toFixed(1) : '--'}
          color="#6b5e54"
        />
        <StatCard
          label="总会话数"
          value={totalSessions != null ? String(totalSessions) : '--'}
          color="#2563eb"
        />
        <StatCard
          label="已学习规则"
          value={String(rules.length)}
          color="#16a34a"
        />
      </div>

      {/* Status row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {/* Circuit breaker */}
        <div style={{ flex: 1, minWidth: 200, padding: '12px 16px', borderRadius: 12, background: circuit.bg, border: `1px solid ${circuit.color}20` }}>
          <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 4 }}>断路器状态</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: circuit.color }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: circuit.color }}>{circuit.text}</span>
            {health.circuitFailures > 0 && (
              <span style={{ fontSize: 11, color: '#9b8e84', marginLeft: 4 }}>
                连续失败 {health.circuitFailures} 次
              </span>
            )}
          </div>
        </div>

        {/* Trend */}
        <div style={{ flex: 1, minWidth: 200, padding: '12px 16px', borderRadius: 12, background: trend ? `${trend.color}08` : 'rgba(0,0,0,0.02)', border: `1px solid ${trend ? trend.color : '#000'}20` }}>
          <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 4 }}>性能趋势</div>
          <span style={{ fontSize: 14, fontWeight: 700, color: trend?.color ?? '#9b8e84' }}>
            {trend?.text ?? '数据不足'}
          </span>
        </div>

        {/* Auto-approved tools */}
        <div style={{ flex: 1, minWidth: 200, padding: '12px 16px', borderRadius: 12, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)' }}>
          <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 4 }}>自动授权工具</div>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed' }}>
            {health.autoApprovedTools.length > 0 ? `${health.autoApprovedTools.length} 个` : '无'}
          </span>
          {health.autoApprovedTools.length > 0 && (
            <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>
              {health.autoApprovedTools.slice(0, 3).join(', ')}{health.autoApprovedTools.length > 3 ? '...' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Checkpoints */}
      {health.checkpointCount > 0 && (
        <div style={{ fontSize: 12, color: '#6b5e54' }}>
          已保存 <strong>{health.checkpointCount}</strong> 个检查点
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
      )}
    </div>
  )
}
