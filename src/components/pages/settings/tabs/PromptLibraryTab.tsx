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
import { inputStyle } from '@/components/common/styles'
import { logError } from '@/utils/logger'
import { FormField } from '../shared';

export function PromptLibraryTab() {
  const prompts = useSettingsStore(s => s.prompts)
  const addPrompt = useSettingsStore(s => s.addPrompt)
  const updatePrompt = useSettingsStore(s => s.updatePrompt)
  const removePrompt = useSettingsStore(s => s.removePrompt)
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleNew = () => {
    const newPrompt: PromptTemplate = {
      id: nanoid(8),
      title: '新模板',
      type: '章节',
      content: '',
      enabled: false,
    }
    addPrompt(newPrompt)
    setEditingId(newPrompt.id)
  }

  const handleToggleEnable = (id: string, type: PromptType) => {
    const prompt = prompts.find(p => p.id === id)
    if (!prompt) return
    if (!prompt.enabled) {
      // Disable all other prompts of the same type
      prompts.filter(p => p.type === type && p.id !== id && p.enabled).forEach(p => {
        updatePrompt(p.id, { enabled: false })
      })
    }
    updatePrompt(id, { enabled: !prompt.enabled })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>提示词模板</h3>
        <Button size="sm" onClick={handleNew} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>
          新建模板
        </Button>
      </div>

      <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {prompts.map(prompt => (
            <div
              key={prompt.id}
              style={{
                padding: 20,
                borderRadius: 20,
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <input
                type="text"
                value={prompt.title}
                onChange={e => updatePrompt(prompt.id, { title: e.target.value })}
                style={{
                  border: 'none',
                  borderBottom: '1px solid rgba(0,0,0,0.06)',
                  outline: 'none',
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#2d2520',
                  background: 'transparent',
                  padding: '0 0 6px',
                }}
                placeholder="标题"
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <select
                  value={prompt.type}
                  onChange={e => updatePrompt(prompt.id, { type: e.target.value as PromptType })}
                  style={{
                    padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)',
                    fontSize: 12, color: '#4a3f38', background: '#faf9f8', cursor: 'pointer', width: 'fit-content',
                  }}
                >
                  {PROMPT_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleToggleEnable(prompt.id, prompt.type)}
                  title={prompt.enabled ? '点击关闭（同类型只能启用一张）' : '点击启用'}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    border: prompt.enabled ? '1px solid rgba(124,58,237,0.3)' : '1px solid rgba(0,0,0,0.08)',
                    background: prompt.enabled ? 'rgba(124,58,237,0.08)' : 'transparent',
                    color: prompt.enabled ? '#7c3aed' : '#9b8e84',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {prompt.enabled ? '● 已启用' : '○ 关闭'}
                </button>
              </div>
              <textarea
                value={prompt.content}
                onChange={e => updatePrompt(prompt.id, { content: e.target.value })}
                className="custom-scrollbar"
                style={{
                  width: '100%',
                  border: '1px solid rgba(0,0,0,0.06)',
                  borderRadius: 10,
                  outline: 'none',
                  resize: 'vertical',
                  fontSize: 13,
                  lineHeight: 1.6,
                  fontFamily: 'inherit',
                  color: '#4a3f38',
                  background: '#faf9f8',
                  padding: 10,
                  minHeight: 120,
                }}
                placeholder="填写提示词内容..."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <Button variant="danger" size="sm" onClick={() => removePrompt(prompt.id)} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>
                  删除
                </Button>
                <Button size="sm">已自动保存</Button>
              </div>
            </div>
          ))}
        </div>
        {prompts.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#9b8e84' }}>
            <p style={{ fontSize: 14 }}>暂无提示词模板</p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// ====================== AI Settings Tab ======================
