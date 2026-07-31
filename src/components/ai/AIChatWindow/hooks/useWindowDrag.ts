// ── Window Drag/Resize（v13.x: 委托共享 hook useDraggableResizable，保留原 API）──

import { useDraggableResizable } from '@/components/common/useDraggableResizable'

export function useWindowDrag(windowKey: string) {
  const { size, setSize, pos, setPos, handleResizeStart, handleDragStart } = useDraggableResizable({
    anchor: 'right-bottom',
    persistKey: windowKey,
    defaultSize: { width: 500, height: 700 },
    defaultPos: { right: 28, bottom: 96 },
    minW: 360, minH: 360, maxW: 1200,
    dragExclude: 'button, input, textarea, select',
  })

  const winSize = size
  const winPos = pos
  const winStyle = { width: winSize.width, height: winSize.height }
  return { winSize, setWinSize: setSize, winPos, setWinPos: setPos, handleResizeStart, handleDragStart, winStyle }
}
