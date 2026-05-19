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

const ALL_DIMS = ['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing','emotionalTone','erotic','technology','politics','romanceDynamics','mysteryChain','militarySystem','economics']
const presetBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed', padding: '2px 6px' }

export default function DimensionSelectionDialog({ extractDims, extractCount, onToggleDim, onSetDims, onConfirm, onClose }: Props) {
  const renderDim = (d: { key: string; label: string; desc: string }) => (
    <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 8, cursor: 'pointer', background: extractDims.has(d.key) ? 'rgba(124,58,237,0.04)' : 'transparent', border: extractDims.has(d.key) ? '1px solid rgba(124,58,237,0.15)' : '1px solid transparent' }}>
      <input type="checkbox" checked={extractDims.has(d.key)} onChange={() => onToggleDim(d.key)} style={{ width: 13, height: 13, accentColor: '#7c3aed' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: '#2d2520' }}>{d.label}</span>
      <span style={{ fontSize: 9, color: '#9b8e84', marginLeft: 'auto' }}>{d.desc}</span>
    </label>
  )
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 24, width: 480, boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: '#2d2520', marginBottom: 16 }}>选择提取维度</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, maxHeight: 320, overflowY: 'auto' }} className="custom-scrollbar">
          <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', padding: '4px 8px' }}>基础维度</div>
          {[
            { key: 'characters', label: '角色提取', desc: '姓名/性格/关系/弧线' },
            { key: 'worldbuilding', label: '世界观测', desc: '地点/势力/规则/历史' },
            { key: 'items', label: '道具物品', desc: '法宝/丹药/武器/能力' },
            { key: 'powerSystem', label: '等级体系', desc: '境界/段位/晋升条件' },
            { key: 'chapterSummary', label: '章节摘要', desc: '150-300字详细剧情摘要' },
            { key: 'events', label: '关键事件', desc: '3-5个本章关键事件点' },
            { key: 'foreshadowing', label: '伏笔追踪', desc: '埋设/回收/相关章节' },
            { key: 'emotionalTone', label: '情绪基调', desc: '紧张/温馨/悲伤/热血' },
          ].map(d => renderDim(d))}
          <div style={{ fontSize: 10, fontWeight: 600, color: '#9b8e84', padding: '4px 8px', marginTop: 4 }}>扩展维度</div>
          {[
            { key: 'technology', label: '科技体系', desc: '科技层级/技术分类' },
            { key: 'politics', label: '政治/势力格局', desc: '势力关系/政治体系' },
            { key: 'romanceDynamics', label: '感情线', desc: '感情发展/恋爱阶段' },
            { key: 'mysteryChain', label: '推理链', desc: '线索/推理步骤/反转' },
            { key: 'militarySystem', label: '军事/战力体系', desc: '军衔/战力/编制' },
            { key: 'economics', label: '经济/资源体系', desc: '货币/资源/贸易' },
            { key: 'erotic', label: '情色分析', desc: 'dom-sub/性爱流程/体液/权力关系' },
          ].map(d => renderDim(d))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => onSetDims(new Set(ALL_DIMS))} style={presetBtn}>全选</button>
          <button onClick={() => onSetDims(new Set())} style={presetBtn}>清空</button>
          <button onClick={() => onSetDims(new Set(['characters','worldbuilding','chapterSummary','events','emotionalTone']))} style={presetBtn}>城市/恋爱</button>
          <button onClick={() => onSetDims(new Set(['characters','worldbuilding','items','powerSystem','chapterSummary','events','foreshadowing']))} style={presetBtn}>修仙/玄幻</button>
          <button onClick={() => onSetDims(new Set(['characters','worldbuilding','chapterSummary','events','foreshadowing','mysteryChain','emotionalTone']))} style={presetBtn}>悬疑</button>
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
