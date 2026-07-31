import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store'
import { settingsService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import ImageLightbox from '@/components/common/ImageLightbox'
import ConfirmModal from '@/components/common/ConfirmModal'
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { AIAssistantSettings, RoleTemplate, CharacterCard } from '@/types/settings'
import { DEFAULT_AI_SETTINGS, CHARACTER_IDENTITIES, createDefaultRoleTemplate, createDefaultCharacter } from '@/types/settings'
import { inputStyle, textareaStyle, captionText } from '@/components/common/styles'
import { FormField } from '../shared'
import { compressAndSaveImage, loadAvatar } from '@/utils/imageCompress'
import { useDraggableResizable } from '@/components/common/useDraggableResizable'

// ── Shared mini styles ──
const miniField: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 2,
}
const miniLabel: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#6b5e54',
}
const miniInput: React.CSSProperties = {
  padding: '5px 8px', fontSize: 13, borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.1)', outline: 'none',
  background: '#fff', color: '#2d2520', fontFamily: 'inherit',
}
const cardStyle: React.CSSProperties = {
  padding: 16, borderRadius: 14, cursor: 'pointer',
  border: '1px solid rgba(0,0,0,0.06)',
  background: 'rgba(255,255,255,0.7)',
  transition: 'all 0.2s ease',
}

