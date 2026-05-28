import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  hover?: boolean
  depth?: 0 | 1 | 2  // 0=flat, 1=standard, 2=elevated
  glow?: boolean
}

const depthStyles = {
  0: { background: 'rgba(255,255,255,0.4)', boxShadow: 'none', border: '1px solid rgba(0,0,0,0.03)' },
  1: { background: 'rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)', border: '1px solid rgba(255,255,255,0.5)' },
  2: { background: 'rgba(255,255,255,0.85)', boxShadow: '0 8px 24px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)', border: '1px solid rgba(255,255,255,0.6)' },
}

export default function GlassCard({ children, className = '', style, onClick, hover = true, depth = 1, glow = false }: Props) {
  const d = depthStyles[depth]

  return (
    <div
      onClick={onClick}
      className={`${className} ${hover ? 'hover-lift' : ''}`}
      style={{
        padding: 20,
        borderRadius: 20,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        backdropFilter: depth > 0 ? 'blur(12px)' : undefined,
        WebkitBackdropFilter: depth > 0 ? 'blur(12px)' : undefined,
        ...d,
        ...style,
      }}
      onMouseEnter={e => {
        if (hover && !glow) {
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)'
        }
        if (glow) {
          e.currentTarget.style.boxShadow = '0 0 20px rgba(124,58,237,0.12), 0 4px 12px rgba(0,0,0,0.06)'
          e.currentTarget.style.borderColor = 'rgba(124,58,237,0.15)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = d.boxShadow
        if (glow) e.currentTarget.style.borderColor = d.border
      }}
    >
      {children}
    </div>
  )
}
