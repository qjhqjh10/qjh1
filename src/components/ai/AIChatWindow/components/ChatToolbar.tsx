import { BookOpenIcon, ListBulletIcon, GlobeAltIcon, DocumentTextIcon, PhotoIcon } from '@heroicons/react/24/outline'
import { useState } from 'react'

interface ChatToolbarProps {
  kbEnabled: boolean
  setKbEnabled: (v: boolean) => void
  webSearchEnabled: boolean
  setWebSearchEnabled: (v: boolean) => void
  toolInvokeEnabled: boolean
  setToolInvokeEnabled: (v: boolean) => void
  workMode: 'plan' | 'action'
  setWorkMode: (mode: 'plan' | 'action') => void
  temperature: number
  onTemperatureChange: (delta: number) => void
  attachment: { type: 'file' | 'image'; name: string; content: string; previewUrl?: string } | null
  setAttachment: (a: ChatToolbarProps['attachment']) => void
  activeConfigId: string | null
  configs: Array<{ id: string; model: string }>
  onConfigChange: (id: string) => void
  conversationToolCount: number
  selectedFileIds: string[]
  kbFiles: Array<{ id: string; originalName: string }>
  showKBFileList: boolean
  setShowKBFileList: (v: boolean) => void
  toggleKBFile: (id: string) => void
  selectAllKBFiles: () => void
  loadKBFileList: () => void
}

const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '4px 8px', borderRadius: 8,
  border: active ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
  background: active ? 'rgba(124,58,237,0.06)' : '#fff',
  color: active ? '#7c3aed' : '#6b5e54',
  fontSize: 10, fontWeight: active ? 600 : 400,
  cursor: 'pointer', fontFamily: 'inherit',
})

function ToggleButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={toggleBtnStyle(active)}>
      {icon} {label}
    </button>
  )
}

