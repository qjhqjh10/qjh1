import { useState, useEffect, useRef } from 'react'
import { useAgentStore } from '@/agent/store/AgentStore'
import type { AgentPhase } from '@/agent/state/types'

const PHASE_LABELS: Record<string, string> = {
  THINKING: '思考中', ASSEMBLING_CONTEXT: '组装上下文', CALLING_API: '调用 AI',
  PLANNING: '规划中', AWAITING_TOOLS: '等待工具', EXECUTING: '执行中',
  REFLECTING: '反思中', VERIFYING: '验证中', RESPONDING: '回复中',
  ERROR: '错误', ABORTED: '已中止', AWAITING_APPROVAL: '待审批',
}

export function AgentStatusBar() {
  const [phase, setPhase] = useState<AgentPhase>('IDLE')
  const [iter, setIter] = useState(0)
  const [running, setRunning] = useState(false)
  const [tools, setTools] = useState<Array<{ callId: string; toolName: string; status: string }>>([])
  const [doneTime, setDoneTime] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  // Poll AgentStore every 200ms (lightweight, avoids Zustand reactivity issues)
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const s = useAgentStore.getState().run
      setPhase(s.phase)
      setIter(s.iteration)
      setRunning(s.isRunning)
      setTools(Object.values(s.activeTools))
    }, 200)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  // Track completion for 3s display
  useEffect(() => {
    if (running || tools.length > 0) {
      setDoneTime(0)
    } else if (!running && !tools.length && iter > 0 && !doneTime) {
      setDoneTime(Date.now())
    }
  }, [running, tools.length, iter])

  // Auto-hide after 2s (shorter, less intrusive)
  useEffect(() => {
    if (!doneTime) return
    const t = setTimeout(() => { setDoneTime(0); setIter(0) }, 2000)
    return () => clearTimeout(t)
  }, [doneTime])

  const label = PHASE_LABELS[phase] || phase

  return (
    <div style={{
      padding: '6px 14px', fontSize: 11,
      borderTop: '1px solid rgba(124,58,237,0.12)',
      background: doneTime ? 'rgba(22,163,74,0.06)' : 'rgba(124,58,237,0.04)',
    }}>
      {doneTime ? (
        <span style={{ fontWeight: 600, color: '#16a34a' }}>✓ 完成 · {iter} 轮 {tools.length} 工具</span>
      ) : !running && iter === 0 ? (
        <span style={{ color: '#9b8e84' }}>就绪</span>
      ) : (
        <>
          <span style={{ fontWeight: 600, color: '#7c3aed' }}>{label}</span>
          {iter > 0 && <span style={{ color: '#9b8e84', margin: '0 8px' }}>· 第{iter}轮</span>}
          {tools.map((t, i) => (
            <span key={t.callId || i} style={{
              display: 'inline-block', margin: '1px 4px', padding: '2px 8px', borderRadius: 6, fontSize: 10,
              background: t.status === 'success' ? 'rgba(22,163,74,0.12)' : t.status === 'error' ? 'rgba(220,38,38,0.12)' : 'rgba(124,58,237,0.12)',
              color: t.status === 'success' ? '#16a34a' : t.status === 'error' ? '#dc2626' : '#7c3aed',
            }}>
              {t.status === 'running' ? '⏳' : t.status === 'success' ? '✓' : t.status === 'pending' ? '○' : '✗'} {t.toolName}
            </span>
          ))}
        </>
      )}
    </div>
  )
}
