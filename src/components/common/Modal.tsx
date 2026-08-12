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
  resizable?: boolean
}

export default function Modal({ isOpen, onClose, title, children, width: initialWidth = 640, maxHeight = '92vh', closeOnBackdropClick = true, draggable = false, resizable = false }: Props) {
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef({ startX: 0, startY: 0, posX: 0, posY: 0, active: false })
  const [modalSize, setModalSize] = useState({ w: 0, h: 0 })
  const [fixedPos, setFixedPos] = useState<{ left: number; top: number } | null>(null)
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0, startLeft: 0, startTop: 0, active: false })
  const modalRef = useRef<HTMLDivElement>(null)

  // Reset position when modal opens
  useEffect(() => { if (isOpen) { setDragPos({ x: 0, y: 0 }); setModalSize({ w: 0, h: 0 }); setFixedPos(null) } }, [isOpen])

  // Resize: fix position on start, update size on move
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = modalRef.current?.getBoundingClientRect()
    if (!rect) return
    setFixedPos({ left: rect.left, top: rect.top })
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height, startLeft: rect.left, startTop: rect.top, active: true }
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const hu = () => { resizeRef.current.active = false; document.body.style.userSelect = '' }
    const hm = (ev: MouseEvent) => {
      if (!resizeRef.current.active) return
      setModalSize({ w: Math.max(320, resizeRef.current.startW + ev.clientX - resizeRef.current.startX), h: Math.max(200, resizeRef.current.startH + ev.clientY - resizeRef.current.startY) })
    }
    window.addEventListener('mousemove', hm)
    window.addEventListener('mouseup', hu)
    return () => { window.removeEventListener('mousemove', hm); window.removeEventListener('mouseup', hu) }
  }, [])

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
    // Clear resize fixed position so drag works normally
    if (fixedPos) setFixedPos(null)
    dragRef.current = { startX: e.clientX, startY: e.clientY, posX: dragPos.x, posY: dragPos.y, active: true }
    document.body.style.userSelect = 'none'
  }, [draggable, dragPos.x, dragPos.y, fixedPos])

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
            // v16.3.0(审计 U2 修复): 100 → 110——KbSelectionModal 等整页弹窗须高于
            // AI 写作助手浮窗（zIndex 101）；浮窗内模态层（translateZ(0) 包含块）不受影响
            zIndex: 110,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.35)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
            style={{
              position: fixedPos ? 'fixed' : 'relative',
              left: fixedPos ? fixedPos.left : dragPos.x,
              top: fixedPos ? fixedPos.top : dragPos.y,
              background: 'var(--theme-bg-card-solid, #fff)',
              borderRadius: 'var(--theme-radius-xxl, 24px)',
              boxShadow: 'var(--theme-shadow-lg, 0 24px 64px rgba(0, 0, 0, 0.14))',
              width: modalSize.w ? modalSize.w : initialWidth,
              height: modalSize.h ? modalSize.h : undefined,
              maxWidth: '95vw',
              maxHeight: modalSize.h ? 'none' : maxHeight,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 320,
              minHeight: 200,
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
                  borderBottom: '1px solid var(--theme-border, #f0ece8)',
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
                    color: 'var(--theme-text-muted, #9b8e84)',
                  }}
                >
                  <XMarkIcon style={{ width: 20, height: 20 }} />
                </button>
              </div>
            )}
            {/* Drag handle bar when draggable but no title
                v16.4.0: 8px 隐形手柄难发现（主弹窗变小后拖动问题根因）——加高到 16px + 居中拖拽指示线 */}
            {!title && draggable && (
              <div
                onMouseDown={handleDragStart}
                style={{
                  height: 16, cursor: 'grab', flexShrink: 0, userSelect: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(180deg, rgba(0,0,0,0.02), transparent)',
                }}
                title="拖动此处移动弹窗"
              >
                <div style={{
                  width: 36, height: 4, borderRadius: 2,
                  background: 'rgba(0,0,0,0.08)',
                }} />
              </div>
            )}
            <div style={{ flex: 1, overflow: 'auto', padding: title || !draggable ? 24 : '8px 24px 24px' }} className="custom-scrollbar">
              {children}
            </div>
            {/* Resize handle */}
            {resizable && (
              <div
                onMouseDown={handleResizeStart}
                style={{
                  position: 'absolute', bottom: 0, right: 0,
                  width: 20, height: 20, cursor: 'nwse-resize',
                  background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.1) 50%)',
                  borderRadius: '0 0 24px 0',
                }}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
