// ── 细纲参考弹窗（v16.4.1 用户决策）──
// 参考背景卡片化：点击细纲卡片 → 先选择章节（可多选），字段勾选应用于所有已选章节。
// 语义：不选章节 = 不注入细纲（明确选择，不再"默认全部"）。

import { useEffect, useState } from 'react'
import Modal from '@/components/common/Modal'
import Button from '@/components/common/Button'
import { checkInput, miniActionLink } from '@/components/common/ChapterGenerationModal/constants'
import type { DetailedOutlineToggles } from '@/types/settings'
import type { DetailedChapter } from '@/types/chapter'
import { XMarkIcon } from '@heroicons/react/24/outline'

interface Props {
  open: boolean
  chapters: DetailedChapter[]
  selectedChapterIds: string[]
  fields: DetailedOutlineToggles
  onClose: () => void
  onConfirm: (chapterIds: string[], fields: DetailedOutlineToggles) => void
}

// v16.4.1(审查修复): 细纲字段共享单一真源（AICharacterGenerateDialog.DETAILED_FIELDS 导出）
export const CHAPTER_REF_FIELDS: [keyof DetailedOutlineToggles, string][] = [
  ['plotOverview', '剧情概述'], ['chapterCharacters', '出场角色'],
  ['location', '场景地点'], ['keyEvents', '关键事件'],
]
const FIELDS = CHAPTER_REF_FIELDS

export function ChapterRefModal({ open, chapters, selectedChapterIds, fields, onClose, onConfirm }: Props) {
  const [draftChapters, setDraftChapters] = useState<string[]>([])
  const [draftFields, setDraftFields] = useState<DetailedOutlineToggles>(fields)

  useEffect(() => {
    if (open) {
      setDraftChapters(selectedChapterIds)
      setDraftFields(fields)
    }
  }, [open])

  const toggleChapter = (id: string) => {
    setDraftChapters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleField = (key: keyof DetailedOutlineToggles) => {
    setDraftFields(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="选择细纲参考" width={520} draggable>
      <div style={{ fontSize: 12.5, color: '#6b5e54', lineHeight: 1.7, marginBottom: 10 }}>
        先选择要参考的章节（可多选），字段勾选应用于所有已选章节。<b>不选章节 = 不注入细纲</b>。
      </div>

      {/* 已选章节 */}
      {draftChapters.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {draftChapters.map(id => {
            const idx = chapters.findIndex(c => c.id === id)
            const title = chapters.find(c => c.id === id)?.title || id
            return (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 10px', borderRadius: 999, background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.18)', fontSize: 12, color: '#7c3aed', fontWeight: 600 }}>
                第{idx + 1}章 {title}
                <button onClick={() => toggleChapter(id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 13, padding: 0, lineHeight: 1, display: 'flex' }} title="移除">
                  <XMarkIcon style={{ width: 12, height: 12 }} />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* 章节列表 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#4a3f38' }}>章节（{draftChapters.length} 个）</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button onClick={() => setDraftChapters(chapters.map(c => c.id))} style={miniActionLink}>全选</button>
          <button onClick={() => setDraftChapters([])} style={miniActionLink}>清空</button>
        </div>
      </div>
      <div className="custom-scrollbar" style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid rgba(0,0,0,0.05)', borderRadius: 10, padding: 6, marginBottom: 12 }}>
        {chapters.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12.5, color: '#9b8e84' }}>暂无章节，可先在细纲页面创建</div>
        ) : chapters.map((ch, idx) => (
          <label key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', background: draftChapters.includes(ch.id) ? 'rgba(124,58,237,0.06)' : 'transparent' }}>
            <input type="checkbox" checked={draftChapters.includes(ch.id)} onChange={() => toggleChapter(ch.id)} style={checkInput} />
            <span style={{ fontSize: 12.5, fontWeight: draftChapters.includes(ch.id) ? 600 : 400, color: draftChapters.includes(ch.id) ? '#7c3aed' : '#3d342e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              第{idx + 1}章 {ch.title || '未命名'}
            </span>
          </label>
        ))}
      </div>

      {/* 字段勾选 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#4a3f38' }}>注入字段（应用于已选章节）</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button onClick={() => { const next = { ...draftFields }; (Object.keys(next) as (keyof DetailedOutlineToggles)[]).forEach(k => { next[k] = true }); setDraftFields(next) }} style={miniActionLink}>全选</button>
          <button onClick={() => { const next = { ...draftFields }; (Object.keys(next) as (keyof DetailedOutlineToggles)[]).forEach(k => { next[k] = false }); setDraftFields(next) }} style={miniActionLink}>清空</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
        {FIELDS.map(([key, label]) => (
          <label key={key} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 8,
            fontSize: 12.5, cursor: 'pointer',
            background: draftFields[key] ? 'rgba(59,130,246,0.12)' : '#f8f7f5',
            border: draftFields[key] ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(0,0,0,0.08)',
            color: draftFields[key] ? '#2563eb' : '#4a3f38', fontWeight: draftFields[key] ? 700 : 400,
          }}>
            <input type="checkbox" checked={draftFields[key]} onChange={() => toggleField(key)} style={checkInput} />
            {label}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 12, marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" onClick={() => onConfirm(draftChapters, draftFields)}>确定</Button>
      </div>
    </Modal>
  )
}
