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
import { FormField, StatCard } from '../shared';

export function TokenStatsTab() {
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
