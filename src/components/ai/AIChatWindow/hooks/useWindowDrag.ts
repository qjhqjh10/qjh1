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

  // v16.3.0(审计 M1 修复): 删未使用返回值 winStyle/setWinSize/setWinPos——调用方仅消费
  // winSize/winPos/handleResizeStart/handleDragStart（JSX 直接读 winPos/winSize）
  return { winSize: size, winPos: pos, handleResizeStart, handleDragStart }
}
