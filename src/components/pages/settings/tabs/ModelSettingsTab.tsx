import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store'
import { settingsService, aiService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { PlusIcon, TrashIcon, ArrowPathIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import type { ModelConfig } from '@/types/settings'
import { DEFAULT_MODEL_CONFIG, PROVIDER_PRESETS } from '@/types/settings'
import { FormField } from '../shared'
import { inputStyle } from '@/components/common/styles'
import { logError } from '@/utils/logger'

function safe(v: number | undefined, fallback = 0): number {
  return typeof v === 'number' && !isNaN(v) ? v : fallback
}

const labelS: React.CSSProperties = { display: 'block', fontSize: 9, fontWeight: 600, color: '#9b8e84', marginBottom: 2 }

function ApiKeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input type={show ? 'text' : 'password'} value={value}
        onChange={e => onChange(e.target.value)}
        className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder="sk-..." />
      <button onClick={() => setShow(!show)} title={show ? '隐藏' : '查看'}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9b8e84', flexShrink: 0 }}>
        {show ? <EyeSlashIcon style={{ width: 16, height: 16 }} /> : <EyeIcon style={{ width: 16, height: 16 }} />}
      </button>
    </div>
  )
}

function ModelCard({
  icon, title, desc, modelValue, onModelChange, placeholder,
  tempValue, onTempChange, tempDisabled,
  maxTokValue, onMaxTokChange,
  ctxWinValue, onCtxWinChange,
  inPrice, onInPrice, outPrice, onOutPrice, cachePrice, onCachePrice,
  currency, onCurrency,
  showPricing, showCtx,
  apiUrl, onApiUrl, apiKey, onApiKey,
  onRefreshModels, loadingModels,
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
  currency: 'USD' | 'CNY'; onCurrency?: (v: 'USD' | 'CNY') => void
  showPricing?: boolean; showCtx?: boolean
  apiUrl?: string; onApiUrl?: (v: string) => void
  apiKey?: string; onApiKey?: (v: string) => void
  onRefreshModels?: () => void; loadingModels?: boolean
  children?: React.ReactNode
}) {
  const sym = currency === 'CNY' ? '¥' : '$'
  return (
    <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>{icon} {title}</div>
      <div style={{ fontSize: 9, color: '#9b8e84', marginBottom: 10 }}>{desc}</div>

      {/* Model name + refresh */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={labelS}>模型名</label>
          <input type="text" value={modelValue} onChange={e => onModelChange(e.target.value)}
            className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder={placeholder} />
        </div>
        {onRefreshModels && (
          <button onClick={onRefreshModels} disabled={loadingModels} title="刷新模型列表"
            style={{ padding: 6, borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', cursor: 'pointer', marginBottom: 1 }}>
            <ArrowPathIcon style={{ width: 14, height: 14, color: '#6b5e54', opacity: loadingModels ? 0.4 : 1 }} />
          </button>
        )}
      </div>

      {/* Temp + MaxTokens + Context */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 110px' }}>
          <label style={labelS}>温度 {tempDisabled ? 'N/A' : tempValue.toFixed(1)}</label>
          <input type="range" min="0" max="2" step="0.1" value={tempValue}
            onChange={e => onTempChange(parseFloat(e.target.value))} disabled={tempDisabled}
            style={{ width: '100%', accentColor: tempDisabled ? '#d4ccc4' : '#7c3aed', marginTop: 4 }} />
        </div>
        <div style={{ flex: '0 0 80px' }}>
          <label style={labelS}>最大输出</label>
          <input type="number" min="0" value={maxTokValue} onChange={e => onMaxTokChange(parseInt(e.target.value) || 0)}
            className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} />
          <div style={{ fontSize: 7, color: '#9b8e84' }}>0=模型默认</div>
        </div>
        {showCtx && ctxWinValue !== undefined && onCtxWinChange && (
          <div style={{ flex: '0 0 80px' }}>
            <label style={labelS}>上下文</label>
            <input type="number" min="1000" step="1000" value={ctxWinValue}
              onChange={e => onCtxWinChange(parseInt(e.target.value) || 128000)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} />
          </div>
        )}
        {onCurrency && (
          <div style={{ flex: '0 0 74px' }}>
            <label style={labelS}>货币</label>
            <select value={currency} onChange={e => onCurrency(e.target.value as 'USD' | 'CNY')}
              style={{ ...inputStyle, fontSize: 10, padding: '4px 2px', cursor: 'pointer' }}>
              <option value="USD">$ USD</option>
              <option value="CNY">¥ CNY</option>
            </select>
          </div>
        )}
      </div>

      {/* API override */}
      {onApiUrl && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelS}>API地址 (覆盖)</label>
            <input type="text" value={apiUrl || ''} onChange={e => onApiUrl(e.target.value)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 10, padding: '3px 6px' }} placeholder="留空=模板默认" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelS}>API密钥 (覆盖)</label>
            <ApiKeyInput value={apiKey || ''} onChange={v => onApiKey?.(v)} />
          </div>
        </div>
      )}

      {/* Pricing */}
      {showPricing !== false && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
          {onInPrice && <div style={{ flex: 1 }}>
            <label style={labelS}>输入 {sym}/1M</label>
            <input type="number" step="0.01" min="0" value={inPrice || ''}
              onChange={e => onInPrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} placeholder="用Main" />
          </div>}
          {onOutPrice && <div style={{ flex: 1 }}>
            <label style={labelS}>输出 {sym}/1M</label>
            <input type="number" step="0.01" min="0" value={outPrice || ''}
              onChange={e => onOutPrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} placeholder="用Main" />
          </div>}
          {onCachePrice && <div style={{ flex: 1 }}>
            <label style={labelS}>缓存 {sym}/1M</label>
            <input type="number" step="0.01" min="0" value={cachePrice || ''}
              onChange={e => onCachePrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={{ ...inputStyle, fontSize: 11, padding: '4px 6px' }} placeholder="用Main" />
          </div>}
          {!onInPrice && !onOutPrice && !onCachePrice && (
            <div style={{ fontSize: 10, color: '#9b8e84' }}>{sym}{safe(inPrice).toFixed(2)}/张</div>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

export function ModelSettingsTab() {
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const addConfig = useSettingsStore(s => s.addConfig)
  const updateConfig = useSettingsStore(s => s.updateConfig)
  const removeConfig = useSettingsStore(s => s.removeConfig)
  const setActiveConfig = useSettingsStore(s => s.setActiveConfig)
  const [savedAt, setSavedAt] = useState(0)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeConfig = configs.find(c => c.id === activeConfigId)

  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      settingsService.saveConfigs(configs).then(() => setSavedAt(Date.now())).catch(e => logError('Config sync failed', e))
    }, 600)
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }
  }, [configs])

  useEffect(() => { if (!savedAt) return; const t = setTimeout(() => setSavedAt(0), 3000); return () => clearTimeout(t) }, [savedAt])

  const handleAdd = () => {
    const id = nanoid(8)
    addConfig({ ...DEFAULT_MODEL_CONFIG, id, name: `配置 ${configs.length + 1}` })
    setActiveConfig(id)
  }

  if (!activeConfig) {
    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ width: '35%', borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>模型配置模板</span>
            <Button size="sm" onClick={handleAdd} icon={<PlusIcon style={{ width: 12, height: 12 }} />}>新建</Button>
          </div>
        </div>
        <div style={{ width: '65%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 13 }}>
          选择一个配置模板或新建一个
        </div>
      </div>
    )
  }

  // ── Helpers ──
  const u = (patch: Partial<ModelConfig>) => updateConfig(activeConfig.id, patch)

  const sym = (cur: 'USD' | 'CNY' | undefined) => (cur || activeConfig.currency) === 'CNY' ? '¥' : '$'

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Left: config list */}
      <div style={{ width: '30%', borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>模板列表</span>
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

      {/* Right: config form */}
      <div style={{ width: '70%', overflow: 'auto' }} className="custom-scrollbar">
        <ScrollArea maxHeight="100%" style={{ paddingRight: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
            {savedAt > 0 && (
              <div style={{ padding: '6px 14px', borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', color: '#16a34a', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>✓ 已保存</div>
            )}

            {/* ═══ 模板名称 ═══ */}
            <div style={{ padding: 14, borderRadius: 14, background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(168,85,247,0.04))', border: '1px solid rgba(124,58,237,0.12)' }}>
              <input type="text" value={activeConfig.name}
                onChange={e => u({ name: e.target.value })}
                style={{ fontSize: 16, fontWeight: 700, color: '#2d2520', border: 'none', background: 'transparent', outline: 'none', width: '100%', fontFamily: 'inherit' }}
                placeholder="输入模板名称..." />
              <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 2 }}>显示在聊天窗口左下角 + 系统设置标题栏</div>
            </div>

            {/* ═══ 💪 Main = 模板默认 + 主力 ═══ */}
            <ModelCard
              icon="💪" title="Main 主力模型" desc="对话执行 + 工具调用。主力战斗员。下方 API 设置作为所有子模型的默认值。"
              modelValue={activeConfig.model} onModelChange={v => u({ model: v })}
              placeholder="deepseek-chat / gpt-4o"
              tempValue={activeConfig.temperature} onTempChange={v => u({ temperature: v })}
              maxTokValue={activeConfig.maxTokens} onMaxTokChange={v => u({ maxTokens: v })}
              ctxWinValue={activeConfig.contextWindow ?? 128000}
              onCtxWinChange={v => u({ contextWindow: v })}
              inPrice={activeConfig.inputPricePerM} onInPrice={v => u({ inputPricePerM: v })}
              outPrice={activeConfig.outputPricePerM} onOutPrice={v => u({ outputPricePerM: v })}
              cachePrice={activeConfig.cacheHitPricePerM} onCachePrice={v => u({ cacheHitPricePerM: v })}
              currency={activeConfig.mainCurrency || activeConfig.currency}
              onCurrency={v => u({ mainCurrency: v })}
              showCtx
              apiUrl={activeConfig.mainApiUrl || activeConfig.apiUrl} onApiUrl={v => u({ mainApiUrl: v })}
              apiKey={activeConfig.mainApiKey || activeConfig.apiKey} onApiKey={v => u({ mainApiKey: v })}
            >
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 120px' }}>
                    <label style={labelS}>默认服务商</label>
                    <select value={PROVIDER_PRESETS.some(p => p.name === activeConfig.provider) ? activeConfig.provider : '__custom__'}
                      onChange={e => {
                        const v = e.target.value; if (v === '__custom__') return
                        const preset = PROVIDER_PRESETS.find(p => p.name === v)
                        u({ provider: v, apiUrl: preset ? preset.apiUrl : activeConfig.apiUrl })
                      }}
                      style={{ ...inputStyle, fontSize: 10, cursor: 'pointer' }}>
                      {PROVIDER_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                      <option value="__custom__">自定义</option>
                    </select>
                  </div>
                  <div style={{ flex: '1 1 150px' }}>
                    <label style={labelS}>默认 API 地址</label>
                    <input type="text" value={activeConfig.apiUrl} onChange={e => u({ apiUrl: e.target.value })}
                      className="focus-ring" style={{ ...inputStyle, fontSize: 10, padding: '3px 6px' }} />
                  </div>
                  <div style={{ flex: '1 1 150px' }}>
                    <label style={labelS}>默认 API 密钥</label>
                    <ApiKeyInput value={activeConfig.apiKey} onChange={v => u({ apiKey: v })} />
                  </div>
                </div>
                <FormField label="推理深度 (reasoning_effort)">
                  <select value={activeConfig.reasoningEffort || ''}
                    onChange={e => u({ reasoningEffort: (e.target.value || undefined) as any })}
                    style={{ ...inputStyle, fontSize: 11, cursor: 'pointer' }}>
                    <option value="">默认（不设置）</option>
                    <option value="min">min</option><option value="low">low</option>
                    <option value="medium">medium</option><option value="high">high</option><option value="max">max</option>
                  </select>
                </FormField>
              </div>
            </ModelCard>

            {/* ═══ ⚡ Cheap ═══ */}
            <ModelCard
              icon="⚡" title="Cheap 便宜模型" desc="分类器 + 意图方案。留空模型名则复用 Main。"
              modelValue={activeConfig.cheapModel} onModelChange={v => u({ cheapModel: v })}
              placeholder="留空=用Main"
              tempValue={safe(activeConfig.cheapTemperature, activeConfig.temperature)}
              onTempChange={v => u({ cheapTemperature: v })}
              maxTokValue={safe(activeConfig.cheapMaxTokens, activeConfig.maxTokens)}
              onMaxTokChange={v => u({ cheapMaxTokens: v })}
              inPrice={safe(activeConfig.cheapInputPricePerM)} onInPrice={v => u({ cheapInputPricePerM: v })}
              outPrice={safe(activeConfig.cheapOutputPricePerM)} onOutPrice={v => u({ cheapOutputPricePerM: v })}
              cachePrice={safe(activeConfig.cheapCacheHitPricePerM)} onCachePrice={v => u({ cheapCacheHitPricePerM: v })}
              currency={activeConfig.cheapCurrency || activeConfig.mainCurrency || activeConfig.currency}
              onCurrency={v => u({ cheapCurrency: v })}
              apiUrl={activeConfig.cheapApiUrl || ''} onApiUrl={v => u({ cheapApiUrl: v })}
              apiKey={activeConfig.cheapApiKey || ''} onApiKey={v => u({ cheapApiKey: v })}
            />

            {/* ═══ 🧠 Reasoning ═══ */}
            <ModelCard
              icon="🧠" title="Reasoning 推理模型" desc="深度分析。可选，留空模型名则复用 Main。"
              modelValue={activeConfig.reasoningModel} onModelChange={v => u({ reasoningModel: v })}
              placeholder="留空=用Main"
              tempValue={safe(activeConfig.reasoningTemperature)} onTempChange={v => u({ reasoningTemperature: v })}
              tempDisabled={!!activeConfig.reasoningModel && /reasoner|o1|o3|r1/i.test(activeConfig.reasoningModel)}
              maxTokValue={safe(activeConfig.reasoningMaxTokens, activeConfig.maxTokens)}
              onMaxTokChange={v => u({ reasoningMaxTokens: v })}
              inPrice={safe(activeConfig.reasoningInputPricePerM)} onInPrice={v => u({ reasoningInputPricePerM: v })}
              outPrice={safe(activeConfig.reasoningOutputPricePerM)} onOutPrice={v => u({ reasoningOutputPricePerM: v })}
              cachePrice={safe(activeConfig.reasoningCacheHitPricePerM)} onCachePrice={v => u({ reasoningCacheHitPricePerM: v })}
              currency={activeConfig.reasoningCurrency || activeConfig.mainCurrency || activeConfig.currency}
              onCurrency={v => u({ reasoningCurrency: v })}
              apiUrl={activeConfig.reasoningApiUrl || ''} onApiUrl={v => u({ reasoningApiUrl: v })}
              apiKey={activeConfig.reasoningApiKey || ''} onApiKey={v => u({ reasoningApiKey: v })}
            />

            {/* ═══ 🎨 Image ═══ */}
            <ModelCard
              icon="🎨" title="Image 图片模型" desc="图片生成。留空模型名则禁用。"
              modelValue={activeConfig.imageModel} onModelChange={v => u({ imageModel: v })}
              placeholder="留空=禁用"
              tempValue={0} onTempChange={() => {}} tempDisabled
              maxTokValue={0} onMaxTokChange={() => {}}
              inPrice={safe(activeConfig.imageInputPricePerM)} outPrice={safe(activeConfig.imageOutputPricePerM)}
              cachePrice={0}
              currency={activeConfig.mainCurrency || activeConfig.currency}
              showPricing={false}
            >
              {activeConfig.imageModel && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)', marginTop: 8 }}>
                  <div style={{ flex: '1 1 130px' }}>
                    <label style={labelS}>图片API地址</label>
                    <input type="text" value={activeConfig.imageApiUrl || ''}
                      onChange={e => u({ imageApiUrl: e.target.value })}
                      className="focus-ring" style={{ ...inputStyle, fontSize: 10, padding: '3px 6px' }} placeholder="留空=模板默认" />
                  </div>
                  <div style={{ flex: '1 1 130px' }}>
                    <label style={labelS}>图片API密钥</label>
                    <ApiKeyInput value={activeConfig.imageApiKey || ''} onChange={v => u({ imageApiKey: v })} />
                  </div>
                  <div style={{ flex: '0 0 70px' }}>
                    <label style={labelS}>费用/张</label>
                    <input type="number" step="0.01" min="0" value={safe(activeConfig.imageOutputPricePerM) || ''}
                      onChange={e => u({ imageOutputPricePerM: parseFloat(e.target.value) || 0 })}
                      className="focus-ring" style={{ ...inputStyle, fontSize: 10, padding: '3px 6px' }} placeholder="0" />
                  </div>
                </div>
              )}
            </ModelCard>

            {/* ═══ 📚 Embedding ═══ */}
            <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>📚 知识库 Embedding</div>
              <div style={{ fontSize: 9, color: '#9b8e84', marginBottom: 10 }}>用于知识库文件的向量化和语义搜索，独立于对话模型。</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 160px' }}>
                  <label style={labelS}>Embedding 模型名</label>
                  <input type="text" value={activeConfig.embeddingModel || ''}
                    onChange={e => u({ embeddingModel: e.target.value })}
                    className="focus-ring" style={{ ...inputStyle, fontSize: 11 }} placeholder="text-embedding-3-small" />
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <label style={labelS}>API地址 (可选覆盖)</label>
                  <input type="text" value={activeConfig.embeddingApiUrl || ''}
                    onChange={e => u({ embeddingApiUrl: e.target.value })}
                    className="focus-ring" style={{ ...inputStyle, fontSize: 10, padding: '3px 6px' }} placeholder="留空=模板默认" />
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <label style={labelS}>API密钥 (可选覆盖)</label>
                  <ApiKeyInput value={activeConfig.embeddingApiKey || ''} onChange={v => u({ embeddingApiKey: v })} />
                </div>
              </div>
            </div>

            {/* ═══ 系统提示词 ═══ */}
            <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>系统提示词</div>
              <textarea value={activeConfig.systemPrompt}
                onChange={e => u({ systemPrompt: e.target.value })}
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
    </div>
  )
}
