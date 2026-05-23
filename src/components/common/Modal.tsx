import { ReactNode, useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: number | string
  maxHeight?: string
  closeOnBackdropClick?: boolean
  draggable?: boolean
}

export default function Modal({ isOpen, onClose, title, children, width = 640, maxHeight = '92vh', closeOnBackdropClick = true, draggable = false }: Props) {
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef({ startX: 0, startY: 0, posX: 0, posY: 0, active: false })

  // Reset drag position when modal opens
  useEffect(() => { if (isOpen) setDragPos({ x: 0, y: 0 }) }, [isOpen])

  // Cleanup drag listeners on unmount
  useEffect(() => {
    const hu = () => { dragRef.current.active = false; document.body.style.userSelect = '' }
    const hm = (ev: MouseEvent) => {
      if (!dragRef.current.active) return
      setDragPos({ x: dragRef.current.posX + ev.clientX - dragRef.current.startX, y: dragRef.current.posY + ev.clientY - dragRef.current.startY })
    }
    window.addEventListener('mousemove', hm)
    window.addEventListener('mouseup', hu)
    return () => { window.removeEventListener('mousemove', hm); window.removeEventListener('mouseup', hu) }
  }, [])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!draggable) return
    if ((e.target as HTMLElement).closest('button, select, input, textarea, label')) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, posX: dragPos.x, posY: dragPos.y, active: true }
    document.body.style.userSelect = 'none'
  }, [draggable, dragPos.x, dragPos.y])

  useEffect(() => {
    if (isOpen) {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose()
      }
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={closeOnBackdropClick ? onClose : undefined}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.35)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              left: dragPos.x,
              top: dragPos.y,
              background: '#fff',
              borderRadius: 24,
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.14)',
              width,
              maxWidth: '95vw',
              maxHeight,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {title && (
              <div
                onMouseDown={handleDragStart}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '20px 24px 16px',
                  borderBottom: '1px solid #f0ece8',
                  cursor: draggable ? 'grab' : 'default',
                  userSelect: 'none',
                }}
              >
                <h2 style={{ fontSize: 17, fontWeight: 600 }}>{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="关闭"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 6,
                    borderRadius: 8,
                    display: 'flex',
                    color: '#9b8e84',
                  }}
                >
                  <XMarkIcon style={{ width: 20, height: 20 }} />
                </button>
              </div>
            )}
            {/* Drag handle bar when draggable but no title */}
            {!title && draggable && (
              <div
                onMouseDown={handleDragStart}
                style={{
                  height: 8, cursor: 'grab',
                  background: 'linear-gradient(90deg, transparent 40%, rgba(0,0,0,0.05) 50%, transparent 60%)',
                }}
              />
            )}
            <div style={{ flex: 1, overflow: 'auto', padding: title || !draggable ? 24 : '8px 24px 24px' }} className="custom-scrollbar">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
