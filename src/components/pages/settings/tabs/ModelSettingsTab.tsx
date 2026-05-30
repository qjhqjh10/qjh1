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
import { logError } from '@/utils/logger'

// ── Shared styles ──
const cardInner: React.CSSProperties = { padding: '20px 22px', borderRadius: 16, background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(0,0,0,0.06)' }
const cardTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 4 }
const cardDesc: React.CSSProperties = { fontSize: 11, color: '#9b8e84', marginBottom: 14, lineHeight: 1.4 }
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 3 }
const inputBase: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', outline: 'none', background: '#fff', color: '#2d2520', fontFamily: 'inherit', boxSizing: 'border-box' }
const hintText: React.CSSProperties = { fontSize: 10, color: '#9b8e84', marginTop: 2 }

function safe(v: number | undefined, fallback = 0): number {
  return typeof v === 'number' && !isNaN(v) ? v : fallback
}

// ── API Key with eye toggle ──
function ApiKeyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false)
  const isMasked = value === '••••••••'
  return (
    <div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input type={show ? 'text' : 'password'}
          value={isMasked ? '' : value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => { if (isMasked) onChange('') }}
          className="focus-ring" style={{ ...inputBase, flex: 1 }}
          placeholder={isMasked ? '•••••••• (已加密存储)' : 'sk-...'} />
        <button onClick={() => setShow(!show)} title={show ? '隐藏' : '查看'}
          style={{ background: 'none', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, cursor: 'pointer', padding: '6px 8px', color: '#9b8e84', flexShrink: 0 }}>
          {show ? <EyeSlashIcon style={{ width: 18, height: 18 }} /> : <EyeIcon style={{ width: 18, height: 18 }} />}
        </button>
      </div>
      {isMasked && <div style={{ fontSize: 9, color: '#16a34a', marginTop: 2 }}>✅ 已加密存储。如需更换，直接输入新密钥即可。</div>}
    </div>
  )
}

