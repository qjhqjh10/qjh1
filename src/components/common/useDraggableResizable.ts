// ── 可拖拽/缩放的窗口 hook（v13.x: 统一 PopupWindow / useWindowDrag / 设置弹窗手写实现）──
// 支持两种锚定：left-top（AISettingsTab/PromptLibraryTab 风格）与 right-bottom（悬浮窗风格）。
// 统一了四角 + 四边 8 手柄缩放、尺寸/位置钳制、localStorage 持久化。

import { useState, useRef, useEffect, useCallback } from 'react'

export interface DraggableResizableOptions {
  /** 锚定方式：left-top 从左上角定位，right-bottom 从右下角定位 */
  anchor: 'left-top' | 'right-bottom'
  /** 持久化 key（可选，提供则存 localStorage：`${key}-size` / `${key}-pos`） */
  persistKey?: string
  defaultSize: { width: number; height: number }
  defaultPos: { left?: number; top?: number; right?: number; bottom?: number }
  minW?: number
  minH?: number
  maxW?: number
  maxH?: number
  /** 拖拽排除选择器（如 'button, input, textarea, select'） */
  dragExclude?: string
}

export function useDraggableResizable(opts: DraggableResizableOptions) {
  const {
    anchor, persistKey, defaultSize, defaultPos,
    minW = 360, minH = 360, maxW = 1200,
  } = opts
  const maxH = opts.maxH ?? Math.max(minH, window.innerHeight - 60)

  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    if (persistKey) {
      try {
        const s = localStorage.getItem(persistKey + '-size')
        if (s) {
          const parsed = JSON.parse(s) as { width?: number; height?: number }
          if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
            return { width: parsed.width, height: parsed.height }
          }
        }
      } catch { /* ignore */ }
    }
    return defaultSize
  })
  const [pos, setPos] = useState<{ left?: number; top?: number; right?: number; bottom?: number }>(() => {
    if (persistKey) {
      try {
        const s = localStorage.getItem(persistKey + '-pos')
        if (s) {
          const parsed = JSON.parse(s) as { left?: number; top?: number; right?: number; bottom?: number }
          if (typeof parsed.right === 'number' || typeof parsed.left === 'number') {
            return parsed
          }
        }
      } catch { /* ignore */ }
    }
    return defaultPos
  })

  useEffect(() => {
    if (persistKey) { try { localStorage.setItem(persistKey + '-size', JSON.stringify(size)) } catch { /* ignore */ } }
  }, [size, persistKey])
  useEffect(() => {
    if (persistKey) { try { localStorage.setItem(persistKey + '-pos', JSON.stringify(pos)) } catch { /* ignore */ } }
  }, [pos, persistKey])

  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0, startP: {} as { left?: number; top?: number; right?: number; bottom?: number }, corner: '' })
  const dragRef = useRef({ startX: 0, startY: 0, startP: {} as { left?: number; top?: number; right?: number; bottom?: number } })
  const cleanupRef = useRef<(() => void) | null>(null)

  // Cleanup drag/resize listeners on unmount
  useEffect(() => {
    return () => { cleanupRef.current?.() }
  }, [])

  const clamp = useCallback((v: number) => Math.max(minW, Math.min(maxW, v)), [minW, maxW])
  const clampH = useCallback((v: number) => Math.max(minH, Math.min(maxH, v)), [minH, maxH])

  const handleResizeStart = useCallback((corner: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      startW: size.width, startH: size.height,
      startP: { ...pos }, corner,
    }
    const handleMove = (ev: MouseEvent) => {
      const { startX, startY, startW, startH, startP, corner: c } = resizeRef.current
      const dx = ev.clientX - startX; const dy = ev.clientY - startY
      let w = startW, h = startH
      const nextP: Record<string, number> = { ...startP }
      const isEdge = /^(top|bottom|left|right)$/.test(c)
      if (isEdge) {
        if (c === 'right') {
          w = clamp(startW + dx)
          if (anchor === 'right-bottom') nextP.right = (startP.right ?? 0) - dx
        }
        if (c === 'left') {
          const nw = clamp(startW - dx)
          if (anchor === 'left-top') nextP.left = (startP.left ?? 0) + (startW - nw)
          w = nw
        }
        if (c === 'bottom') {
          h = clampH(startH + dy)
          if (anchor === 'right-bottom') nextP.bottom = (startP.bottom ?? 0) - dy
        }
        if (c === 'top') {
          const nh = clampH(startH - dy)
          if (anchor === 'left-top') nextP.top = (startP.top ?? 0) + (startH - nh)
          h = nh
        }
      } else {
        // Corner: 拖拽边随鼠标，对侧为锚点
        if (c.includes('right')) { w = clamp(startW + dx); if (anchor === 'right-bottom') nextP.right = (startP.right ?? 0) - dx }
        if (c.includes('left')) {
          const nw = clamp(startW - dx)
          if (anchor === 'left-top') nextP.left = (startP.left ?? 0) + (startW - nw)
          w = nw
        }
        if (c.includes('bottom')) { h = clampH(startH + dy); if (anchor === 'right-bottom') nextP.bottom = (startP.bottom ?? 0) - dy }
        if (c.includes('top')) {
          const nh = clampH(startH - dy)
          if (anchor === 'left-top') nextP.top = (startP.top ?? 0) + (startH - nh)
          h = nh
        }
      }
      setSize({ width: w, height: h })
      setPos(nextP as typeof pos)
    }
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      cleanupRef.current = null
    }
    cleanupRef.current?.()
    cleanupRef.current = handleUp
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [size, pos, anchor, clamp, clampH])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (opts.dragExclude && (e.target as HTMLElement).closest(opts.dragExclude)) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startP: { ...pos } }
    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      const nextP: Record<string, number> = { ...dragRef.current.startP }
      if (anchor === 'right-bottom') {
        nextP.right = Math.max(0, (nextP.right ?? 0) - dx)
        nextP.bottom = Math.max(0, (nextP.bottom ?? 0) - dy)
      } else {
        nextP.left = Math.max(0, (nextP.left ?? 0) + dx)
        nextP.top = Math.max(0, (nextP.top ?? 0) + dy)
      }
      setPos(nextP as typeof pos)
    }
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      cleanupRef.current = null
    }
    cleanupRef.current?.()
    cleanupRef.current = handleUp
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [pos, anchor, opts.dragExclude])

  return { size, setSize, pos, setPos, handleResizeStart, handleDragStart }
}
