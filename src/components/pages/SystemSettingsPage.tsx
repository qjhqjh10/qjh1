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
import { FormField, StatCard } from './settings/shared'
import { VersionTab } from './settings/VersionTab'

type SettingsTab = 'models' | 'prompts' | 'ai' | 'display' | 'tokenstats' | 'version'

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

function formatContextWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}

function ModelSettingsTab() {
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const addConfig = useSettingsStore(s => s.addConfig)
  const updateConfig = useSettingsStore(s => s.updateConfig)
  const removeConfig = useSettingsStore(s => s.removeConfig)
  const setActiveConfig = useSettingsStore(s => s.setActiveConfig)

  const [modelList, setModelList] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeConfig = configs.find(c => c.id === activeConfigId)

  const [savedAt, setSavedAt] = useState(0)

  // Sync configs to main process whenever they change (debounced)
  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      settingsService.saveConfigs(configs).then(() => setSavedAt(Date.now())).catch((e) => logError('Config sync failed', e))
    }, 600)
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [configs])

  // Clear save indicator after 3s
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(0), 3000)
    return () => clearTimeout(t)
  }, [savedAt])

  const handleNew = () => {
    const newConfig: ModelConfig = {
      ...DEFAULT_MODEL_CONFIG,
      id: nanoid(8),
      name: `设置 ${configs.length + 1}`,
    }
    addConfig(newConfig)
    setActiveConfig(newConfig.id)
  }

  const handleDelete = (id: string) => {
    removeConfig(id)
  }

  const handleRefreshModels = useCallback(async () => {
    if (!activeConfig || !activeConfig.apiUrl || !activeConfig.apiKey) return
    setLoadingModels(true)
    try {
      // Sync current config to main process first
      await settingsService.saveConfigs(configs)
      const models = await aiService.listModels(activeConfig.id)
      setModelList(models)
      setShowModelDropdown(true)
    } catch (err) {
      logError('Failed to fetch models', err)
    }
    setLoadingModels(false)
  }, [activeConfig, configs])

  const handleSelectModel = (model: string) => {
    if (activeConfig) {
      updateConfig(activeConfig.id, { model })
    }
    setShowModelDropdown(false)
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (!showModelDropdown) return
    const close = () => setShowModelDropdown(false)
    document.addEventListener('click', close, { once: true })
    return () => document.removeEventListener('click', close)
  }, [showModelDropdown])

  return (
    <div style={{ display: 'flex', height: '100%', gap: 24 }}>
      {/* Left: Template list */}
      <div style={{ width: '40%', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520' }}>设置模板列表</h3>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <Button size="sm" onClick={handleNew} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>新建设置</Button>
          {activeConfigId && (
            <Button size="sm" variant="danger" onClick={() => handleDelete(activeConfigId)} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>
              删除
            </Button>
          )}
        </div>
        <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {configs.map(config => (
              <button
                key={config.id}
                onClick={() => setActiveConfig(config.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: 'none',
                  background: activeConfigId === config.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                  color: activeConfigId === config.id ? '#7c3aed' : '#4a3f38',
                  fontSize: 13,
                  fontWeight: activeConfigId === config.id ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {config.name}
                <div style={{ fontSize: 11, color: '#9b8e84', marginTop: 2 }}>{config.model}</div>
              </button>
            ))}
            {configs.length === 0 && (
              <div style={{ padding: 12, textAlign: 'center', color: '#9b8e84', fontSize: 12 }}>
                暂无设置，点击"新建设置"
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Config form (60%) */}
      {activeConfig ? (
        <div style={{ width: '60%', overflow: 'hidden' }} className="custom-scrollbar">
          <ScrollArea maxHeight="100%" style={{ paddingRight: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Save indicator */}
              {savedAt > 0 && (
                <div style={{ padding: '6px 14px', borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', color: '#16a34a', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
                  ✓ 已保存至本地
                </div>
              )}
              {/* Basic config */}
              <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>基础配置区</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <FormField label="服务商">
                    <select
                      value={PROVIDER_PRESETS.some(p => p.name === activeConfig.provider) ? activeConfig.provider : '__custom__'}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '__custom__') return
                        const preset = PROVIDER_PRESETS.find(p => p.name === v)
                        updateConfig(activeConfig.id, {
                          provider: v,
                          apiUrl: preset ? preset.apiUrl : activeConfig.apiUrl,
                        })
                      }}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      <option value="">-- 选择服务商 --</option>
                      {PROVIDER_PRESETS.map(p => (
                        <option key={p.name} value={p.name}>{p.label}</option>
                      ))}
                      <option value="__custom__">自定义...</option>
                    </select>
                    {!PROVIDER_PRESETS.some(p => p.name === activeConfig.provider) && activeConfig.provider && (
                      <input
                        type="text"
                        value={activeConfig.provider}
                        onChange={e => updateConfig(activeConfig.id, { provider: e.target.value })}
                        style={{ ...inputStyle, marginTop: 6 }}
                        placeholder="输入服务商名称"
                      />
                    )}
                  </FormField>
                  <FormField label="接口地址">
                    <input
                      type="text"
                      value={activeConfig.apiUrl}
                      onChange={e => updateConfig(activeConfig.id, { apiUrl: e.target.value })}
                      style={inputStyle}
                      placeholder="https://api.openai.com/v1"
                    />
                  </FormField>
                  <FormField label="API密钥">
                    <input
                      type="password"
                      value={activeConfig.apiKey}
                      onChange={e => updateConfig(activeConfig.id, { apiKey: e.target.value })}
                      style={inputStyle}
                      placeholder="sk-..."
                    />
                  </FormField>
                  <FormField label="选择模型">
                    <div style={{ position: 'relative' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="text"
                          value={activeConfig.model}
                          onChange={e => updateConfig(activeConfig.id, { model: e.target.value })}
                          onFocus={() => modelList.length > 0 && setShowModelDropdown(true)}
                          style={{ ...inputStyle, flex: 1 }}
                          placeholder="gpt-4o"
                        />
                        <button
                          title="刷新模型列表"
                          onClick={handleRefreshModels}
                          disabled={loadingModels}
                          style={{
                            padding: 8,
                            borderRadius: 10,
                            border: '1px solid rgba(0,0,0,0.08)',
                            background: '#fff',
                            cursor: loadingModels ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: loadingModels ? 0.5 : 1,
                          }}
                        >
                          <ArrowPathIcon style={{ width: 16, height: 16, color: '#6b5e54' }} />
                        </button>
                      </div>
                      {/* Model dropdown */}
                      {showModelDropdown && modelList.length > 0 && (
                        <div
                          className="custom-scrollbar"
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            maxHeight: 240,
                            overflowY: 'auto',
                            background: '#fff',
                            borderRadius: 12,
                            border: '1px solid rgba(0,0,0,0.1)',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                            zIndex: 20,
                            marginTop: 4,
                          }}
                        >
                          {modelList.map(m => (
                            <button
                              key={m}
                              onClick={(e) => { e.stopPropagation(); handleSelectModel(m) }}
                              style={{
                                width: '100%',
                                textAlign: 'left',
                                padding: '10px 14px',
                                border: 'none',
                                background: activeConfig.model === m ? 'rgba(124,58,237,0.06)' : 'transparent',
                                color: activeConfig.model === m ? '#7c3aed' : '#4a3f38',
                                fontSize: 13,
                                fontWeight: activeConfig.model === m ? 600 : 400,
                                cursor: 'pointer',
                                borderBottom: '1px solid rgba(0,0,0,0.04)',
                              }}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </FormField>
                  <FormField label="Embedding模型">
                    <input
                      type="text"
                      value={activeConfig.embeddingModel || 'text-embedding-3-small'}
                      onChange={e => updateConfig(activeConfig.id, { embeddingModel: e.target.value })}
                      style={inputStyle}
                      placeholder="text-embedding-3-small"
                    />
                  </FormField>
                </div>
              </div>

              {/* Advanced config */}
              <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>高级参数设置区</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <FormField label={`温度控制 (${activeConfig.temperature.toFixed(1)})`}>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={activeConfig.temperature}
                      onChange={e => updateConfig(activeConfig.id, { temperature: parseFloat(e.target.value) })}
                      onMouseUp={() => settingsService.saveConfigs(useSettingsStore.getState().configs)}
                      onTouchEnd={() => settingsService.saveConfigs(useSettingsStore.getState().configs)}
                      style={{ width: '100%', accentColor: '#7c3aed' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9b8e84' }}>
                      <span>精确</span>
                      <span>创造</span>
                    </div>
                  </FormField>
                  <FormField label="最大输出令牌 (0=由大模型决定)">
                    <input
                      type="number"
                      min="0"
                      value={activeConfig.maxTokens}
                      onChange={e => updateConfig(activeConfig.id, { maxTokens: parseInt(e.target.value) || 0 })}
                      style={inputStyle}
                    />
                  </FormField>
                  <FormField label={`上下文窗口大小 (${formatContextWindow(activeConfig.contextWindow ?? 128000)})`}>
                    <input
                      type="number"
                      min="1000"
                      step="1000"
                      value={activeConfig.contextWindow ?? 128000}
                      onChange={e => updateConfig(activeConfig.id, { contextWindow: parseInt(e.target.value) || 128000 })}
                      style={inputStyle}
                      placeholder="128000"
                    />
                    <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>模型总上下文容量（影响用量条上限）。常见：GPT-4o=128K，Claude=200K，DeepSeek V4=1M</div>
                  </FormField>
                  <FormField label="推理深度 (reasoning_effort)">
                    <select
                      value={activeConfig.reasoningEffort || ''}
                      onChange={e => updateConfig(activeConfig.id, { reasoningEffort: (e.target.value || undefined) as any })}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      <option value="">默认（不设置，兼容所有模型）</option>
                      <option value="min">min — 最低推理</option>
                      <option value="low">low — 低推理</option>
                      <option value="medium">medium — 中等推理</option>
                      <option value="high">high — 高推理</option>
                      <option value="max">max — 最强推理（DeepSeek Pro 推荐）</option>
                    </select>
                    <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>仅 DeepSeek Pro / OpenAI o 系列支持。设为空则不传此参数，兼容所有模型。</div>
                  </FormField>
                  <FormField label="系统提示词">
                    <textarea
                      value={activeConfig.systemPrompt}
                      onChange={e => updateConfig(activeConfig.id, { systemPrompt: e.target.value })}
                      style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                      placeholder="系统提示词..."
                    />
                  </FormField>
                  <div style={{ paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54' }}>价格设置 (每百万 Token)</div>
                      <select
                        value={activeConfig.currency || 'USD'}
                        onChange={e => updateConfig(activeConfig.id, { currency: e.target.value as 'USD' | 'CNY' })}
                        style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        <option value="USD">US Dollar ($)</option>
                        <option value="CNY">人民币 (¥)</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>输入价格 ({activeConfig.currency === 'CNY' ? '¥' : '$'})</label>
                        <input type="number" step="0.01" min="0" value={activeConfig.inputPricePerM ?? 2.50} onChange={e => updateConfig(activeConfig.id, { inputPricePerM: parseFloat(e.target.value) || 0 })} style={inputStyle} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>缓存命中 ({activeConfig.currency === 'CNY' ? '¥' : '$'})</label>
                        <input type="number" step="0.01" min="0" value={activeConfig.cacheHitPricePerM ?? 1.25} onChange={e => updateConfig(activeConfig.id, { cacheHitPricePerM: parseFloat(e.target.value) || 0 })} style={inputStyle} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>输出价格 ({activeConfig.currency === 'CNY' ? '¥' : '$'})</label>
                        <input type="number" step="0.01" min="0" value={activeConfig.outputPricePerM ?? 10.00} onChange={e => updateConfig(activeConfig.id, { outputPricePerM: parseFloat(e.target.value) || 0 })} style={inputStyle} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 14 }}>
          {configs.length > 0 ? '选择左侧设置模板' : '点击"新建设置"创建配置'}
        </div>
      )}
    </div>
  )
}

function PromptLibraryTab() {
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

function AISettingsTab() {
  const aiSettings = useSettingsStore(s => ({ ...DEFAULT_AI_SETTINGS, ...s.aiSettings }))
  const setAISettings = useSettingsStore(s => s.setAISettings)

  const update = (k: keyof AIAssistantSettings, v: unknown) => setAISettings({ [k]: v })

  return (
    <div className="custom-scrollbar" style={{ overflowY: 'auto', paddingRight: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 能力总览面板 */}
        <div style={{ padding: 20, borderRadius: 20, background: 'linear-gradient(135deg, rgba(124,58,237,0.04), rgba(59,130,246,0.04))', border: '1px solid rgba(124,58,237,0.12)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: '#7c3aed' }}>AI 写作助手能力总览</h4>
          <p style={{ fontSize: 11, color: '#9b8e84', marginBottom: 14 }}>你的 AI 助手具备以下能力，覆盖写作全流程</p>

          {/* 工具清单 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b5e54', marginBottom: 8 }}>13 个文件操作工具</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[
                { n: 'list_directory', t: '只读' }, { n: 'read_file', t: '只读' }, { n: 'search_files', t: '只读' },
                { n: 'search_content', t: '只读' },
                { n: 'edit_file', t: '预览确认' },
                { n: 'create_file', t: '需确认' }, { n: 'delete_file', t: '需确认' },
                { n: 'rename_file', t: '需确认' },
                { n: 'create_project', t: '需确认' }, { n: 'delete_project', t: '需确认' },
                { n: 'kb_index_file', t: '自动' },
              ].map(t => (
                <span key={t.n} title={t.n} style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10,
                  background: t.t === '只读' ? 'rgba(16,185,129,0.06)' : t.t === '需确认' ? 'rgba(245,158,11,0.06)' : t.t === '预览确认' ? 'rgba(59,130,246,0.06)' : 'rgba(124,58,237,0.04)',
                  color: t.t === '只读' ? '#16a34a' : t.t === '需确认' ? '#d97706' : t.t === '预览确认' ? '#3b82f6' : '#7c3aed',
                  fontWeight: 600, cursor: 'default',
                }}>{t.n}</span>
              ))}
            </div>
          </div>

          {/* 工作模式 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b5e54', marginBottom: 6 }}>2 种工作模式</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, padding: '8px 12px', borderRadius: 10, background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#16a34a' }}>Plan 分析</span>
                <p style={{ fontSize: 10, color: '#6b5e54', margin: '4px 0 0' }}>仅只读工具，安全探索项目</p>
              </div>
              <div style={{ flex: 1, padding: '8px 12px', borderRadius: 10, background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.1)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#d97706' }}>Action 执行</span>
                <p style={{ fontSize: 10, color: '#6b5e54', margin: '4px 0 0' }}>全部工具，可修改文件</p>
              </div>
            </div>
          </div>

          {/* 内嵌命令 + 页面覆盖 */}
          <div style={{ display: 'flex', gap: 16, fontSize: 10, color: '#9b8e84' }}>
            <span>6 个内嵌命令（分析/检查/创建/统计/备份）</span>
            <span>10 个页面数据上下文注入</span>
            <span>编辑预览 DiffView</span>
            <span>一键回滚撤销</span>
          </div>
        </div>

        {/* AI Dialogue */}
        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>AI 对话设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="工作模式">
              <select value={aiSettings.workMode || 'action'} onChange={e => update('workMode', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="plan">Plan 分析 — 仅可读取搜索，不可修改文件</option>
                <option value="action">Action 执行 — 全部工具可用，可修改文件</option>
              </select>
              <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 4 }}>聊天窗口中也可随时切换。Plan 模式安全无风险。</div>
            </FormField>
            <FormField label="默认角色">
              <select value={aiSettings.defaultRole} onChange={e => update('defaultRole', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {aiSettings.customRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </FormField>
            <div style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>自定义角色 (可增删改)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {aiSettings.customRoles.map((role, idx) => (
                  <div key={role.id} style={{ padding: '8px 10px', borderRadius: 8, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                      <input value={role.name} onChange={e => {
                        const roles = [...aiSettings.customRoles]
                        roles[idx] = { ...roles[idx], name: e.target.value }
                        update('customRoles', roles)
                      }} style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }} placeholder="角色名称" />
                      <button onClick={() => {
                        const deleted = aiSettings.customRoles[idx]
                        const remaining = aiSettings.customRoles.filter((_, i) => i !== idx)
                        update('customRoles', remaining)
                        // Reset defaultRole if deleted
                        if (aiSettings.defaultRole === deleted.id && remaining.length > 0) {
                          update('defaultRole', remaining[0].id)
                        }
                      }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 4 }}>
                        <TrashIcon style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                    <textarea value={role.prompt} onChange={e => {
                      const roles = [...aiSettings.customRoles]
                      roles[idx] = { ...roles[idx], prompt: e.target.value }
                      update('customRoles', roles)
                    }} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.06)', fontSize: 11, fontFamily: 'inherit', resize: 'vertical', minHeight: 50 }} placeholder="角色系统提示词..." />
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => {
                  const roles = [...aiSettings.customRoles, { id: `role_${Date.now()}`, name: '新角色', prompt: '' }]
                  update('customRoles', roles)
                }} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>添加角色</Button>
              </div>
            </div>
            <FormField label="回复风格">
              <select value={aiSettings.responseStyle} onChange={e => update('responseStyle', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {[{ v: 'concise', l: '简洁' }, { v: 'normal', l: '标准' }, { v: 'detailed', l: '详细' }].map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </FormField>
            <FormField label="自动应用到编辑器">
              <input type="checkbox" checked={aiSettings.autoApply} onChange={e => update('autoApply', e.target.checked)} />
            </FormField>
          </div>
        </div>

        {/* Conversation History */}
        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>对话上下文</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label={`对话历史保留条数 (${aiSettings.maxHistory ?? 100})`}>
              <input type="range" min={10} max={500} step={10}
                value={aiSettings.maxHistory ?? 100}
                onChange={e => update('maxHistory', parseInt(e.target.value))}
                style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9b8e84', marginTop: 2 }}>
                <span>10</span><span>500</span>
              </div>
            </FormField>
            <FormField label={`工具结果保留轮数 (${aiSettings.toolRetentionRounds ?? 3})`}>
              <input type="range" min={0} max={10} step={1}
                value={aiSettings.toolRetentionRounds ?? 3}
                onChange={e => update('toolRetentionRounds', parseInt(e.target.value))}
                style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9b8e84', marginTop: 2 }}>
                <span>0 (不保留)</span><span>10</span>
              </div>
            </FormField>
            <FormField label={`核心规则复述间隔 (${aiSettings.rulesRefreshInterval ?? 31})`}>
              <input type="range" min={0} max={100} step={5}
                value={aiSettings.rulesRefreshInterval ?? 31}
                onChange={e => update('rulesRefreshInterval', parseInt(e.target.value))}
                style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9b8e84', marginTop: 2 }}>
                <span>0 (不重复)</span><span>100</span>
              </div>
            </FormField>
          </div>
        </div>

        {/* Context Priority */}
        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>信息调用优先级</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="参考信息优先顺序">
              <select value={aiSettings.contextPriority} onChange={e => update('contextPriority', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="balanced">均衡 — 知识库 + 模型 + 搜索</option>
                <option value="kb-first">知识库优先 — 以知识库为准，模型补充</option>
                <option value="model-first">模型优先 — 以模型知识为准，知识库参考</option>
              </select>
            </FormField>
            <div style={{ fontSize: 11, color: '#9b8e84', lineHeight: 1.6 }}>
              {aiSettings.contextPriority === 'kb-first' && '知识库检索结果放在最前，指示 AI 优先参考知识库信息。适合需要依据设定集、资料库创作的场景。'}
              {aiSettings.contextPriority === 'model-first' && '减少知识库上下文的权重，让 AI 更多依靠自身知识。适合知识库内容可能触发安全策略的场景。'}
              {aiSettings.contextPriority === 'balanced' && '知识库、模型知识、网络搜索平等参与。适合大多数场景。'}
            </div>
          </div>
        </div>

        {/* Web Search */}
        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>界面设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="显示新会话欢迎信息">
              <input type="checkbox" checked={aiSettings.showWelcome !== false} onChange={e => update('showWelcome', e.target.checked)} />
            </FormField>
          </div>

          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, marginTop: 24, color: '#2d2520' }}>联网搜索设置</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="默认开启联网搜索">
              <input type="checkbox" checked={aiSettings.webSearchDefault} onChange={e => update('webSearchDefault', e.target.checked)} />
            </FormField>
            <FormField label={`搜索结果数量 (${aiSettings.searchResultCount})`}>
              <input type="range" min={1} max={10} value={aiSettings.searchResultCount} onChange={e => update('searchResultCount', parseInt(e.target.value))} style={{ width: '100%' }} />
            </FormField>
            <FormField label="安全搜索">
              <select value={aiSettings.safeSearch} onChange={e => update('safeSearch', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {[{ v: 'strict', l: '严格' }, { v: 'moderate', l: '中等' }, { v: 'off', l: '关闭' }].map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </FormField>
          </div>
        </div>

        {/* Priority Sites */}
        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>优先搜索网站</h4>
          <div style={{ marginBottom: 12 }}>
            <Button size="sm" onClick={() => {
              const id = nanoid()
              setAISettings({ prioritySites: [...aiSettings.prioritySites, { id, url: '', description: '', category: '百科' }] })
            }} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>添加网址</Button>
          </div>
          {aiSettings.prioritySites.map((site, i) => (
            <div key={site.id} style={{ padding: 12, borderRadius: 12, background: '#faf9f8', border: '1px solid rgba(0,0,0,0.04)', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={site.url} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], url: e.target.value }
                setAISettings({ prioritySites: sites })
              }} placeholder="网址 (如 zh.wikipedia.org)" style={{ ...inputStyle, flex: 2 }} />
              <input value={site.description} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], description: e.target.value }
                setAISettings({ prioritySites: sites })
              }} placeholder="描述" style={{ ...inputStyle, flex: 1 }} />
              <select value={site.category} onChange={e => {
                const sites = [...aiSettings.prioritySites]
                sites[i] = { ...sites[i], category: e.target.value }
                setAISettings({ prioritySites: sites })
              }} style={{ ...inputStyle, cursor: 'pointer', width: 100 }}>
                {['文学', '百科', '社区', '资料', '其他'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button variant="danger" size="sm" onClick={() => {
                setAISettings({ prioritySites: aiSettings.prioritySites.filter(s => s.id !== site.id) })
              }} icon={<TrashIcon style={{ width: 14, height: 14 }} />}>删除</Button>
            </div>
          ))}
        </div>

        {/* Budget */}
        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>月度预算预警</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="月度预算上限 ($)">
              <input type="number" min={0} step={0.01} value={aiSettings.monthlyBudget} onChange={e => update('monthlyBudget', parseFloat(e.target.value) || 0)} style={inputStyle} placeholder="0=不限" />
            </FormField>
            <FormField label="启用预算预警">
              <input type="checkbox" checked={aiSettings.budgetWarning} onChange={e => update('budgetWarning', e.target.checked)} />
            </FormField>
          </div>
        </div>

        {/* Avatar Settings */}
        <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>会话头像</h4>
          <div style={{ display: 'flex', gap: 24 }}>
            {/* User Avatar */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#6b5e54' }}>你的头像</span>
              <div onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => { const f = i.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => update('userAvatar', r.result as string); r.readAsDataURL(f) }; i.click() }}
                style={{ width: 56, height: 56, borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', border: '2px dashed rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.02)' }}>
                {aiSettings.userAvatar
                  ? <img src={aiSettings.userAvatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 22 }}>✍️</span>}
              </div>
              {aiSettings.userAvatar && (
                <button onClick={() => update('userAvatar', '')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#ef4444', fontFamily: 'inherit' }}>清除</button>
              )}
            </div>
            {/* Assistant Avatar */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#6b5e54' }}>AI 头像</span>
              <div onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => { const f = i.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => update('assistantAvatar', r.result as string); r.readAsDataURL(f) }; i.click() }}
                style={{ width: 56, height: 56, borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', border: '2px dashed rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.02)' }}>
                {aiSettings.assistantAvatar
                  ? <img src={aiSettings.assistantAvatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 22 }}>📖</span>}
              </div>
              {aiSettings.assistantAvatar && (
                <button onClick={() => update('assistantAvatar', '')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#ef4444', fontFamily: 'inherit' }}>清除</button>
              )}
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: '#9b8e84' }}>点击头像可上传图片。上传后会话中的头像将替换为你的自定义图片。留空使用默认emoji。</div>
        </div>
      </div>
    </div>
  )
}

// ====================== Display Settings Tab ======================

function DisplaySettingsTab() {
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

function TokenStatsTab() {
  const activeProjectId = useStore(s => s.activeProjectId)
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const aiSettings = useSettingsStore(s => s.aiSettings)
  const currency = configs.find(c => c.id === activeConfigId)?.currency || 'USD'
  const cSym = currency === 'CNY' ? '¥' : '$'
  const [usage, setUsage] = useState<UsageResult | null>(null)

  const [filterConfigId, setFilterConfigId] = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [filterYear, setFilterYear] = useState<number | undefined>(undefined)
  const [filterMonth, setFilterMonth] = useState<number | undefined>(undefined)
  const [filterDay, setFilterDay] = useState<number | undefined>(undefined)
  const [viewMode, setViewMode] = useState<'summary' | 'byDay' | 'byConfig'>('summary')
  const [showDetail, setShowDetail] = useState(false)

  useEffect(() => {
    const opts: Record<string, unknown> = {}
    if (activeProjectId) opts.projectId = activeProjectId
    if (filterConfigId) opts.configId = filterConfigId
    if (filterModel) opts.model = filterModel
    if (filterYear !== undefined) opts.year = filterYear
    if (filterMonth !== undefined) opts.month = filterMonth
    if (filterDay !== undefined) opts.day = filterDay
    statsService.getUsage(opts).then(data => setUsage(data)).catch(() => {})
  }, [activeProjectId, filterConfigId, filterModel, filterYear, filterMonth, filterDay])

  const totals = usage?.totals
  const models = [...new Set(configs.map(c => c.model))]
  const years = [new Date().getFullYear(), new Date().getFullYear() - 1]
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const days = Array.from({ length: 31 }, (_, i) => i + 1)

  return (
    <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }} className="custom-scrollbar" >
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>Token 用量统计</h4>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterConfigId} onChange={e => setFilterConfigId(e.target.value)} style={miniSelect}>
          <option value="">全部配置</option>
          {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterModel} onChange={e => setFilterModel(e.target.value)} style={miniSelect}>
          <option value="">全部模型</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterYear ?? ''} onChange={e => { setFilterYear(e.target.value ? parseInt(e.target.value) : undefined); setFilterMonth(undefined); setFilterDay(undefined) }} style={miniSelect}>
          <option value="">全部年份</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterMonth ?? ''} onChange={e => { setFilterMonth(e.target.value ? parseInt(e.target.value) : undefined); setFilterDay(undefined) }} disabled={!filterYear} style={miniSelect}>
          <option value="">全部月份</option>
          {months.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <select value={filterDay ?? ''} onChange={e => setFilterDay(e.target.value ? parseInt(e.target.value) : undefined)} disabled={!filterMonth} style={miniSelect}>
          <option value="">全部日期</option>
          {days.map(d => <option key={d} value={d}>{d}日</option>)}
        </select>
        <button onClick={() => { setFilterConfigId(''); setFilterModel(''); setFilterYear(undefined); setFilterMonth(undefined); setFilterDay(undefined) }} style={{ ...miniSelect, cursor: 'pointer', border: 'none', background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>重置</button>
      </div>

      {/* View mode tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['summary', 'byDay', 'byConfig'] as const).map(mode => (
          <button key={mode} onClick={() => setViewMode(mode)} style={{
            padding: '4px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
            background: viewMode === mode ? 'rgba(124,58,237,0.08)' : 'transparent',
            color: viewMode === mode ? '#7c3aed' : '#6b5e54',
            fontWeight: viewMode === mode ? 600 : 400,
          }}>
            {mode === 'summary' ? '汇总' : mode === 'byDay' ? '按日' : '按配置'}
          </button>
        ))}
      </div>

      {totals && totals.count > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Summary cards (always visible) */}
          <div style={{ display: 'flex', gap: 12 }}>
            <StatCard label="调用次数" value={totals.count.toLocaleString()} color="#6b5e54" />
            <StatCard label="输入 Token" value={totals.input.toLocaleString()} color="#2563eb" />
            <StatCard label="输出 Token" value={totals.output.toLocaleString()} color="#16a34a" />
            {totals.cacheHit > 0 && <StatCard label="缓存命中" value={totals.cacheHit.toLocaleString()} color="#ca8a04" />}
            <StatCard label="花费" value={`${cSym}${totals.cost.toFixed(4)}`} color="#7c3aed" />
          </div>

          {/* Budget bar */}
          {aiSettings.monthlyBudget > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b5e54', marginBottom: 4 }}>
                <span>当月预算 {cSym}{totals.cost.toFixed(2)} / {cSym}{aiSettings.monthlyBudget.toFixed(2)}</span>
                <span style={{ color: totals.cost > aiSettings.monthlyBudget ? '#dc2626' : totals.cost > aiSettings.monthlyBudget * 0.8 ? '#e67e00' : '#16a34a' }}>
                  {totals.cost > aiSettings.monthlyBudget ? '已超预算' : totals.cost > aiSettings.monthlyBudget * 0.8 ? '接近上限' : '正常'}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, background: totals.cost > aiSettings.monthlyBudget ? '#dc2626' : totals.cost > aiSettings.monthlyBudget * 0.8 ? '#e67e00' : '#7c3aed', width: `${Math.min(100, (totals.cost / aiSettings.monthlyBudget) * 100)}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {/* By Day view */}
          {viewMode === 'byDay' && usage.byDay.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>日用量</div>
              <div className="custom-scrollbar" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {usage.byDay.map(d => (
                  <div key={d.date} style={{ display: 'flex', gap: 12, fontSize: 11, color: '#4a3f38', padding: '5px 8px', borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                    <span style={{ minWidth: 80, fontWeight: 600 }}>{d.date}</span>
                    <span style={{ minWidth: 40, color: '#9b8e84' }}>{d.count}次</span>
                    <span style={{ minWidth: 60, color: '#2563eb' }}>入 {d.input.toLocaleString()}</span>
                    <span style={{ minWidth: 60, color: '#16a34a' }}>出 {d.output.toLocaleString()}</span>
                    <span style={{ color: '#7c3aed', fontWeight: 600 }}>{cSym}{d.cost.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By Config view */}
          {viewMode === 'byConfig' && usage.byConfig.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>按配置统计</div>
              {usage.byConfig.map(c => (
                <div key={c.configId} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: '#faf9f8' }}>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#4a3f38' }}>
                    <span style={{ fontWeight: 600, minWidth: 80 }}>{c.configName}</span>
                    <span style={{ color: '#9b8e84', minWidth: 60 }}>{c.model}</span>
                    <span style={{ minWidth: 40, color: '#9b8e84' }}>{c.count}次</span>
                    <span style={{ minWidth: 60, color: '#2563eb' }}>入 {c.input.toLocaleString()}</span>
                    <span style={{ minWidth: 60, color: '#16a34a' }}>出 {c.output.toLocaleString()}</span>
                    <span style={{ color: '#7c3aed', fontWeight: 600 }}>{cSym}{c.cost.toFixed(4)}</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 2, background: '#7c3aed', width: totals.cost > 0 ? `${((c.cost / totals.cost) * 100).toFixed(0)}%` : '0%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Detail toggle */}
          <div style={{ marginTop: 4 }}>
            <button onClick={() => setShowDetail(!showDetail)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0 }}>
              {showDetail ? '收起' : '展开'}条目明细 ({usage.entries.length}条)
            </button>
            {showDetail && (
              <div className="custom-scrollbar" style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
                {usage.entries.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 10, color: '#6b5e54', padding: '4px 6px', borderBottom: '1px solid rgba(0,0,0,0.02)', alignItems: 'center' }}>
                    <span style={{ minWidth: 130 }}>{e.timestamp?.split('T')[0]} {e.timestamp?.split('T')[1]?.slice(0, 8)}</span>
                    <span style={{ minWidth: 60, color: '#4a3f38' }}>{e.configName || e.model}</span>
                    <span style={{ color: '#2563eb' }}>入 {e.inputTokens.toLocaleString()}</span>
                    <span style={{ marginLeft: 6, color: '#16a34a' }}>出 {e.outputTokens.toLocaleString()}</span>
                    <span style={{ marginLeft: 6, color: '#7c3aed', fontWeight: 600 }}>{cSym}{(e as { cost: number }).cost.toFixed(4)}</span>
                    <button
                      onClick={() => {
                        if (!confirm('删除此条记录？')) return
                        statsService.deleteByLine(e._line).then(() => {
                          const filter = activeProjectId ? { projectId: activeProjectId } : {}
                          if (filterConfigId) Object.assign(filter, { configId: filterConfigId })
                          if (filterModel) Object.assign(filter, { model: filterModel })
                          if (filterYear !== undefined) Object.assign(filter, { year: filterYear, month: filterMonth, day: filterDay })
                          statsService.getUsage(filter).then((data: unknown) => setUsage(data as typeof usage))
                        })
                      }}
                      title="删除此条"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#d4ccc4', flexShrink: 0, marginLeft: 'auto' }}
                    >
                      <TrashIcon style={{ width: 11, height: 11 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: '#9b8e84', lineHeight: 1.8 }}>
          暂无统计数据。每次 AI 调用都会自动记录 token 用量，开始使用 AI 功能后此处将展示用量和花费。
        </p>
      )}
    </div>
  )
}

const miniSelect: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)',
  outline: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#4a3f38',
}