// ── Model Card Component ──
function ModelCard({
  icon, title, desc, modelValue, onModelChange, placeholder,
  tempValue, onTempChange, tempDisabled,
  maxTokValue, onMaxTokChange,
  ctxWinValue, onCtxWinChange,
  inPrice, onInPrice, outPrice, onOutPrice, cachePrice, onCachePrice,
  currency, onCurrency, showCtx,
  apiUrl, onApiUrl, apiKey, onApiKey,
  configId, onRefreshModels, loadingModels, modelList, showDropdown, setShowDropdown,
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
  showCtx?: boolean
  apiUrl?: string; onApiUrl?: (v: string) => void
  apiKey?: string; onApiKey?: (v: string) => void
  configId: string
  onRefreshModels: () => void; loadingModels: boolean
  modelList: string[]; showDropdown: boolean; setShowDropdown: (v: boolean) => void
  children?: React.ReactNode
}) {
  const sym = currency === 'CNY' ? '¥' : '$'
  return (
    <div style={cardInner}>
      <div style={cardTitle}>{icon} {title}</div>
      <div style={cardDesc}>{desc}</div>

      {/* Model name + refresh + dropdown */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>模型名称</label>
            <input type="text" value={modelValue} onChange={e => { onModelChange(e.target.value); setShowDropdown(false) }}
              onFocus={() => { if (modelList.length > 0) setShowDropdown(true) }}
              className="focus-ring" style={inputBase} placeholder={placeholder} />
          </div>
          <button onClick={onRefreshModels} disabled={loadingModels}
            title="从 API 获取可用模型列表"
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', marginBottom: 1, flexShrink: 0 }}>
            <ArrowPathIcon style={{ width: 16, height: 16, color: '#6b5e54', opacity: loadingModels ? 0.4 : 1 }} />
          </button>
        </div>
        {/* Dropdown */}
        {showDropdown && modelList.length > 0 && (
          <div className="custom-scrollbar" style={{
            position: 'absolute', top: '100%', left: 0, right: 42, maxHeight: 180, overflowY: 'auto',
            background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, marginTop: 2,
          }}>
            {modelList.map(m => (
              <button key={m} onClick={() => { onModelChange(m); setShowDropdown(false) }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none',
                  background: m === modelValue ? 'rgba(124,58,237,0.06)' : 'transparent',
                  color: m === modelValue ? '#7c3aed' : '#2d2520',
                  fontSize: 12, fontWeight: m === modelValue ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid rgba(0,0,0,0.04)',
                }}>
                {m}{m === modelValue ? ' ✓' : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Params row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 120px' }}>
          <label style={fieldLabel}>温度 {tempDisabled ? 'N/A' : tempValue.toFixed(1)}</label>
          <input type="range" min="0" max="2" step="0.1" value={tempValue}
            onChange={e => onTempChange(parseFloat(e.target.value))} disabled={tempDisabled}
            style={{ width: '100%', accentColor: tempDisabled ? '#ccc' : '#7c3aed', marginTop: 6 }} />
        </div>
        <div style={{ flex: '0 0 80px' }}>
          <label style={fieldLabel}>最大输出</label>
          <input type="number" min="0" value={maxTokValue} onChange={e => onMaxTokChange(parseInt(e.target.value) || 0)}
            className="focus-ring" style={{ ...inputBase, padding: '6px 8px' }} />
          <div style={hintText}>0=默认</div>
        </div>
        {showCtx && ctxWinValue !== undefined && onCtxWinChange && (
          <div style={{ flex: '0 0 80px' }}>
            <label style={fieldLabel}>上下文</label>
            <input type="number" min="1000" step="1000" value={ctxWinValue}
              onChange={e => onCtxWinChange(parseInt(e.target.value) || 128000)}
              className="focus-ring" style={{ ...inputBase, padding: '6px 8px' }} />
          </div>
        )}
        {onCurrency && (
          <div style={{ flex: '0 0 80px' }}>
            <label style={fieldLabel}>货币</label>
            <select value={currency} onChange={e => onCurrency(e.target.value as 'USD' | 'CNY')}
              style={{ ...inputBase, padding: '6px 4px', cursor: 'pointer' }}>
              <option value="USD">$ USD</option>
              <option value="CNY">¥ CNY</option>
            </select>
          </div>
        )}
      </div>

      {/* API override */}
      {onApiUrl && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>API 地址（覆盖模板默认值）</label>
            <input type="text" value={apiUrl || ''} onChange={e => onApiUrl(e.target.value)}
              className="focus-ring" style={inputBase} placeholder="留空=模板默认" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>API 密钥（覆盖模板默认值）</label>
            <ApiKeyField value={apiKey || ''} onChange={v => onApiKey?.(v)} />
          </div>
        </div>
      )}

      {/* Pricing */}
      {onInPrice && onOutPrice && onCachePrice && (
        <div style={{ display: 'flex', gap: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>输入价格 {sym}/百万t</label>
            <input type="number" step="0.01" min="0" value={inPrice || ''}
              onChange={e => onInPrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={inputBase} placeholder="0" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>输出价格 {sym}/百万t</label>
            <input type="number" step="0.01" min="0" value={outPrice || ''}
              onChange={e => onOutPrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={inputBase} placeholder="0" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>缓存命中 {sym}/百万t</label>
            <input type="number" step="0.01" min="0" value={cachePrice || ''}
              onChange={e => onCachePrice(parseFloat(e.target.value) || 0)}
              className="focus-ring" style={inputBase} placeholder="0" />
          </div>
        </div>
      )}

      {children}
    </div>
  )
}

// ── Main Tab Component ──
export function ModelSettingsTab() {
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const addConfig = useSettingsStore(s => s.addConfig)
  const updateConfig = useSettingsStore(s => s.updateConfig)
  const removeConfig = useSettingsStore(s => s.removeConfig)
  const setActiveConfig = useSettingsStore(s => s.setActiveConfig)
  const [savedAt, setSavedAt] = useState(0)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelList, setModelList] = useState<string[]>([])
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null) // 'main'|'cheap'|'reasoning'|'image'
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeConfig = configs.find(c => c.id === activeConfigId)

  // Sync to main process (debounced)
  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      settingsService.saveConfigs(configs).then(() => setSavedAt(Date.now())).catch(e => logError('Config sync failed', e))
    }, 600)
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }
  }, [configs])

  useEffect(() => { if (!savedAt) return; const t = setTimeout(() => setSavedAt(0), 3000); return () => clearTimeout(t) }, [savedAt])

  // Fetch model list from API
  const handleRefreshModels = async () => {
    if (!activeConfigId) return
    setLoadingModels(true)
    try {
      const raw = await aiService.listModels(activeConfigId)
      // IPC handler returns string[] (plain model names), not OpenAI format
      const list: string[] = Array.isArray(raw) ? raw
        : typeof raw === 'string' ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : (p.data || []) } catch { return [] } })()
        : []
      setModelList(list)
      setActiveDropdown('main') // Open dropdown after refresh
    } catch (err) { alert(`获取模型列表失败: ${err instanceof Error ? err.message : '请检查网络或API配置'}`) }
    setLoadingModels(false)
  }

  const handleAdd = () => {
    const id = nanoid(8)
    addConfig({ ...DEFAULT_MODEL_CONFIG, id, name: `配置 ${configs.length + 1}` })
    setActiveConfig(id)
  }

  if (!activeConfig) {
    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ width: 280, borderRight: '1px solid rgba(0,0,0,0.06)', padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 4 }}>模型配置模板</div>
          <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 12 }}>创建一个模板开始使用</div>
          <Button size="sm" onClick={handleAdd} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>新建模板</Button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b8e84', fontSize: 14 }}>
          选择或新建一个配置模板
        </div>
      </div>
    )
  }

  const u = (patch: Partial<ModelConfig>) => updateConfig(activeConfig.id, patch)

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* ── Left: config list ── */}
      <div style={{ width: 260, borderRight: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2d2520', marginBottom: 2 }}>模型配置模板</div>
          <div style={{ fontSize: 11, color: '#9b8e84', marginBottom: 10 }}>一键切换四模型组合</div>
          <Button size="sm" onClick={handleAdd} icon={<PlusIcon style={{ width: 14, height: 14 }} />}>新建模板</Button>
        </div>
        <ScrollArea maxHeight="100%" style={{ flex: 1 }}>
          <div style={{ padding: '8px' }}>
            {configs.length > 0 && (
              <button onClick={() => {
                if (confirm('确定要清除所有模型配置数据吗？此操作不可恢复。')) {
                  localStorage.removeItem('novel-writer-settings')
                  location.reload()
                }
              }} style={{
                width: '100%', textAlign: 'center', padding: '8px', borderRadius: 8, border: '1px dashed rgba(220,38,38,0.2)',
                background: 'transparent', color: '#dc2626', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                marginBottom: 8,
              }}>
                🗑 清除所有设置数据
              </button>
            )}
            {configs.map(config => (
              <button key={config.id} onClick={() => setActiveConfig(config.id)} style={{
                width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: 'none',
                background: activeConfigId === config.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                color: activeConfigId === config.id ? '#7c3aed' : '#4a3f38',
                fontSize: 14, fontWeight: activeConfigId === config.id ? 600 : 400, cursor: 'pointer',
                marginBottom: 2,
              }}>
                <div>{config.name}</div>
                <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 3 }}>
                  💪{config.model}{config.cheapModel ? ` ⚡${config.cheapModel}` : ''}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Right: config form ── */}
      <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
        <ScrollArea maxHeight="100%" style={{ paddingRight: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
            {savedAt > 0 && (
              <div style={{ padding: '8px 16px', borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', color: '#16a34a', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
                ✓ 已保存
              </div>
            )}

            {/* ── 模板名称 ── */}
            <div style={{ padding: '18px 22px', borderRadius: 16, background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(168,85,247,0.05))', border: '1px solid rgba(124,58,237,0.15)' }}>
              <label style={{ ...fieldLabel, fontSize: 12, color: '#7c3aed' }}>模板名称</label>
              <input type="text" value={activeConfig.name} onChange={e => u({ name: e.target.value })}
                style={{ fontSize: 18, fontWeight: 700, color: '#2d2520', border: 'none', background: 'transparent', outline: 'none', width: '100%', fontFamily: 'inherit', padding: '4px 0' }}
                placeholder="输入模板名称，如 DeepSeek全家桶" />
              <div style={{ fontSize: 10, color: '#9b8e84' }}>此名称显示在聊天窗口左下角下拉框和系统设置标题栏</div>
            </div>

            {/* ── 💪 Main ── */}
            <ModelCard
              icon="💪" title="Main 主力模型" desc="对话执行、工具调用、章节写作。下方模板默认设置作为所有子模型的共享默认值。"
              modelValue={activeConfig.model} onModelChange={v => u({ model: v })}
              placeholder="deepseek-chat / gpt-4o"
              tempValue={activeConfig.temperature} onTempChange={v => u({ temperature: v })}
              maxTokValue={activeConfig.maxTokens} onMaxTokChange={v => u({ maxTokens: v })}
              ctxWinValue={activeConfig.contextWindow ?? 128000} onCtxWinChange={v => u({ contextWindow: v })}
              inPrice={activeConfig.inputPricePerM} onInPrice={v => u({ inputPricePerM: v })}
              outPrice={activeConfig.outputPricePerM} onOutPrice={v => u({ outputPricePerM: v })}
              cachePrice={activeConfig.cacheHitPricePerM} onCachePrice={v => u({ cacheHitPricePerM: v })}
              currency={activeConfig.mainCurrency || activeConfig.currency}
              onCurrency={v => u({ mainCurrency: v })}
              apiUrl={activeConfig.mainApiUrl || activeConfig.apiUrl} onApiUrl={v => u({ mainApiUrl: v })}
              apiKey={activeConfig.mainApiKey || activeConfig.apiKey} onApiKey={v => u({ mainApiKey: v })}
              configId={activeConfig.id} onRefreshModels={handleRefreshModels} loadingModels={loadingModels}
              modelList={modelList} showDropdown={activeDropdown === 'main'} setShowDropdown={(v) => setActiveDropdown(v ? 'main' : null)}
            >
              {/* Template defaults */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ ...cardTitle, fontSize: 13, marginBottom: 8 }}>⚙️ 模板默认设置（子模型未覆盖时使用）</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 130px' }}>
                    <label style={fieldLabel}>默认服务商</label>
                    <select value={PROVIDER_PRESETS.some(p => p.name === activeConfig.provider) ? activeConfig.provider : '__custom__'}
                      onChange={e => { const v = e.target.value; if (v === '__custom__') return; const p = PROVIDER_PRESETS.find(x => x.name === v); u({ provider: v, apiUrl: p ? p.apiUrl : activeConfig.apiUrl }) }}
                      style={{ ...inputBase, cursor: 'pointer' }}>
                      {PROVIDER_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                      <option value="__custom__">自定义</option>
                    </select>
                  </div>
                  <div style={{ flex: '1 1 180px' }}>
                    <label style={fieldLabel}>默认 API 地址</label>
                    <input type="text" value={activeConfig.apiUrl} onChange={e => u({ apiUrl: e.target.value })}
                      className="focus-ring" style={inputBase} />
                  </div>
                  <div style={{ flex: '1 1 180px' }}>
                    <label style={fieldLabel}>默认 API 密钥</label>
                    <ApiKeyField value={activeConfig.apiKey} onChange={v => u({ apiKey: v })} />
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <FormField label="推理深度 (reasoning_effort)">
                    <select value={activeConfig.reasoningEffort || ''}
                      onChange={e => u({ reasoningEffort: (e.target.value || undefined) as any })}
                      style={{ ...inputBase, cursor: 'pointer' }}>
                      <option value="">默认（不传此参数）</option>
                      <option value="min">min</option><option value="low">low</option>
                      <option value="medium">medium</option><option value="high">high</option><option value="max">max</option>
                    </select>
                  </FormField>
                </div>
              </div>
            </ModelCard>

            {/* ── ⚡ Cheap ── */}
            <ModelCard
              icon="⚡" title="Cheap 便宜模型" desc="分类器 + 意图方案。速度和成本优先，建议用 Flash/Mini。留空模型名则复用 Main。"
              modelValue={activeConfig.cheapModel} onModelChange={v => u({ cheapModel: v })}
              placeholder="留空 = 复用 Main 模型"
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
              configId={activeConfig.id} onRefreshModels={handleRefreshModels} loadingModels={loadingModels}
              modelList={modelList} showDropdown={activeDropdown === 'cheap'} setShowDropdown={(v) => setActiveDropdown(v ? 'cheap' : null)}
            />

            {/* ── 🧠 Reasoning ── */}
            <ModelCard
              icon="🧠" title="Reasoning 推理模型" desc="深度分析、复杂推理。可选。推理模型通常不需要温度参数（自动禁用）。"
              modelValue={activeConfig.reasoningModel} onModelChange={v => u({ reasoningModel: v })}
              placeholder="留空 = 复用 Main 模型"
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
              configId={activeConfig.id} onRefreshModels={handleRefreshModels} loadingModels={loadingModels}
              modelList={modelList} showDropdown={activeDropdown === 'reasoning'} setShowDropdown={(v) => setActiveDropdown(v ? 'reasoning' : null)}
            />

            {/* ── 🎨 Image ── */}
            <div style={cardInner}>
              <div style={cardTitle}>🎨 Image 图片模型</div>
              <div style={cardDesc}>图片生成。留空模型名则禁用图片功能。可能使用不同于文本的 API。</div>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={fieldLabel}>模型名称</label>
                    <input type="text" value={activeConfig.imageModel} onChange={e => u({ imageModel: e.target.value })}
                      onFocus={() => { if (modelList.length > 0) setActiveDropdown('image') }}
                      className="focus-ring" style={inputBase} placeholder="留空 = 禁用图片功能（如 dall-e-3）" />
                  </div>
                  <button onClick={handleRefreshModels} disabled={loadingModels}
                    title="从 API 获取可用模型列表" style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', marginBottom: 1, flexShrink: 0 }}>
                    <ArrowPathIcon style={{ width: 16, height: 16, color: '#6b5e54', opacity: loadingModels ? 0.4 : 1 }} />
                  </button>
                </div>
                {activeDropdown === 'image' && modelList.length > 0 && (
                  <div className="custom-scrollbar" style={{
                    position: 'absolute', top: '100%', left: 0, right: 42, maxHeight: 180, overflowY: 'auto',
                    background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, marginTop: 2,
                  }}>
                    {modelList.map(m => (
                      <button key={m} onClick={() => { u({ imageModel: m }); setActiveDropdown(null) }}
                        style={{
                          width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none',
                          background: m === activeConfig.imageModel ? 'rgba(124,58,237,0.06)' : 'transparent',
                          color: m === activeConfig.imageModel ? '#7c3aed' : '#2d2520',
                          fontSize: 12, fontWeight: m === activeConfig.imageModel ? 600 : 400,
                          cursor: 'pointer', fontFamily: 'inherit', borderBottom: '1px solid rgba(0,0,0,0.04)',
                        }}>
                        {m}{m === activeConfig.imageModel ? ' ✓' : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {activeConfig.imageModel && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <div style={{ flex: '1 1 150px' }}>
                    <label style={fieldLabel}>图片 API 地址</label>
                    <input type="text" value={activeConfig.imageApiUrl || ''} onChange={e => u({ imageApiUrl: e.target.value })}
                      className="focus-ring" style={inputBase} placeholder="留空=模板默认" />
                  </div>
                  <div style={{ flex: '1 1 150px' }}>
                    <label style={fieldLabel}>图片 API 密钥</label>
                    <ApiKeyField value={activeConfig.imageApiKey || ''} onChange={v => u({ imageApiKey: v })} />
                  </div>
                  <div style={{ flex: '0 0 90px' }}>
                    <label style={fieldLabel}>费用/张</label>
                    <input type="number" step="0.01" min="0" value={safe(activeConfig.imageOutputPricePerM) || ''}
                      onChange={e => u({ imageOutputPricePerM: parseFloat(e.target.value) || 0 })}
                      className="focus-ring" style={inputBase} placeholder="0" />
                  </div>
                </div>
              )}
            </div>

            {/* ── 📚 Embedding ── */}
            <div style={cardInner}>
              <div style={cardTitle}>📚 知识库 Embedding</div>
              <div style={cardDesc}>用于知识库文件的向量化和语义搜索，独立于对话模型。</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={fieldLabel}>Embedding 模型名称</label>
                  <input type="text" value={activeConfig.embeddingModel || ''} onChange={e => u({ embeddingModel: e.target.value })}
                    className="focus-ring" style={inputBase} placeholder="text-embedding-3-small" />
                </div>
                <div style={{ flex: '1 1 150px' }}>
                  <label style={fieldLabel}>API 地址（可选覆盖）</label>
                  <input type="text" value={activeConfig.embeddingApiUrl || ''} onChange={e => u({ embeddingApiUrl: e.target.value })}
                    className="focus-ring" style={inputBase} placeholder="留空=模板默认" />
                </div>
                <div style={{ flex: '1 1 150px' }}>
                  <label style={fieldLabel}>API 密钥（可选覆盖）</label>
                  <ApiKeyField value={activeConfig.embeddingApiKey || ''} onChange={v => u({ embeddingApiKey: v })} />
                </div>
              </div>
            </div>

            {/* ── System Prompt ── */}
            <div style={cardInner}>
              <div style={cardTitle}>系统提示词</div>
              <textarea value={activeConfig.systemPrompt} onChange={e => u({ systemPrompt: e.target.value })}
                style={{ ...inputBase, minHeight: 90, resize: 'vertical', fontSize: 13, lineHeight: 1.6 }}
                placeholder="系统提示词..." />
            </div>

            {/* ── Delete ── */}
            {configs.length > 1 && (
              <button onClick={() => { removeConfig(activeConfig.id); setActiveConfig(configs[0].id !== activeConfig.id ? configs[0].id : configs[1]?.id || '') }}
                style={{
                  padding: '12px', borderRadius: 12, border: '1px solid rgba(220,38,38,0.15)', background: '#fff',
                  color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                <TrashIcon style={{ width: 16, height: 16 }} /> 删除此配置模板
              </button>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
