import { useEffect, useRef } from 'react'
import { PencilSquareIcon, PencilIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline'

interface Props {
  x: number
  y: number
  onContinue: () => void
  onRewrite?: () => void
  onSendToAI?: () => void
  onClose: () => void
}

export default function ContextMenu({ x, y, onContinue, onRewrite, onSendToAI, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  const item: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 13, color: '#2d2520', width: '100%', textAlign: 'left',
    borderRadius: 6,
  }

  return (
    <div ref={ref} role="menu" style={{
      position: 'fixed', left: x, top: y, zIndex: 200,
      background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.14)',
      border: '1px solid rgba(0,0,0,0.06)', padding: 4, minWidth: 140,
    }}>
      {onRewrite && (
        <button onClick={onRewrite} role="menuitem" style={item}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f5f3ff'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
        >
          <PencilIcon style={{ width: 16, height: 16, color: '#7c3aed' }} /> 改写
        </button>
      )}
      <button onClick={onContinue} role="menuitem" style={item}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f5f3ff'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <PencilSquareIcon style={{ width: 16, height: 16, color: '#7c3aed' }} /> 续写
      </button>
      {onSendToAI && (
        <>
          <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '2px 8px' }} />
          <button onClick={onSendToAI} role="menuitem" style={{ ...item, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#fef3c7'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PaperAirplaneIcon style={{ width: 16, height: 16, color: '#d97706' }} /> 发送到 AI 写作助手
            </span>
            <span style={{ fontSize: 10.5, color: '#9b8e84', paddingLeft: 24, lineHeight: 1.4 }}>
              AI 加载本章全文，可直接在编辑器改写（可撤销）
            </span>
          </button>
        </>
      )}
    </div>
  )
}
