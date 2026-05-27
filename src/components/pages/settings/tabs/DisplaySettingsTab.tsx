import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { settingsService, aiService, statsService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { PlusIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import type { ModelConfig, PromptTemplate, PromptType, AIAssistantSettings } from '@/types/settings'
import type { UsageResult } from '@/types/electron'
import { PROMPT_TYPES, DEFAULT_MODEL_CONFIG, DEFAULT_AI_SETTINGS, PROVIDER_PRESETS } from '@/types/settings'
import { FormField } from '../shared';
import { inputStyle } from '@/components/common/styles'
import { logError } from '@/utils/logger'

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

  return (
    <div className="custom-scrollbar" style={{ overflowY: 'auto', paddingRight: 16, height: '100%' }}>
      <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>外观设置</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="深色模式">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#4a3f38' }}>
              <input
                type="checkbox"
                checked={displaySettings.theme === 'dark'}
                onChange={e => setDisplaySettings({ theme: e.target.checked ? 'dark' : 'light' })}
                style={{ width: 18, height: 18, accentColor: '#7c3aed', cursor: 'pointer' }}
              />
              {displaySettings.theme === 'dark' ? '已开启深色模式' : '已关闭深色模式'}
            </label>
          </FormField>
        </div>
      </div>

      <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)', marginTop: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>字体大小设置</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {items.map(item => (
            <FormField key={item.key} label={`${item.label} (${displaySettings[item.key]})`}>
              <select
                value={displaySettings[item.key]}
                onChange={e => setDisplaySettings({ [item.key]: e.target.value })}
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

// ====================== Token Stats Tab ======================
