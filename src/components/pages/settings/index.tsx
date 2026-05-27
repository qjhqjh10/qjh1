import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import type { SettingsTab } from './types'
import { formatContextWindow } from './constants'
import { ModelSettingsTab } from './tabs/ModelSettingsTab'
import { PromptLibraryTab } from './tabs/PromptLibraryTab'
import { AISettingsTab } from './tabs/AISettingsTab'
import { DisplaySettingsTab } from './tabs/DisplaySettingsTab'
import { TokenStatsTab } from './tabs/TokenStatsTab'
import { VersionTab } from './VersionTab'

export default function SystemSettingsPage() {
  const setActivePage = useStore(s => s.setActivePage)
  const [activeTab, setActiveTab] = useState<SettingsTab>('models')
  useEffect(() => { setActivePage('settings') }, [])

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px 0' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#2d2520', marginBottom: 16 }}>控制台配置</h2>
        {/* Tab nav */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid rgba(0,0,0,0.04)' }}>
          {([
            ['models', '模型设置'],
            ['prompts', '提示词库'],
            ['ai', 'AI写作助手'],
            ['display', '显示设置'],
            ['tokenstats', 'Token统计'],
            ['version', '版本更新'],
          ] as [SettingsTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 24px',
                border: 'none',
                background: 'transparent',
                fontSize: 14,
                fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? '#7c3aed' : '#6b5e54',
                borderBottom: activeTab === tab ? '2px solid #7c3aed' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -2,
                transition: 'all 0.15s ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: 24 }}>
        {activeTab === 'models' && <ModelSettingsTab />}
        {activeTab === 'prompts' && <PromptLibraryTab />}
        {activeTab === 'ai' && <AISettingsTab />}
        {activeTab === 'display' && <DisplaySettingsTab />}
        {activeTab === 'tokenstats' && <TokenStatsTab />}
        {activeTab === 'version' && <VersionTab />}
      </div>
    </div>
  )
}

export { formatContextWindow }
