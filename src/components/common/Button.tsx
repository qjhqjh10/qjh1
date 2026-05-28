import { ReactNode, useRef, useCallback } from 'react'

interface Props {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent-gradient'
  size?: 'sm' | 'md'
  disabled?: boolean
  style?: React.CSSProperties
  icon?: ReactNode
}

const variants: Record<string, { bg: string; color: string; hoverBg: string; border?: string; shadow?: string }> = {
  primary: { bg: '#7c3aed', color: '#fff', hoverBg: '#6d28d9', shadow: '0 2px 8px rgba(124,58,237,0.25)' },
  secondary: { bg: 'rgba(255,255,255,0.7)', color: '#4a3f38', hoverBg: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)' },
  danger: { bg: '#fee2e2', color: '#dc2626', hoverBg: '#fecaca' },
  ghost: { bg: 'transparent', color: '#6b5e54', hoverBg: 'rgba(0,0,0,0.04)' },
  'accent-gradient': {
    bg: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
    color: '#fff',
    hoverBg: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)',
    shadow: '0 4px 14px rgba(124,58,237,0.3)',
  },
}

export default function Button({ children, onClick, variant = 'primary', size = 'md', disabled, style, icon }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const v = variants[variant]
  const padding = size === 'sm' ? '6px 14px' : '10px 20px'
  const fontSize = size === 'sm' ? 12 : 14

  const handleRipple = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const ripple = document.createElement('span')
    const size = Math.max(rect.width, rect.height)
    ripple.style.width = ripple.style.height = `${size}px`
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`
    ripple.className = 'ripple-effect'
    btnRef.current.appendChild(ripple)
    setTimeout(() => ripple.remove(), 600)
    onClick?.()
  }, [onClick])

  return (
    <button
      ref={btnRef}
      onClick={disabled ? undefined : handleRipple}
      disabled={disabled}
      className="ripple-container"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding,
        fontSize,
        fontWeight: 600,
        borderRadius: 14,
        border: v.border || 'none',
        background: v.bg,
        color: v.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: v.shadow || 'none',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = v.hoverBg
          if (v.shadow) e.currentTarget.style.boxShadow = v.shadow
          e.currentTarget.style.transform = 'translateY(-1px)'
        }
      }}
      onMouseLeave={e => {
        if (!disabled) {
          e.currentTarget.style.background = v.bg
          e.currentTarget.style.boxShadow = v.shadow || 'none'
          e.currentTarget.style.transform = 'translateY(0)'
        }
      }}
      onMouseDown={e => {
        if (!disabled) e.currentTarget.style.transform = 'scale(0.97)'
      }}
      onMouseUp={e => {
        if (!disabled) e.currentTarget.style.transform = 'translateY(-1px)'
      }}
    >
      {icon}
      {children}
    </button>
  )
}
