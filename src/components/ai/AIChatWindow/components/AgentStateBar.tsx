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
  PLANNING:           { label: '规划中',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
  REFLECTING:         { label: '反思中',  color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  VERIFYING:          { label: '验证中',  color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  RESPONDING:         { label: '回复中',  color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  ERROR:              { label: '错误',    color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
  ABORTED:            { label: '已中止',  color: '#9b8e84', bg: 'rgba(155,142,132,0.08)' },
}

// Phase progress weights for the progress bar
const PHASE_PROGRESS: Record<AgentPhase, number> = {
  IDLE: 0, THINKING: 5, ASSEMBLING_CONTEXT: 10, CALLING_API: 20,
  AWAITING_TOOLS: 50, PLANNING: 15, EXECUTING: 60, AWAITING_APPROVAL: 55,
  REFLECTING: 70, VERIFYING: 75, RESPONDING: 90, ERROR: 0, ABORTED: 0,
}

export function AgentStateBar() {
  const phase = useAgentStore(s => s.run.phase)
  const iteration = useAgentStore(s => s.run.iteration)
  const isRunning = useAgentStore(s => s.run.isRunning)
  const thinking = useAgentStore(s => s.run.thinking)
  const error = useAgentStore(s => s.run.lastError)
  const maxIterations = 15

  if (!isRunning && phase === 'IDLE') return null

  const info = PHASE_LABELS[phase] || PHASE_LABELS.IDLE
  const phaseProgress = PHASE_PROGRESS[phase] || 0
  // Overall progress: each iteration contributes ~6.7% (100/15), plus within-iteration phase progress
  const overallProgress = Math.min(100, ((iteration - 1) / maxIterations) * 100 + phaseProgress / maxIterations)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        style={{
          padding: '8px 14px', borderRadius: 10, marginBottom: 8,
          background: info.bg, border: `1px solid ${info.color}20`,
          fontSize: 12, fontFamily: 'inherit', position: 'relative', overflow: 'hidden',
        }}
      >
        {/* Animated progress bar background */}
        {isRunning && (
          <motion.div
            initial={{ width: '0%' }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              background: `${info.color}08`, zIndex: 0,
            }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }}>
          {/* Spinning indicator when running, static dot when idle */}
          {isRunning ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              style={{
                width: 14, height: 14, borderRadius: '50%',
                border: `2px solid ${info.color}30`,
                borderTopColor: info.color,
                flexShrink: 0,
              }}
            />
          ) : (
            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#9b8e84', flexShrink: 0 }} />
          )}

          <span style={{ color: info.color, fontWeight: 600 }}>{info.label}</span>

          {/* Iteration counter with max */}
          {iteration > 0 && (
            <span style={{ color: '#9b8e84', fontSize: 10 }}>
              · 第 {iteration}/{maxIterations} 轮
            </span>
          )}

          {/* Progress percentage */}
          {isRunning && (
            <span style={{ color: info.color, fontSize: 10, fontWeight: 500, marginLeft: 'auto' }}>
              {Math.round(overallProgress)}%
            </span>
          )}

          {/* Thinking preview */}
          {thinking && !error && (
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
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
