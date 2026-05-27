import { motion, AnimatePresence } from 'framer-motion'
import { useAgentStore } from '@/agent/store/AgentStore'
import type { AgentPhase } from '@/agent/state/types'

const PHASE_LABELS: Record<AgentPhase, { label: string; color: string; bg: string }> = {
  IDLE:               { label: '就绪',    color: '#9b8e84', bg: 'transparent' },
  THINKING:           { label: '思考中',  color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  ASSEMBLING_CONTEXT: { label: '组装上下文', color: '#6366f1', bg: 'rgba(99,102,241,0.08)' },
  CALLING_API:        { label: '调用 AI',  color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  AWAITING_TOOLS:     { label: '等待工具', color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  EXECUTING:          { label: '执行中',  color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  AWAITING_APPROVAL:  { label: '待审批',  color: '#d97706', bg: 'rgba(217,119,6,0.10)' },
  REFLECTING:         { label: '反思中',  color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  RESPONDING:         { label: '回复中',  color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  ERROR:              { label: '错误',    color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
  ABORTED:            { label: '已中止',  color: '#9b8e84', bg: 'rgba(155,142,132,0.08)' },
}

export function AgentStateBar() {
  const phase = useAgentStore(s => s.run.phase)
  const iteration = useAgentStore(s => s.run.iteration)
  const isRunning = useAgentStore(s => s.run.isRunning)
  const thinking = useAgentStore(s => s.run.thinking)
  const error = useAgentStore(s => s.run.lastError)

  if (!isRunning && phase === 'IDLE') return null

  const info = PHASE_LABELS[phase] || PHASE_LABELS.IDLE

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        style={{
          padding: '6px 14px', borderRadius: 8, marginBottom: 8,
          background: info.bg, border: `1px solid ${info.color}20`,
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        {/* Phase indicator */}
        <span style={{
          width: 8, height: 8, borderRadius: 4,
          background: isRunning ? info.color : '#9b8e84',
          animation: isRunning ? 'pulse 1.5s infinite' : 'none',
        }} />
        <span style={{ color: info.color, fontWeight: 600 }}>{info.label}</span>

        {/* Iteration */}
        {iteration > 0 && (
          <span style={{ color: '#9b8e84', fontSize: 10 }}>
            · 第 {iteration} 轮
          </span>
        )}

        {/* Thinking preview */}
        {thinking && (
          <span style={{ color: '#9b8e84', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            · {thinking.intent.slice(0, 50)}
          </span>
        )}

        {/* Error */}
        {error && (
          <span style={{ color: '#dc2626', fontSize: 10, flex: 1 }}>
            · {error.slice(0, 60)}
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
