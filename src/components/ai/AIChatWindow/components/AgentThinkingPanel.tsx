import { motion, AnimatePresence } from 'framer-motion'
import { useAgentStore } from '@/agent/store/AgentStore'

export function AgentThinkingPanel() {
  const thinking = useAgentStore(s => s.run.thinking)
  const phase = useAgentStore(s => s.run.phase)
  const isRunning = useAgentStore(s => s.run.isRunning)

  if (!thinking || !isRunning) return null

  const isThinking = phase === 'THINKING' || phase === 'ASSEMBLING_CONTEXT'

  return (
    <AnimatePresence>
      {isThinking && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 8,
            background: 'rgba(124,58,237,0.06)',
            border: '1px solid rgba(124,58,237,0.15)',
            fontSize: 12, fontFamily: 'inherit',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 600, color: '#7c3aed', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: 3,
              background: '#7c3aed',
              animation: 'pulse 1.2s infinite',
            }} />
            思考计划
          </div>

          <div style={{ color: '#6b7280', fontSize: 11 }}>
            {thinking.intent}
          </div>

          {thinking.steps.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {thinking.steps.map((step, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '2px 0', color: '#6d5h80',
                }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: 8,
                    background: 'rgba(124,58,237,0.1)', color: '#7c3aed',
                    fontSize: 10, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontWeight: 600,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ color: '#4b5563' }}>{step.action}</span>
                  <span style={{ color: '#9ca3af', fontSize: 10 }}>
                    [{step.tool}]
                  </span>
                </div>
              ))}
            </div>
          )}

          {thinking.filesNeeded.length > 0 && (
            <div style={{ marginTop: 4, color: '#6b7280', fontSize: 10 }}>
              需要文件: {thinking.filesNeeded.join(', ')}
            </div>
          )}

          <div style={{ marginTop: 4, color: '#9ca3af', fontSize: 10 }}>
            ~{thinking.estimatedTokens} tokens
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