// ═══════════════════════════════════════════════════════════════
// 角色卡片编辑器（弹窗内使用）
// ═══════════════════════════════════════════════════════════════
function CharacterCardEditor({
  character, onChange, onDelete, canDelete, onAvatarClick,
}: {
  character: CharacterCard
  onChange: (c: CharacterCard) => void
  onDelete: () => void
  canDelete: boolean
  onAvatarClick: (avatarSrc: string) => void
}) {
  const [avatarSrc, setAvatarSrc] = useState('')
  useEffect(() => {
    loadAvatar(character.avatar || '').then(setAvatarSrc)
  }, [character.avatar])

  const set = (patch: Partial<CharacterCard>) => onChange({ ...character, ...patch })

  const handleAvatarUpload = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'image/*'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return
      try {
        const filePath = await compressAndSaveImage(f, `char_${character.id}`)
        set({ avatar: filePath })
      } catch (e: any) { alert(e.message) }
    }
    inp.click()
  }

  // 身份选项
  const CUSTOM_IDENTITY = "✏️ 自定义"
  const isCustomIdentity = !CHARACTER_IDENTITIES.includes(character.identity as any) || character.identity === "自定义"
  const selectValue = isCustomIdentity ? CUSTOM_IDENTITY : character.identity

  return (
    <div style={{
      width: "100%", minWidth: 240,
      borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)',
      background: character.isUser
        ? 'linear-gradient(135deg, rgba(124,58,237,0.03), rgba(168,85,247,0.02))'
        : 'linear-gradient(135deg, rgba(22,163,74,0.03), rgba(34,197,94,0.02))',
      overflow: 'hidden',
    }}>
      {/* 头部：类型标记 + 头像 + 删除 */}
      <div style={{
        padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid rgba(0,0,0,0.04)',
        background: character.isUser ? 'rgba(124,58,237,0.06)' : 'rgba(22,163,74,0.06)',
      }}>
        <span style={{
          padding: '1px 7px', borderRadius: 6, fontSize: 11, fontWeight: 700,
          background: character.isUser ? 'rgba(124,58,237,0.12)' : 'rgba(22,163,74,0.12)',
          color: character.isUser ? '#7c3aed' : '#16a34a',
        }}>{character.isUser ? '用户' : 'AI'}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#4a3f38', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {character.name || '未命名'}
        </span>
        <button onClick={handleAvatarUpload} title="点击上传头像" style={{
          width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
          overflow: 'hidden', border: '1px dashed rgba(0,0,0,0.12)',
          background: 'rgba(0,0,0,0.02)', padding: 0, flexShrink: 0,
        }}>
          {avatarSrc
            ? <img src={avatarSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onClick={(e) => { e.stopPropagation(); onAvatarClick(avatarSrc) }} />
            : <span style={{ fontSize: 14 }}>{character.isUser ? '✍️' : '🤖'}</span>}
        </button>
        {canDelete && (
          <button onClick={onDelete} title="删除角色" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: '#d4ccc4', display: 'flex',
          }}><XMarkIcon style={{ width: 14, height: 14 }} /></button>
        )}
      </div>

      {/* 卡片体 */}
      <div style={{ padding: '10px' }}>
        {/* 上部分：一行多列 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {/* 身份 */}
          <div style={miniField}>
            <label style={miniLabel}>身份</label>
            <select value={selectValue} onChange={e => {
              const v = e.target.value
              if (v === CUSTOM_IDENTITY) { set({ identity: "" }) }
              else { set({ identity: v }) }
            }}
              style={{ ...miniInput, cursor: "pointer", width: 72, padding: "4px 4px", fontSize: 13 }}>
              {CHARACTER_IDENTITIES.map(idt => <option key={idt} value={idt}>{idt}</option>)}
              <option value={CUSTOM_IDENTITY}>{CUSTOM_IDENTITY}</option>
            </select>
            {isCustomIdentity && (
              <input value={character.identity} onChange={e => set({ identity: e.target.value })}
                style={{ ...miniInput, width: 72, marginTop: 4 }} placeholder="输入身份" />
            )}
          </div>
          {/* 姓名 */}
          <div style={miniField}>
            <label style={miniLabel}>姓名</label>
            <input value={character.name} onChange={e => set({ name: e.target.value })}
              style={{ ...miniInput, width: 68 }} placeholder="姓名" />
          </div>
          {/* 性别 */}
          <div style={miniField}>
            <label style={miniLabel}>性别</label>
            <select value={character.gender} onChange={e => set({ gender: e.target.value as '男' | '女' })}
              style={{ ...miniInput, cursor: 'pointer', width: 48, padding: '4px 2px', fontSize: 13 }}>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          {/* 关系 */}
          <div style={miniField}>
            <label style={miniLabel}>关系</label>
            <input value={character.relationship} onChange={e => set({ relationship: e.target.value })}
              style={{ ...miniInput, width: 68 }} placeholder="关系" />
          </div>
        </div>

        {/* 是否为用户角色 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6b5e54', marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={character.isUser} onChange={e => set({ isUser: e.target.checked })}
            style={{ width: 13, height: 13, accentColor: '#7c3aed' }} />
          由我扮演此角色
        </label>

        {/* 下部分：背景设定 */}
        <div style={miniField}>
          <label style={miniLabel}>背景设定</label>
          <textarea value={character.personality} onChange={e => set({ personality: e.target.value })}
            style={{ ...miniInput, minHeight: 80, resize: 'vertical', fontSize: 13, lineHeight: 1.5 }}
            placeholder="性格特征、外貌、背景故事、特殊能力等..." />
        </div>

        {/* 开场白 */}
        {!character.isUser && (
          <div style={{ ...miniField, marginTop: 6 }}>
            <label style={miniLabel}>开场白（可选）</label>
            <textarea value={character.firstMessage || ''} onChange={e => set({ firstMessage: e.target.value })}
              style={{ ...miniInput, minHeight: 40, resize: 'vertical', fontSize: 13, lineHeight: 1.5 }}
              placeholder="对话开始时此角色的第一句话..." />
          </div>
        )}

        {/* 示例对话 */}
        {!character.isUser && (
          <div style={{ ...miniField, marginTop: 6 }}>
            <label style={miniLabel}>示例对话（可选，帮助AI把握语气）</label>
            <textarea value={character.exampleDialogue || ''} onChange={e => set({ exampleDialogue: e.target.value })}
              style={{ ...miniInput, minHeight: 50, resize: 'vertical', fontSize: 13, lineHeight: 1.5 }}
              placeholder="示例对话帮助AI学习角色语气..." />
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 角色预览卡片（网格中使用，点击打开编辑弹窗）
// ═══════════════════════════════════════════════════════════════
function CharacterPreviewCard({
  character, onClick, onDelete, canDelete,
}: {
  character: CharacterCard
  onClick: () => void
  onDelete: () => void
  canDelete: boolean
}) {
  const [avatarSrc, setAvatarSrc] = useState('')
  useEffect(() => {
    loadAvatar(character.avatar || '').then(setAvatarSrc)
  }, [character.avatar])

  return (
    <div onClick={onClick} style={{
      padding: 14, borderRadius: 14, cursor: 'pointer',
      border: '1px solid rgba(0,0,0,0.08)',
      background: character.isUser
        ? 'linear-gradient(135deg, rgba(124,58,237,0.04), rgba(168,85,247,0.02))'
        : 'linear-gradient(135deg, rgba(22,163,74,0.04), rgba(34,197,94,0.02))',
      transition: 'all 0.2s ease',
      position: 'relative',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = character.isUser ? 'rgba(124,58,237,0.3)' : 'rgba(22,163,74,0.3)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.06)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* 头部：头像 + 姓名 + 标签 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', overflow: 'hidden',
          border: '2px solid rgba(0,0,0,0.06)', background: 'rgba(0,0,0,0.02)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {avatarSrc
            ? <img src={avatarSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 18 }}>{character.isUser ? '✍️' : '🤖'}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {character.name || '未命名'}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            <span style={{
              padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600,
              background: character.isUser ? 'rgba(124,58,237,0.1)' : 'rgba(22,163,74,0.1)',
              color: character.isUser ? '#7c3aed' : '#16a34a',
            }}>{character.isUser ? '用户' : 'AI'}</span>
            {character.identity && (
              <span style={{ fontSize: 10, color: '#9b8e84' }}>{character.identity}</span>
            )}
            <span style={{ fontSize: 10, color: '#9b8e84' }}>{character.gender}</span>
          </div>
        </div>
        {canDelete && (
          <button onClick={(e) => { e.stopPropagation(); onDelete() }} title="删除角色" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: '#d4ccc4', display: 'flex', flexShrink: 0,
          }}><XMarkIcon style={{ width: 14, height: 14 }} /></button>
        )}
      </div>

      {/* 背景设定摘要 */}
      <div style={{
        fontSize: 11, color: '#9b8e84', lineHeight: 1.5,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        maxHeight: 34,
      }}>
        {character.personality || '点击编辑背景设定...'}
      </div>

      {/* 关系 */}
      {character.relationship && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#9b8e84' }}>
          关系: {character.relationship}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 角色详情编辑弹窗（大尺寸，方便填写大量信息）
// ═══════════════════════════════════════════════════════════════
function CharacterDetailModal({
  character, open, onClose, onChange, onDelete, canDelete,
}: {
  character: CharacterCard | null
  open: boolean
  onClose: () => void
  onChange: (c: CharacterCard) => void
  onDelete: () => void
  canDelete: boolean
}) {
  const initialW = Math.round(window.innerWidth * 0.85)
  const initialH = Math.round(window.innerHeight * 0.88)
  // v13.x: 统一共享拖拽 hook（原手写 dragRef/resizeRef 实现删除）
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
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [avatarSrc, setAvatarSrc] = useState('')

  // ── 头像加载 ──
  useEffect(() => {
    if (character) loadAvatar(character.avatar || '').then(setAvatarSrc)
  }, [character?.avatar])

  // ── 便捷更新 ──
  const set = (patch: Partial<CharacterCard>) => {
    if (character) onChange({ ...character, ...patch })
  }

  const handleAvatarUpload = () => {
    if (!character) return
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'image/*'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return
      try {
        const filePath = await compressAndSaveImage(f, `char_${character.id}`)
        set({ avatar: filePath })
      } catch (e: any) { alert(e.message) }
    }
    inp.click()
  }

  // ── 身份选择逻辑 ──
  const CUSTOM_IDENTITY = "✏️ 自定义"
  const isCustomIdentity = character ? !CHARACTER_IDENTITIES.includes(character.identity as any) || character.identity === "自定义" : false
  const selectIdentityValue = character && !isCustomIdentity ? character.identity : CUSTOM_IDENTITY

  useEffect(() => {
    if (open) {
      const w = Math.round(window.innerWidth * 0.85)
      const h = Math.round(window.innerHeight * 0.88)
      setModalSize({ width: w, height: h })
      setModalPos({ left: Math.round((window.innerWidth - w) / 2), top: Math.round((window.innerHeight - h) / 2) })
    }
  }, [open])

  if (!open || !character) return null

  const corners = ['top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'] as const

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div onMouseDown={handleDragStart} style={{
        position: 'absolute',
        left: modalPos.left, top: modalPos.top,
        width: modalSize.width, height: modalSize.height,
        borderRadius: 20, background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px)', boxShadow: '0 28px 100px rgba(0,0,0,0.25)',
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

        {/* 关闭按钮 */}
        <button onClick={(ev) => { ev.stopPropagation(); onClose() }} style={{
          position: 'absolute', top: 12, right: 14, zIndex: 30,
          width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)',
          background: 'rgba(255,255,255,0.9)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#6b5e54', fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
        }} title="关闭 (Esc)">✕</button>

        {/* 标题栏 */}
        <div style={{
          padding: '16px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: character.isUser
            ? 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(168,85,247,0.02))'
            : 'linear-gradient(135deg, rgba(22,163,74,0.06), rgba(34,197,94,0.02))',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 24 }}>{character.isUser ? '✍️' : '🤖'}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#2d2520' }}>
              编辑{character.isUser ? '用户' : 'AI'}角色 · {character.name || '未命名'}
            </div>
            <div style={{ fontSize: 12, color: '#9b8e84' }}>在此详细编辑角色卡片的全部信息</div>
          </div>
        </div>

        {/* 内容区 — 上部紧凑字段 + 下部扩展文本框 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {/* ── 上部：紧凑字段区（头像 + 身份/姓名/性别/关系）── */}
          <div style={{
            flexShrink: 0, padding: '20px 24px 14px',
            borderBottom: '1px solid rgba(0,0,0,0.04)',
            display: 'flex', gap: 16, alignItems: 'flex-start',
          }}>
            {/* 头像 */}
            <button onClick={handleAvatarUpload} title="点击上传头像" style={{
              width: 64, height: 64, borderRadius: 16, cursor: 'pointer',
              overflow: 'hidden', border: '2px dashed rgba(0,0,0,0.12)',
              background: 'rgba(0,0,0,0.02)', padding: 0, flexShrink: 0,
            }}>
              {avatarSrc
                ? <img src={avatarSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onClick={(e) => { e.stopPropagation(); setLightboxSrc(avatarSrc) }} />
                : <span style={{ fontSize: 28 }}>{character.isUser ? '✍️' : '🤖'}</span>}
            </button>

            {/* 字段网格 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                {/* 身份 */}
                <div style={{ ...miniField, flex: '0 0 auto' }}>
                  <label style={miniLabel}>身份</label>
                  <select value={selectIdentityValue} onChange={e => {
                    const v = e.target.value
                    if (v === CUSTOM_IDENTITY) { set({ identity: "" }) }
                    else { set({ identity: v }) }
                  }} style={{ ...miniInput, cursor: "pointer", width: 80, padding: "5px 4px", fontSize: 13 }}>
                    {CHARACTER_IDENTITIES.map(idt => <option key={idt} value={idt}>{idt}</option>)}
                    <option value={CUSTOM_IDENTITY}>{CUSTOM_IDENTITY}</option>
                  </select>
                  {isCustomIdentity && (
                    <input value={character.identity} onChange={e => set({ identity: e.target.value })}
                      style={{ ...miniInput, width: 80, marginTop: 4 }} placeholder="输入身份" />
                  )}
                </div>
                {/* 姓名 */}
                <div style={{ ...miniField, flex: '0 0 auto' }}>
                  <label style={miniLabel}>姓名</label>
                  <input value={character.name} onChange={e => set({ name: e.target.value })}
                    style={{ ...miniInput, width: 80 }} placeholder="姓名" />
                </div>
                {/* 性别 */}
                <div style={{ ...miniField, flex: '0 0 auto' }}>
                  <label style={miniLabel}>性别</label>
                  <select value={character.gender} onChange={e => set({ gender: e.target.value as '男' | '女' })}
                    style={{ ...miniInput, cursor: 'pointer', width: 56, padding: '5px 2px', fontSize: 13 }}>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </select>
                </div>
                {/* 关系 */}
                <div style={{ ...miniField, flex: '0 0 auto' }}>
                  <label style={miniLabel}>关系</label>
                  <input value={character.relationship} onChange={e => set({ relationship: e.target.value })}
                    style={{ ...miniInput, width: 88 }} placeholder="关系" />
                </div>
                {/* 角色类型标签 + 删除 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', paddingBottom: 2 }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: character.isUser ? 'rgba(124,58,237,0.1)' : 'rgba(22,163,74,0.1)',
                    color: character.isUser ? '#7c3aed' : '#16a34a',
                  }}>{character.isUser ? '用户角色' : 'AI 角色'}</span>
                  {canDelete && (
                    <button onClick={onDelete} title="删除角色" style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                      color: '#d4ccc4', display: 'flex',
                    }}><TrashIcon style={{ width: 16, height: 16 }} /></button>
                  )}
                </div>
              </div>
              {/* 由我扮演此角色 */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b5e54', cursor: 'pointer' }}>
                <input type="checkbox" checked={character.isUser} onChange={e => set({ isUser: e.target.checked })}
                  style={{ width: 14, height: 14, accentColor: '#7c3aed' }} />
                由我扮演此角色
              </label>
            </div>
          </div>

          {/* ── 下部：扩展文本框（撑满剩余空间）── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 24px 20px', gap: 12, minHeight: 0, overflow: 'hidden' }}>
            {/* 背景设定 — 主力区域 */}
            <div style={{ flex: character.isUser ? 1 : 3, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <label style={{ ...miniLabel, marginBottom: 4, flexShrink: 0 }}>背景设定</label>
              <textarea value={character.personality} onChange={e => set({ personality: e.target.value })}
                style={{
                  flex: 1, width: '100%', minHeight: 0,
                  padding: 12, borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.1)', outline: 'none',
                  background: '#fff', color: '#2d2520',
                  fontSize: 14, lineHeight: 1.7, resize: 'none',
                  fontFamily: 'inherit',
                }}
                placeholder="性格特征、外貌、背景故事、特殊能力等..." />
            </div>

            {/* 开场白 — AI角色专属 */}
            {!character.isUser && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <label style={{ ...miniLabel, marginBottom: 4, flexShrink: 0 }}>开场白（可选）</label>
                <textarea value={character.firstMessage || ''} onChange={e => set({ firstMessage: e.target.value })}
                  style={{
                    flex: 1, width: '100%', minHeight: 0,
                    padding: 12, borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.1)', outline: 'none',
                    background: '#fff', color: '#2d2520',
                    fontSize: 14, lineHeight: 1.7, resize: 'none',
                    fontFamily: 'inherit',
                  }}
                  placeholder="对话开始时此角色的第一句话..." />
              </div>
            )}

            {/* 示例对话 — AI角色专属 */}
            {!character.isUser && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <label style={{ ...miniLabel, marginBottom: 4, flexShrink: 0 }}>示例对话（可选，帮助AI把握语气）</label>
                <textarea value={character.exampleDialogue || ''} onChange={e => set({ exampleDialogue: e.target.value })}
                  style={{
                    flex: 1, width: '100%', minHeight: 0,
                    padding: 12, borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.1)', outline: 'none',
                    background: '#fff', color: '#2d2520',
                    fontSize: 14, lineHeight: 1.7, resize: 'none',
                    fontFamily: 'inherit',
                  }}
                  placeholder="示例对话帮助AI学习角色语气..." />
              </div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '12px 24px 16px',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(255,255,255,0.9)', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            padding: '10px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600,
            border: 'none', background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
            color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
          }}>完成编辑</button>
        </div>
      </div>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 文本设定编辑弹窗（世界观背景 / 场景与对话设定 通用，大尺寸）
// ═══════════════════════════════════════════════════════════════
function TextSettingModal({
  title, emoji, value, open, onClose, onChange, placeholder,
}: {
  title: string
  emoji: string
  value: string
  open: boolean
  onClose: () => void
  onChange: (v: string) => void
  placeholder: string
}) {
  const initialW = Math.round(window.innerWidth * 0.82)
  const initialH = Math.round(window.innerHeight * 0.82)
  // v13.x: 统一共享拖拽 hook
  const { size: modalSize, setSize: setModalSize, pos: modalPos, setPos: setModalPos, handleResizeStart, handleDragStart } = useDraggableResizable({
    anchor: 'left-top',
    defaultSize: { width: initialW, height: initialH },
    defaultPos: {
      left: Math.round((window.innerWidth - initialW) / 2),
      top: Math.round((window.innerHeight - initialH) / 2),
    },
    minW: 500, minH: 400, maxW: window.innerWidth,
    dragExclude: 'button, textarea',
  })

  useEffect(() => {
    if (open) {
      const w = Math.round(window.innerWidth * 0.82)
      const h = Math.round(window.innerHeight * 0.82)
      setModalSize({ width: w, height: h })
      setModalPos({ left: Math.round((window.innerWidth - w) / 2), top: Math.round((window.innerHeight - h) / 2) })
    }
  }, [open])

  if (!open) return null

  const corners = ['top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'] as const

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div onMouseDown={handleDragStart} style={{
        position: 'absolute',
        left: modalPos.left, top: modalPos.top,
        width: modalSize.width, height: modalSize.height,
        borderRadius: 20, background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px)', boxShadow: '0 28px 100px rgba(0,0,0,0.25)',
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

        {/* 关闭按钮 */}
        <button onClick={(ev) => { ev.stopPropagation(); onClose() }} style={{
          position: 'absolute', top: 12, right: 14, zIndex: 30,
          width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)',
          background: 'rgba(255,255,255,0.9)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#6b5e54', fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
        }} title="关闭 (Esc)">✕</button>

        {/* 标题栏 */}
        <div style={{
          padding: '16px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: 'linear-gradient(135deg, rgba(124,58,237,0.04), rgba(168,85,247,0.02))',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 24 }}>{emoji}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#2d2520' }}>{title}</div>
            <div style={{ fontSize: 12, color: '#9b8e84' }}>在此详细编辑设定内容</div>
          </div>
        </div>

        {/* 内容区 — 大文本框 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, minHeight: 0 }}>
          <textarea value={value} onChange={e => onChange(e.target.value)}
            style={{
              flex: 1, width: '100%', minHeight: 0,
              padding: 16, borderRadius: 12,
              border: '1px solid rgba(0,0,0,0.08)',
              background: '#fff', color: '#2d2520',
              fontSize: 15, lineHeight: 1.8, resize: 'none',
              outline: 'none', fontFamily: 'inherit',
            }}
            placeholder={placeholder}
            autoFocus
          />
        </div>

        {/* 底部按钮 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 24px 16px',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(255,255,255,0.9)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: '#9b8e84' }}>
            {value.length > 0 ? `${value.length} 字` : '尚未填写'}
          </span>
          <button onClick={onClose} style={{
            padding: '10px 28px', borderRadius: 10, fontSize: 14, fontWeight: 600,
            border: 'none', background: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
            color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
          }}>完成编辑</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// 角色模板详情弹窗（参考 ModelSettingsTab 左栏列表+右栏详情）
// ═══════════════════════════════════════════════════════════════
function RoleTemplateDetailModal({
  open, onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const roleTemplates = useSettingsStore(s => s.aiSettings.roleTemplates)
  const activeId = useSettingsStore(s => s.aiSettings.activeRoleTemplateId)
  const addRoleTemplate = useSettingsStore(s => s.addRoleTemplate)
  const updateRoleTemplate = useSettingsStore(s => s.updateRoleTemplate)
  const removeRoleTemplate = useSettingsStore(s => s.removeRoleTemplate)
  const setActiveRoleTemplate = useSettingsStore(s => s.setActiveRoleTemplate)

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [charDeleteConfirmId, setCharDeleteConfirmId] = useState<string | null>(null)

  // ── 子编辑弹窗状态 ──
  const [editingCharId, setEditingCharId] = useState<string | null>(null)
  const [worldModalOpen, setWorldModalOpen] = useState(false)
  const [scenarioModalOpen, setScenarioModalOpen] = useState(false)

  // ── 拖动 + 缩放状态（v13.x: 统一共享拖拽 hook）──
  const initialW = Math.round(window.innerWidth * 9 / 10)
  const initialH = Math.round(window.innerHeight * 9 / 10)
  const { size: modalSize, setSize: setModalSize, pos: modalPos, setPos: setModalPos, handleResizeStart, handleDragStart } = useDraggableResizable({
    anchor: 'left-top',
    defaultSize: { width: initialW, height: initialH },
    defaultPos: {
      left: Math.round((window.innerWidth - initialW) / 2),
      top: Math.round((window.innerHeight - initialH) / 2),
    },
    minW: 600, minH: 500, maxW: window.innerWidth,
    dragExclude: 'button, input, textarea, select',
  })

  // 当 open 变为 true 时重新计算居中位置
  useEffect(() => {
    if (open) {
      const w = Math.round(window.innerWidth * 9 / 10)
      const h = Math.round(window.innerHeight * 9 / 10)
      setModalSize({ width: w, height: h })
      setModalPos({ left: Math.round((window.innerWidth - w) / 2), top: Math.round((window.innerHeight - h) / 2) })
    }
  }, [open])

  const activeTemplate = roleTemplates.find(t => t.id === activeId)

  if (!open) return null

  const handleAddTemplate = () => {
    const tpl = createDefaultRoleTemplate()
    addRoleTemplate(tpl)
  }

  const handleDeleteTemplate = (id: string) => {
    removeRoleTemplate(id)
  }

  const update = (patch: Partial<RoleTemplate>) => {
    if (!activeId) return
    updateRoleTemplate(activeId, patch)
  }

  const handleAddCharacter = () => {
    if (!activeTemplate) return
    const newChar = createDefaultCharacter(false, '新角色', '助手')
    update({ characters: [...activeTemplate.characters, newChar] })
  }

  const handleUpdateCharacter = (charId: string, updated: CharacterCard) => {
    if (!activeTemplate) return
    update({
      characters: activeTemplate.characters.map(c => c.id === charId ? updated : c),
    })
  }

  const handleDeleteCharacter = (charId: string) => {
    if (!activeTemplate) return
    const remaining = activeTemplate.characters.filter(c => c.id !== charId)
    const hasUser = remaining.some(c => c.isUser)
    const hasAI = remaining.some(c => !c.isUser)
    if (!hasUser || !hasAI) {
      alert('至少需要保留一个用户角色和一个AI角色')
      return
    }
    update({ characters: remaining })
  }

  // 四边 + 四角 resize handles
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
          display: 'flex', overflow: 'hidden',
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

        {/* ── 左栏：模板列表 ── */}
        <div style={{
          width: 220, borderRight: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.01)',
        }}>
          <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>
              📋 角色模板列表
            </div>
            <div style={{ fontSize: 12, color: '#9b8e84', marginBottom: 10 }}>
              {roleTemplates.length} 个模板
            </div>
            <button onClick={handleAddTemplate} style={{
              width: '100%', padding: '7px 12px', borderRadius: 10,
              border: '1px solid rgba(124,58,237,0.2)',
              background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}>
              <PlusIcon style={{ width: 14, height: 14 }} /> 新建模板
            </button>
          </div>
          <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
            <div style={{ padding: '6px' }}>
              {roleTemplates.map(tpl => (
                <div key={tpl.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <button onClick={() => setActiveRoleTemplate(tpl.id)} style={{
                    flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: 'none',
                    background: activeId === tpl.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                    color: activeId === tpl.id ? '#7c3aed' : '#4a3f38',
                    fontSize: 14, fontWeight: activeId === tpl.id ? 600 : 400, cursor: 'pointer',
                  }}>
                    <div>{tpl.name}</div>
                    <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 3 }}>
                      {tpl.characters.length} 个角色
                      {tpl.worldSetting ? ' · 有世界观' : ''}
                    </div>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id) }}
                    title="删除模板" style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6,
                      color: '#d4ccc4', flexShrink: 0,
                    }}>
                    <TrashIcon style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              ))}
              {roleTemplates.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, color: '#9b8e84', fontSize: 12 }}>
                  暂无模板，点击上方按钮创建
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── 右栏：模板详情 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!activeTemplate ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 14 }}>
              请选择或新建一个角色模板
            </div>
          ) : (
<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                          <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20, paddingBottom: 8, height: '100%' }}>

                {/* 模板名称 */}
                <div style={{
                  padding: '14px 18px', borderRadius: 14,
                  background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(168,85,247,0.03))',
                  border: '1px solid rgba(124,58,237,0.12)',
                }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#7c3aed', marginBottom: 4, display: 'block' }}>
                    模板名称
                  </label>
                  <input type="text" value={activeTemplate.name}
                    onChange={e => update({ name: e.target.value })}
                    style={{
                      fontSize: 16, fontWeight: 700, color: '#2d2520', border: 'none',
                      background: 'transparent', outline: 'none', width: '100%', fontFamily: 'inherit',
                    }} placeholder="输入模板名称" />
                </div>

                {/* ── 角色卡片区域 ── */}
                <div>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 10,
                  }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>
                        👥 角色卡片
                      </div>
                      <div style={{ fontSize: 12, color: '#9b8e84' }}>
                        {activeTemplate.characters.length} 个角色（{activeTemplate.characters.filter(c => c.isUser).length} 用户 + {activeTemplate.characters.filter(c => !c.isUser).length} AI）
                      </div>
                    </div>
                    <button onClick={handleAddCharacter} style={{
                      padding: '4px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      border: '1px solid rgba(22,163,74,0.2)', background: 'rgba(22,163,74,0.04)',
                      color: '#16a34a', cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <PlusIcon style={{ width: 12, height: 12 }} /> 添加角色
                    </button>
                  </div>

                  {/* 角色预览卡片网格排列（点击打开编辑弹窗） */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
                    padding: 14, borderRadius: 14,
                    background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.08)',
                    maxHeight: 420, overflowY: 'auto',
                  }} className="custom-scrollbar">
                    {activeTemplate.characters.map(char => (
                      <CharacterPreviewCard
                        key={char.id}
                        character={char}
                        onClick={() => setEditingCharId(char.id)}
                        onDelete={() => setCharDeleteConfirmId(char.id)}
                        canDelete={activeTemplate.characters.length > 2}
                      />
                    ))}
                  </div>
                </div>

                {/* ── 补充设定区域（撑满剩余空间）── */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#2d2520', marginBottom: 10, flexShrink: 0 }}>
                    📖 补充设定
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
                    {/* 世界观背景 — 点击预览卡片打开大弹窗编辑 */}
                    <div onClick={() => setWorldModalOpen(true)} style={{
                      flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
                      padding: 14, borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)',
                      transition: 'all 0.2s ease',
                    }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'rgba(124,58,237,0.2)'
                        e.currentTarget.style.boxShadow = '0 4px 16px rgba(124,58,237,0.06)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexShrink: 0 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54', cursor: 'pointer' }}>
                          📖 世界观背景
                        </label>
                        <span style={{ fontSize: 11, color: '#9b8e84' }}>点击编辑 ✎</span>
                      </div>
                      <div style={{ flex: 1, fontSize: 13, color: activeTemplate.worldSetting ? '#4a3f38' : '#c5bfb8', lineHeight: 1.6, overflow: 'hidden', minHeight: 0 }}>
                        {activeTemplate.worldSetting
                          ? (activeTemplate.worldSetting.length > 200 ? activeTemplate.worldSetting.slice(0, 200) + '...' : activeTemplate.worldSetting)
                          : '点击此处填写世界观背景设定...'}
                      </div>
                    </div>

                    {/* 场景/对话设定 — 点击预览卡片打开大弹窗编辑 */}
                    <div onClick={() => setScenarioModalOpen(true)} style={{
                      flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
                      padding: 14, borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)',
                      transition: 'all 0.2s ease',
                    }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'rgba(124,58,237,0.2)'
                        e.currentTarget.style.boxShadow = '0 4px 16px rgba(124,58,237,0.06)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexShrink: 0 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#6b5e54', cursor: 'pointer' }}>
                          💬 场景与对话设定
                        </label>
                        <span style={{ fontSize: 11, color: '#9b8e84' }}>点击编辑 ✎</span>
                      </div>
                      <div style={{ flex: 1, fontSize: 13, color: activeTemplate.scenarioSetting ? '#4a3f38' : '#c5bfb8', lineHeight: 1.6, overflow: 'hidden', minHeight: 0 }}>
                        {activeTemplate.scenarioSetting
                          ? (activeTemplate.scenarioSetting.length > 200 ? activeTemplate.scenarioSetting.slice(0, 200) + '...' : activeTemplate.scenarioSetting)
                          : '点击此处填写场景与对话设定...'}
                      </div>
                    </div>
                  </div>
                </div>

