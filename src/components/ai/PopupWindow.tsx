import { useStore } from '@/store'
import type { PopupWindow as PopupWindowData } from '@/store'
import { OutlinePopup } from './popups/OutlinePopup'
import { DraftPopup } from './popups/DraftPopup'
import { KbPopup } from './popups/KbPopup'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useDraggableResizable } from '@/components/common/useDraggableResizable'

interface Props {
  popup: PopupWindowData
  zIndex: number
  onFocus: () => void
}

export default function PopupWindow({ popup, zIndex, onFocus }: Props) {
  const closePopup = useStore(s => s.closePopup)
  // v13.x: 统一共享拖拽 hook（原手写实现删除；持久化 key 保持 popup_window_<type>）
  const { size, pos, handleResizeStart, handleDragStart } = useDraggableResizable({
    anchor: 'right-bottom',
    persistKey: 'popup_window_' + popup.type,
    defaultSize: { width: 480, height: 420 },
    defaultPos: { right: 300 + Math.random() * 200, bottom: 100 + Math.random() * 200 },
    minW: 360, minH: 360, maxW: 1200,
    dragExclude: 'button, input, textarea, select',
  })

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
        <button onClick={() => closePopup(popup.id)}
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
