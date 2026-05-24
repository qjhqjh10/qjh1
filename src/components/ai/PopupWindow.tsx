import { useRef, useEffect, useState } from 'react'
import { useStore } from '@/store'
import type { PopupWindow as PopupWindowData } from '@/store'
import { OutlinePopup } from './popups/OutlinePopup'
import { DraftPopup } from './popups/DraftPopup'
import { KbPopup } from './popups/KbPopup'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface Props {
  popup: PopupWindowData
  zIndex: number
  onFocus: () => void
}

const STORAGE_PREFIX = 'popup_window_'

function loadBounds(type: string) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + type)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.w === 'number' && typeof parsed.h === 'number' &&
          typeof parsed.r === 'number' && typeof parsed.b === 'number') {
        return { width: parsed.w, height: parsed.h, right: parsed.r, bottom: parsed.b }
      }
    }
  } catch {}
  return { width: 480, height: 420, right: 300 + Math.random() * 200, bottom: 100 + Math.random() * 200 }
}

function saveBounds(type: string, w: number, h: number, r: number, b: number) {
  try { localStorage.setItem(STORAGE_PREFIX + type, JSON.stringify({ w, h, r, b })) } catch {}
}

export default function PopupWindow({ popup, zIndex, onFocus }: Props) {
  const closePopup = useStore(s => s.closePopup)
  const saved = loadBounds(popup.type)
  const [size, setSize] = useState({ width: saved.width, height: saved.height })
  const [pos, setPos] = useState({ right: saved.right, bottom: saved.bottom })
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0, startR: 0, startB: 0, corner: '' })
  const dragRef = useRef({ startX: 0, startY: 0, startR: 0, startB: 0 })
  const cleanupDragRef = useRef<(() => void) | null>(null)

  // Persist position/size on every change (matches AIChatWindow behavior)
  useEffect(() => { saveBounds(popup.type, size.width, size.height, pos.right, pos.bottom) }, [size, pos, popup.type])

  // Cleanup drag/resize listeners on unmount
  useEffect(() => {
    return () => { cleanupDragRef.current?.() }
  }, [])

  const handleResizeStart = (corner: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height, startR: pos.right, startB: pos.bottom, corner }
    const handleMove = (ev: MouseEvent) => {
      const { startX, startY, startW, startH, startR, startB, corner } = resizeRef.current
      const dx = ev.clientX - startX; const dy = ev.clientY - startY
      let w = startW, h = startH, r = startR, b = startB
      const isEdge = /^(top|bottom|left|right)$/.test(corner)
      if (isEdge) {
        if (corner === 'right')  { w = Math.max(360, Math.min(1200, startW + dx)); r = startR - dx }
        if (corner === 'left')   { w = Math.max(360, Math.min(1200, startW - dx)) }
        if (corner === 'bottom') { h = Math.max(360, Math.min(window.innerHeight - 60, startH + dy)); b = startB - dy }
        if (corner === 'top')    { h = Math.max(360, Math.min(window.innerHeight - 60, startH - dy)) }
      } else {
        if (corner.includes('right'))  { w = Math.max(360, Math.min(1200, startW + dx)) }
        if (corner.includes('left'))   { w = Math.max(360, Math.min(1200, startW - dx)); r = startR + dx }
        if (corner.includes('bottom')) { h = Math.max(360, Math.min(window.innerHeight - 60, startH + dy)) }
        if (corner.includes('top'))    { h = Math.max(360, Math.min(window.innerHeight - 60, startH - dy)); b = startB + dy }
      }
      setSize({ width: w, height: h })
      setPos({ right: Math.max(0, r), bottom: Math.max(0, b) })
    }
    const handleUp = () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); cleanupDragRef.current = null }
    cleanupDragRef.current?.()
    cleanupDragRef.current = handleUp
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp)
  }

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select')) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startR: pos.right, startB: pos.bottom }
    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragRef.current.startX; const dy = ev.clientY - dragRef.current.startY
      setPos({ right: Math.max(0, dragRef.current.startR - dx), bottom: Math.max(0, dragRef.current.startB - dy) })
    }
    const handleUp = () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); cleanupDragRef.current = null }
    cleanupDragRef.current?.()
    cleanupDragRef.current = handleUp
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp)
  }

  const renderContent = () => {
    switch (popup.type) {
      case 'outline':
        return <OutlinePopup />
      case 'worldbuilding':
        return <OutlinePopup worldbuilding />
      case 'draft':
        return <DraftPopup documentKey={popup.documentKey || ''} />
      case 'kb':
        return <KbPopup />
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
      <div
        onMouseDown={handleDragStart}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(0,0,0,0.02)', cursor: 'grab', flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>{popup.title}</span>
        <button onClick={() => { saveBounds(popup.type, size.width, size.height, pos.right, pos.bottom); closePopup(popup.id) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2, display: 'flex' }}>
          <XMarkIcon style={{ width: 16, height: 16 }} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
        {renderContent()}
      </div>
      {/* 8 resize handles matching AIChatWindow style */}
      {(['top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'] as const).map(corner => {
        const isEdge = corner === 'top' || corner === 'bottom' || corner === 'left' || corner === 'right'
        return (
        <div key={corner} onMouseDown={handleResizeStart(corner)} style={{
          position: 'absolute',
          top: corner.includes('top') ? 0 : undefined,
          bottom: corner.includes('bottom') ? 0 : undefined,
          left: corner.includes('left') ? 0 : undefined,
          right: corner.includes('right') ? 6 : undefined,
          width: isEdge ? (corner === 'top' || corner === 'bottom' ? 'calc(100% - 16px)' : (corner === 'right' ? 4 : 8)) : 16,
          height: isEdge ? (corner === 'left' || corner === 'right' ? 'calc(100% - 16px)' : (corner === 'bottom' ? 4 : 8)) : 16,
          marginTop: (corner === 'left' || corner === 'right') ? 8 : 0,
          cursor: corner === 'top' || corner === 'bottom' ? 'ns-resize'
            : corner === 'left' || corner === 'right' ? 'ew-resize'
            : corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize',
          zIndex: isEdge ? 1 : 10,
        }}>
          {!isEdge && <svg width="12" height="12" viewBox="0 0 14 14"><path d="M0 14L14 0V3L3 14H0Z" fill="#9b8e84" opacity="0.3"/></svg>}
        </div>
      )})}
    </div>
  )
}