</div>
              </ScrollArea>

              {/* bottom buttons */}
              <div style={{
                display: "flex", justifyContent: "flex-end", gap: 10,
                padding: "10px 20px 14px",
                borderTop: "1px solid rgba(0,0,0,0.06)",
                background: "rgba(255,255,255,0.9)",
                flexShrink: 0,
              }}>
                <button onClick={() => setDeleteConfirmOpen(true)} style={{
                  padding: "8px 22px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: "1px solid rgba(220,38,38,0.15)", background: "#fff",
                  color: "#dc2626", cursor: "pointer", fontFamily: "inherit",
                }}>删除模板</button>
                <button onClick={onClose} style={{
                  padding: "8px 22px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: "1px solid rgba(0,0,0,0.1)", background: "#fff",
                  color: "#6b5e54", cursor: "pointer", fontFamily: "inherit",
                }}>关闭</button>
                <button onClick={onClose} style={{
                  padding: "8px 22px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: "none", background: "linear-gradient(135deg, #7c3aed, #8b5cf6)",
                  color: "#fff", cursor: "pointer", fontFamily: "inherit",
                }}>保存</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 头像灯箱 */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
      {/* 删除确认弹窗 */}
      {deleteConfirmOpen && (
        <ConfirmModal
          isOpen={true}
          title="删除角色模板"
          message={`确定要删除角色模板「${activeTemplate?.name || ''}」吗？此操作不可撤销。`}
          confirmLabel="删除"
          danger
          onConfirm={() => {
            if (activeTemplate) {
              handleDeleteTemplate(activeTemplate.id)
              if (roleTemplates.length <= 1) onClose()
            }
            setDeleteConfirmOpen(false)
          }}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
      {/* 角色删除确认弹窗 */}
      {charDeleteConfirmId && activeTemplate && (
        <ConfirmModal
          isOpen={true}
          title="删除角色"
          message={`确定要删除角色「${activeTemplate.characters.find(c => c.id === charDeleteConfirmId)?.name || ''}」吗？此操作不可撤销。`}
          confirmLabel="删除"
          danger
          onConfirm={() => {
            handleDeleteCharacter(charDeleteConfirmId)
            setCharDeleteConfirmId(null)
          }}
          onCancel={() => setCharDeleteConfirmId(null)}
        />
      )}
      {/* ── 子编辑弹窗（角色详情 / 世界观 / 场景设定）── */}
      {activeTemplate && editingCharId && (
        <CharacterDetailModal
          character={activeTemplate.characters.find(c => c.id === editingCharId) || null}
          open={true}
          onClose={() => setEditingCharId(null)}
          onChange={(c) => handleUpdateCharacter(editingCharId, c)}
          onDelete={() => { setEditingCharId(null); setCharDeleteConfirmId(editingCharId) }}
          canDelete={activeTemplate.characters.length > 2}
        />
      )}
      {activeTemplate && (
        <TextSettingModal
          title="世界观背景"
          emoji="📖"
          value={activeTemplate.worldSetting}
          open={worldModalOpen}
          onClose={() => setWorldModalOpen(false)}
          onChange={(v) => update({ worldSetting: v })}
          placeholder="描述这个世界的背景设定：时代、地理、势力、文化、规则体系等..."
        />
      )}
      {activeTemplate && (
        <TextSettingModal
          title="场景与对话设定"
          emoji="💬"
          value={activeTemplate.scenarioSetting}
          open={scenarioModalOpen}
          onClose={() => setScenarioModalOpen(false)}
          onChange={(v) => update({ scenarioSetting: v })}
          placeholder="补充角色间的关系动态、生活/工作/人际/社会设定、对话规则等..."
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// AI 设置主面板
// ═══════════════════════════════════════════════════════════════
export function AISettingsTab() {
  const aiSettings = useSettingsStore(s => ({ ...DEFAULT_AI_SETTINGS, ...s.aiSettings }))
  const setAISettings = useSettingsStore(s => s.setAISettings)
  const addRoleTemplate = useSettingsStore(s => s.addRoleTemplate)
  const removeRoleTemplate = useSettingsStore(s => s.removeRoleTemplate)

  const update = (k: keyof AIAssistantSettings, v: unknown) => setAISettings({ [k]: v })

  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedTplId, setSelectedTplId] = useState<string | null>(null)
  const [cardDeleteConfirmId, setCardDeleteConfirmId] = useState<string | null>(null)

  // 加载头像
  const [userAvatarSrc, setUserAvatarSrc] = useState('')
  const [aiAvatarSrc, setAiAvatarSrc] = useState('')
  useEffect(() => {
    loadAvatar(aiSettings.userAvatar || '').then(setUserAvatarSrc)
    loadAvatar(aiSettings.assistantAvatar || '').then(setAiAvatarSrc)
  }, [aiSettings.userAvatar, aiSettings.assistantAvatar])

  const roleTemplates = aiSettings.roleTemplates || []

  // 打开详情弹窗
  const openTemplateDetail = (tplId: string) => {
    setSelectedTplId(tplId)
    useSettingsStore.getState().setActiveRoleTemplate(tplId)
    setDetailModalOpen(true)
  }

  // 新建模板并打开
  const handleNewTemplate = () => {
    const tpl = createDefaultRoleTemplate()
    addRoleTemplate(tpl)
    openTemplateDetail(tpl.id)
  }

  return (
    <div className="custom-scrollbar" style={{ overflowY: 'auto', paddingRight: 16, height: '100%' }}>
      <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── 能力总览面板 ── */}
        <div className="stagger-item glass-card-enhanced" style={{ padding: 20, background: 'linear-gradient(135deg, rgba(124,58,237,0.04), rgba(59,130,246,0.04))', border: '1px solid rgba(124,58,237,0.12)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: '#7c3aed' }}>AI 写作助手能力总览</h4>
          <p style={{ ...captionText, marginBottom: 14 }}>你的 AI 助手具备以下能力，覆盖写作全流程</p>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b5e54', marginBottom: 8 }}>27 个工具（首轮全量 + 后续 11 个高频）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[
                { n: 'read_file', t: '核心' }, { n: 'create_file', t: '核心' },
                { n: 'edit_file', t: '核心' }, { n: 'delete_file', t: '核心' },
                { n: 'list_directory', t: '核心' }, { n: 'search_content', t: '核心' },
                { n: 'tool_search', t: '核心' },
                { n: 'find_files', t: '只读' }, { n: 'batch_replace', t: '只读' },
                { n: 'rename_file', t: '需确认' },
                { n: 'create_project', t: '需确认' }, { n: 'delete_project', t: '需确认' },
              ].map(t => (
                <span key={t.n} title={t.n} style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10,
                  background: t.t === '核心' ? 'rgba(124,58,237,0.08)' : t.t === '只读' ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)',
                  color: t.t === '核心' ? '#7c3aed' : t.t === '只读' ? '#16a34a' : '#d97706',
                  fontWeight: 600, cursor: 'default',
                }}>{t.n}</span>
              ))}
              <span style={{ fontSize: 10, color: '#9b8e84', padding: '2px 4px' }}>+ 扩展 22 个（tool_search 按需发现）</span>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b5e54', marginBottom: 6 }}>特性</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 10, color: '#9b8e84' }}>
              <span>首条全量注入，后续精简 ~540 tokens</span>
              <span>Prompt 缓存（费用减免 90%+）</span>
              <span>tool_search 按需发现扩展工具</span>
              <span>风格/场景模板注入</span>
              <span>上下文自动压缩</span>
              <span>双协议（Anthropic+OpenAI）</span>
            </div>
          </div>
        </div>

        {/* ── 角色模板卡片 ── */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520', marginBottom: 2 }}>🎭 角色模板</h4>
              <p style={{ ...captionText }}>每个模板包含一组角色卡片和世界观设定，对话时可切换</p>
            </div>
            <button onClick={handleNewTemplate} style={{
              padding: '6px 14px', borderRadius: 10, fontSize: 11, fontWeight: 600,
              border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.06)',
              color: '#7c3aed', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <PlusIcon style={{ width: 14, height: 14 }} /> 新建模板
            </button>
          </div>

          {/* 模板卡片网格 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {roleTemplates.map(tpl => {
              const userChars = tpl.characters.filter(c => c.isUser)
              const aiChars = tpl.characters.filter(c => !c.isUser)
              return (
                <div key={tpl.id} style={cardStyle}
                  onClick={() => openTemplateDetail(tpl.id)}
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
                  {/* 卡片头部 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 20 }}>🎭</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#2d2520', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tpl.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#9b8e84' }}>
                        {tpl.characters.length} 个角色
                      </div>
                    </div>
                    <button onClick={(e) => {
                      e.stopPropagation()
                      setCardDeleteConfirmId(tpl.id)
                    }} style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                      color: '#d4ccc4', flexShrink: 0,
                    }} title="删除模板">
                      <TrashIcon style={{ width: 14, height: 14 }} />
                    </button>
                  </div>

                  {/* 角色预览 */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {userChars.map(c => (
                      <span key={c.id} style={{
                        padding: '1px 7px', borderRadius: 6, fontSize: 9, fontWeight: 600,
                        background: 'rgba(124,58,237,0.08)', color: '#7c3aed',
                      }}>👤 {c.name}</span>
                    ))}
                    {aiChars.map(c => (
                      <span key={c.id} style={{
                        padding: '1px 7px', borderRadius: 6, fontSize: 9, fontWeight: 600,
                        background: 'rgba(22,163,74,0.08)', color: '#16a34a',
                      }}>🤖 {c.name}</span>
                    ))}
                  </div>

                  {tpl.worldSetting && (
                    <div style={{ marginTop: 8, fontSize: 9, color: '#9b8e84' }}>
                      📖 已设定世界观
                    </div>
                  )}
                </div>
              )
            })}

            {/* 空状态：无模板时显示新建引导 */}
            {roleTemplates.length === 0 && (
              <button onClick={handleNewTemplate} style={{
                ...cardStyle, textAlign: 'center', background: 'rgba(124,58,237,0.02)',
                border: '1px dashed rgba(124,58,237,0.2)', display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                minHeight: 120, gap: 8,
              }}>
                <PlusIcon style={{ width: 28, height: 28, color: '#7c3aed', opacity: 0.5 }} />
                <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600 }}>创建第一个角色模板</span>
                <span style={{ fontSize: 10, color: '#9b8e84' }}>包含写作者和写作助手角色</span>
              </button>
            )}
          </div>
        </div>

        {/* ── AI 对话设置（精简版：只保留不依赖角色的设置） ── */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>AI 对话设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="回复风格">
              <select value={aiSettings.responseStyle} onChange={e => update('responseStyle', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                {[{ v: 'concise', l: '简洁' }, { v: 'normal', l: '标准' }, { v: 'detailed', l: '详细' }].map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </FormField>
            <FormField label="自动应用到编辑器">
              <input type="checkbox" checked={aiSettings.autoApply} onChange={e => update('autoApply', e.target.checked)} />
            </FormField>
          </div>
        </div>

        {/* Context Priority */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>信息调用优先级</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="参考信息优先顺序">
              <select value={aiSettings.contextPriority} onChange={e => update('contextPriority', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="balanced">均衡 — 知识库 + 模型 + 搜索</option>
                <option value="kb-first">知识库优先 — 以知识库为准，模型补充</option>
                <option value="model-first">模型优先 — 以模型知识为准，知识库参考</option>
              </select>
            </FormField>
            <div style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.6 }}>
              {aiSettings.contextPriority === 'kb-first' && '知识库检索结果放在最前，指示 AI 优先参考知识库信息。适合需要依据设定集、资料库创作的场景。'}
              {aiSettings.contextPriority === 'model-first' && '减少知识库上下文的权重，让 AI 更多依靠自身知识。适合知识库内容可能触发安全策略的场景。'}
              {aiSettings.contextPriority === 'balanced' && '知识库、模型知识、网络搜索平等参与。适合大多数场景。'}
            </div>
          </div>
        </div>

        {/* Web Search + Pexels */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>界面设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="显示新会话欢迎信息">
              <input type="checkbox" checked={aiSettings.showWelcome !== false} onChange={e => update('showWelcome', e.target.checked)} />
            </FormField>
          </div>

          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, marginTop: 24, color: '#2d2520' }}>联网搜索设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="默认开启联网搜索">
              <input type="checkbox" checked={aiSettings.webSearchDefault} onChange={e => update('webSearchDefault', e.target.checked)} />
            </FormField>
            <FormField label={`搜索结果数量 (${aiSettings.searchResultCount})`}>
              <input type="range" min={1} max={10} value={aiSettings.searchResultCount} onChange={e => update('searchResultCount', parseInt(e.target.value))} style={{ width: '100%' }} />
            </FormField>
            <FormField label="安全搜索">
              <select value={aiSettings.safeSearch} onChange={e => update('safeSearch', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
                {[{ v: 'strict', l: '严格' }, { v: 'moderate', l: '中等' }, { v: 'off', l: '关闭' }].map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </FormField>
          </div>

          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, marginTop: 24, color: '#2d2520' }}>🖼️ 图片搜索 Pexels</h4>
          <PexelsKeyField />
        </div>

        {/* Priority Sites */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>优先搜索网站</h4>
          <div style={{ marginBottom: 12 }}>
            <Button size="sm" onClick={() => {
              const id = nanoid()
              setAISettings({ prioritySites: [...aiSettings.prioritySites, { id, url: '', description: '', category: '百科' }] })
            }} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>添加网址</Button>
          </div>
          {aiSettings.prioritySites.map((site, i) => (
            <div key={site.id} className="interactive" style={{ padding: 12, borderRadius: 12, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={site.url} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], url: e.target.value }
                setAISettings({ prioritySites: sites })
              }} placeholder="网址 (如 zh.wikipedia.org)" className="focus-ring" style={{ ...inputStyle, flex: 2 }} />
              <input value={site.description} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], description: e.target.value }
                setAISettings({ prioritySites: sites })
              }} placeholder="描述" className="focus-ring" style={{ ...inputStyle, flex: 1 }} />
              <select value={site.category} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], category: e.target.value }
                setAISettings({ prioritySites: sites })
              }} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer', width: 100 }}>
                {['文学', '百科', '社区', '资料', '其他'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button variant="danger" size="sm" onClick={() => {
                setAISettings({ prioritySites: aiSettings.prioritySites.filter(s => s.id !== site.id) })
              }} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
            </div>
          ))}
        </div>

        {/* Budget */}
        <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>月度预算预警</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="月度预算上限 ($)">
              <input type="number" min={0} step={0.01} value={aiSettings.monthlyBudget} onChange={e => update('monthlyBudget', parseFloat(e.target.value) || 0)} className="focus-ring" style={inputStyle} placeholder="0=不限" />
            </FormField>
            <FormField label="启用预算预警">
              <input type="checkbox" checked={aiSettings.budgetWarning} onChange={e => update('budgetWarning', e.target.checked)} />
            </FormField>
          </div>
        </div>
      </div>

      {/* 详情弹窗 */}
      <RoleTemplateDetailModal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
      />

      {/* 卡片删除确认弹窗 */}
      {cardDeleteConfirmId && (
        <ConfirmModal
          isOpen={true}
          title="删除角色模板"
          message={`确定要删除角色模板「${roleTemplates.find(t => t.id === cardDeleteConfirmId)?.name || ''}」吗？此操作不可撤销。`}
          confirmLabel="删除"
          danger
          onConfirm={() => {
            removeRoleTemplate(cardDeleteConfirmId)
            setCardDeleteConfirmId(null)
          }}
          onCancel={() => setCardDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}

/** Pexels API 密钥管理 */
function PexelsKeyField() {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    settingsService.loadPexelsKey().then((k: string) => { if (k) setKey(k) }).catch(() => {})
  }, [])

  const save = async () => {
    await settingsService.savePexelsKey(key.trim())
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.5 }}>
        免费注册 <a href="https://www.pexels.com/api/" target="_blank" style={{ color: '#7c3aed' }}>pexels.com/api</a> 获取 API Key。
        200次/时，2万次/月。支持中文搜索，国内可直接访问。
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={key} onChange={e => setKey(e.target.value)}
          placeholder="粘贴 Pexels API Key..."
          className="focus-ring" style={{ ...inputStyle, flex: 1 }} />
        <button onClick={save}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: saved ? '#16a34a' : '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {saved ? '✓ 已保存' : '保存'}
        </button>
      </div>
    </div>
  )
}
