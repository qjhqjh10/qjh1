import { SUB_AGENTS } from '@/agent/subagents/SubAgentManager'

const TIER_COLORS: Record<string, { color: string; label: string }> = {
  cheap: { color: '#16a34a', label: '经济' },
  main: { color: '#2563eb', label: '标准' },
  eval: { color: '#7c3aed', label: '评估' },
}

export function TeamSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Sub-agent cards */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>
          子 Agent ({SUB_AGENTS.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SUB_AGENTS.map(agent => {
            const tier = TIER_COLORS[agent.modelTier || 'main'] ?? TIER_COLORS.main
            return (
              <div key={agent.name} style={{
                padding: '12px 16px', borderRadius: 12,
                background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>{agent.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: tier.color,
                    background: `${tier.color}10`, borderRadius: 4, padding: '1px 6px',
                  }}>
                    {tier.label}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#6b5e54', lineHeight: 1.5, marginBottom: 6 }}>
                  {agent.purpose}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9b8e84' }}>
                  <span>工具: {agent.toolNames.length}个</span>
                  <span>上下文: {agent.contextProviderDomains.length}个</span>
                  <span>最大迭代: {agent.maxIterations}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Team Relay explanation */}
      <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.1)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>Team Relay 接力模式</div>
        <div style={{ fontSize: 12, color: '#4a3f38', lineHeight: 1.6 }}>
          当任务复杂度较高时，Agent 可启动接力模式，由 4 个角色依次协作：
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {['Planner 规划', 'Coder 编码', 'Reviewer 审查', 'Fixer 修复'].map((role, i) => (
            <div key={role} style={{
              padding: '4px 12px', borderRadius: 8,
              background: i === 0 ? 'rgba(37,99,235,0.08)' : i === 1 ? 'rgba(22,163,74,0.08)' : i === 2 ? 'rgba(230,126,0,0.08)' : 'rgba(220,38,38,0.08)',
              fontSize: 11, fontWeight: 600,
              color: i === 0 ? '#2563eb' : i === 1 ? '#16a34a' : i === 2 ? '#e67e00' : '#dc2626',
            }}>
              {i > 0 && <span style={{ marginRight: 6, color: '#9b8e84' }}>→</span>}
              {role}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 8 }}>
          接力模式通过关键词自动触发，每个角色使用独立的工具集和上下文。审查不通过时自动进入修复轮。
        </div>
      </div>
    </div>
  )
}
