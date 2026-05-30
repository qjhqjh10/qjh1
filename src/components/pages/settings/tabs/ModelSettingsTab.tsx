import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store'
import { settingsService, aiService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { PlusIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import type { ModelConfig } from '@/types/settings'
import { DEFAULT_MODEL_CONFIG, PROVIDER_PRESETS } from '@/types/settings'
import { FormField } from '../shared'
import { formatContextWindow } from '../constants'
import { inputStyle } from '@/components/common/styles'
import { logError } from '@/utils/logger'

function safe(v: number | undefined, fallback = 0): number {
  return typeof v === 'number' && !isNaN(v) ? v : fallback
}

function ModelCard({
  icon, title, desc, modelValue, onModelChange, placeholder,
  tempValue, onTempChange, tempDisabled,
  maxTokValue, onMaxTokChange,
  ctxWinValue, onCtxWinChange,
  inPrice, onInPrice, outPrice, onOutPrice, cachePrice, onCachePrice,
  currency, showPricing, showCtx,
  apiProvider, onApiProvider, apiUrl, onApiUrl, apiKey, onApiKey,
  children,
}: {
  icon: string; title: string; desc: string
  modelValue: string; onModelChange: (v: string) => void; placeholder: string
  tempValue: number; onTempChange: (v: number) => void; tempDisabled?: boolean
  maxTokValue: number; onMaxTokChange: (v: number) => void
  ctxWinValue?: number; onCtxWinChange?: (v: number) => void
  inPrice: number; onInPrice?: (v: number) => void
  outPrice: number; onOutPrice?: (v: number) => void
  cachePrice: number; onCachePrice?: (v: number) => void
  currency: 'USD' | 'CNY'
  showPricing?: boolean; showCtx?: boolean
  apiProvider?: string; onApiProvider?: (v: string) => void
  apiUrl?: string; onApiUrl?: (v: string) => void
  apiKey?: string; onApiKey?: (v: string) => void
  children?: React.ReactNode
}) {
  const sym = currency === 'CNY' ? '¥' : '$'
  return (
    <div style={{
      padding: 16, borderRadius: 14,
      background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>
        {icon} {title}
      </div>
      <div style={{ fontSize: 9, color: '#9b8e84', marginBottom: 10 }}>{desc}</div>

      {/* Row 1: Model name + parameters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px' }}>
          <label style={labelS}>模型名</label>
          <input type="text" value={modelValue} onChange={e => onModelChange(e.target.value)}
            className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder={placeholder} />
        </div>
        <div style={{ flex: '0 0 120px' }}>
          <label style={labelS}>温度 {tempDisabled ? 'N/A' : tempValue.toFixed(1)}</label>
          <input type="range" min="0" max="2" step="0.1" value={tempValue}
            onChange={e => onTempChange(parseFloat(e.target.value))}
            disabled={tempDisabled}
            style={{ width: '100%', accentColor: tempDisabled ? '#d4ccc4' : '#7c3aed', marginTop: 4 }} />
        </div>
        <div style={{ flex: '0 0 80px' }}>
          <label style={labelS}>最大输出</label>
          <input type="number" min="0" value={maxTokValue} onChange={e => onMaxTokChange(parseInt(e.target.value) || 0)}
            className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} />
        </div>
        {showCtx && ctxWinValue !== undefined && onCtxWinChange && (
          <div style={{ flex: '0 0 90px' }}>
            <label style={labelS}>上下文</label>
            <input type="number" min="1000" step="1000" value={ctxWinValue}
              onChange={e => onCtxWinChange(parseInt(e.target.value) || 128000)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} />
          </div>
        )}
      </div>

      {/* Pricing row */}
      {showPricing !== false && (
        <div style={{
          display: 'flex', gap: 8, paddingTop: 8,
          borderTop: '1px solid rgba(0,0,0,0.04)',
        }}>
          {onInPrice && <div style={{ flex: 1 }}>
            <label style={labelS}>输入 {sym}/1M</label>
            <input type="number" step="0.01" min="0" value={inPrice || ''}
              onChange={e => onInPrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }}
              placeholder="用Main" />
          </div>}
          {onOutPrice && <div style={{ flex: 1 }}>
            <label style={labelS}>输出 {sym}/1M</label>
            <input type="number" step="0.01" min="0" value={outPrice || ''}
              onChange={e => onOutPrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }}
              placeholder="用Main" />
          </div>}
          {onCachePrice && <div style={{ flex: 1 }}>
            <label style={labelS}>缓存 {sym}/1M</label>
            <input type="number" step="0.01" min="0" value={cachePrice || ''}
              onChange={e => onCachePrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }}
              placeholder="用Main" />
          </div>}
          {!onInPrice && !onOutPrice && !onCachePrice && (
            <div style={{ fontSize: 10, color: '#9b8e84' }}>
              {sym}{safe(inPrice).toFixed(2)}/张
            </div>
          )}
        </div>
      )}

      {/* API 覆盖 (每个子模型可独立设置) */}
      {onApiUrl !== undefined && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 100px' }}>
              <label style={labelS}>API地址 (覆盖)</label>
              <input type="text" value={apiUrl || ''} onChange={e => onApiUrl?.(e.target.value)}
                className="focus-ring" style={{ ...inputStyle, fontSize: 10, padding: '3px 6px' }}
                placeholder="留空=模板默认" />
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={labelS}>API密钥 (覆盖)</label>
              <input type="password" value={apiKey || ''} onChange={e => onApiKey?.(e.target.value)}
                className="focus-ring" style={{ ...inputStyle, fontSize: 10, padding: '3px 6px' }}
                placeholder="留空=模板默认" />
            </div>
          </div>
        </div>
      )}

      {children}
    </div>
  )
}

