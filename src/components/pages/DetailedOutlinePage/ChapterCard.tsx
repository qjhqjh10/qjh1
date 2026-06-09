import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import GlassCard from '@/components/common/GlassCard'
import ConfirmModal from '@/components/common/ConfirmModal'
import { TrashIcon, PencilIcon, UserGroupIcon, MapPinIcon } from '@heroicons/react/24/outline'
import type { DetailedChapter } from '@/types/chapter'

interface ChapterCardProps {
  chapter: DetailedChapter
  index: number
  allChapters: DetailedChapter[]
  previewText: (ch: DetailedChapter) => string
  charPreview: (ch: DetailedChapter) => string
  onOpen: (ch: DetailedChapter) => void
  onDelete: (ch: DetailedChapter) => void
  onReorder: (updated: DetailedChapter[]) => void
}

export function ChapterCard({ chapter, index, allChapters, previewText, charPreview, onOpen, onDelete, onReorder }: ChapterCardProps) {
  const navigate = useNavigate()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const preview = previewText(chapter)
  const chars = charPreview(chapter)

  return (
    <>
    <GlassCard key={chapter.id} hover style={{ cursor: 'pointer', minHeight: 180, maxHeight: 260, minWidth: 0, overflow: 'hidden' }}
      onClick={() => onOpen(chapter)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        draggable
        onDragStart={e => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation() }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={e => {
          e.preventDefault()
          e.stopPropagation()
          const fromIdx = parseInt(e.dataTransfer.getData('text/plain'))
          if (fromIdx === index || isNaN(fromIdx)) return
          const updated = [...allChapters]
          const [moved] = updated.splice(fromIdx, 1)
          updated.splice(index, 0, moved)
          onReorder(updated.map((c, i) => ({ ...c, order: i })))
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: '#d4ccc4', fontSize: 14, cursor: 'grab', flexShrink: 0 }} title="拖拽排序"
            onClick={e => e.stopPropagation()}
          >⠿</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', flexShrink: 0 }}>
            章节{index + 1}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 7px', borderRadius: 5,
            fontSize: 9, fontWeight: 600,
            background: chapter.status === 'completed' ? 'rgba(22,163,74,0.08)' : 'rgba(239,68,68,0.06)',
            color: chapter.status === 'completed' ? '#16a34a' : '#ef4444',
            flexShrink: 0,
          }}>
            {chapter.status === 'completed' ? '已完成' : '未完成'}
          </span>
          <span style={{
            flex: 1, fontSize: 13, fontWeight: 600, color: '#2d2520',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {chapter.title || '(未命名)'}
          </span>
          {/* Action buttons */}
          <button onClick={e => { e.stopPropagation(); navigate(`/chapter/${chapter.id}`) }}
            title="撰写本章" className="interactive" style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)',
              background: 'rgba(124,58,237,0.04)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 10, fontWeight: 600, color: '#7c3aed',
              flexShrink: 0,
            }}>
            <PencilIcon style={{ width: 11, height: 11 }} /> 撰写
          </button>
          <button onClick={e => { e.stopPropagation(); setShowDeleteConfirm(true) }}
            title="删除本章细纲" className="interactive" style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.15)',
              background: 'transparent', cursor: 'pointer',
              flexShrink: 0,
            }}>
            <TrashIcon style={{ width: 13, height: 13, color: '#ef4444' }} />
          </button>
        </div>

        {/* Content preview */}
        {preview ? (
          <div style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.6, flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {preview}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#c4bdb6', flex: 1, fontStyle: 'italic', minHeight: 0 }}>
            点击编辑细纲内容
          </div>
        )}

        {/* Meta footer: characters + location */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
          {chars && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6b5e54', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              <UserGroupIcon style={{ width: 11, height: 11, color: '#9b8e84', flexShrink: 0 }} /> {chars}
            </span>
          )}
          {chapter.location && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6b5e54', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              <MapPinIcon style={{ width: 11, height: 11, color: '#9b8e84', flexShrink: 0 }} /> {chapter.location.slice(0, 30)}{chapter.location.length > 30 ? '…' : ''}
            </span>
          )}
        </div>
      </div>
    </GlassCard>
    {createPortal(
      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="删除细纲"
        message={`确定删除「${chapter.title || '未命名'}」的细纲？此操作不可撤销。`}
        confirmLabel="删除"
        danger
        onConfirm={() => { setShowDeleteConfirm(false); onDelete(chapter) }}
        onCancel={() => setShowDeleteConfirm(false)}
      />,
      document.body
    )}
    </>
  )
}
