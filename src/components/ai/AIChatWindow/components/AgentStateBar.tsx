import { motion, AnimatePresence } from 'framer-motion'
import { useAgentStore } from '@/agent/store/AgentStore'
import type { AgentPhase } from '@/agent/state/types'

const PHASE_LABELS: Record<AgentPhase, { label: string; color: string; bg: string }> = {
  IDLE:               { label: '就绪',    color: '#9b8e84', bg: 'transparent' },
  ANALYZE:            { label: '分析中',  color: '#6366f1', bg: 'rgba(99,102,241,0.08)' },
  EXECUTE:            { label: '执行中',  color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  VERIFY:             { label: '验证中',  color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  WAITING_APPROVAL:   { label: '待审批',  color: '#d97706', bg: 'rgba(217,119,6,0.10)' },
  DONE:               { label: '完成',    color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  ERROR:              { label: '错误',    color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
  ABORTED:            { label: '已中止',  color: '#9b8e84', bg: 'rgba(155,142,132,0.08)' },
}

const PHASE_PROGRESS: Record<AgentPhase, number> = {
  IDLE: 0, ANALYZE: 20, EXECUTE: 50, VERIFY: 80, WAITING_APPROVAL: 55, DONE: 100, ERROR: 0, ABORTED: 0,
}

export function AgentStateBar({ maxIterations = 30 }: { maxIterations?: number }) {
  const phase = useAgentStore(s => s.run.phase)
  const iteration = useAgentStore(s => s.run.iteration)
  const isRunning = useAgentStore(s => s.run.isRunning)
  const thinking = useAgentStore(s => s.run.thinking)
  const error = useAgentStore(s => s.run.lastError)
  const activeTools = useAgentStore(s => s.run.activeTools)

  const toolEntries = Object.values(activeTools)
  const completedTools = toolEntries.filter(t => t.status === 'success' || t.status === 'error')

  // v14.9.x(UI): 就绪提示已移除——空闲时不渲染任何东西（原"就绪 · 输入消息开始"占位）
  if (!isRunning && phase === 'IDLE' && !error && completedTools.length === 0) {
    return null
  }

  const info = PHASE_LABELS[phase] || PHASE_LABELS.IDLE
  const phaseProgress = PHASE_PROGRESS[phase] || 0
  const overallProgress = Math.min(100, ((iteration - 1) / maxIterations) * 100 + phaseProgress / maxIterations)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        style={{
          padding: '6px 14px', borderRadius: 10, marginBottom: 8,
          background: info.bg, border: `1px solid ${info.color}20`,
          fontSize: 12, fontFamily: 'inherit', position: 'relative', overflow: 'hidden',
        }}
      >
        {isRunning && (
          <motion.div
            initial={{ width: '0%' }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: `${info.color}08`, zIndex: 0 }}
          />
        )}

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRunning ? (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${info.color}30`, borderTopColor: info.color, flexShrink: 0 }} />
            ) : (
              <span style={{ width: 8, height: 8, borderRadius: 4, background: info.color, flexShrink: 0 }} />
            )}
            <span style={{ color: info.color, fontWeight: 600, fontSize: 11 }}>{info.label}</span>
            {iteration > 0 && <span style={{ color: '#9b8e84', fontSize: 10 }}>· 第 {iteration}/{maxIterations} 轮</span>}
            {isRunning && <span style={{ color: info.color, fontSize: 10, fontWeight: 500, marginLeft: 'auto' }}>{Math.round(overallProgress)}%</span>}
            {thinking && !error && <span style={{ color: '#9b8e84', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>· {thinking.intent.slice(0, 50)}</span>}
            {error && <span style={{ color: '#dc2626', fontSize: 10, flex: 1 }}>· {error.slice(0, 60)}</span>}
          </div>

          {/* Tool usage chips — 每一步使用了什么工具，依次排列 */}
          {toolEntries.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {toolEntries.map(t => {
                const isDone = t.status === 'success' || t.status === 'error'
                const isPending = t.status === 'pending' || t.status === 'running'
                return (
                  <span key={t.callId} style={{
                    padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                    background: t.status === 'error' ? 'rgba(220,38,38,0.08)' : isDone ? 'rgba(22,163,74,0.08)' : 'rgba(124,58,237,0.06)',
                    color: t.status === 'error' ? '#dc2626' : isDone ? '#16a34a' : '#7c3aed',
                    border: `1px solid ${t.status === 'error' ? 'rgba(220,38,38,0.15)' : isDone ? 'rgba(22,163,74,0.12)' : 'rgba(124,58,237,0.1)'}`,
                    opacity: isPending ? 0.7 : 1,
                  }}>
                    {t.status === 'error' ? '✗' : isDone ? '✓' : '○'} {t.toolName}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
