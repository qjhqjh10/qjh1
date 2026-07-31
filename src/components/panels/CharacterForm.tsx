import { fileService } from '@/services/fileService'
import { CHARACTER_FIELDS, ROLES } from '@/services/characterService'
import Button from '@/components/common/Button'
import { inputStyle } from '@/components/common/styles'
import type { Character } from '@/types/character'
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
  const set = (k: keyof Character, v: unknown) => onChange({ ...char, [k]: v })

  // ---- 自定义信息条块 ----
  const blocks = char.customBlocks || []
  const setBlock = (i: number, patch: Partial<Character['customBlocks'][number]>) => {
    const next = blocks.map((b, idx) => idx === i ? { ...b, ...patch } : b)
    onChange({ ...char, customBlocks: next })
  }
  const removeBlock = (i: number) => {
    onChange({ ...char, customBlocks: blocks.filter((_, idx) => idx !== i) })
  }
  const addBlock = () => {
    onChange({ ...char, customBlocks: [...blocks, { label: '', content: '' }] })
  }

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

      {/* 自定义信息条块 — 用户可自由增删 */}
      <div style={{ borderTop: '1px dashed #e5e0da', paddingTop: 12, marginTop: 4 }}>
        <label style={{ ...labelStyle, marginBottom: 8 }}>
          自定义信息条块
          <span style={{ fontWeight: 400, color: '#9b8e84', fontSize: 11, marginLeft: 4 }}>（自由增删 — 前框填特点，后框填具体信息）</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {blocks.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input
                type="text"
                value={b.label}
                onChange={e => setBlock(i, { label: e.target.value })}
                placeholder="特点（如：口头禅）"
                className="focus-ring"
                style={{ ...inputStyle, width: 140, flexShrink: 0 }}
              />
              <textarea
                value={b.content}
                onChange={e => setBlock(i, { content: e.target.value })}
                placeholder="具体信息..."
                className="focus-ring"
                style={{ ...inputStyle, flex: 1, minHeight: 40, resize: 'vertical' }}
              />
              <button
                onClick={() => removeBlock(i)}
                title="删除此条块"
                style={{
                  flexShrink: 0, alignSelf: 'center', width: 30, height: 30, borderRadius: 8,
                  border: '1px solid #fecaca', background: '#fff7f7', color: '#dc2626',
                  fontSize: 15, cursor: 'pointer', lineHeight: 1,
                }}
              >✕</button>
            </div>
          ))}
          {blocks.length === 0 && (
            <div style={{ fontSize: 12, color: '#9b8e84', padding: '8px 2px' }}>暂无自定义条块，可点击下方按钮添加，例如「口头禅: 莫欺少年穷」</div>
          )}
          <button
            onClick={addBlock}
            style={{
              alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 10,
              border: '1.5px dashed #c4b5fd', background: 'rgba(124,58,237,0.03)',
              color: '#7c3aed', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.07)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.03)' }}
          >+ 添加信息条块</button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid #f0ece8' }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={onSave} disabled={!char.name.trim()}>保存角色设定</Button>
      </div>
    </div>
  )
}
