import { fileService } from '@/services/fileService'
import { CHARACTER_FIELDS, ROLES } from '@/services/characterService'
import CharacterImage from './CharacterImage'
import Button from '@/components/common/Button'
import { inputStyle } from '@/components/common/styles'
import { TagIcon } from '@heroicons/react/24/outline'
import type { Character } from '@/types/character'
import { RELATIONSHIP_TAGS } from '@/types/character'

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
  const toggleTag = (tag: string) => {
    const tags = char.relationshipTags as string[]
    if (tags.includes(tag)) {
      onChange({ ...char, relationshipTags: (tags.filter(t => t !== tag) as Character['relationshipTags']) })
    } else {
      onChange({ ...char, relationshipTags: ([...tags, tag] as Character['relationshipTags']) })
    }
  }

  const set = (k: keyof Character, v: unknown) => onChange({ ...char, [k]: v })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 角色形象图 */}
      <div>
        <div style={labelStyle}>形象图</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {char.image ? (
            <div style={{ position: 'relative', width: 80, height: 80, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.08)' }}>
              <CharacterImage image={char.image} projectPath={projectPath} alt={char.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: 12, background: 'rgba(124,58,237,0.04)', border: '2px dashed rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 10 }}>
              无形象
            </div>
          )}
          <div>
            <button onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'; input.accept = 'image/*'
              input.onchange = async () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = async () => {
                  try {
                    const fn = await fileService.saveImageUrl(reader.result as string, projectPath)
                    if (fn) { set('image', fn); return }
                  } catch { /* fallback to base64 */ }
                  set('image', reader.result as string)
                }
                reader.readAsDataURL(file)
              }
              input.click()
            }} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(124,58,237,0.15)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
              {char.image ? '更换形象图' : '上传形象图'}
            </button>
            {char.image && (
              <button onClick={() => set('image', undefined)} style={{ marginLeft: 8, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.15)', background: 'rgba(239,68,68,0.04)', color: '#dc2626', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                移除
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Basic info row */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>姓名</label>
          <input type="text" value={char.name} onChange={e => set('name', e.target.value)} style={inputStyle} placeholder="角色姓名" />
        </div>
        <div style={{ width: 130 }}>
          <label style={labelStyle}>角色类型</label>
          <select value={char.role} onChange={e => set('role', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
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
            value={char[k] as string}
            onChange={e => set(k, e.target.value)}
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
                padding: '3px 10px', borderRadius: 8, border: char.relationshipTags.includes(tag) ? '1px solid #7c3aed' : '1px solid #e5e0da',
                background: char.relationshipTags.includes(tag) ? 'rgba(124,58,237,0.08)' : '#fff',
                color: char.relationshipTags.includes(tag) ? '#7c3aed' : '#6b5e54',
                fontSize: 11, cursor: 'pointer', fontWeight: char.relationshipTags.includes(tag) ? 600 : 400,
                transition: 'all 0.1s ease',
              }}
            >
              {tag}
            </button>
          ))}
        </div>
        {char.relationshipTags.length > 0 && (
          <div style={{ fontSize: 11, color: '#9b8e84' }}>
            已选: {char.relationshipTags.join('、')}
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
