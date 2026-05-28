import { motion } from 'framer-motion'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}

export default function Toggle({ checked, onChange, disabled = false, size = 'md' }: ToggleProps) {
  const w = size === 'sm' ? 32 : 40
  const h = size === 'sm' ? 18 : 22
  const dot = size === 'sm' ? 14 : 18
  const travel = w - dot - (size === 'sm' ? 2 : 2)

  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.92 }}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: w, height: h,
        borderRadius: h / 2,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked
          ? 'var(--theme-accent, #7c3aed)'
          : 'var(--theme-border, rgba(0,0,0,0.12))',
        position: 'relative',
        padding: 0,
        transition: 'background 0.2s ease',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <motion.div
        animate={{ x: checked ? travel : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{
          width: dot, height: dot,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: 1, left: 1,
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      />
    </motion.button>
  )
}
