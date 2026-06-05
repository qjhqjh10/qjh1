import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store'
import { settingsService, aiService } from '@/services/fileService'
import { nanoid } from 'nanoid'
import Button from '@/components/common/Button'
import ScrollArea from '@/components/common/ScrollArea'
import { PlusIcon, TrashIcon, ArrowPathIcon, EyeIcon, EyeSlashIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import type { ModelConfig } from '@/types/settings'
import { DEFAULT_MODEL_CONFIG, PROVIDER_PRESETS, IMAGE_PROVIDER_PRESETS } from '@/types/settings'
import type { ProviderPreset } from '@/types/settings'
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const isMasked = value === '••••••••'

  const startEditing = () => {
    if (isMasked) { setEditing(true); setDraft('') }
  }

  const commitOrCancel = () => {
    if (!editing) return
    // 只有用户确实输入了新内容才保存，否则恢复
    if (draft.trim()) onChange(draft.trim())
    setEditing(false)
    setDraft('')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input type={show ? 'text' : 'password'}
          value={editing ? draft : (isMasked ? '' : value)}
          onChange={e => { setDraft(e.target.value); if (!editing) setEditing(true) }}
          onFocus={startEditing}
          onBlur={commitOrCancel}
          onKeyDown={e => { if (e.key === 'Enter') commitOrCancel() }}
          className="focus-ring" style={{ ...inputBase, flex: 1 }}
          placeholder={isMasked && !editing ? '•••••••• (已加密存储)' : 'sk-...'} />
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
  currency, onCurrency,
  apiUrl, onApiUrl, apiKey, onApiKey,
  provider, onProvider, protocol, onProtocol,
  showMainFields, apiUrlHint, providerPresets,
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
  apiUrl?: string; onApiUrl?: (v: string) => void
  apiKey?: string; onApiKey?: (v: string) => void
  provider?: string; onProvider?: (v: string) => void
  protocol?: string; onProtocol?: (v: string) => void
  showMainFields?: boolean
  apiUrlHint?: string  // 自定义 API URL 提示文本
  providerPresets?: ProviderPreset[]  // 自定义服务商列表（图片模型用 IMAGE_PROVIDER_PRESETS）
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

      {/* ── 提供商 + 协议 + API 地址（仅 Main 模型显示） ── */}
      {showMainFields && provider !== undefined && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: '1 1 120px' }}>
            <label style={fieldLabel}>服务商 Provider</label>
            {(() => {
              const presets = providerPresets || PROVIDER_PRESETS
              return (<>
            <select value={presets.some(p => p.name === provider) ? provider : '__custom__'}
              onChange={e => {
                const v = e.target.value
                if (v === '__custom__') { onProvider?.(''); return }
                const p = presets.find(x => x.name === v)
                onProvider?.(v)
                if (p?.apiUrl) onApiUrl?.(p.apiUrl)
              }}
              style={{ ...inputBase, cursor: 'pointer' }}>
              {presets.map(p => <option key={p.name} value={p.name}>{p.label}</option>)}
              <option value="__custom__">自定义（手动填写地址和密钥）</option>
            </select>
            <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 2 }}>列表中没有你的服务商？选"自定义"后直接在下方地址栏输入 API URL 即可</div>
              </>)
            })()}
          </div>
          {onProtocol && (
            <div style={{ flex: '1 1 200px' }}>
              <label style={fieldLabel}>协议 Protocol</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <div style={{ display: 'flex', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', overflow: 'hidden', flex: 1 }}>
                  <button onClick={() => onProtocol('openai')}
                    style={{ flex:1, padding:'7px 10px', border:'none', cursor:'pointer', fontSize:11, fontWeight:protocol!=='anthropic'?700:400, background:protocol!=='anthropic'?'rgba(124,58,237,0.08)':'#fff', color:protocol!=='anthropic'?'#7c3aed':'#9b8e84', fontFamily:'inherit' }}
                    title="OpenAI 兼容协议 — tool_calls 数组格式">OpenAI</button>
                  <button onClick={() => onProtocol('anthropic')}
                    style={{ flex:1, padding:'7px 10px', border:'none', borderLeft:'1px solid rgba(0,0,0,0.06)', cursor:'pointer', fontSize:11, fontWeight:protocol==='anthropic'?700:400, background:protocol==='anthropic'?'rgba(22,163,74,0.08)':'#fff', color:protocol==='anthropic'?'#16a34a':'#9b8e84', fontFamily:'inherit' }}
                    title="Anthropic Messages API — 流式 content blocks">Anthropic</button>
                </div>
                <button
                  onClick={() => onProtocol('openai')}
                  title="图片模型始终使用 OpenAI Images API。无论 Main 协议选什么，图片生成独立工作。如需单模型同时处理文本+图片，请切换到 OpenAI。"
                  style={{
                    padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.3)',
                    background: 'rgba(245,158,11,0.06)', color: '#b45309',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >🎨 图片</button>
              </div>
            </div>
          )}
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabel}>地址 API URL</label>
            <input type="text" value={apiUrl || ''} onChange={e => onApiUrl?.(e.target.value)}
              className="focus-ring" style={{ ...inputBase, fontSize: 12 }} />
            <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 2 }}>
              {apiUrlHint || (protocol === 'anthropic' ? 'DeepSeek Anthropic: https://api.deepseek.com/anthropic' : 'DeepSeek: https://api.deepseek.com')}
            </div>
          </div>
          {onApiKey && apiKey !== undefined && (
            <div style={{ flex: '1 1 160px' }}>
              <label style={fieldLabel}>密钥 API Key</label>
              <ApiKeyField value={apiKey} onChange={v => onApiKey(v)} />
            </div>
          )}
        </div>
      )}

      {/* Model name + params row — 四等分，各自居中 */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
          {/* 模型名称 + 刷新 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <label style={fieldLabel}>模型名称 Model</label>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', width: '100%' }}>
              <input type="text" value={modelValue} onChange={e => { onModelChange(e.target.value); setShowDropdown(false) }}
                onFocus={() => { if (modelList.length > 0) setShowDropdown(true) }}
                className="focus-ring" style={{ ...inputBase, flex: 1, paddingRight: 4 }} placeholder={placeholder} />
              {modelList.length > 0 && (
                <button onClick={() => setShowDropdown(!showDropdown)}
                  title={showDropdown ? '收起模型列表' : '展开模型列表'}
                  style={{ padding: '7px 6px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: showDropdown ? 'rgba(124,58,237,0.06)' : '#fff', cursor: 'pointer', flexShrink: 0 }}>
                  <ChevronDownIcon style={{ width: 14, height: 14, color: '#6b5e54', transform: showDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>
              )}
              <button onClick={onRefreshModels} disabled={loadingModels}
                title="从 API 获取可用模型列表" style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', flexShrink: 0 }}>
                <ArrowPathIcon style={{ width: 16, height: 16, color: '#6b5e54', opacity: loadingModels ? 0.4 : 1 }} />
              </button>
            </div>
          </div>
          {/* 温度 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <label style={fieldLabel}>温度 Temp {tempDisabled ? 'N/A' : tempValue.toFixed(1)}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', maxWidth: 180 }}>
              <span style={{ fontSize: 9, color: '#9b8e84' }}>0.1</span>
              <input type="range" min="0" max="2" step="0.1" value={tempValue}
                onChange={e => onTempChange(parseFloat(e.target.value))} disabled={tempDisabled}
                style={{ flex: 1, accentColor: tempDisabled ? '#ccc' : '#7c3aed' }} />
              <span style={{ fontSize: 9, color: '#9b8e84' }}>2</span>
            </div>
          </div>
          {/* 最大输出 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <label style={fieldLabel}>最大输出 Max Tokens</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" min="0" value={maxTokValue} onChange={e => onMaxTokChange(parseInt(e.target.value) || 0)}
                className="focus-ring" style={{ ...inputBase, padding: '6px 8px', width: 60 }} />
              <span style={{ fontSize: 9, color: '#9b8e84', whiteSpace: 'nowrap' }}>0=默认</span>
            </div>
          </div>
          {/* 上下文窗口 */}
          {ctxWinValue !== undefined && onCtxWinChange && (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <label style={fieldLabel}>上下文 Context</label>
              <input type="number" min="1000" step="1000" value={ctxWinValue}
                onChange={e => { const v = parseInt(e.target.value); onCtxWinChange(isNaN(v) ? 128000 : v) }}
                className="focus-ring" style={{ ...inputBase, width: '100%' }} />
            </div>
          )}
        </div>
        {/* Dropdown — 模型选择弹窗 */}
        {showDropdown && modelList.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 220, overflowY: 'auto',
            background: '#fff', borderRadius: 12, border: '1px solid rgba(0,0,0,0.12)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.15)', zIndex: 50, marginTop: 4,
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

      {/* API override — only for sub-models (Image), hidden when Main has top-row fields */}
      {!showMainFields && onApiUrl && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>地址 API URL</label>
            <input type="text" value={apiUrl || ''} onChange={e => onApiUrl(e.target.value)}
              className="focus-ring" style={inputBase} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>密钥 API Key</label>
            <ApiKeyField value={apiKey || ''} onChange={v => onApiKey?.(v)} />
          </div>
        </div>
      )}

      {/* Pricing + Currency — single row */}
      {/* cacheHitPricePerM = 输入（缓存命中）= 折扣价 | inputPricePerM = 输入（缓存未命中）= 全价 | outputPricePerM = 输出 */}
      {(onInPrice || onOutPrice) && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {onCurrency && (
            <div style={{ flex: '0 0 60px' }}>
              <label style={fieldLabel}>货币</label>
              <select value={currency} onChange={e => onCurrency(e.target.value as 'USD' | 'CNY')}
                style={{ ...inputBase, padding: '7px 4px', cursor: 'pointer', fontSize: 12 }}>
                <option value="USD">$</option>
                <option value="CNY">¥</option>
              </select>
              <div style={{ ...hintText, visibility: 'hidden' }}>.</div>
            </div>
          )}
          {onCachePrice && (
            <div style={{ flex: '1 1 120px' }}>
              <label style={fieldLabel}>输入缓存命中 Cache Hit</label>
              <input type="number" step="0.01" min="0" value={cachePrice || ''}
                onChange={e => onCachePrice(parseFloat(e.target.value) || 0)}
                className="focus-ring" style={inputBase} placeholder="0" />
              <div style={hintText}>{sym}/百万t（折扣价）</div>
            </div>
          )}
          {onInPrice && (
            <div style={{ flex: '1 1 120px' }}>
              <label style={fieldLabel}>输入缓存未命中 Cache Miss</label>
              <input type="number" step="0.01" min="0" value={inPrice || ''}
                onChange={e => onInPrice(parseFloat(e.target.value) || 0)}
                className="focus-ring" style={inputBase} placeholder="0" />
              <div style={hintText}>{sym}/百万t（全价）</div>
            </div>
          )}
          {onOutPrice && (
            <div style={{ flex: '1 1 120px' }}>
              <label style={fieldLabel}>输出 Output</label>
              <input type="number" step="0.01" min="0" value={outPrice || ''}
                onChange={e => onOutPrice(parseFloat(e.target.value) || 0)}
                className="focus-ring" style={inputBase} placeholder="0" />
              <div style={hintText}>{sym}/百万t</div>
            </div>
          )}
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
  const [loadingMainModels, setLoadingMainModels] = useState(false)
  const [loadingImageModels, setLoadingImageModels] = useState(false)
  const [mainModelList, setMainModelList] = useState<string[]>([])
  const [imageModelList, setImageModelList] = useState<string[]>([])
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null) // 'main'|'image'
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

  // Fetch model list from API — per-card (main / image)
  const handleRefreshModels = async (card: 'main' | 'image') => {
    const currentConfigId = useSettingsStore.getState().activeConfigId
    if (!currentConfigId) return
    if (card === 'main') setLoadingMainModels(true)
    else setLoadingImageModels(true)
    try {
      // 强制立即保存配置，确保 API 密钥已同步到主进程
      await settingsService.saveConfigs(useSettingsStore.getState().configs)
      // scope='image': 如果用户配置了独立的图片 API，使用图片专用密钥和地址；否则回退到 Main 配置
      const scope = card === 'image' ? 'image' : undefined
      const raw = await aiService.listModels(currentConfigId, scope)
      const list: string[] = Array.isArray(raw) ? raw
        : typeof raw === 'string' ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : (p.data || []) } catch { return [] } })()
        : []
      if (list.length === 0) {
        alert('未获取到模型列表。\n\n可能原因：\n1. API 地址不正确（检查地址格式）\n2. API 密钥无效或未填写\n3. 网络连接问题\n4. 该服务商不支持 /models 端点\n\n请检查设置后重试。')
      }
      if (card === 'main') { setMainModelList(list); if (list.length > 0) setActiveDropdown('main') }
      else { setImageModelList(list); if (list.length > 0) setActiveDropdown('image') }
    } catch (err) { alert(`获取模型列表失败: ${err instanceof Error ? err.message : '请检查网络或API配置'}`) }
    if (card === 'main') setLoadingMainModels(false)
    else setLoadingImageModels(false)
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
              <button onClick={async () => {
                if (confirm('确定要清除所有模型配置数据吗？此操作不可恢复。')) {
                  await settingsService.clearConfigs().catch(() => {})
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
              <div key={config.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                <button onClick={() => setActiveConfig(config.id)} style={{
                  flex: 1, textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: 'none',
                  background: activeConfigId === config.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                  color: activeConfigId === config.id ? '#7c3aed' : '#4a3f38',
                  fontSize: 14, fontWeight: activeConfigId === config.id ? 600 : 400, cursor: 'pointer',
                }}>
                  <div>{config.name}</div>
                  <div style={{ fontSize: 10, color: '#9b8e84', marginTop: 3, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>💪{config.model}{config.imageModel ? ` 🎨${config.imageModel}` : ''}</span>
                    <span style={{
                      display: 'inline-block', padding: '0 5px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                      background: (config as any).protocol === 'anthropic' ? 'rgba(22,163,74,0.1)' : 'rgba(59,130,246,0.08)',
                      color: (config as any).protocol === 'anthropic' ? '#16a34a' : '#3b82f6',
                    }}>{(config as any).protocol === 'anthropic' ? 'ANT' : 'OAI'}</span>
                  </div>
                </button>
                <button onClick={(e) => { e.stopPropagation(); removeConfig(config.id); if (activeConfigId === config.id) { const latest = useSettingsStore.getState().configs; setActiveConfig(latest.filter(c => c.id !== config.id)[0]?.id || null) } }}
                    title="删除此配置" style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: 8,
                      color: '#d4ccc4', flexShrink: 0,
                    }}>
                    <TrashIcon style={{ width: 16, height: 16 }} />
                  </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Right: config form ── */}
      <div style={{ flex: 1, overflow: 'auto' }} className="custom-scrollbar">
        <ScrollArea maxHeight="100%" style={{ paddingRight: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>

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
              icon="💪" title="Main 主力模型" desc="AI写作助手核心模型 — 对话执行、工具调用、章节创作。"
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
              apiUrl={activeConfig.apiUrl} onApiUrl={v => u({ apiUrl: v })}
              apiKey={activeConfig.apiKey} onApiKey={v => u({ apiKey: v })}
              provider={activeConfig.provider} onProvider={v => u({ provider: v, mainProvider: v })}
              protocol={(activeConfig as any).protocol || 'openai'} onProtocol={v => u({ protocol: v as 'openai' | 'anthropic' })}
              showMainFields={true}
              configId={activeConfig.id} onRefreshModels={() => handleRefreshModels('main')} loadingModels={loadingMainModels}
              modelList={mainModelList} showDropdown={activeDropdown === 'main'} setShowDropdown={(v) => setActiveDropdown(v ? 'main' : null)}
            />

            {/* ── 🎨 Image ── */}
            <ModelCard
              icon="🎨" title="Image 图片模型" desc="图片生成。留空模型名则禁用；若图片与 Main 提供商不同，请填写独立 API 地址和密钥。"
              modelValue={activeConfig.imageModel} onModelChange={v => u({ imageModel: v })}
              placeholder="留空 = 禁用（如 dall-e-3）"
              tempValue={0} onTempChange={() => {}} tempDisabled
              maxTokValue={0} onMaxTokChange={() => {}}
              inPrice={safe(activeConfig.imageInputPricePerM)} onInPrice={v => u({ imageInputPricePerM: v })}
              outPrice={safe(activeConfig.imageOutputPricePerM)} onOutPrice={v => u({ imageOutputPricePerM: v })}
              cachePrice={0}
              currency={activeConfig.mainCurrency || activeConfig.currency}
              apiUrl={activeConfig.imageApiUrl || activeConfig.apiUrl} onApiUrl={v => u({ imageApiUrl: v })}
              apiKey={activeConfig.imageApiKey || ''} onApiKey={v => u({ imageApiKey: v })}
              provider={activeConfig.imageProvider || activeConfig.provider}
              onProvider={v => u({ imageProvider: v })}
              apiUrlHint="图片 API 地址（DALL-E / FLUX / SD — 需支持 OpenAI Images 端点）"
              providerPresets={IMAGE_PROVIDER_PRESETS}
              showMainFields={true}
              configId={activeConfig.id} onRefreshModels={() => handleRefreshModels('image')} loadingModels={loadingImageModels}
              modelList={imageModelList} showDropdown={activeDropdown === 'image'} setShowDropdown={(v) => setActiveDropdown(v ? 'image' : null)}
            >
              <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(124,58,237,0.04)', fontSize: 10, color: '#6b5e54', lineHeight: 1.5 }}>
                💡 定价说明：DALL-E 等专用图片模型按 <b>每张图</b> 计费（填入单价如 0.04），GPT-4o 等多模态模型按 <b>token</b> 计费（结合 Main 模型价格）。<br />
                ⚠️ 未填写独立 API 密钥时，图片生成将共用 Main 模型的 API 连接。
              </div>
            </ModelCard>

            {/* ── 📚 Embedding ── */}
            <div style={cardInner}>
              <div style={cardTitle}>📚 知识库 Embedding</div>
              <div style={cardDesc}>用于知识库文件的向量化和语义搜索，独立于对话模型。</div>
              <div>
                <label style={fieldLabel}>模型名称 Embedding Model</label>
                <input type="text" value={activeConfig.embeddingModel || ''} onChange={e => u({ embeddingModel: e.target.value })}
                  className="focus-ring" style={{ ...inputBase, maxWidth: 360 }} placeholder="text-embedding-3-small" />
                <div style={hintText}>使用模板默认的 API 地址和密钥连接</div>
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
            <button onClick={() => { removeConfig(activeConfig.id); const latest = useSettingsStore.getState().configs; setActiveConfig(latest.filter(c => c.id !== activeConfig.id)[0]?.id || null) }}
                style={{
                  padding: '12px', borderRadius: 12, border: '1px solid rgba(220,38,38,0.15)', background: '#fff',
                  color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                <TrashIcon style={{ width: 16, height: 16 }} /> 删除此配置模板
              </button>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
