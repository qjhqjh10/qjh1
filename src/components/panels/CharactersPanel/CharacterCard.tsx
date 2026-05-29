import type { Character } from '@/types/character'
import GlassCard from '@/components/common/GlassCard'
import CharacterImage from '../CharacterImage'
import { PencilIcon, TrashIcon, UserIcon } from '@heroicons/react/24/outline'
import { safeStr } from '@/utils/safeStr'

interface CharacterCardProps {
  char: Character
  projectPath: string
  onEdit: (char: Character) => void
  onDelete: (char: Character) => void
  onLightbox: (image: string, projectPath: string) => void
  onUploadImage?: (char: Character) => void
}

export function CharacterCard({ char, projectPath, onEdit, onDelete, onLightbox, onUploadImage }: CharacterCardProps) {
  return (
    <GlassCard key={char.id} onClick={() => onEdit(char)} className="char-card" style={{ display: 'flex', gap: 14, padding: 14, minHeight: 150 }}>
      {/* 形象图 — 左侧，点击放大 */}
      <div onClick={e => { e.stopPropagation(); if (char.image) { onLightbox(char.image, projectPath) } else if (onUploadImage) { onUploadImage(char) } }}
        className="char-img-box"
        title={char.image ? '点击放大' : '点击上传形象图'}
        style={{
          width: 100, minHeight: 130, maxHeight: 160, borderRadius: 12,
          overflow: 'hidden', flexShrink: 0,
          cursor: 'pointer',
          border: '1px solid rgba(0,0,0,0.06)', position: 'relative',
        }}>
        {char.image ? (
          <>
            <CharacterImage image={char.image} projectPath={projectPath} alt={char.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div className="char-img-overlay" style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)',
              transition: 'background 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ opacity: 0, transition: 'opacity 0.2s', color: '#fff', fontSize: 10, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>点击放大</span>
            </div>
          </>
        ) : (
          <div className="char-img-placeholder" style={{
            width: '100%', height: '100%', minHeight: 130,
            background: 'rgba(124,58,237,0.02)',
            border: '2px dashed rgba(124,58,237,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.25s ease',
          }}>
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
    </GlassCard>
  )
}
