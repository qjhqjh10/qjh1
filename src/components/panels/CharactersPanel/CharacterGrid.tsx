import type { Character } from '@/types/character'
import { ROLES, normalizeRole } from '@/services/characterService'
import { ROLE_COLORS } from './constants'
import { CharacterCard } from './CharacterCard'
import EmptyState from '@/components/common/EmptyState'

interface CharacterGridProps {
  characters: Character[]
  projectPath: string
  onEdit: (char: Character) => void
  onDelete: (char: Character) => void
}

export function CharacterGrid({ characters, projectPath, onEdit, onDelete }: CharacterGridProps) {
  if (characters.length === 0) {
    return (
      <EmptyState icon="👤" title="暂无角色" description="点击 AI生成角色 或 新建角色 创建" />
    )
  }

  const groupedChars = ROLES.map(role => ({
    role,
    chars: characters.filter(c => normalizeRole(c.role as string) === role),
  })).filter(g => g.chars.length > 0)

  return (
    <>
      {groupedChars.map((group, gi) => (
        <div key={group.role}>
          {/* Section header */}
          <div className="role-group-header" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, marginTop: gi > 0 ? 28 : 0 }}>
            <div style={{ width: 3, height: 22, borderRadius: 2, background: ROLE_COLORS[group.role] }} />
            <span style={{
              fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
              background: `linear-gradient(135deg, ${ROLE_COLORS[group.role]}, ${ROLE_COLORS[group.role]}cc)`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>{group.role}</span>
            <span style={{ fontSize: 11, color: '#9b8e84', fontWeight: 500 }}>
              {group.chars.length} 位
            </span>
          </div>
          {/* Card grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
            {group.chars.map(char => (
              <div key={char.id} className="stagger-item">
                <CharacterCard char={char} projectPath={projectPath} onEdit={onEdit} onDelete={onDelete} />
              </div>
            ))}
          </div>
          {/* Divider between groups */}
          {gi < groupedChars.length - 1 && (
            <div style={{ height: 1, marginTop: 24, background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.06), transparent)' }} />
          )}
        </div>
      ))}
    </>
  )
}
