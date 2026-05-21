import { useState, useEffect, useCallback, useRef } from 'react'
import { XMarkIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon, ArrowsPointingOutIcon } from '@heroicons/react/24/outline'

interface Props {
  src: string
  alt?: string
  onClose: () => void
}

export default function ImageLightbox({ src, alt, onClose }: Props) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })

  const zoomIn = useCallback(() => setScale(s => Math.min(s + 0.3, 5)), [])
  const zoomOut = useCallback(() => setScale(s => Math.max(s - 0.3, 0.3)), [])
  const reset = useCallback(() => { setScale(1); setPosition({ x: 0, y: 0 }) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') zoomIn()
      if (e.key === '-') zoomOut()
      if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, zoomIn, zoomOut, reset])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y }
    const onMove = (ev: MouseEvent) => {
      setPosition({
        x: dragStart.current.posX + ev.clientX - dragStart.current.x,
        y: dragStart.current.posY + ev.clientY - dragStart.current.y,
      })
    }
    const onUp = () => { setDragging(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.85)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Controls */}
      <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', gap: 8, zIndex: 101 }}>
        <button onClick={e => { e.stopPropagation(); zoomOut() }} style={ctrlBtn}>
          <MagnifyingGlassMinusIcon style={{ width: 18, height: 18 }} />
        </button>
        <button onClick={e => { e.stopPropagation(); zoomIn() }} style={ctrlBtn}>
          <MagnifyingGlassPlusIcon style={{ width: 18, height: 18 }} />
        </button>
        <button onClick={e => { e.stopPropagation(); reset() }} style={ctrlBtn} title="重置 (0)">
          <ArrowsPointingOutIcon style={{ width: 18, height: 18 }} />
        </button>
        <button onClick={e => { e.stopPropagation(); onClose() }} style={ctrlBtn}>
          <XMarkIcon style={{ width: 20, height: 20 }} />
        </button>
      </div>

      {/* Zoom indicator */}
      <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.5)', fontSize: 12, zIndex: 101 }}>
        {Math.round(scale * 100)}%
      </div>

      {/* Image */}
      <img
        src={src}
        alt={alt || '图片'}
        onClick={e => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        style={{
          maxWidth: '90%', maxHeight: '85%',
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transition: dragging ? 'none' : 'transform 0.2s ease',
          cursor: dragging ? 'grabbing' : 'grab',
          borderRadius: 12,
          userSelect: 'none',
        }}
        draggable={false}
        onWheel={e => {
          e.preventDefault()
          if (e.deltaY < 0) zoomIn()
          else zoomOut()
        }}
      />
    </div>
  )
}

const ctrlBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 36, height: 36, borderRadius: 10, border: 'none',
  background: 'rgba(255,255,255,0.1)', color: '#fff',
  cursor: 'pointer', backdropFilter: 'blur(8px)',
}
