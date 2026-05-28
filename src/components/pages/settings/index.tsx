import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/store'
import type { SettingsTab } from './types'
import { formatContextWindow } from './constants'
import { ModelSettingsTab } from './tabs/ModelSettingsTab'
import { PromptLibraryTab } from './tabs/PromptLibraryTab'
import { AISettingsTab } from './tabs/AISettingsTab'
import { DisplaySettingsTab } from './tabs/DisplaySettingsTab'
import { TokenStatsTab } from './tabs/TokenStatsTab'
import { AgentSettingsTab } from './tabs/AgentSettingsTab'
import { VersionTab } from './VersionTab'

const TABS: [SettingsTab, string][] = [
  ['models', '模型设置'],
  ['prompts', '提示词库'],
  ['ai', 'AI写作助手'],
  ['display', '显示设置'],
  ['tokenstats', 'Token统计'],
  ['agent', 'Agent'],
  ['version', '版本更新'],
]

export default function SystemSettingsPage() {
  const setActivePage = useStore(s => s.setActivePage)
  const [activeTab, setActiveTab] = useState<SettingsTab>('models')
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0 })
  const tabRefs = useRef<Map<SettingsTab, HTMLButtonElement>>(new Map())

  useEffect(() => { setActivePage('settings') }, [])

  // Animated underline
  useEffect(() => {
    const el = tabRefs.current.get(activeTab)
    if (el) {
      const parent = el.parentElement
      if (parent) {
        const parentRect = parent.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        setUnderlineStyle({
          left: elRect.left - parentRect.left,
          width: elRect.width,
        })
      }
    }
  }, [activeTab])

  return (
    <div className="page-enter" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px 0' }}>
        <h2 style={{
          fontSize: 22, fontWeight: 700, marginBottom: 16,
          background: 'linear-gradient(135deg, #2d2520 0%, #6b5e54 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          控制台配置
        </h2>
        {/* Tab nav */}
        <div style={{ display: 'flex', gap: 2, position: 'relative', borderBottom: '2px solid rgba(0,0,0,0.04)' }}>
          {TABS.map(([tab, label]) => (
            <button
              key={tab}
              ref={el => { if (el) tabRefs.current.set(tab, el) }}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 20px',
                border: 'none',
                background: 'transparent',
                fontSize: 13,
                fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? '#7c3aed' : '#6b5e54',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                position: 'relative',
              }}
              onMouseEnter={e => {
                if (activeTab !== tab) e.currentTarget.style.color = '#4a3f38'
              }}
              onMouseLeave={e => {
                if (activeTab !== tab) e.currentTarget.style.color = '#6b5e54'
              }}
            >
              {label}
            </button>
          ))}
          {/* Animated underline */}
          <span style={{
            position: 'absolute',
            bottom: -2,
            left: underlineStyle.left,
            width: underlineStyle.width,
            height: 2,
            background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
            borderRadius: 1,
            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }} />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: 24 }}>
        {activeTab === 'models' && <ModelSettingsTab />}
        {activeTab === 'prompts' && <PromptLibraryTab />}
        {activeTab === 'ai' && <AISettingsTab />}
        {activeTab === 'display' && <DisplaySettingsTab />}
        {activeTab === 'tokenstats' && <TokenStatsTab />}
        {activeTab === 'agent' && <AgentSettingsTab />}
        {activeTab === 'version' && <VersionTab />}
      </div>
    </div>
  )
}

export { formatContextWindow }
