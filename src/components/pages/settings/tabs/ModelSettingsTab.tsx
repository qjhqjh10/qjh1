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
import { formatContextWindow } from '../constants';
import { inputStyle } from '@/components/common/styles'
import { logError } from '@/utils/logger'

export function ModelSettingsTab() {
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
