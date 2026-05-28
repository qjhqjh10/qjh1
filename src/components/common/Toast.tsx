import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface ToastItem {
  id: string
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration: number
}

interface ToastContextValue {
  toast: (message: string, type?: ToastItem['type'], duration?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const TYPE_COLORS: Record<ToastItem['type'], { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(22,163,74,0.1)', border: 'rgba(22,163,74,0.3)', icon: '✓' },
  error: { bg: 'rgba(220,38,38,0.1)', border: 'rgba(220,38,38,0.3)', icon: '✕' },
  warning: { bg: 'rgba(230,126,0,0.1)', border: 'rgba(230,126,0,0.3)', icon: '!' },
  info: { bg: 'rgba(37,99,235,0.1)', border: 'rgba(37,99,235,0.3)', icon: 'i' },
}

function ToastCard({ toast: t, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(t.id), t.duration)
    return () => clearTimeout(timer)
  }, [t.id, t.duration, onRemove])

  const colors = TYPE_COLORS[t.type]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderRadius: 12,
        background: 'var(--theme-bg-card-solid, #fff)',
        border: `1px solid ${colors.border}`,
        boxShadow: 'var(--theme-shadow-md, 0 8px 24px rgba(0,0,0,0.1))',
        fontSize: 13, color: 'var(--theme-text-primary, #2d2520)',
        minWidth: 240, maxWidth: 380,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <span style={{
        width: 22, height: 22, borderRadius: '50%',
        background: colors.bg, border: `1px solid ${colors.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, flexShrink: 0,
        color: t.type === 'success' ? 'var(--theme-success, #16a34a)' :
               t.type === 'error' ? 'var(--theme-error, #dc2626)' :
               t.type === 'warning' ? 'var(--theme-warning, #e67e00)' :
               'var(--theme-info, #2563eb)',
      }}>{colors.icon}</span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
      <button
        onClick={() => onRemove(t.id)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--theme-text-muted, #9b8e84)', padding: 2, fontSize: 14, lineHeight: 1,
        }}
      >×</button>
    </motion.div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastItem['type'] = 'info', duration = 3000) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    setToasts(prev => [...prev, { id, message, type, duration }])
  }, [])

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: 'fixed', top: 20, right: 20, zIndex: 10000,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: toasts.length > 0 ? 'auto' : 'none',
      }}>
        <AnimatePresence mode="popLayout">
          {toasts.map(t => (
            <ToastCard key={t.id} toast={t} onRemove={remove} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
