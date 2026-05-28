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
  primary: {
    bg: 'var(--theme-accent)',
    color: 'var(--theme-text-inverse)',
    hoverBg: 'var(--theme-accent-hover)',
    shadow: '0 2px 8px var(--theme-accent-glow)',
  },
  secondary: {
    bg: 'var(--theme-bg-card)',
    color: 'var(--theme-text-primary)',
    hoverBg: 'var(--theme-bg-card-solid)',
    border: '1px solid var(--theme-border)',
  },
  danger: {
    bg: 'var(--theme-error-bg)',
    color: 'var(--theme-error)',
    hoverBg: 'var(--theme-error)',
  },
  ghost: {
    bg: 'transparent',
    color: 'var(--theme-text-secondary)',
    hoverBg: 'var(--theme-bg-hover)',
  },
  'accent-gradient': {
    bg: 'linear-gradient(135deg, var(--theme-accent) 0%, var(--theme-accent-light) 100%)',
    color: 'var(--theme-text-inverse)',
    hoverBg: 'linear-gradient(135deg, var(--theme-accent-hover) 0%, var(--theme-accent) 100%)',
    shadow: '0 4px 14px var(--theme-accent-glow)',
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
    const s = Math.max(rect.width, rect.height)
    ripple.style.width = ripple.style.height = `${s}px`
    ripple.style.left = `${e.clientX - rect.left - s / 2}px`
    ripple.style.top = `${e.clientY - rect.top - s / 2}px`
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
      className="ripple-container touch-press"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding,
        fontSize,
        fontWeight: 600,
        borderRadius: 'var(--theme-radius-lg)',
        border: v.border || 'none',
        background: v.bg,
        color: v.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: v.shadow || 'none',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'inherit',
        ...style,
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = v.hoverBg
          if (v.shadow) e.currentTarget.style.boxShadow = v.shadow
          e.currentTarget.style.transform = 'translateY(-2px)'
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
        if (!disabled) e.currentTarget.style.transform = 'scale(0.95)'
      }}
      onMouseUp={e => {
        if (!disabled) e.currentTarget.style.transform = 'translateY(-2px)'
      }}
    >
      {icon}
      {children}
    </button>
  )
}
