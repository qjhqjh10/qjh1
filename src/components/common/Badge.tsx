import { motion, AnimatePresence } from 'framer-motion'

interface BadgeProps {
  count?: number
  dot?: boolean
  color?: string
  children?: React.ReactNode
}

export default function Badge({ count, dot = false, color, children }: BadgeProps) {
  const accentColor = color || 'var(--theme-error, #dc2626)'

  if (dot) {
    return (
      <div style={{ position: 'relative', display: 'inline-flex' }}>
        {children}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          style={{
            position: 'absolute', top: -3, right: -3,
            width: 8, height: 8, borderRadius: '50%',
            background: accentColor,
            border: '2px solid var(--theme-bg-card-solid, #fff)',
          }}
        />
      </div>
    )
  }

  const displayCount = count !== undefined ? (count > 99 ? '99+' : String(count)) : null

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {children}
      <AnimatePresence mode="wait">
        {displayCount && (
          <motion.span
            key={displayCount}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            style={{
              position: 'absolute', top: -8, right: -8,
              minWidth: 18, height: 18, borderRadius: 9,
              background: accentColor, color: '#fff',
              fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid var(--theme-bg-card-solid, #fff)',
              lineHeight: 1,
            }}
          >
            {displayCount}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
