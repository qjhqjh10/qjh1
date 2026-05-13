import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  disabled?: boolean
  style?: React.CSSProperties
  icon?: ReactNode
}

const variants = {
  primary: { bg: '#7c3aed', color: '#fff', hoverBg: '#6d28d9' },
  secondary: { bg: 'rgba(255,255,255,0.7)', color: '#4a3f38', hoverBg: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)' },
  danger: { bg: '#fee2e2', color: '#dc2626', hoverBg: '#fecaca' },
  ghost: { bg: 'transparent', color: '#6b5e54', hoverBg: 'rgba(0,0,0,0.04)' },
}

export default function Button({ children, onClick, variant = 'primary', size = 'md', disabled, style, icon }: Props) {
  const v = variants[variant]
  const padding = size === 'sm' ? '6px 14px' : '10px 20px'
  const fontSize = `var(--button-font-size, ${size === 'sm' ? 12 : 14}px)`

  return (
    <button
      onClick={onClick}
      disabled={disabled}
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
        transition: 'all 0.15s ease',
        ...style,
      }}
      onMouseEnter={e => {
        if (!disabled) (e.currentTarget as HTMLElement).style.background = v.hoverBg
      }}
      onMouseLeave={e => {
        if (!disabled) (e.currentTarget as HTMLElement).style.background = v.bg
      }}
    >
      {icon}
      {children}
    </button>
  )
}