export function ChatToolbar(props: ChatToolbarProps) {
  const [showKBFileList, setShowKBFileList] = useState(false)

  return (
    <div style={{ display: 'flex', gap: 6, padding: '8px 18px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(0,0,0,0.1)', flexWrap: 'wrap', alignItems: 'center' }}>
      <ToggleButton icon={<BookOpenIcon style={{ width: 12, height: 12 }} />} label="知识库" active={props.kbEnabled} onClick={() => props.setKbEnabled(!props.kbEnabled)} />
      {props.kbEnabled && (
        <div style={{ position: 'relative' }}>
          <button onClick={() => { props.loadKBFileList(); setShowKBFileList(!showKBFileList) }} title="选择知识库文件" style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8,
            border: props.selectedFileIds.length > 0 ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
            background: props.selectedFileIds.length > 0 ? 'rgba(124,58,237,0.04)' : '#fff',
            color: props.selectedFileIds.length > 0 ? '#7c3aed' : '#9b8e84', fontSize: 11, fontWeight: props.selectedFileIds.length > 0 ? 600 : 400,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <ListBulletIcon style={{ width: 11, height: 11 }} />
            文件 {props.selectedFileIds.length > 0 ? `(${props.selectedFileIds.length})` : ''}
          </button>
          {showKBFileList && (
            <div className="custom-scrollbar" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4, minWidth: 220, maxHeight: 260, overflowY: 'auto', background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', padding: 4 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                <button onClick={props.selectAllKBFiles} style={{ flex: 1, padding: '3px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', background: 'transparent', fontWeight: props.selectedFileIds.length === 0 ? 600 : 400, color: props.selectedFileIds.length === 0 ? '#7c3aed' : '#6b5e54' }}>全部</button>
              </div>
              {props.kbFiles.length > 0 ? props.kbFiles.map(f => (
                <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', cursor: 'pointer', borderRadius: 6, fontSize: 11, color: '#2d2520' }}>
                  <input type="checkbox" checked={props.selectedFileIds.includes(f.id) || props.selectedFileIds.length === 0} onChange={() => props.toggleKBFile(f.id)} style={{ width: 13, height: 13, accentColor: '#7c3aed' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.originalName}</span>
                </label>
              )) : <div style={{ fontSize: 11, color: '#9b8e84', textAlign: 'center', padding: 8 }}>暂无知识库文件</div>}
            </div>
          )}
        </div>
      )}
      {/* Plan/Action toggle */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <div style={{ display: 'inline-flex', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <button onClick={() => props.setWorkMode('plan')} style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: props.workMode === 'plan' ? 700 : 400, background: props.workMode === 'plan' ? 'rgba(22,163,74,0.12)' : 'transparent', color: props.workMode === 'plan' ? '#16a34a' : '#9b8e84', fontFamily: 'inherit' }}>Plan</button>
          <button onClick={() => props.setWorkMode('action')} style={{ padding: '4px 10px', border: 'none', borderLeft: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: 11, fontWeight: props.workMode === 'action' ? 700 : 400, background: props.workMode === 'action' ? 'rgba(217,119,6,0.12)' : 'transparent', color: props.workMode === 'action' ? '#d97706' : '#d4ccc4', fontFamily: 'inherit' }}>Action</button>
        </div>
      </div>
      {/* Temperature control */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 4px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff' }}
        title={`温度: ${props.temperature.toFixed(1)} — 越高回复越随机/有创意，越低越确定/保守`}>
        <button onClick={() => props.onTemperatureChange(-0.1)} style={{ padding: '1px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#9b8e84', fontFamily: 'inherit', lineHeight: 1 }}>-</button>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', minWidth: 36, textAlign: 'center', cursor: 'default' }}>
          {props.temperature.toFixed(1)}C
        </span>
        <button onClick={() => props.onTemperatureChange(0.1)} style={{ padding: '1px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#9b8e84', fontFamily: 'inherit', lineHeight: 1 }}>+</button>
      </div>
      <ToggleButton icon={<GlobeAltIcon style={{ width: 12, height: 12 }} />} label="联网搜索" active={props.webSearchEnabled} onClick={() => props.setWebSearchEnabled(!props.webSearchEnabled)} />
      <ToggleButton
        icon={<span style={{ fontSize: 12 }}>🔧</span>}
        label={`调用工具${props.conversationToolCount > 0 ? ` · ${props.conversationToolCount}` : ''}`}
        active={props.toolInvokeEnabled}
        onClick={() => props.setToolInvokeEnabled(!props.toolInvokeEnabled)}
      />
      {/* File upload */}
      <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.md,.text'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { const text = r.result as string; if (!text.trim()) return; props.setAttachment({ type: 'file', name: f.name, content: text.slice(0, 50000) }) }; r.readAsText(f, 'UTF-8') }; inp.click() }} title="上传文本文件" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: props.attachment?.type === 'file' ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)', background: props.attachment?.type === 'file' ? 'rgba(124,58,237,0.06)' : '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><DocumentTextIcon style={{ width: 11, height: 11 }} /> 文件</button>
      {/* Image upload */}
      <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { props.setAttachment({ type: 'image', name: f.name, content: `[上传图片: ${f.name}]`, previewUrl: r.result as string }) }; r.readAsDataURL(f) }; inp.click() }} title="上传图片" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: props.attachment?.type === 'image' ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)', background: props.attachment?.type === 'image' ? 'rgba(124,58,237,0.06)' : '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><PhotoIcon style={{ width: 11, height: 11 }} /> 图片</button>
      {/* Model switcher */}
      <select
        value={props.activeConfigId || ''}
        onChange={e => { if (e.target.value) props.onConfigChange(e.target.value) }}
        style={{ padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 10, color: '#4a3f38', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', maxWidth: 150 }}
        title="切换模型配置"
      >
        {props.configs.map(c => (
          <option key={c.id} value={c.id}>{c.model}</option>
        ))}
      </select>
    </div>
  )
}
