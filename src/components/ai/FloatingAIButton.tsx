import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import { SparklesIcon } from '@heroicons/react/24/outline'

const DEFAULT_POS = { x: 28, y: 28 } // from bottom-right

export default function FloatingAIButton() {
  const isOpen = useStore(s => s.isAIChatOpen)
  const toggleAIChat = useStore(s => s.toggleAIChat)

  const [pos, setPos] = useState(DEFAULT_POS)
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 })
  const moved = useRef(false)
  const cleanupDragRef = useRef<(() => void) | null>(null)

  // Cleanup drag listeners on unmount
  useEffect(() => () => { cleanupDragRef.current?.() }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    moved.current = false
    dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
    const handleMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const dx = dragStart.current.x - ev.clientX
      const dy = dragStart.current.y - ev.clientY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true
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
    if (!moved.current) toggleAIChat()
  }, [toggleAIChat])

  return (
    <button
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      title="AI写作助手（可拖动）"
      style={{
        position: 'fixed',
        bottom: pos.y,
        right: pos.x,
        width: 56, height: 56,
        borderRadius: '50%',
        border: 'none',
        background: isOpen
          ? 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)'
          : 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
        color: '#fff',
        cursor: 'grab',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 32px rgba(124, 58, 237, 0.3)',
        transition: 'box-shadow 0.2s ease',
        zIndex: 50, userSelect: 'none',
      }}
      onMouseEnter={e => {
        if (!dragging.current) {
          e.currentTarget.style.transform = 'scale(1.08)'
          e.currentTarget.style.boxShadow = '0 12px 40px rgba(124, 58, 237, 0.4)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'scale(1)'
        e.currentTarget.style.boxShadow = '0 8px 32px rgba(124, 58, 237, 0.3)'
      }}
    >
      <SparklesIcon style={{ width: 26, height: 26 }} />
    </button>
  )
}
