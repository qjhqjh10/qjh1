import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  hover?: boolean
}

export default function GlassCard({ children, className = '', style, onClick, hover = true }: Props) {
  return (
    <div
      onClick={onClick}
      className={`glass-card ${hover ? 'hover-lift' : ''} ${className}`}
      style={{
        padding: 20,
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