const labelS: React.CSSProperties = { display: 'block', fontSize: 9, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }

export function ModelSettingsTab() {
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const addConfig = useSettingsStore(s => s.addConfig)
  const updateConfig = useSettingsStore(s => s.updateConfig)
  const removeConfig = useSettingsStore(s => s.removeConfig)
  const setActiveConfig = useSettingsStore(s => s.setActiveConfig)

  const [modelList, setModelList] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [showDropdownFor, setShowDropdownFor] = useState<string | null>(null)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [savedAt, setSavedAt] = useState(0)

  const activeConfig = configs.find(c => c.id === activeConfigId)

  // Sync configs to main process (debounced)
  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      settingsService.saveConfigs(configs).then(() => setSavedAt(Date.now())).catch(e => logError('Config sync failed', e))
    }, 600)
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }
  }, [configs])

  useEffect(() => { if (!savedAt) return; const t = setTimeout(() => setSavedAt(0), 3000); return () => clearTimeout(t) }, [savedAt])

  const handleRefreshModels = async () => {
    if (!activeConfigId) return
    setLoadingModels(true)
    try {
      const raw = await aiService.listModels(activeConfigId)
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      setModelList(Array.isArray(parsed.data) ? parsed.data.map((m: any) => m.id).filter(Boolean) : [])
    } catch { setModelList([]) }
    setLoadingModels(false)
  }

  const handleSelectModel = (modelName: string) => {
    if (!activeConfig || !showDropdownFor) return
    const key = showDropdownFor === 'cheap' ? 'cheapModel' : showDropdownFor === 'reasoning' ? 'reasoningModel' : showDropdownFor === 'image' ? 'imageModel' : 'model'
    updateConfig(activeConfig.id, { [key]: modelName } as any)
    setShowDropdownFor(null)
  }

  const handleAdd = () => {
    const id = nanoid(8)
    addConfig({ ...DEFAULT_MODEL_CONFIG, id, name: `配置 ${configs.length + 1}` })
    setActiveConfig(id)
  }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Left: config list (35%) */}
      <div style={{ width: '35%', borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>模型配置模板</span>
          <Button size="sm" onClick={handleAdd} icon={<PlusIcon style={{ width: 12, height: 12 }} />}>新建</Button>
        </div>
        <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
          <div style={{ padding: '6px 8px' }}>
            {configs.map(config => (
              <button key={config.id} onClick={() => setActiveConfig(config.id)} style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: 12, border: 'none',
                background: activeConfigId === config.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                color: activeConfigId === config.id ? '#7c3aed' : '#4a3f38',
                fontSize: 13, fontWeight: activeConfigId === config.id ? 600 : 400, cursor: 'pointer',
              }}>
                {config.name}
                <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 2 }}>
                  {config.model}{config.cheapModel ? ` | ${config.cheapModel}` : ''}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right: config form (65%) */}
      {activeConfig ? (
        <div style={{ width: '65%', overflow: 'auto' }} className="custom-scrollbar">
          <ScrollArea maxHeight="100%" style={{ paddingRight: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
              {savedAt > 0 && (
                <div style={{ padding: '6px 14px', borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', color: '#16a34a', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>✓ 已保存</div>
              )}

              {/* ═══ 模板名称 ═══ */}
              <div style={{ padding: 14, borderRadius: 14, background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(168,85,247,0.04))', border: '1px solid rgba(124,58,237,0.12)' }}>
                <input type="text" value={activeConfig.name}
                  onChange={e => updateConfig(activeConfig.id, { name: e.target.value })}
                  className="focus-ring"
                  style={{ fontSize: 16, fontWeight: 700, color: '#2d2520', border: 'none', background: 'transparent', outline: 'none', width: '100%', fontFamily: 'inherit' }}
                  placeholder="输入模板名称..." />
                <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 2 }}>此名称将显示在聊天窗口左下角的模型选择器中</div>
              </div>

              {/* ═══ 基础设置 ═══ */}
              <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#2d2520' }}>⚙️ 模板默认设置（子模型可选覆盖）</h4>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 140px' }}>
                    <FormField label="默认服务商">
                      <select value={PROVIDER_PRESETS.some(p => p.name === activeConfig.provider) ? activeConfig.provider : '__custom__'}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '__custom__') return
                          const preset = PROVIDER_PRESETS.find(p => p.name === v)
                          updateConfig(activeConfig.id, { provider: v, apiUrl: preset ? preset.apiUrl : activeConfig.apiUrl })
                        }}
                        className="focus-ring" style={{ ...inputStyle, fontSize: 11, cursor: 'pointer' }}>
                        {PROVIDER_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                        <option value="__custom__">自定义</option>
                      </select>
                    </FormField>
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <FormField label="默认 API 地址">
                      <input type="text" value={activeConfig.apiUrl}
                        onChange={e => updateConfig(activeConfig.id, { apiUrl: e.target.value })}
                        className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} />
                    </FormField>
                    <FormField label="默认 API 密钥">
                      <input type="password" value={activeConfig.apiKey}
                        onChange={e => updateConfig(activeConfig.id, { apiKey: e.target.value })}
                        className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder="sk-..." />
                    </FormField>
                    <FormField label="货币单位">
                      <select value={activeConfig.currency} onChange={e => updateConfig(activeConfig.id, { currency: e.target.value as 'USD' | 'CNY' })}
                        style={{ ...inputStyle, fontSize: 11, cursor: 'pointer' }}>
                        <option value="USD">$ USD</option>
                        <option value="CNY">¥ CNY</option>
                      </select>
                    </FormField>
                  </div>
                </div>
              </div>

              {/* ═══ 💪 Main ═══ */}
              <ModelCard
                icon="💪" title="Main 主力模型" desc="对话执行 + 工具调用。主力战斗员，负责写作和复杂操作。"
                modelValue={activeConfig.model} onModelChange={v => updateConfig(activeConfig.id, { model: v })}
                placeholder="deepseek-chat / gpt-4o"
                tempValue={activeConfig.temperature} onTempChange={v => updateConfig(activeConfig.id, { temperature: v })}
                maxTokValue={activeConfig.maxTokens} onMaxTokChange={v => updateConfig(activeConfig.id, { maxTokens: v })}
                ctxWinValue={activeConfig.contextWindow ?? 128000}
                onCtxWinChange={v => updateConfig(activeConfig.id, { contextWindow: v })}
                inPrice={activeConfig.inputPricePerM} onInPrice={v => updateConfig(activeConfig.id, { inputPricePerM: v })}
                outPrice={activeConfig.outputPricePerM} onOutPrice={v => updateConfig(activeConfig.id, { outputPricePerM: v })}
                cachePrice={activeConfig.cacheHitPricePerM} onCachePrice={v => updateConfig(activeConfig.id, { cacheHitPricePerM: v })}
                currency={activeConfig.currency} showCtx
                apiUrl={activeConfig.mainApiUrl || ''} onApiUrl={v => updateConfig(activeConfig.id, { mainApiUrl: v })}
                apiKey={activeConfig.mainApiKey || ''} onApiKey={v => updateConfig(activeConfig.id, { mainApiKey: v })}
              >
                <div style={{ paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)', marginTop: 8 }}>
                  <FormField label="推理深度 (reasoning_effort)">
                    <select value={activeConfig.reasoningEffort || ''}
                      onChange={e => updateConfig(activeConfig.id, { reasoningEffort: (e.target.value || undefined) as any })}
                      style={{ ...inputStyle, fontSize: 11, cursor: 'pointer' }}>
                      <option value="">默认（不设置）</option>
                      <option value="min">min</option><option value="low">low</option>
                      <option value="medium">medium</option><option value="high">high</option>
                      <option value="max">max</option>
                    </select>
                  </FormField>
                </div>
              </ModelCard>

              {/* ═══ ⚡ Cheap ═══ */}
              <ModelCard
                icon="⚡" title="Cheap 便宜模型" desc="分类器 + 意图方案。速度和成本优先，建议用 Flash/Mini 等模型。留空模型名则复用 Main。"
                modelValue={activeConfig.cheapModel} onModelChange={v => updateConfig(activeConfig.id, { cheapModel: v })}
                placeholder="留空=用Main (建议 deepseek-chat / gpt-4o-mini)"
                tempValue={safe(activeConfig.cheapTemperature, activeConfig.temperature)}
                onTempChange={v => updateConfig(activeConfig.id, { cheapTemperature: v })}
                maxTokValue={safe(activeConfig.cheapMaxTokens, activeConfig.maxTokens)}
                onMaxTokChange={v => updateConfig(activeConfig.id, { cheapMaxTokens: v })}
                inPrice={safe(activeConfig.cheapInputPricePerM)} onInPrice={v => updateConfig(activeConfig.id, { cheapInputPricePerM: v })}
                outPrice={safe(activeConfig.cheapOutputPricePerM)} onOutPrice={v => updateConfig(activeConfig.id, { cheapOutputPricePerM: v })}
                cachePrice={safe(activeConfig.cheapCacheHitPricePerM)} onCachePrice={v => updateConfig(activeConfig.id, { cheapCacheHitPricePerM: v })}
                currency={activeConfig.currency}
                apiUrl={activeConfig.cheapApiUrl || ''} onApiUrl={v => updateConfig(activeConfig.id, { cheapApiUrl: v })}
                apiKey={activeConfig.cheapApiKey || ''} onApiKey={v => updateConfig(activeConfig.id, { cheapApiKey: v })}
              />

              {/* ═══ 🧠 Reasoning ═══ */}
              <ModelCard
                icon="🧠" title="Reasoning 推理模型" desc="深度分析 + 复杂推理。可选，留空模型名则复用 Main。推理模型通常不需要温度参数。"
                modelValue={activeConfig.reasoningModel} onModelChange={v => updateConfig(activeConfig.id, { reasoningModel: v })}
                placeholder="留空=用Main (如 deepseek-reasoner / o1)"
                tempValue={safe(activeConfig.reasoningTemperature)} onTempChange={v => updateConfig(activeConfig.id, { reasoningTemperature: v })}
                tempDisabled={!!activeConfig.reasoningModel && /reasoner|o1|o3|deep.*seek.*r1/i.test(activeConfig.reasoningModel)}
                maxTokValue={safe(activeConfig.reasoningMaxTokens, activeConfig.maxTokens)}
                onMaxTokChange={v => updateConfig(activeConfig.id, { reasoningMaxTokens: v })}
                inPrice={safe(activeConfig.reasoningInputPricePerM)} onInPrice={v => updateConfig(activeConfig.id, { reasoningInputPricePerM: v })}
                outPrice={safe(activeConfig.reasoningOutputPricePerM)} onOutPrice={v => updateConfig(activeConfig.id, { reasoningOutputPricePerM: v })}
                cachePrice={safe(activeConfig.reasoningCacheHitPricePerM)} onCachePrice={v => updateConfig(activeConfig.id, { reasoningCacheHitPricePerM: v })}
                currency={activeConfig.currency}
                apiUrl={activeConfig.reasoningApiUrl || ''} onApiUrl={v => updateConfig(activeConfig.id, { reasoningApiUrl: v })}
                apiKey={activeConfig.reasoningApiKey || ''} onApiKey={v => updateConfig(activeConfig.id, { reasoningApiKey: v })}
              />

              {/* ═══ 🎨 Image ═══ */}
              <ModelCard
                icon="🎨" title="Image 图片模型" desc="图片生成。可选，留空模型名则禁用图片功能。可能使用不同于文本模型的 API。"
                modelValue={activeConfig.imageModel} onModelChange={v => updateConfig(activeConfig.id, { imageModel: v })}
                placeholder="留空=禁用 (如 dall-e-3)"
                tempValue={0} onTempChange={() => {}} tempDisabled
                maxTokValue={0} onMaxTokChange={() => {}}
                inPrice={safe(activeConfig.imageInputPricePerM)}
                outPrice={safe(activeConfig.imageOutputPricePerM)}
                cachePrice={0}
                currency={activeConfig.currency} showPricing={false}
              >
                {activeConfig.imageModel && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)', marginTop: 8 }}>
                    <div style={{ flex: '1 1 140px' }}>
                      <label style={{ display: 'block', fontSize: 9, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>图片API地址</label>
                      <input type="text" value={activeConfig.imageApiUrl || ''}
                        onChange={e => updateConfig(activeConfig.id, { imageApiUrl: e.target.value })}
                        className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder="留空用模板默认" />
                    </div>
                    <div style={{ flex: '1 1 140px' }}>
                      <label style={{ display: 'block', fontSize: 9, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>图片API密钥</label>
                      <input type="password" value={activeConfig.imageApiKey || ''}
                        onChange={e => updateConfig(activeConfig.id, { imageApiKey: e.target.value })}
                        className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder="留空用模板默认" />
                    </div>
                    <div style={{ flex: '1 1 80px' }}>
                      <label style={{ display: 'block', fontSize: 9, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }}>费用/张</label>
                      <input type="number" step="0.01" min="0" value={activeConfig.imageOutputPricePerM || ''}
                        onChange={e => updateConfig(activeConfig.id, { imageOutputPricePerM: parseFloat(e.target.value) || 0 })}
                        className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} placeholder="0" />
                    </div>
                  </div>
                )}
              </ModelCard>

              {/* ═══ 📚 Embedding ═══ */}
              <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>📚 知识库 Embedding</div>
                <div style={{ fontSize: 9, color: '#9b8e84', marginBottom: 10 }}>用于知识库文件的向量化和语义搜索，独立于对话模型。</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label style={labelS}>Embedding 模型名</label>
                    <input type="text" value={activeConfig.embeddingModel || ''}
                      onChange={e => updateConfig(activeConfig.id, { embeddingModel: e.target.value })}
                      className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder="text-embedding-3-small" />
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={labelS}>API地址 (可选覆盖)</label>
                    <input type="text" value={activeConfig.embeddingApiUrl || ''}
                      onChange={e => updateConfig(activeConfig.id, { embeddingApiUrl: e.target.value })}
                      className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder="留空用模板默认" />
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={labelS}>API密钥 (可选覆盖)</label>
                    <input type="password" value={activeConfig.embeddingApiKey || ''}
                      onChange={e => updateConfig(activeConfig.id, { embeddingApiKey: e.target.value })}
                      className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder="留空用模板默认" />
                  </div>
                </div>
              </div>

              {/* ═══ 系统提示词 ═══ */}
              <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>系统提示词</div>
                <textarea value={activeConfig.systemPrompt}
                  onChange={e => updateConfig(activeConfig.id, { systemPrompt: e.target.value })}
                  style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontSize: 11 }}
                  placeholder="系统提示词..." />
              </div>

              {/* ═══ 删除 ═══ */}
              {configs.length > 1 && (
                <button onClick={() => { removeConfig(activeConfig.id); setActiveConfig(configs[0].id !== activeConfig.id ? configs[0].id : configs[1]?.id || '') }}
                  style={{
                    padding: '10px', borderRadius: 12, border: '1px solid rgba(220,38,38,0.15)', background: '#fff',
                    color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                  <TrashIcon style={{ width: 14, height: 14 }} /> 删除此配置模板
                </button>
              )}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div style={{ width: '65%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 13 }}>
          选择一个配置模板或新建一个
        </div>
      )}
    </div>
  )
}
