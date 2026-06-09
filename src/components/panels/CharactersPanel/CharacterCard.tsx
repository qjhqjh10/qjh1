import { useState, useEffect, useRef } from 'react'
import type { Character } from '@/types/character'
import GlassCard from '@/components/common/GlassCard'
import { fileService } from '@/services/fileService'
import { PencilIcon, TrashIcon, UserIcon } from '@heroicons/react/24/outline'
import { safeStr } from '@/utils/safeStr'

interface CharacterCardProps {
  char: Character
  projectPath: string
  onEdit: (char: Character) => void
  onDelete: (char: Character) => void
}

/** Find existing character image file by convention */
async function findCharImage(projectPath: string, charId: string): Promise<string | null> {
  try {
    const dir = `${projectPath}/uploads/images`
    const files = await fileService.listDir(dir)
    const match = files.find(f => f.startsWith(`char_${charId}.`))
    return match || null
  } catch { return null }
}

/** Delete character image by convention */
async function deleteCharImage(projectPath: string, charId: string): Promise<void> {
  try {
    const existing = await findCharImage(projectPath, charId)
    if (existing) await fileService.deleteFile(`${projectPath}/uploads/images/${existing}`)
  } catch { /* ignore */ }
}

export function CharacterCard({ char, projectPath, onEdit, onDelete }: CharacterCardProps) {
  const [imageSrc, setImageSrc] = useState('')
  const [imageFile, setImageFile] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const refreshRef = useRef(0)

  // Load image from file convention on mount and when char.id changes
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setImageSrc('')
      setImageFile(null)
      if (!projectPath || !char.id) return
      const fn = await findCharImage(projectPath, char.id)
      if (cancelled || !fn) return
      setImageFile(fn)
      try {
        const b64 = await fileService.readBinary(`${projectPath}/uploads/images/${fn}`)
        if (cancelled || !b64) return
        const ext = fn.split('.').pop()?.toLowerCase() || 'png'
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
        setImageSrc(`data:${mime};base64,${b64}`)
      } catch { /* ignore */ }
    }
    load()
    return () => { cancelled = true }
  }, [projectPath, char.id, refreshRef.current])

  const handleUpload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file || !projectPath || !char.id) return
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          // Remove old image first
          await deleteCharImage(projectPath, char.id)
          // Save new image with convention: char_{id}.{ext}
          const ext = (file.name.split('.').pop() || 'png').toLowerCase()
          await fileService.saveImageUrl(reader.result as string, projectPath)
          // Find the saved file and rename to convention
          const dir = `${projectPath}/uploads/images`
          const files = await fileService.listDir(dir)
          const saved = files.find(f => !f.startsWith('char_') && f.includes('char'))
          const targetName = `char_${char.id}.${ext}`
          if (saved && saved !== targetName) {
            // saveImageUrl saves with auto-generated name; rename to convention
            const fullImgPath = `${projectPath}/uploads/images`
            // Read saved file, write to target name, delete original
            try {
              const content = await fileService.readBinary(`${fullImgPath}/${saved}`)
              if (content) {
                await fileService.writeBinary(`${fullImgPath}/${targetName}`, content)
                await fileService.deleteFile(`${fullImgPath}/${saved}`)
              }
            } catch { /* fallback: keep auto-generated name */ }
          }
          refreshRef.current++
        } catch { /* ignore */ }
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const handleReplace = () => {
    setCtxMenu(null)
    handleUpload()
  }

  const handleRemove = async () => {
    setCtxMenu(null)
    if (!projectPath || !char.id) return
    await deleteCharImage(projectPath, char.id)
    setImageSrc('')
    setImageFile(null)
    refreshRef.current++
  }

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (imageSrc) {
      // Left click on existing image → lightbox (open in new window / preview)
      // For now, we just highlight; user can right-click for options
    } else {
      handleUpload()
    }
  }

  const handleImageContext = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (imageSrc) {
      setCtxMenu({ x: e.clientX, y: e.clientY })
    }
  }

  // Close context menu on any click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctxMenu])

  return (
    <GlassCard key={char.id} onClick={() => onEdit(char)} className="char-card" style={{ display: 'flex', gap: 14, padding: 14, minHeight: 150 }}>
      {/* 形象图 — 左侧，独立管理 */}
      <div onClick={handleImageClick} onContextMenu={handleImageContext}
        title={imageSrc ? '右键更换或取消形象图' : '点击上传形象图'}
        style={{
          width: 100, minHeight: 130, maxHeight: 160, borderRadius: 12,
          overflow: 'hidden', flexShrink: 0,
          cursor: 'pointer',
          border: '1px solid rgba(0,0,0,0.06)', position: 'relative',
        }}>
        {imageSrc ? (
          <>
            <img src={imageSrc} alt={char.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)',
              transition: 'background 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.3)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0)' }}
            >
              <span style={{ opacity: 0, transition: 'opacity 0.2s', color: '#fff', fontSize: 10, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0' }}
              >右键菜单</span>
            </div>
          </>
        ) : (
          <div style={{
            width: '100%', height: '100%', minHeight: 130,
            background: 'rgba(124,58,237,0.02)',
            border: '2px dashed rgba(124,58,237,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.25s ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,0.3)'; e.currentTarget.style.background = 'rgba(124,58,237,0.04)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,0.1)'; e.currentTarget.style.background = 'rgba(124,58,237,0.02)' }}
          >
            <UserIcon style={{ width: 28, height: 28, color: '#d4ccc4' }} />
          </div>
        )}
      </div>

      {/* Right: Info */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#1e1b2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0, lineHeight: 1.3 }}>
            {char.name || '未命名角色'}
          </h4>
          <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            <button onClick={e => { e.stopPropagation(); onEdit(char) }} title="编辑" className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9b8e84', display: 'flex', borderRadius: 4 }}>
              <PencilIcon style={{ width: 13, height: 13 }} />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(char) }} title="删除" className="interactive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9b8e84', display: 'flex', borderRadius: 4 }}>
              <TrashIcon style={{ width: 13, height: 13 }} />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {char.role && (
            <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 5, background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(168,85,247,0.05))', color: '#7c3aed', fontSize: 10, fontWeight: 600 }}>{char.role}</span>
          )}
          {char.importance !== undefined && char.importance > 0 && (
            <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 5, background: 'rgba(245,158,11,0.08)', color: '#e67e00', fontSize: 10, fontWeight: 600 }}>★ {char.importance}</span>
          )}
        </div>
        {char.occupation && <p style={{ fontSize: 11, color: '#6b5e54', margin: 0, lineHeight: 1.4, fontWeight: 500 }}>{char.occupation}</p>}
        {(char.gender || char.age) && <p style={{ fontSize: 11, color: '#9b8e84', margin: 0 }}>{[char.gender, char.age].filter(Boolean).join(' · ')}</p>}
        {(char.relationshipTags || []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 1 }}>
            {(char.relationshipTags || []).slice(0, 3).map(t => (
              <span key={t} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(124,58,237,0.04)', color: '#7c3aed' }}>{t}</span>
            ))}
            {(char.relationshipTags || []).length > 3 && <span style={{ fontSize: 9, color: '#9b8e84' }}>+{(char.relationshipTags || []).length - 3}</span>}
          </div>
        )}
        {char.personality && (
          <p style={{ fontSize: 11, color: '#6b5e54', margin: 0, marginTop: 3, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {safeStr(char.personality)}
          </p>
        )}
      </div>

      {/* Right-click context menu for image */}
      {ctxMenu && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', left: ctxMenu.x, top: ctxMenu.y,
          zIndex: 9999, background: '#fff', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
          border: '1px solid rgba(0,0,0,0.06)',
          overflow: 'hidden', minWidth: 120,
        }}>
          <button onClick={handleReplace} style={{
            display: 'block', width: '100%', padding: '10px 16px', border: 'none',
            background: 'transparent', cursor: 'pointer', fontSize: 13,
            color: '#2d2520', textAlign: 'left', fontFamily: 'inherit',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5f2f0' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >🖼 更换形象图</button>
          <button onClick={handleRemove} style={{
            display: 'block', width: '100%', padding: '10px 16px', border: 'none',
            background: 'transparent', cursor: 'pointer', fontSize: 13,
            color: '#dc2626', textAlign: 'left', fontFamily: 'inherit',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >✕ 取消形象图</button>
        </div>
      )}
    </GlassCard>
  )
}
