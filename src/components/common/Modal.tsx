import { ReactNode, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: number | string
}

export default function Modal({ isOpen, onClose, title, children, width = 640 }: Props) {
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
          onClick={onClose}
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
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 24,
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.14)',
              width,
              maxWidth: '90vw',
              maxHeight: '85vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {title && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '20px 24px 16px',
                  borderBottom: '1px solid #f0ece8',
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
            <div style={{ flex: 1, overflow: 'auto', padding: 24 }} className="custom-scrollbar">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
