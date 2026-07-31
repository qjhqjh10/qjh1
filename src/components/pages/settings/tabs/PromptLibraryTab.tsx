import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import ConfirmModal from '@/components/common/ConfirmModal'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { PromptTemplate, PromptType } from '@/types/settings'
import { PROMPT_TYPES } from '@/types/settings'
import { useDraggableResizable } from '@/components/common/useDraggableResizable'

export function PromptLibraryTab() {
  const prompts = useSettingsStore(s => s.prompts)
  const addPrompt = useSettingsStore(s => s.addPrompt)
  const updatePrompt = useSettingsStore(s => s.updatePrompt)
  const removePrompt = useSettingsStore(s => s.removePrompt)

  // 弹窗编辑状态
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null)
  // 删除确认状态
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  // 弹窗内删除确认（与卡片删除区分，避免弹窗同时关掉）
  const [modalDeleteConfirm, setModalDeleteConfirm] = useState(false)

  const editingPrompt = editingPromptId ? prompts.find(p => p.id === editingPromptId) : null

  const handleNew = () => {
    const newPrompt: PromptTemplate = {
      id: nanoid(8),
      title: '新模板',
      type: '章节',
      content: '',
      enabled: false,
    }
    addPrompt(newPrompt)
    setEditingPromptId(newPrompt.id)
  }

  const handleToggleEnable = (id: string, type: PromptType) => {
    const prompt = prompts.find(p => p.id === id)
    if (!prompt) return
    if (!prompt.enabled) {
      // 关闭同类型其他已启用的模板
      prompts.filter(p => p.type === type && p.id !== id && p.enabled).forEach(p => {
        updatePrompt(p.id, { enabled: false })
      })
    }
    updatePrompt(id, { enabled: !prompt.enabled })
  }

  const handleDeleteConfirmed = () => {
    if (deleteConfirmId) {
      removePrompt(deleteConfirmId)
      if (editingPromptId === deleteConfirmId) setEditingPromptId(null)
      setDeleteConfirmId(null)
    }
  }

  // 弹窗内的删除按钮 → 弹出确认
  const handleModalDeleteClick = () => setModalDeleteConfirm(true)

  const handleModalDeleteConfirmed = () => {
    if (editingPrompt) {
      removePrompt(editingPrompt.id)
      setEditingPromptId(null)
    }
    setModalDeleteConfirm(false)
  }

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>提示词模板</h3>
        <Button size="sm" onClick={handleNew} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>
          新建模板
        </Button>
      </div>

      <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {prompts.map(prompt => (
            <div
              key={prompt.id}
              className="stagger-item"
              onClick={() => setEditingPromptId(prompt.id)}
              style={{
                padding: 18,
                borderRadius: 16,
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(124,58,237,0.2)'
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(124,58,237,0.08)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)'
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* 卡片标题 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 15, fontWeight: 600, color: '#2d2520',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {prompt.title || '未命名模板'}
                </span>
              </div>

              {/* 类型 + 启用状态 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  padding: '2px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                  background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
                  border: '1px solid rgba(124,58,237,0.12)',
                }}>
                  {prompt.type}
                </span>
                <span style={{
                  padding: '2px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                  background: prompt.enabled ? 'rgba(16,185,129,0.08)' : 'rgba(0,0,0,0.03)',
                  color: prompt.enabled ? '#16a34a' : '#9b8e84',
                  border: prompt.enabled ? '1px solid rgba(16,185,129,0.15)' : '1px solid rgba(0,0,0,0.06)',
                }}>
                  {prompt.enabled ? '● 已启用' : '○ 未启用'}
                </span>
              </div>

              {/* 内容预览（截断） */}
              <div style={{
                fontSize: 12, color: '#9b8e84', lineHeight: 1.5,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                maxHeight: 54, wordBreak: 'break-all',
              }}>
                {prompt.content || '暂无内容'}
              </div>

              {/* 删除按钮 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteConfirmId(prompt.id)}
                  icon={<TrashIcon style={{ width: 14, height: 14 }} />}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}

          {prompts.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84', gridColumn: '1 / -1' }}>
              <p style={{ fontSize: 14 }}>暂无提示词模板</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>点击「新建模板」创建第一个提示词模板</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ═══════════════════════════════════════════════════════
          编辑弹窗（占屏幕 80% 宽 × 80% 高）
          ═══════════════════════════════════════════════════════ */}
      {editingPrompt && (
        <PromptEditModal
          prompt={editingPrompt}
          prompts={prompts}
          onUpdate={(patch) => updatePrompt(editingPrompt.id, patch)}
          onToggleEnable={() => handleToggleEnable(editingPrompt.id, editingPrompt.type)}
          onDelete={handleModalDeleteClick}
          onClose={() => setEditingPromptId(null)}
          onDeleteConfirmOpen={modalDeleteConfirm}
          onDeleteConfirmClose={() => setModalDeleteConfirm(false)}
          onDeleteConfirmed={handleModalDeleteConfirmed}
        />
      )}

      {/* ═══════════════════════════════════════════════════════
          卡片删除确认弹窗
          ═══════════════════════════════════════════════════════ */}
      {deleteConfirmId && (
        <ConfirmModal
          isOpen={true}
          title="删除提示词模板"
          message={`确定要删除提示词模板「${prompts.find(p => p.id === deleteConfirmId)?.title || ''}」吗？此操作不可撤销。`}
          confirmLabel="删除"
          danger
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 提示词模板编辑弹窗 (宽 80vw × 高 80vh)
// ═══════════════════════════════════════════════════════════════
function PromptEditModal({
  prompt,
  prompts,
  onUpdate,
  onToggleEnable,
  onDelete,
  onClose,
  onDeleteConfirmOpen,
  onDeleteConfirmClose,
  onDeleteConfirmed,
}: {
  prompt: PromptTemplate
  prompts: PromptTemplate[]
  onUpdate: (patch: Partial<PromptTemplate>) => void
  onToggleEnable: () => void
  onDelete: () => void
  onClose: () => void
  onDeleteConfirmOpen: boolean
  onDeleteConfirmClose: () => void
  onDeleteConfirmed: () => void
}) {
  const initialW = Math.round(window.innerWidth * 4 / 5)
  const initialH = Math.round(window.innerHeight * 4 / 5)
  // v13.x: 统一共享拖拽 hook
  const { size: modalSize, setSize: setModalSize, pos: modalPos, setPos: setModalPos, handleResizeStart, handleDragStart } = useDraggableResizable({
    anchor: 'left-top',
    defaultSize: { width: initialW, height: initialH },
    defaultPos: {
      left: Math.round((window.innerWidth - initialW) / 2),
      top: Math.round((window.innerHeight - initialH) / 2),
    },
    minW: 500, minH: 400, maxW: window.innerWidth,
    dragExclude: 'button, input, textarea, select',
  })

  // 当 prompt 变化时重新居中（新建模板时）
  useEffect(() => {
    const w = Math.round(window.innerWidth * 4 / 5)
    const h = Math.round(window.innerHeight * 4 / 5)
    setModalSize({ width: w, height: h })
    setModalPos({ left: Math.round((window.innerWidth - w) / 2), top: Math.round((window.innerHeight - h) / 2) })
  }, [prompt.id])

  const corners = ['top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'] as const

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(3px)',
    }} onClick={onClose}>
      {/* 拖动 + 可缩放的内容容器 */}
      <div
        onMouseDown={handleDragStart}
        style={{
          position: 'absolute',
          left: modalPos.left, top: modalPos.top,
          width: modalSize.width, height: modalSize.height,
          borderRadius: 20, background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(20px)', boxShadow: '0 24px 80px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }} onClick={e => e.stopPropagation()}>

        {/* 调整大小句柄 */}
        {corners.map(corner => {
          const isEdge = corner === 'top' || corner === 'bottom' || corner === 'left' || corner === 'right'
          return (
            <div key={corner} onMouseDown={handleResizeStart(corner)} style={{
              position: 'absolute',
              top: corner.includes('top') ? 0 : undefined,
              bottom: corner.includes('bottom') ? 0 : undefined,
              left: corner.includes('left') ? 0 : undefined,
              right: corner.includes('right') ? 0 : undefined,
              width: isEdge ? (corner === 'top' || corner === 'bottom' ? '100%' : 8) : 16,
              height: isEdge ? (corner === 'left' || corner === 'right' ? '100%' : 8) : 16,
              cursor: corner === 'top' || corner === 'bottom' ? 'ns-resize'
                : corner === 'left' || corner === 'right' ? 'ew-resize'
                : corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize',
              zIndex: 20,
            }} />
          )
        })}

        {/* 右上角关闭按钮 */}
        <button onClick={(ev) => { ev.stopPropagation(); onClose() }} style={{
          position: 'absolute', top: 12, right: 14, zIndex: 30,
          width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)',
          background: 'rgba(255,255,255,0.9)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#6b5e54', fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
        }} title="关闭">✕</button>

        {/* ── 弹窗内容 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '28px 32px' }}>
          {/* 标题区域 */}
          <div style={{
            padding: '14px 18px', borderRadius: 14, marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(168,85,247,0.03))',
            border: '1px solid rgba(124,58,237,0.12)',
          }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#7c3aed', marginBottom: 4, display: 'block' }}>
              模板名称
            </label>
            <input
              type="text"
              value={prompt.title}
              onChange={e => onUpdate({ title: e.target.value })}
              style={{
                fontSize: 18, fontWeight: 700, color: '#2d2520', border: 'none',
                background: 'transparent', outline: 'none', width: '100%', fontFamily: 'inherit',
              }}
              placeholder="输入模板名称"
            />
          </div>

          {/* 类型 + 启用状态 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54' }}>类型：</label>
              <select
                value={prompt.type}
                onChange={e => onUpdate({ type: e.target.value as PromptType })}
                className="focus-ring"
                style={{
                  padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)',
                  fontSize: 13, color: '#4a3f38', background: '#faf9f8', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {PROMPT_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <button
              onClick={onToggleEnable}
              title={prompt.enabled ? '点击关闭（同类型只能启用一张）' : '点击启用'}
              style={{
                padding: '5px 14px', borderRadius: 8,
                border: prompt.enabled ? '1px solid rgba(124,58,237,0.3)' : '1px solid rgba(0,0,0,0.08)',
                background: prompt.enabled ? 'rgba(124,58,237,0.08)' : 'transparent',
                color: prompt.enabled ? '#7c3aed' : '#9b8e84',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              {prompt.enabled ? '● 已启用' : '○ 未启用'}
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: '#9b8e84' }}>
              同类型已有 {prompts.filter(p => p.type === prompt.type && p.enabled).length} 张启用
            </span>
          </div>

          {/* 内容编辑区 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54', marginBottom: 8, display: 'block' }}>
              提示词内容
            </label>
            <textarea
              value={prompt.content}
              onChange={e => onUpdate({ content: e.target.value })}
              className="custom-scrollbar"
              style={{
                flex: 1,
                width: '100%',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 12,
                outline: 'none',
                resize: 'none',
                fontSize: 14,
                lineHeight: 1.7,
                fontFamily: 'inherit',
                color: '#4a3f38',
                background: '#faf9f8',
                padding: 16,
                minHeight: 0,
              }}
              placeholder="填写提示词内容..."
            />
          </div>

          {/* 底部按钮 */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)',
          }}>
            <button onClick={onDelete} style={{
              padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              border: '1px solid rgba(220,38,38,0.15)', background: '#fff',
              color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <TrashIcon style={{ width: 14, height: 14, marginRight: 4, verticalAlign: 'middle' }} />
              删除模板
            </button>
            <button onClick={onClose} style={{
              padding: '8px 24px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              border: 'none', background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
              color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              保存并关闭
            </button>
          </div>
        </div>
      </div>

      {/* 弹窗内的删除确认 */}
      {onDeleteConfirmOpen && (
        <ConfirmModal
          isOpen={true}
          title="删除提示词模板"
          message={`确定要删除提示词模板「${prompt.title || ''}」吗？此操作不可撤销。`}
          confirmLabel="删除"
          danger
          onConfirm={onDeleteConfirmed}
          onCancel={onDeleteConfirmClose}
        />
      )}
    </div>
  )
}
