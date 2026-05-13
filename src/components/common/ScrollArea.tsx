import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  maxHeight?: string | number
  style?: React.CSSProperties
}

export default function ScrollArea({ children, maxHeight = '100%', style }: Props) {
  return (
    <div
      className="custom-scrollbar"
      style={{
        overflowY: 'auto',
        maxHeight,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
