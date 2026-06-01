import { useState } from 'react'
import { FeedbackSection } from './agent/FeedbackSection'
import { ReliabilitySection } from './agent/ReliabilitySection'
import { MCPSection } from './agent/MCPSection'
import { LearningSection } from './agent/LearningSection'

type AgentSubTab = 'feedback' | 'reliability' | 'mcp' | 'learning'

const SUB_TABS: [AgentSubTab, string, string][] = [
  ['feedback', '自我优化', '🔧'],
  ['reliability', '可靠性', '🛡️'],
  ['learning', '学习', '📝'],
  ['mcp', 'MCP', '🔌'],
]

export function AgentSettingsTab() {
  const [activeSubTab, setActiveSubTab] = useState<AgentSubTab>('feedback')

  return (
    <div style={{
      padding: 20, borderRadius: 20,
      background: 'rgba(255,255,255,0.6)',
      border: '1px solid rgba(0,0,0,0.05)',
      display: 'flex', flexDirection: 'column', height: '100%',
      backdropFilter: 'blur(12px)',
    }}>
      <h4 style={{
        fontSize: 15, fontWeight: 700, marginBottom: 14, color: '#2d2520',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          width: 24, height: 24, borderRadius: 8,
          background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, color: '#fff',
        }}>A</span>
        Agent 引擎
      </h4>

      {/* Sub-tab nav */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, flexWrap: 'wrap', padding: '3px', borderRadius: 12, background: 'rgba(0,0,0,0.02)' }}>
        {SUB_TABS.map(([tab, label, icon]) => {
          const active = activeSubTab === tab
          return (
            <button
              key={tab}
              onClick={() => setActiveSubTab(tab)}
              style={{
                padding: '6px 14px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                background: active ? '#fff' : 'transparent',
                color: active ? '#7c3aed' : '#6b5e54',
                fontWeight: active ? 600 : 400,
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span style={{ fontSize: 11 }}>{icon}</span>
              {label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', animation: 'fadeInUp 0.25s ease-out' }} className="custom-scrollbar" key={activeSubTab}>
        {activeSubTab === 'feedback' && <FeedbackSection />}
        {activeSubTab === 'reliability' && <ReliabilitySection />}
        {activeSubTab === 'mcp' && <MCPSection />}
        {activeSubTab === 'learning' && <LearningSection />}
      </div>
    </div>
  )
}
