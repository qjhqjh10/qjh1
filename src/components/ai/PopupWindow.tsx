import { useRef, useEffect, useState } from 'react'
import { useStore } from '@/store'
import type { PopupWindow as PopupWindowData } from '@/store'
import { OutlinePopup } from './popups/OutlinePopup'
import { DraftPopup } from './popups/DraftPopup'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface Props {
  popup: PopupWindowData
  zIndex: number
  onFocus: () => void
}

export default function PopupWindow({ popup, zIndex, onFocus }: Props) {
  const closePopup = useStore(s => s.closePopup)
  const [size, setSize] = useState({ width: 420, height: 360 })
  const [pos, setPos] = useState(() => ({
    right: 300 + Math.random() * 200,
    bottom: 100 + Math.random() * 200,
  }))
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0, startR: 0, startB: 0, corner: '' })
  const dragRef = useRef({ startX: 0, startY: 0, startR: 0, startB: 0 })

  const handleResizeStart = (corner: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height, startR: pos.right, startB: pos.bottom, corner }
    const hm = (ev: MouseEvent) => {
      const { startX, startY, startW, startH, startR, startB, corner } = resizeRef.current
      const dx = ev.clientX - startX; const dy = ev.clientY - startY
      let w = startW, h = startH, r = startR, b = startB
      if (corner.includes('right')) { w = Math.max(320, Math.min(900, startW + dx)); r = startR - dx }
      if (corner.includes('left')) { w = Math.max(320, Math.min(900, startW - dx)) }
      if (corner.includes('bottom')) { h = Math.max(240, Math.min(800, startH + dy)); b = startB - dy }
      if (corner.includes('top')) { h = Math.max(240, Math.min(800, startH - dy)) }
      setSize({ width: w, height: h })
      setPos({ right: Math.max(0, r), bottom: Math.max(0, b) })
    }
    const hu = () => { window.removeEventListener('mousemove', hm); window.removeEventListener('mouseup', hu) }
    window.addEventListener('mousemove', hm); window.addEventListener('mouseup', hu)
  }

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startR: pos.right, startB: pos.bottom }
    const hm = (ev: MouseEvent) => {
      const dx = ev.clientX - dragRef.current.startX; const dy = ev.clientY - dragRef.current.startY
      setPos({ right: Math.max(0, dragRef.current.startR - dx), bottom: Math.max(0, dragRef.current.startB - dy) })
    }
    const hu = () => { window.removeEventListener('mousemove', hm); window.removeEventListener('mouseup', hu) }
    window.addEventListener('mousemove', hm); window.addEventListener('mouseup', hu)
  }

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', () => {})
      window.removeEventListener('mouseup', () => {})
    }
  }, [])

  const renderContent = () => {
    switch (popup.type) {
      case 'outline':
        return <OutlinePopup />
      case 'worldbuilding':
        return <OutlinePopup worldbuilding />
      case 'draft':
        return <DraftPopup documentKey={popup.documentKey || ''} />
      default:
        return <div style={{ padding: 20, color: '#9b8e84' }}>未知弹窗类型</div>
    }
  }

  return (
    <div
      onMouseDown={onFocus}
      style={{
        position: 'fixed', right: pos.right, bottom: pos.bottom,
        width: size.width, height: size.height,
        borderRadius: 16, background: '#fff',
        border: '1px solid rgba(0,0,0,0.1)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column', zIndex: 50 + zIndex,
        overflow: 'hidden',
      }}
    >
      {/* Title bar (draggable) */}
      <div
        onMouseDown={handleDragStart}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(0,0,0,0.02)', cursor: 'grab', flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>{popup.title}</span>
        <button
          onClick={() => closePopup(popup.id)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2, display: 'flex' }}
        >
          <XMarkIcon style={{ width: 16, height: 16 }} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {renderContent()}
      </div>

      {/* 4-corner resize handles */}
      {(['top-left','top-right','bottom-left','bottom-right'] as const).map(corner => (
        <div key={corner} onMouseDown={handleResizeStart(corner)} style={{
          position: 'absolute',
          top: corner.includes('top') ? 0 : undefined,
          bottom: corner.includes('bottom') ? 0 : undefined,
          left: corner.includes('left') ? 0 : undefined,
          right: corner.includes('right') ? 0 : undefined,
          width: 14, height: 14,
          cursor: corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize',
          opacity: 0.3,
        }}>
          <svg width="12" height="12" viewBox="0 0 14 14"><path d="M0 14L14 0V3L3 14H0Z" fill="#9b8e84"/><path d="M0 14L14 0H11L0 11V14Z" fill="#9b8e84"/></svg>
        </div>
      ))}
    </div>
  )
}
