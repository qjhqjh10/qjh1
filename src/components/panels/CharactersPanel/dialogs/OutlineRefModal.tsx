// ── 大纲参考弹窗（v16.4.1 用户决策）──
// 参考背景卡片化：点击大纲卡片 → 弹窗内列出实体部分 → 点击某部分再开子弹窗勾选实体。
// v16.4.1(审查修复): 部分列表从 sections.json 动态渲染（支持自定义部分）；hidden 部分显示屏蔽态。
// 语义：未勾选实体 = 全部注入；勾空 = 不注入。

import { useState } from 'react'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { checkInput } from '@/components/common/ChapterGenerationModal/constants'
import { EntityPickerModal } from './EntityPickerModal'
import { SECTION_EMOJI, SECTION_NAMES } from '@/data/builtinSections'
import type { OutlineEntity, OutlineSectionDef } from '@/types/outline'

interface Props {
  open: boolean
  /** 部分定义（父级从 loadSections 加载——含用户自定义部分与 hidden 状态） */
  sections: OutlineSectionDef[]
  /** 部分 key → 实体列表（父级预载） */
  partEntities: Record<string, OutlineEntity[]>
  /** 部分 key → 勾选实体 id（缺省 = 全部注入；空数组 = 不注入） */
  selectedEntities: Record<string, string[]>
  /** 选中态：部分是否被勾选注入（大纲区块 checkbox） */
  enabledParts: Record<string, boolean>
  onClose: () => void
  onPickEntities: (sectionKey: string, ids: string[]) => void
  /** 切换部分启用状态（对应大纲维度勾选） */
  onToggleEnabled: (sectionKey: string, enabled: boolean) => void
}

export function OutlineRefModal({ open, sections, partEntities, selectedEntities, enabledParts, onClose, onPickEntities, onToggleEnabled }: Props) {
  const [picking, setPicking] = useState<string | null>(null)

  // 实体部分（doc/characters 无实体勾选）；按 sections 顺序
  const partList = sections.filter(s => s.type === 'entities' && s.key !== 'characters')
  const pickingMeta = partList.find(p => p.key === picking)

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title="选择大纲参考" width={520} draggable>
        <div style={{ fontSize: 12.5, color: '#6b5e54', lineHeight: 1.7, marginBottom: 12 }}>
          勾选启用要注入的部分；点击部分行选择具体内容。<b>未选择过 = 全部注入；勾空 = 该部分不注入</b>。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {partList.map(part => {
            const total = (partEntities[part.key] || []).length
            const sel = selectedEntities[part.key]
            const enabled = enabledParts[part.key] !== false
            const hidden = part.hidden
            const stateText = hidden
              ? '已屏蔽（不注入）'
              : !enabled
                ? '未启用'
                : sel === undefined
                  ? (total > 0 ? `全部（${total}个）` : '无内容')
                  : sel.length > 0
                    ? `已选 ${sel.length} 个`
                    : '不注入'
            const stateColor = hidden ? '#b0a89e' : !enabled ? '#b0a89e' : sel === undefined ? '#3d342e' : sel.length > 0 ? '#7c3aed' : '#f59e0b'
            return (
              <div key={part.key} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)', background: hidden ? '#f5f3f0' : (enabled ? '#fff' : '#f7f5f2'),
                opacity: hidden ? 0.55 : 1,
              }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                  <input type="checkbox" checked={enabled && !hidden} disabled={hidden} onChange={e => onToggleEnabled(part.key, e.target.checked)} style={checkInput} title={hidden ? '该部分已在大纲页屏蔽' : (enabled ? '停用该部分' : '启用该部分')} />
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{SECTION_EMOJI[part.key] || '📄'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#1f1a16', textDecoration: (hidden || !enabled) ? 'line-through' : 'none' }}>{SECTION_NAMES[part.key] || part.name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: stateColor, marginTop: 1, fontWeight: sel !== undefined ? 600 : 400 }}>{stateText}</span>
                  </span>
                </label>
                {enabled && !hidden && (
                  <button onClick={() => setPicking(part.key)} title="选择要注入的具体内容"
                    style={{
                      background: 'rgba(124,58,237,0.05)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 6,
                      padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                      color: sel !== undefined ? '#7c3aed' : '#6b5e54', fontWeight: sel !== undefined ? 700 : 400,
                    }}>
                    {sel !== undefined ? (sel.length > 0 ? `已选 ${sel.length} 个` : '不注入') : '选择内容'}
                  </button>
                )}
              </div>
            )
          })}
          {partList.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: '#9b8e84' }}>暂无实体部分</div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <Button variant="secondary" size="sm" onClick={onClose}>完成</Button>
        </div>
      </Modal>

      {/* 实体勾选子弹窗（层级导航第二层） */}
      {picking && pickingMeta && (
        <EntityPickerModal
          open={true}
          partName={SECTION_NAMES[pickingMeta.key] || pickingMeta.name}
          emoji={SECTION_EMOJI[pickingMeta.key] || '📄'}
          entities={partEntities[pickingMeta.key] || []}
          selectedIds={selectedEntities[pickingMeta.key] || []}
          onClose={() => setPicking(null)}
          onConfirm={(ids) => {
            onPickEntities(pickingMeta.key, ids)
            setPicking(null)
          }}
        />
      )}
    </>
  )
}
