import { useState, useRef, useEffect, useCallback } from "react";

export function useWindowDrag(windowKey: string) {
  const [winSize, setWinSize] = useState(() => {
    try { const s = localStorage.getItem(windowKey + '-size'); if (s) return JSON.parse(s) } catch {}
    return { width: 500, height: 700 }
  })
  const [winPos, setWinPos] = useState(() => {
    try { const s = localStorage.getItem(windowKey + '-pos'); if (s) return JSON.parse(s) } catch {}
    return { right: 28, bottom: 96 }
  })
  // Persist window position/size
  useEffect(() => { try { localStorage.setItem(windowKey + '-size', JSON.stringify(winSize)) } catch {} }, [winSize])
  useEffect(() => { try { localStorage.setItem(windowKey + '-pos', JSON.stringify(winPos)) } catch {} }, [winPos])
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0, startR: 0, startB: 0, corner: '' })
  const dragRef = useRef({ startX: 0, startY: 0, startR: 0, startB: 0 })
  const cleanupDragRef = useRef<(() => void) | null>(null)

  // Cleanup drag/resize listeners on unmount
  useEffect(() => {
    return () => { cleanupDragRef.current?.() }
  }, [])

  const handleResizeStart = (corner: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: winSize.width, startH: winSize.height, startR: winPos.right, startB: winPos.bottom, corner }
    const handleMove = (ev: MouseEvent) => {
      const { startX, startY, startW, startH, startR, startB, corner } = resizeRef.current
      const dx = ev.clientX - startX; const dy = ev.clientY - startY
      let w = startW, h = startH, r = startR, b = startB
      const isEdge = /^(top|bottom|left|right)$/.test(corner)
      const MIN_W = 360, MAX_W = 1200, MIN_H = 360
      const MAX_H = Math.max(MIN_H, window.innerHeight - 60)
      // r/b update only when right/bottom edge follows mouse
      const moveRight  = corner.includes('right')
      const moveBottom = corner.includes('bottom')
      if (isEdge) {
        if (corner === 'right')  { w = clamp(startW + dx); r = startR - dx }
        if (corner === 'left')   { w = clamp(startW - dx) }
        if (corner === 'bottom') { h = clampH(startH + dy); b = startB - dy }
        if (corner === 'top')    { h = clampH(startH - dy) }
      } else {
        // Corner: opposite corner is the anchor (r/b only update for dragged side)
        if (corner.includes('right'))  { w = clamp(startW + dx); if (moveRight) r = startR - dx }
        if (corner.includes('left'))   { w = clamp(startW - dx) }
        if (corner.includes('bottom')) { h = clampH(startH + dy); if (moveBottom) b = startB - dy }
        if (corner.includes('top'))    { h = clampH(startH - dy) }
      }
      function clamp(v: number) { return Math.max(MIN_W, Math.min(MAX_W, v)) }
      function clampH(v: number) { return Math.max(MIN_H, Math.min(MAX_H, v)) }
      setWinSize({ width: w, height: h })
      setWinPos({ right: Math.max(0, r), bottom: Math.max(0, b) })
    }
    const handleUp = () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); cleanupDragRef.current = null }
    cleanupDragRef.current?.()
    cleanupDragRef.current = handleUp
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp)
  }

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea')) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startR: winPos.right, startB: winPos.bottom }
    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragRef.current.startX; const dy = ev.clientY - dragRef.current.startY
      setWinPos({ right: Math.max(0, dragRef.current.startR - dx), bottom: Math.max(0, dragRef.current.startB - dy) })
    }
    const handleUp = () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); cleanupDragRef.current = null }
    cleanupDragRef.current?.()
    cleanupDragRef.current = handleUp
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp)
  }
  const winStyle = { width: winSize.width, height: winSize.height };
  return { winSize, setWinSize, winPos, setWinPos, handleResizeStart, handleDragStart, winStyle };
}
