import { useSettingsStore } from '@/store'
import { FormField } from '../shared'
import { inputStyle } from '@/components/common/styles'
import { THEMES, getThemeIds } from '@/themes'
import type { ThemeId } from '@/types/settings'

export function DisplaySettingsTab() {
  const displaySettings = useSettingsStore(s => s.displaySettings)
  const setDisplaySettings = useSettingsStore(s => s.setDisplaySettings)

  const items: { key: keyof Omit<typeof displaySettings, 'theme'>; label: string; options: string[] }[] = [
    { key: 'sidebarFontSize', label: '侧边栏文字', options: ['12px', '13px', '14px', '15px', '16px'] },
    { key: 'cardTitleFontSize', label: '卡片标题', options: ['14px', '15px', '16px', '17px', '18px'] },
    { key: 'buttonFontSize', label: '按钮文字', options: ['13px', '14px', '15px', '16px', '17px'] },
    { key: 'editorFontSize', label: '编辑器内容', options: ['14px', '16px', '18px', '20px', '22px'] },
    { key: 'toolbarFontSize', label: '工具栏按钮', options: ['11px', '12px', '13px', '14px'] },
  ]

  const themeIds = getThemeIds()

  return (
    <div className="custom-scrollbar page-enter" style={{ overflowY: 'auto', paddingRight: 16, height: '100%' }}>
      {/* Theme Selection */}
      <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#2d2520' }}>视觉风格</h4>
        <p style={{ fontSize: 11, color: '#9b8e84', marginBottom: 16 }}>选择你喜欢的主题风格，切换后立即生效</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {themeIds.map(id => {
            const theme = THEMES[id]
            const isActive = displaySettings.theme === id
            return (
              <div
                key={id}
                onClick={() => setDisplaySettings({ theme: id as ThemeId })}
                style={{
                  padding: 14, borderRadius: 14, cursor: 'pointer',
                  border: isActive ? `2px solid ${theme.colors.accent}` : '2px solid rgba(0,0,0,0.06)',
                  background: isActive ? `${theme.colors.accentBg}` : 'rgba(255,255,255,0.5)',
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? `0 0 12px ${theme.colors.accentGlow}` : 'none',
                }}
              >
                {/* Preview gradient */}
                <div style={{
                  height: 40, borderRadius: 8, marginBottom: 10,
                  background: theme.preview,
                  border: '1px solid rgba(0,0,0,0.06)',
                }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2520', marginBottom: 2 }}>
                  {theme.name}
                </div>
                <div style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.4 }}>
                  {theme.description}
                </div>
                {/* Color swatches */}
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  {[theme.colors.accent, theme.colors.textPrimary, theme.colors.bgSurface, theme.colors.success, theme.colors.warning].map((c, i) => (
                    <div key={i} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid rgba(0,0,0,0.1)' }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Font Size Settings */}
      <div className="stagger-item" style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)', marginTop: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>字体大小设置</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {items.map(item => (
            <FormField key={item.key} label={`${item.label} (${displaySettings[item.key]})`}>
              <select
                value={displaySettings[item.key]}
                onChange={e => setDisplaySettings({ [item.key]: e.target.value })}
                className="focus-ring"
                style={{ ...inputStyle, cursor: 'pointer', width: '100%' }}
              >
                {item.options.map(s => <option key={s} value={s}>{s.replace('px', '')}</option>)}
              </select>
            </FormField>
          ))}
        </div>
      </div>
    </div>
  )
}
