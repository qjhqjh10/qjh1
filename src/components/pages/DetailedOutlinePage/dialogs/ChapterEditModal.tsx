import { useState } from 'react'
import Modal from '@/components/common/Modal'
import ConfirmModal from '@/components/common/ConfirmModal'
import { TrashIcon, UserGroupIcon, MapPinIcon } from '@heroicons/react/24/outline'
import type { DetailedChapter, ChapterStatus } from '@/types/chapter'
import { btnSecondary, btnPrimary } from '../constants'

interface ChapterEditModalProps {
  isOpen: boolean
  editDraft: DetailedChapter | null
  isErotic: boolean
  onClose: () => void
  onUpdate: (field: string, value: string) => void
  onSave: () => Promise<void>
  onSaveAndWrite: () => void
  onDelete: (ch: DetailedChapter) => void
}

export function ChapterEditModal({ isOpen, editDraft, isErotic, onClose, onUpdate, onSave, onSaveAndWrite, onDelete }: ChapterEditModalProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editDraft ? `编辑细纲 — ${editDraft.title || '未命名'}` : ''}
      width={800}
      draggable
    >
      {editDraft && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Title + Status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="text"
              value={editDraft.title}
              onChange={e => onUpdate('title', e.target.value)}
              style={{
                flex: 1, border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
                outline: 'none', fontSize: 16, fontWeight: 600, color: '#2d2520',
                background: '#faf9f8', padding: '8px 12px', fontFamily: 'inherit',
              }}
              placeholder="章节标题"
            />
            <select
              value={editDraft.status}
              onChange={e => onUpdate('status', e.target.value as ChapterStatus)}
              style={{
                padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)',
                fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                color: editDraft.status === 'completed' ? '#16a34a' : '#ef4444',
                fontWeight: 600, background: '#faf9f8',
              }}
            >
              <option value="incomplete">未完成</option>
              <option value="completed">已完成</option>
            </select>
          </div>

          {/* 本章剧情概述 */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              本章剧情概述
              <span style={{ fontWeight: 400, fontSize: 10, color: '#9b8e84' }}>
                （建议 150—250 字，当前 {editDraft.plotOverview?.length || 0} 字）
              </span>
            </label>
            <textarea
              value={editDraft.plotOverview || ''}
              onChange={e => onUpdate('plotOverview', e.target.value)}
              className="custom-scrollbar"
              style={{
                width: '100%', border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 10, outline: 'none', resize: 'vertical',
                fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
                color: '#4a3f38', background: '#faf9f8', padding: 14,
                minHeight: 120, maxHeight: 220,
              }}
              placeholder="简要概述本章的剧情走向，包括核心事件、冲突和转折点…"
            />
          </div>

          {/* 出现的角色 */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserGroupIcon style={{ width: 14, height: 14, color: '#6b5e54' }} />
              出现的角色
            </label>
            <textarea
              value={editDraft.characters || ''}
              onChange={e => onUpdate('characters', e.target.value)}
              className="custom-scrollbar"
              style={{
                width: '100%', border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 10, outline: 'none', resize: 'vertical',
                fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit',
                color: '#4a3f38', background: '#faf9f8', padding: '10px 14px',
                minHeight: 80, maxHeight: 160,
              }}
              placeholder={`每行一个角色，格式：角色名 — 性别/年龄/特征描述

示例：
林星辰 — 男，28岁，退役星际舰队指挥官，冷静果断
叶雪 — 女，25岁，星际医官，温柔坚韧`}
            />
          </div>

          {/* 场景地点 */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPinIcon style={{ width: 14, height: 14, color: '#6b5e54' }} />
              场景地点
            </label>
            <input
              type="text"
              value={editDraft.location || ''}
              onChange={e => onUpdate('location', e.target.value)}
              style={{
                width: '100%', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
                outline: 'none', fontSize: 13, color: '#4a3f38',
                background: '#faf9f8', padding: '8px 12px', fontFamily: 'inherit',
              }}
              placeholder="例如：星际港口 · 第7停泊区 · 黄昏"
            />
          </div>

          {/* 关键事件 */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              关键事件
              <span style={{ fontWeight: 400, fontSize: 10, color: '#9b8e84' }}>
                （每行一个事件，按发生顺序排列）
              </span>
            </label>
            <textarea
              value={editDraft.keyEvents || ''}
              onChange={e => onUpdate('keyEvents', e.target.value)}
              className="custom-scrollbar"
              style={{
                width: '100%', border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 10, outline: 'none', resize: 'vertical',
                fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit',
                color: '#4a3f38', background: '#faf9f8', padding: '10px 14px',
                minHeight: 80, maxHeight: 180,
              }}
              placeholder={`每行一个关键事件，例如：
主角抵达星际港口，发现货物被调包
在酒吧与线人接头，获得走私路线图
遭遇星际巡警突击检查，被迫逃亡`}
            />
          </div>

          {/* 自定义内容 */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              自定义内容
              <span style={{ fontWeight: 400, fontSize: 10, color: '#9b8e84' }}>
                （AI可自由添加伏笔、节奏、情绪、世界观关联等额外信息）
              </span>
            </label>
            <textarea
              value={editDraft.customContent || ''}
              onChange={e => onUpdate('customContent', e.target.value)}
              className="custom-scrollbar"
              style={{
                width: '100%', border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 10, outline: 'none', resize: 'vertical',
                fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit',
                color: '#4a3f38', background: '#faf9f8', padding: '10px 14px',
                minHeight: 60, maxHeight: 160,
              }}
              placeholder="自定义额外内容，如伏笔线索、节奏控制、情绪基调、世界观关联等…"
            />
          </div>

          {/* 情色剧情 — only for erotic novels */}
          {isErotic && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 6, display: 'block' }}>
                情色剧情
              </label>
              <textarea
                value={editDraft.eroticContent || ''}
                onChange={e => onUpdate('eroticContent', e.target.value)}
                className="custom-scrollbar"
                style={{
                  width: '100%', border: '1px solid rgba(220,38,38,0.15)',
                  borderRadius: 10, outline: 'none', resize: 'vertical',
                  fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit',
                  color: '#4a3f38', background: '#fef2f2', padding: 14,
                  minHeight: 100, maxHeight: 220,
                }}
                placeholder="仅情色小说类型时填写，描述本章的情色剧情内容…"
              />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '8px 16px', borderRadius: 8,
                border: '1px solid rgba(239,68,68,0.2)',
                background: 'rgba(239,68,68,0.03)', color: '#dc2626',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <TrashIcon style={{ width: 14, height: 14 }} /> 删除本章
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={btnSecondary}>取消</button>
              <button onClick={onSave} style={btnPrimary}>保存</button>
              <button
                onClick={onSaveAndWrite}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: 'none',
                  background: '#16a34a', color: '#fff',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                保存并撰写
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
    <ConfirmModal
      isOpen={showDeleteConfirm}
      title="删除细纲"
      message={`确定删除「${editDraft?.title || '未命名'}」的细纲？此操作不可撤销。`}
      confirmLabel="删除"
      danger
      onConfirm={() => { setShowDeleteConfirm(false); onDelete(editDraft!) }}
      onCancel={() => setShowDeleteConfirm(false)}
    />
    </>
  )
}
