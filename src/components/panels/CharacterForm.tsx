import { fileService } from '@/services/fileService'
import { CHARACTER_FIELDS, ROLES } from '@/services/characterService'
import Button from '@/components/common/Button'
import { inputStyle } from '@/components/common/styles'
import { TagIcon } from '@heroicons/react/24/outline'
import type { Character } from '@/types/character'
import { RELATIONSHIP_TAGS } from '@/types/character'
import { safeStr } from '@/utils/safeStr'

const FIELD_TO_LABEL: Record<string, string> = Object.fromEntries(
  CHARACTER_FIELDS.map(f => [f.key as string, f.label])
)

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 4,
}

interface Props {
  char: Character
  onChange: (c: Character) => void
  onSave: () => void
  onClose: () => void
  projectPath: string
}

export default function CharacterForm({ char, onChange, onSave, onClose, projectPath }: Props) {
  const tags: string[] = (char.relationshipTags as string[]) || []
  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      onChange({ ...char, relationshipTags: (tags.filter(t => t !== tag) as Character['relationshipTags']) })
    } else {
      onChange({ ...char, relationshipTags: ([...tags, tag] as Character['relationshipTags']) })
    }
  }

  const set = (k: keyof Character, v: unknown) => onChange({ ...char, [k]: v })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Basic info row */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>姓名</label>
          <input type="text" value={char.name} onChange={e => set('name', e.target.value)} className="focus-ring" style={inputStyle} placeholder="角色姓名" />
        </div>
        <div style={{ width: 130 }}>
          <label style={labelStyle}>角色类型</label>
          <select value={char.role} onChange={e => set('role', e.target.value)} className="focus-ring" style={{ ...inputStyle, cursor: 'pointer' }}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>性别</label>
          <input type="text" value={char.gender} onChange={e => set('gender', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>年龄</label>
          <input type="text" value={char.age} onChange={e => set('age', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>职业/身份</label>
          <input type="text" value={char.occupation} onChange={e => set('occupation', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>重要程度 ({char.importance ?? 50})</label>
          <input type="range" min="1" max="100" value={char.importance ?? 50} onChange={e => set('importance', parseInt(e.target.value))} style={{ width: '100%', accentColor: '#7c3aed', marginTop: 4 }} />
        </div>
      </div>

      {/* Text fields */}
      {(['background', 'appearance', 'personality', 'abilities', 'weaknesses', 'relationships', 'arc'] as const).map(k => (
        <div key={k}>
          <label style={labelStyle}>{FIELD_TO_LABEL[k]}</label>
          <textarea
            value={safeStr(char[k])}
            onChange={e => set(k, e.target.value)}
            className="focus-ring"
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
            placeholder={`${FIELD_TO_LABEL[k]}...`}
          />
        </div>
      ))}

      {/* Relationship Tags */}
      <div>
        <label style={labelStyle}>
          <TagIcon style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />
          关系标签（点击选择/取消）
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {RELATIONSHIP_TAGS.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              style={{
                padding: '3px 10px', borderRadius: 8, border: tags.includes(tag) ? '1px solid #7c3aed' : '1px solid #e5e0da',
                background: tags.includes(tag) ? 'rgba(124,58,237,0.08)' : '#fff',
                color: tags.includes(tag) ? '#7c3aed' : '#6b5e54',
                fontSize: 11, cursor: 'pointer', fontWeight: tags.includes(tag) ? 600 : 400,
                transition: 'all 0.1s ease',
              }}
            >
              {tag}
            </button>
          ))}
        </div>
        {tags.length > 0 && (
          <div style={{ fontSize: 11, color: '#9b8e84' }}>
            已选: {tags.join('、')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={onSave} disabled={!char.name.trim()}>保存角色设定</Button>
      </div>
    </div>
  )
}
