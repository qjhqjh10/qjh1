import { motion } from 'framer-motion'

interface ProgressProps {
  value: number // 0-100
  color?: string
  height?: number
  showLabel?: boolean
  animated?: boolean
}

export default function Progress({ value, color, height = 6, showLabel = false, animated = true }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value))
  const accentColor = color || 'var(--theme-accent, #7c3aed)'

  return (
    <div style={{ width: '100%' }}>
      {showLabel && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginBottom: 4,
          fontSize: 11, color: 'var(--theme-text-muted, #9b8e84)',
        }}>
          <span>{Math.round(clamped)}%</span>
        </div>
      )}
      <div style={{
        height, borderRadius: height / 2,
        background: 'var(--theme-bg-hover, rgba(0,0,0,0.04))',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <motion.div
          initial={animated ? { width: 0 } : false}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{
            height: '100%',
            borderRadius: height / 2,
            background: accentColor,
            position: 'relative',
          }}
        >
          {/* Glow pulse at the end */}
          <motion.div
            animate={{
              boxShadow: [
                `0 0 4px ${accentColor}40`,
                `0 0 12px ${accentColor}60`,
                `0 0 4px ${accentColor}40`,
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              position: 'absolute',
              right: 0, top: 0, bottom: 0,
              width: 8, borderRadius: '50%',
              background: accentColor,
            }}
          />
        </motion.div>
      </div>
    </div>
  )
}

export function ProgressIndeterminate({ color, height = 4 }: { color?: string; height?: number }) {
  const accentColor = color || 'var(--theme-accent, #7c3aed)'

  return (
    <div style={{
      height, borderRadius: height / 2,
      background: 'var(--theme-bg-hover, rgba(0,0,0,0.04))',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <motion.div
        animate={{ x: ['-100%', '200%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: '40%', height: '100%',
          borderRadius: height / 2,
          background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        }}
      />
    </div>
  )
}
