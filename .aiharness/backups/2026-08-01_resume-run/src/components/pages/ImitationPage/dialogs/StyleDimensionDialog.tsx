import Button from '@/components/common/Button'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { DIMENSION_META, NOVEL_TYPE_DIMS } from '@/types/story'
import { TYPE_LABELS } from '../constants'

interface Props {
  styleDims: Set<string>
  styleChapterCount: number
  novelType: string
  onToggleDim: (key: string) => void
  onSetDims: (dims: Set<string>) => void
  onConfirm: () => void
  onClose: () => void
}

export default function StyleDimensionDialog({ styleDims, styleChapterCount, novelType, onToggleDim, onSetDims, onConfirm, onClose }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 24, width: 500, boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520', marginBottom: 16 }}>选择风格分析维度</h3>
        {['基础文风', '进阶技法', '涩涩专属', '类型专属'].map(cat => {
          const dimsInCat = Object.entries(DIMENSION_META).filter(([, v]) => v.category === cat)
          if (dimsInCat.length === 0) return null
          return (
            <div key={cat} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#9b8e84', marginBottom: 4 }}>{cat}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {dimsInCat.map(([key, meta]) => (
                  <label key={key} style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                    background: styleDims.has(key) ? 'rgba(124,58,237,0.06)' : 'transparent',
                    border: styleDims.has(key) ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
                    fontSize: 10,
                  }}>
                    <input type="checkbox" checked={styleDims.has(key)} onChange={() => onToggleDim(key)} style={{ width: 12, height: 12, accentColor: '#7c3aed' }} />
                    {meta.label}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, marginTop: 8 }}>
          <button onClick={() => onSetDims(new Set(Object.keys(DIMENSION_META)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>全选</button>
          <button onClick={() => onSetDims(new Set(NOVEL_TYPE_DIMS['通用']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>基础</button>
          <button onClick={() => onSetDims(new Set(NOVEL_TYPE_DIMS[TYPE_LABELS[novelType]] || NOVEL_TYPE_DIMS['通用']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>按类型推荐</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={onConfirm} icon={<SparklesIcon style={{ width: 14, height: 14 }} />}>
            开始分析 ({styleDims.size}维 · {styleChapterCount || 20}章)
          </Button>
        </div>
      </div>
    </div>
  )
}
