import { useState } from 'react'
import Modal from './Modal'
import { DiffView } from './DiffView'
import { useSettingsStore } from '@/store'
import type { VersionRecord } from './ChapterGenerationModal'

export function VersionHistoryModal({ isOpen, onClose, versions, onRestore }: {
  isOpen: boolean; onClose: () => void; versions: VersionRecord[]; onRestore: (v: VersionRecord) => void
}) {
  const [compareA, setCompareA] = useState<number | null>(null)
  const [compareB, setCompareB] = useState<number | null>(null)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="版本历史" width={compareA !== null && compareB !== null ? 900 : 700}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflowY: 'auto' }} className="custom-scrollbar">
        {versions.length > 0 ? versions.map((v, i) => (
          <div key={i} style={{ padding: '10px 14px', borderRadius: 10, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={compareA === i} onChange={() => setCompareA(compareA === i ? null : i)} disabled={compareB === i} style={{ width: 13, height: 13, accentColor: '#7c3aed', cursor: compareB === i ? 'not-allowed' : 'pointer' }} title="选择对比A" />
                <input type="checkbox" checked={compareB === i} onChange={() => setCompareB(compareB === i ? null : i)} disabled={compareA === i} style={{ width: 13, height: 13, accentColor: '#e67e00', cursor: compareA === i ? 'not-allowed' : 'pointer' }} title="选择对比B" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>版本 {versions.length - i} — {v.modelName}</span>
              </div>
              <span style={{ fontSize: 10, color: '#9b8e84', flexShrink: 0 }}>{new Date(v.generatedAt).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#6b5e54', marginBottom: 6, flexWrap: 'wrap' }}>
              <span>温度: {v.temperature}</span>
              <span>提示词: {v.promptTitle}</span>
              <span>Token: 入{v.tokens.input} 出{v.tokens.output} 总{v.tokens.total}</span>
              <span style={{ color: '#7c3aed' }}>{useSettingsStore.getState().configs.find(c => c.id === v.modelConfigId)?.currency === 'CNY' ? '¥' : '$'}{v.cost.toFixed(4)}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <details style={{ flex: 1, fontSize: 12, color: '#4a3f38' }}>
                <summary style={{ cursor: 'pointer', color: '#7c3aed', fontWeight: 600 }}>查看内容 ({v.generatedContent.length}字)</summary>
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#fff', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }} className="custom-scrollbar">{v.generatedContent}</div>
              </details>
              <button onClick={() => { if (confirm('确定用此版本替换当前正文？')) onRestore(v) }} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>恢复</button>
            </div>
          </div>
        )) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 13 }}>暂无版本记录，使用"AI生成"创建第一个版本。</div>
        )}
      </div>

      {compareA !== null && compareB !== null && versions[compareA] && versions[compareB] && (
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 8 }}>
            版本对比 — 旧(v{versions.length - compareA}) vs 新(v{versions.length - compareB})
          </div>
          <DiffView
            oldText={versions[compareA].generatedContent}
            newText={versions[compareB].generatedContent}
            oldLabel={`${versions[compareA].modelName} ${new Date(versions[compareA].generatedAt).toLocaleString()}`}
            newLabel={`${versions[compareB].modelName} ${new Date(versions[compareB].generatedAt).toLocaleString()}`}
          />
        </div>
      )}
    </Modal>
  )
}
