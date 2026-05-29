import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import { useAgentStore } from '@/agent/store/AgentStore'
import { SparklesIcon } from '@heroicons/react/24/outline'

const POS_STORAGE_KEY = 'floating-ai-button-pos'
const DEFAULT_POS = { x: 28, y: 28 } // from bottom-right

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return {
          x: Math.max(0, Math.min(window.innerWidth - 60, parsed.x)),
          y: Math.max(0, Math.min(window.innerHeight - 60, parsed.y)),
        }
      }
    }
  } catch {}
  return DEFAULT_POS
}

export default function FloatingAIButton() {
  const isOpen = useStore(s => s.isAIChatOpen)
  const toggleAIChat = useStore(s => s.toggleAIChat)
  const isAgentRunning = useAgentStore(s => s.run.isRunning)

  const [pos, setPos] = useState(loadPosition)
  const posRef = useRef(pos)
  const dragging = useRef(false)
  const didDrag = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 })
  const cleanupDragRef = useRef<(() => void) | null>(null)

  // Sync posRef
  useEffect(() => { posRef.current = pos }, [pos])

  // Cleanup drag listeners on unmount
  useEffect(() => () => { cleanupDragRef.current?.() }, [])

  // Persist position to localStorage on change
  useEffect(() => {
    try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos)) } catch {}
  }, [pos])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    didDrag.current = false
    dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
    const handleMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const dx = dragStart.current.x - ev.clientX
      const dy = dragStart.current.y - ev.clientY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag.current = true
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 60, dragStart.current.px + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, dragStart.current.py + dy)),
      })
    }
    const handleUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      cleanupDragRef.current = null
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    cleanupDragRef.current = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [pos])

  const handleClick = useCallback(() => {
    if (!didDrag.current) toggleAIChat()
  }, [toggleAIChat])

  return (
    <div style={{ position: 'fixed', bottom: pos.y, right: pos.x, zIndex: 50 }}>
      {/* Pulsing ring when agent is working */}
      {isAgentRunning && (
        <div style={{
          position: 'absolute', top: -6, left: -6, right: -6, bottom: -6,
          borderRadius: '50%', border: '2px solid rgba(124, 58, 237, 0.4)',
          animation: 'aiButtonPulse 2s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}
      <button
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        title={isAgentRunning ? 'AI写作助手 — 工作中...' : 'AI写作助手（可拖动）'}
        style={{
          width: 56, height: 56,
          borderRadius: '50%',
          border: isAgentRunning ? '2px solid rgba(124, 58, 237, 0.6)' : 'none',
          background: isAgentRunning
            ? 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)'
            : isOpen
              ? 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)'
              : 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
          color: '#fff',
          cursor: 'grab',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: isAgentRunning
            ? '0 0 20px rgba(124, 58, 237, 0.5), 0 8px 32px rgba(124, 58, 237, 0.3)'
            : '0 8px 32px rgba(124, 58, 237, 0.3)',
          transition: 'box-shadow 0.3s ease, border 0.3s ease, background 0.3s ease',
          userSelect: 'none',
        }}
        onMouseEnter={e => {
          if (!dragging.current) {
            e.currentTarget.style.transform = 'scale(1.08)'
            e.currentTarget.style.boxShadow = '0 12px 40px rgba(124, 58, 237, 0.4)'
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = isAgentRunning
            ? '0 0 20px rgba(124, 58, 237, 0.5), 0 8px 32px rgba(124, 58, 237, 0.3)'
            : '0 8px 32px rgba(124, 58, 237, 0.3)'
        }}
      >
        <SparklesIcon style={{ width: 26, height: 26 }} />
      </button>
    </div>
  )
}
