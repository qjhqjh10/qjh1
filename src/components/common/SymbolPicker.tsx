import { useState } from 'react'
import Modal from './Modal'

const SYMBOLS: Record<string, string[]> = {
  '中文标点': ['。', '，', '！', '？', '；', '：', '、', '…', '—', '～', '·', '「', '」', '『', '』', '（', '）', '《', '》', '【', '】', '"', '"', '\'', '\''],
  '特殊符号': ['★', '☆', '●', '○', '◆', '◇', '▲', '△', '■', '□', '♥', '♡', '☀', '☁', '☂', '♠', '♣', '♦', '♪', '♫'],
  '数字符号': ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'],
  '数学符号': ['±', '×', '÷', '≈', '≠', '≤', '≥', '∞', '√', '∑', '∏', '∫', '∂', '∆', '∈', '∉', '⊂', '⊃', '∪', '∩'],
  '单位符号': ['￥', '＄', '€', '£', '℃', '℉', '‰', '㎡', '㎥', '№', '㏒', '㏑', '™', '®', '©'],
  '注音符号': ['ˉ', 'ˊ', 'ˇ', 'ˋ', '˙', '¨', '‥', '＊', '‧', '‵', '′', '″', '‴', '⁎', '⁑', '⁂'],
  '常用箭头': ['→', '←', '↑', '↓', '↔', '⇒', '⇐', '⇑', '⇓', '⇔', '↗', '↘', '↙', '↖'],
}

const TABS = Object.keys(SYMBOLS)

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelect: (symbol: string) => void
}

export default function SymbolPicker({ isOpen, onClose, onSelect }: Props) {
  const [tab, setTab] = useState(TABS[0])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="符号库" width={520}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '4px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: tab === t ? 600 : 400,
            background: tab === t ? 'rgba(124,58,237,0.08)' : 'transparent',
            color: tab === t ? '#7c3aed' : '#6b5e54',
          }}>
            {t}
          </button>
        ))}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4,
        padding: 16, borderRadius: 12, background: '#faf9f8',
      }}>
        {(SYMBOLS[tab] || []).map(s => (
          <button
            key={s}
            onClick={() => { onSelect(s); onClose() }}
            title={s}
            style={{
              width: '100%', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, background: '#fff',
              cursor: 'pointer', fontSize: 16, color: '#2d2520',
              transition: 'all 0.1s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5f3ff'; e.currentTarget.style.borderColor = '#c4b5fd' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)' }}
          >
            {s}
          </button>
        ))}
      </div>
    </Modal>
  )
}
