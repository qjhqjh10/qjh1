interface GenerationOverlayProps {
  genWordCount: number;
  genDragPos: { x: number; y: number };
  onCancel: () => void;
  onDragMouseDown: (e: React.MouseEvent) => void;
}

export function GenerationOverlay({ genWordCount, genDragPos, onCancel, onDragMouseDown }: GenerationOverlayProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99,
      background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(2px)',
      pointerEvents: 'auto',
    }}>
      <div
        onMouseDown={onDragMouseDown}
        style={{
          position: 'fixed', left: '50%', top: '50%', transform: `translate(calc(-50% + ${genDragPos.x}px), calc(-50% + ${genDragPos.y}px))`,
          zIndex: 100, padding: '24px 32px', borderRadius: 20,
          background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 16px 64px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          cursor: 'grab', userSelect: 'none', minWidth: 220,
        }}
      >
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid rgba(124,58,237,0.15)',
          borderTopColor: '#7c3aed',
          animation: `spin 0.8s linear infinite`,
        }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>AI 正在生成章节</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#7c3aed' }}>
          {genWordCount.toLocaleString()}
          <span style={{ fontSize: 13, fontWeight: 400, color: '#9b8e84', marginLeft: 4 }}>字</span>
        </div>
        <button
          onClick={onCancel}
          style={{
            padding: '6px 20px', borderRadius: 10, border: '1px solid rgba(220,38,38,0.2)',
            background: 'rgba(220,38,38,0.05)', color: '#dc2626', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          取消生成
        </button>
      </div>
    </div>
  );
}
