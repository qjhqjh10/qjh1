import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  hover?: boolean
  depth?: 0 | 1 | 2
  glow?: boolean
}

const depthStyles = {
  0: {
    background: 'var(--theme-glass-bg-light)',
    boxShadow: 'none',
    border: '1px solid var(--theme-border)',
    backdropFilter: undefined as string | undefined,
  },
  1: {
    background: 'var(--theme-glass-bg)',
    boxShadow: 'var(--theme-shadow-sm)',
    border: '1px solid var(--theme-glass-border)',
    backdropFilter: 'blur(var(--theme-glass-blur))',
  },
  2: {
    background: 'var(--theme-bg-card)',
    boxShadow: 'var(--theme-shadow-md)',
    border: '1px solid var(--theme-glass-border)',
    backdropFilter: 'blur(var(--theme-glass-blur))',
  },
}

// Progressive hover: each depth lifts to the next shadow level
const hoverShadows = {
  0: 'var(--theme-shadow-sm)',
  1: 'var(--theme-shadow-md)',
  2: 'var(--theme-shadow-lg)',
}

const hoverLifts = {
  0: 'translateY(-2px)',
  1: 'translateY(-3px)',
  2: 'translateY(-4px)',
}

export default function GlassCard({ children, className = '', style, onClick, hover = true, depth = 1, glow = false }: Props) {
  const d = depthStyles[depth]

  return (
    <div
      onClick={onClick}
      className={`${className} touch-lift`}
      style={{
        padding: 20,
        borderRadius: 'var(--theme-radius-xxl)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        WebkitBackdropFilter: d.backdropFilter,
        ...d,
        ...style,
      }}
      onMouseEnter={e => {
        if (!hover) return
        if (glow) {
          e.currentTarget.style.boxShadow = 'var(--theme-shadow-glow)'
          e.currentTarget.style.borderColor = 'var(--theme-border-accent)'
        } else {
          e.currentTarget.style.boxShadow = hoverShadows[depth]
        }
        e.currentTarget.style.transform = hoverLifts[depth]
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = d.boxShadow
        e.currentTarget.style.transform = 'translateY(0)'
        if (glow) e.currentTarget.style.borderColor = d.border.split(' ').pop() || ''
      }}
    >
      {children}
    </div>
  )
}
