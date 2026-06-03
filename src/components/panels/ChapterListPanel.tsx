// ── ChapterListPanel ──
// Shared component for displaying, editing, reordering, and deleting
// detailed outline chapters. Used by both Continuation and Imitation pages.
// Eliminates ~150 lines of duplicated code.

import { useState } from 'react'
import { fileService } from '@/services/fileService'
import { saveDetailedChapter } from '@/services/chapterService'
import ScrollArea from '@/components/common/ScrollArea'
import Button from '@/components/common/Button'
import { PencilIcon, TrashIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline'
import { inputStyle } from '@/components/common/styles'
import type { DetailedChapter } from '@/types/chapter'

interface Props {
  chapters: DetailedChapter[]
  setChapters: React.Dispatch<React.SetStateAction<DetailedChapter[]>>
  projectPath: string
  onWriteChapter: (ch: DetailedChapter) => void
  emptyTitle?: string
  emptyDescription?: string
}

export function ChapterListPanel({
  chapters,
  setChapters,
  projectPath,
  onWriteChapter,
  emptyTitle = '暂无细纲章节',
  emptyDescription = '请先生成细纲',
}: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editChapter, setEditChapter] = useState<DetailedChapter | null>(null)

  const handleEdit = (idx: number) => {
    setEditingIdx(idx)
    setEditChapter({ ...chapters[idx] })
  }

  const handleSaveEdit = async () => {
    if (editingIdx === null || !editChapter) return
    const updated = [...chapters]
    updated[editingIdx] = editChapter
    await saveDetailedChapter(projectPath, editChapter)
    setChapters(updated)
    setEditingIdx(null)
    setEditChapter(null)
  }

  const handleDelete = async (ch: DetailedChapter) => {
    await fileService.deleteFile(`${projectPath}/detailed_outline/${ch.id}.yaml`)
    await fileService.deleteFile(`${projectPath}/chapters/${ch.id}.txt`).catch(() => {})
    await fileService.deleteFile(`${projectPath}/summaries/${ch.id}.md`).catch(() => {})
    setChapters(prev => prev.filter(c => c.id !== ch.id))
  }

  const handleMove = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= chapters.length) return
    const updated = [...chapters]
    ;[updated[idx], updated[target]] = [updated[target], updated[idx]]
    updated.forEach((c, i) => { c.order = i })
    setChapters(updated)
    for (const c of [updated[idx], updated[target]]) {
      await saveDetailedChapter(projectPath, c)
    }
  }

  if (chapters.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{emptyTitle}</div>
        <div style={{ fontSize: 12 }}>{emptyDescription}</div>
      </div>
    )
  }

  return (
    <>
      {chapters.map((ch, i) => (
        <div
          key={ch.id}
          style={{
            padding: '14px 16px',
            borderRadius: 12,
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.06)',
            marginBottom: 8,
            borderLeft: ch.status === 'completed' ? '3px solid #16a34a' : '3px solid #ef4444',
          }}
        >
          {editingIdx === i && editChapter ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                value={editChapter.title}
                onChange={e => setEditChapter({ ...editChapter, title: e.target.value })}
                style={{ ...inputStyle as any, fontSize: 12, fontWeight: 600 }}
              />
              <textarea
                value={editChapter.description}
                onChange={e => setEditChapter({ ...editChapter, description: e.target.value })}
                rows={4}
                style={{ ...inputStyle as any, width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit' }}
              />
              <textarea
                value={editChapter.summary}
                onChange={e => setEditChapter({ ...editChapter, summary: e.target.value })}
                rows={2}
                style={{ ...inputStyle as any, width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit' }}
                placeholder="摘要"
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Button size="sm" variant="secondary" onClick={() => { setEditingIdx(null); setEditChapter(null) }}>取消</Button>
                <Button size="sm" onClick={handleSaveEdit}>保存</Button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ch.status === 'completed' ? '#16a34a' : '#ef4444' }}>
                    {ch.status === 'completed' ? '✓ 已完成' : '○ 待续写'}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#2d2520' }}>第{i + 1}章: {ch.title}</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => handleMove(i, -1)} disabled={i === 0} style={iconBtn} title="上移"><ArrowUpIcon style={iconS} /></button>
                  <button onClick={() => handleMove(i, 1)} disabled={i === chapters.length - 1} style={iconBtn} title="下移"><ArrowDownIcon style={iconS} /></button>
                  <button onClick={() => handleEdit(i)} style={iconBtn} title="编辑"><PencilIcon style={iconS} /></button>
                  <button onClick={() => handleDelete(ch)} style={{ ...iconBtn, color: '#ef4444' }} title="删除"><TrashIcon style={iconS} /></button>
                  <Button size="sm" onClick={() => onWriteChapter(ch)}>撰写本章</Button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#4a3f38', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{ch.description}</div>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

const iconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 2 }
const iconS = { width: 14, height: 14 }
