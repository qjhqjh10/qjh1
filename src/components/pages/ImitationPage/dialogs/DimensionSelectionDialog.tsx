import Button from '@/components/common/Button'
import { PlayIcon } from '@heroicons/react/24/outline'

interface Props {
  extractDims: Set<string>
  extractCount: number
  onToggleDim: (key: string) => void
  onSetDims: (dims: Set<string>) => void
  onConfirm: () => void
  onClose: () => void
}

const ALL_DIMS = ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone','erotic']

export default function DimensionSelectionDialog({ extractDims, extractCount, onToggleDim, onSetDims, onConfirm, onClose }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 24, width: 420, boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520', marginBottom: 16 }}>选择提取维度</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {[
            { key: 'characters', label: '角色提取', desc: '姓名/性格/关系/弧线' },
            { key: 'worldbuilding', label: '世界观测', desc: '地点/势力/规则/历史' },
            { key: 'items', label: '道具物品', desc: '法宝/丹药/武器/能力' },
            { key: 'powerSystem', label: '等级体系', desc: '境界/段位/晋升条件' },
            { key: 'chapterSummary', label: '章节摘要', desc: '150-300字详细剧情摘要' },
            { key: 'events', label: '关键事件', desc: '3-5个本章关键事件点' },
            { key: 'foreshadowing', label: '伏笔追踪', desc: '埋设/回收/相关章节' },
            { key: 'emotionalTone', label: '情绪基调', desc: '紧张/温馨/悲伤/热血' },
            { key: 'erotic', label: '情色分析', desc: 'dom-sub/性爱流程/体液/权力关系' },
          ].map(d => (
            <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', background: extractDims.has(d.key) ? 'rgba(124,58,237,0.04)' : 'transparent', border: extractDims.has(d.key) ? '1px solid rgba(124,58,237,0.15)' : '1px solid transparent' }}>
              <input type="checkbox" checked={extractDims.has(d.key)} onChange={() => onToggleDim(d.key)} style={{ width: 14, height: 14, accentColor: '#7c3aed' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>{d.label}</span>
              <span style={{ fontSize: 10, color: '#9b8e84', marginLeft: 'auto' }}>{d.desc}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <button onClick={() => onSetDims(new Set(ALL_DIMS))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>全选</button>
          <button onClick={() => onSetDims(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>清空</button>
          <button onClick={() => onSetDims(new Set(['characters','worldbuilding','chapterSummary','events','emotionalTone']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>城市/恋爱</button>
          <button onClick={() => onSetDims(new Set(['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing']))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed' }}>修仙/玄幻</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={onConfirm} icon={<PlayIcon style={{ width: 14, height: 14 }} />}>
            开始提取 ({extractCount}章 · {extractDims.size}维)
          </Button>
        </div>
      </div>
    </div>
  )
}
