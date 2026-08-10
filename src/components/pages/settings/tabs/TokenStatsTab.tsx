import { useState, useEffect } from 'react'
import { useStore, useSettingsStore } from '@/store'
import { statsService } from '@/services/fileService'
import { TrashIcon } from '@heroicons/react/24/outline'
import type { UsageResult, SessionStatsResult, SessionStatEntry } from '@/types/electron'
import { logError } from '@/utils/logger'
import ConfirmModal from '@/components/common/ConfirmModal'
import { StatCard } from '../shared';

export function TokenStatsTab() {
  const activeProjectId = useStore(s => s.activeProjectId)
  const configs = useSettingsStore(s => s.configs)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const aiSettings = useSettingsStore(s => s.aiSettings)
  const currency = configs.find(c => c.id === activeConfigId)?.currency || 'USD'
  const cSym = currency === 'CNY' ? '¥' : '$'
  const [usage, setUsage] = useState<UsageResult | null>(null)
  const [sessionStats, setSessionStats] = useState<SessionStatsResult | null>(null)
  const [showSessionDetail, setShowSessionDetail] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  // v14.3.1: 当月真实总花费（跨所有项目/筛选——预算条口径与全局预算一致）
  const [monthCost, setMonthCost] = useState<number>(0)

  const [filterConfigId, setFilterConfigId] = useState('')
  const [filterModel, setFilterModel] = useState('')
  // v14.2.1: 按调用来源筛选（主 agent / 子代理 / 独立流水线 / 图片）
  const [filterSource, setFilterSource] = useState('')
  const [filterYear, setFilterYear] = useState<number | undefined>(undefined)
  const [filterMonth, setFilterMonth] = useState<number | undefined>(undefined)
  const [filterDay, setFilterDay] = useState<number | undefined>(undefined)
  const [viewMode, setViewMode] = useState<'summary' | 'byDay' | 'byConfig' | 'byModel'>('summary')
  const [showDetail, setShowDetail] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  useEffect(() => {
    const opts: Record<string, unknown> = {}
    if (activeProjectId) opts.projectId = activeProjectId
    if (filterConfigId) opts.configId = filterConfigId
    if (filterModel) opts.model = filterModel
    if (filterSource) opts.source = filterSource
    if (filterYear !== undefined) opts.year = filterYear
    if (filterMonth !== undefined) opts.month = filterMonth
    if (filterDay !== undefined) opts.day = filterDay
    statsService.getUsage(opts).then(data => setUsage(data)).catch(() => {})
  }, [activeProjectId, filterConfigId, filterModel, filterSource, filterYear, filterMonth, filterDay])

  // Session stats — load on mount and when filters change (but independently)
  useEffect(() => {
    statsService.getSessionStats().then(data => setSessionStats(data)).catch(() => {})
  }, [])

  // v14.3.1: 当月真实总花费（预算条口径：全局预算 vs 全局当月花费，不受项目/来源/日期筛选影响）
  useEffect(() => {
    statsService.getMonthCost().then(v => setMonthCost(v ?? 0)).catch(() => {})
  }, [])

  const totals = usage?.totals
  const models = [...new Set(configs.map(c => c.model))]
  const years = [new Date().getFullYear(), new Date().getFullYear() - 1]
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const days = Array.from({ length: 31 }, (_, i) => i + 1)

  return (
    <>
    <div style={{ padding: 20, borderRadius: 20, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }} className="custom-scrollbar page-enter" >
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#2d2520' }}>Token 用量统计</h4>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterConfigId} onChange={e => setFilterConfigId(e.target.value)} className="focus-ring" style={miniSelect}>
          <option value="">全部配置</option>
          {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterModel} onChange={e => setFilterModel(e.target.value)} className="focus-ring" style={miniSelect}>
          <option value="">全部模型</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {/* v14.2.1: 按调用来源筛选 — 区分主 agent / 子代理 / 独立流水线 / 图片生成 / 知识库嵌入 */}
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="focus-ring" style={miniSelect}>
          <option value="">全部来源</option>
          {(['main', 'subagent', 'pipeline', 'image', 'embedding', 'vision'] as const).map(s => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
        <select value={filterYear ?? ''} onChange={e => { setFilterYear(e.target.value ? parseInt(e.target.value) : undefined); setFilterMonth(undefined); setFilterDay(undefined) }} className="focus-ring" style={miniSelect}>
          <option value="">全部年份</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterMonth ?? ''} onChange={e => { setFilterMonth(e.target.value ? parseInt(e.target.value) : undefined); setFilterDay(undefined) }} disabled={!filterYear} className="focus-ring" style={miniSelect}>
          <option value="">全部月份</option>
          {months.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <select value={filterDay ?? ''} onChange={e => setFilterDay(e.target.value ? parseInt(e.target.value) : undefined)} disabled={!filterMonth} className="focus-ring" style={miniSelect}>
          <option value="">全部日期</option>
          {days.map(d => <option key={d} value={d}>{d}日</option>)}
        </select>
        <button onClick={() => { setFilterConfigId(''); setFilterModel(''); setFilterSource(''); setFilterYear(undefined); setFilterMonth(undefined); setFilterDay(undefined) }} className="interactive" style={{ ...miniSelect, cursor: 'pointer', border: 'none', background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>重置筛选</button>
        <button onClick={() => setConfirmAction({ title: '清空统计', message: '确定清空所有 Token 统计数据？此操作不可撤销。', onConfirm: async () => { try { await statsService.reset(); setUsage(null); setSessionStats(null); setTimeout(() => { statsService.getUsage().then(data => setUsage(data)).catch(() => {}); statsService.getSessionStats().then(data => setSessionStats(data)).catch(() => {}); }, 100); } catch (e) { logError('清除统计数据失败', e); alert('清除失败，请重试'); } } })} className="interactive" style={{ ...miniSelect, cursor: 'pointer', border: '1px solid rgba(220,38,38,0.2)', background: 'rgba(220,38,38,0.04)', color: '#dc2626', fontWeight: 600 }}>清空数据</button>
      </div>

      {/* View mode tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['summary', 'byDay', 'byConfig', 'byModel'] as const).map(mode => (
          <button key={mode} onClick={() => setViewMode(mode)} style={{
            padding: '4px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
            background: viewMode === mode ? 'rgba(124,58,237,0.08)' : 'transparent',
            color: viewMode === mode ? '#7c3aed' : '#6b5e54',
            fontWeight: viewMode === mode ? 600 : 400,
          }}>
            {mode === 'summary' ? '汇总' : mode === 'byDay' ? '按日' : mode === 'byConfig' ? '按配置' : '按模型'}
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

          {/* v14.2.1: 按来源分布（主 agent / 子代理 / 独立流水线 / 图片生成） */}
          {usage.bySource.length > 0 && !filterSource && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e54', marginBottom: 2 }}>按来源分布</div>
              {usage.bySource.map(s => (
                <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#4a3f38' }}>
                  <span style={{ minWidth: 90, fontWeight: 600 }}>{SOURCE_LABELS[s.source] || s.source}</span>
                  <span style={{ minWidth: 36, color: '#9b8e84' }}>{s.count}次</span>
                  <span style={{ minWidth: 66, color: '#2563eb' }}>入 {s.input.toLocaleString()}</span>
                  <span style={{ minWidth: 66, color: '#16a34a' }}>出 {s.output.toLocaleString()}</span>
                  {/* v14.3.1: 补缓存命中列 */}
                  <span style={{ minWidth: 66, color: '#ca8a04' }}>缓存 {s.cacheHit.toLocaleString()}</span>
                  <span style={{ color: '#7c3aed', fontWeight: 600 }}>{cSym}{s.cost.toFixed(4)}</span>
                  <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: '#7c3aed', width: totals.cost > 0 ? `${((s.cost / totals.cost) * 100).toFixed(0)}%` : '0%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Budget bar — v14.3.1: 口径修正为"全局当月真实花费"（getMonthCost，跨所有项目/不受筛选影响），
              与全局预算设置同口径；此前用筛选后的 totals.cost，多项目用户预算进度失真 */}
          {aiSettings.monthlyBudget > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b5e54', marginBottom: 4 }}>
                <span>当月预算 {cSym}{monthCost.toFixed(2)} / {cSym}{aiSettings.monthlyBudget.toFixed(2)}（全局口径）</span>
                <span style={{ color: monthCost > aiSettings.monthlyBudget ? '#dc2626' : monthCost > aiSettings.monthlyBudget * 0.8 ? '#e67e00' : '#16a34a' }}>
                  {monthCost > aiSettings.monthlyBudget ? '已超预算' : monthCost > aiSettings.monthlyBudget * 0.8 ? '接近上限' : '正常'}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, background: monthCost > aiSettings.monthlyBudget ? '#dc2626' : monthCost > aiSettings.monthlyBudget * 0.8 ? '#e67e00' : '#7c3aed', width: `${Math.min(100, (monthCost / aiSettings.monthlyBudget) * 100)}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {/* By Day view */}
          {viewMode === 'byDay' && usage.byDay.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {/* v14.3: 按日趋势折线图（手绘 SVG，无第三方依赖；DeepSeek 官网风格） */}
              <DayTrendChart data={usage.byDay} cSym={cSym} />
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>日用量明细</div>
              <div className="custom-scrollbar" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {usage.byDay.map(d => (
                  <div key={d.date} style={{ display: 'flex', gap: 12, fontSize: 11, color: '#4a3f38', padding: '5px 8px', borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                    <span style={{ minWidth: 80, fontWeight: 600 }}>{d.date}</span>
                    <span style={{ minWidth: 40, color: '#9b8e84' }}>{d.count}次</span>
                    <span style={{ minWidth: 60, color: '#2563eb' }}>入 {d.input.toLocaleString()}</span>
                    <span style={{ minWidth: 60, color: '#16a34a' }}>出 {d.output.toLocaleString()}</span>
                    {/* v14.3.1: 补缓存命中列（成本优化核心指标） */}
                    <span style={{ minWidth: 60, color: '#ca8a04' }}>缓存 {d.cacheHit.toLocaleString()}</span>
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
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#4a3f38', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, minWidth: 80 }}>{c.configName}</span>
                    <span style={{ color: '#9b8e84', minWidth: 60 }}>{c.model}</span>
                    <span style={{ minWidth: 40, color: '#9b8e84' }}>{c.count}次</span>
                    <span style={{ minWidth: 60, color: '#2563eb' }}>入 {c.input.toLocaleString()}</span>
                    <span style={{ minWidth: 60, color: '#16a34a' }}>出 {c.output.toLocaleString()}</span>
                    {/* v14.3.1: 补缓存命中列 */}
                    <span style={{ minWidth: 60, color: '#ca8a04' }}>缓存 {c.cacheHit.toLocaleString()}</span>
                    <span style={{ color: '#7c3aed', fontWeight: 600 }}>{cSym}{c.cost.toFixed(4)}</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 2, background: '#7c3aed', width: totals.cost > 0 ? `${((c.cost / totals.cost) * 100).toFixed(0)}%` : '0%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* v14.3.1: By Model view — 后端 byModel 聚合此前已计算但前端无视图 */}
          {viewMode === 'byModel' && usage.byModel.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginBottom: 8 }}>按模型统计</div>
              {usage.byModel.map(m => (
                <div key={m.model} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: '#faf9f8' }}>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#4a3f38', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, minWidth: 100 }}>{m.model}</span>
                    <span style={{ minWidth: 40, color: '#9b8e84' }}>{m.count}次</span>
                    <span style={{ minWidth: 60, color: '#2563eb' }}>入 {m.input.toLocaleString()}</span>
                    <span style={{ minWidth: 60, color: '#16a34a' }}>出 {m.output.toLocaleString()}</span>
                    <span style={{ minWidth: 60, color: '#ca8a04' }}>缓存 {m.cacheHit.toLocaleString()}</span>
                    <span style={{ color: '#7c3aed', fontWeight: 600 }}>{cSym}{m.cost.toFixed(4)}</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 2, background: '#7c3aed', width: totals.cost > 0 ? `${((m.cost / totals.cost) * 100).toFixed(0)}%` : '0%' }} />
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
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 10, color: '#6b5e54', padding: '4px 6px', borderBottom: '1px solid rgba(0,0,0,0.02)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ minWidth: 130 }}>{e.timestamp?.split('T')[0]} {e.timestamp?.split('T')[1]?.slice(0, 8)}</span>
                    <span style={{ minWidth: 60, color: '#4a3f38' }}>{e.configName || e.model}</span>
                    {/* v14.3.1: 明细补 model / source / cacheHit 列（此前记录了但 UI 不显示，无法核对成本构成） */}
                    <span style={{ minWidth: 90, color: '#9b8e84' }}>{e.model}</span>
                    <span style={{ minWidth: 44, color: '#7c3aed' }}>{SOURCE_LABELS[(e as { source?: string }).source || 'main'] || 'main'}</span>
                    <span style={{ color: '#2563eb' }}>入 {e.inputTokens.toLocaleString()}</span>
                    <span style={{ marginLeft: 6, color: '#16a34a' }}>出 {e.outputTokens.toLocaleString()}</span>
                    <span style={{ marginLeft: 6, color: '#ca8a04' }}>缓存 {((e as { cacheHitTokens?: number }).cacheHitTokens ?? 0).toLocaleString()}</span>
                    <span style={{ marginLeft: 6, color: '#7c3aed', fontWeight: 600 }}>{cSym}{((e as { cost?: number }).cost ?? 0).toFixed(4)}</span>
                    <button
                      onClick={() => setConfirmAction({ title: '删除记录', message: '确定要删除此条 Token 统计记录？', onConfirm: () => { statsService.deleteByLine(e._line).then(() => {
                          const filter = activeProjectId ? { projectId: activeProjectId } : {}
                          if (filterConfigId) Object.assign(filter, { configId: filterConfigId })
                          if (filterModel) Object.assign(filter, { model: filterModel })
                          if (filterYear !== undefined) Object.assign(filter, { year: filterYear, month: filterMonth, day: filterDay })
                          statsService.getUsage(filter).then((data: unknown) => setUsage(data as typeof usage))
                        })
                      }})}
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

      {/* ════════════════════════════════════════════════════════ */}
      {/* 会话统计 */}
      {/* ════════════════════════════════════════════════════════ */}
      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, color: '#2d2520', margin: 0 }}>会话统计</h4>
          <span style={{ fontSize: 11, color: '#9b8e84' }}>
            基于审计日志，按 Agent 会话聚合
          </span>
          <button onClick={() => setConfirmAction({ title: '清空会话统计', message: '确定清空所有会话统计记录？此操作不可撤销。', onConfirm: async () => { await statsService.resetSessions(); setSessionStats(null); setTimeout(() => statsService.getSessionStats().then(setSessionStats).catch(() => {}), 200) } })} className="interactive" style={{ ...miniSelect, cursor: 'pointer', marginLeft: 'auto', border: '1px solid rgba(220,38,38,0.2)', background: 'rgba(220,38,38,0.04)', color: '#dc2626', fontWeight: 600 }}>
            🗑 清空会话
          </button>
        </div>

        {sessionStats && sessionStats.totalSessions > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Session summary cards */}
            <div style={{ display: 'flex', gap: 12 }}>
              <StatCard label="会话数" value={sessionStats.totalSessions.toLocaleString()} color="#6b5e54" />
              <StatCard label="API 调用" value={sessionStats.totals.apiCalls.toLocaleString()} color="#2563eb" />
              <StatCard label="输入 Token" value={sessionStats.totals.promptTokens.toLocaleString()} color="#7c3aed" />
              <StatCard label="输出 Token" value={sessionStats.totals.completionTokens.toLocaleString()} color="#16a34a" />
              <StatCard label="工具调用" value={sessionStats.totals.toolCalls.toLocaleString()} color="#ca8a04" />
              {/* v14 批处理: 会话统计 API 费用合计（旧日志无 cost → 0） */}
              <StatCard label="会话花费" value={`$${sessionStats.totals.cost.toFixed(4)}`} color="#0f766e" />
            </div>

            {/* Session list */}
            <div style={{ marginTop: 4 }}>
              <button
                onClick={() => setShowSessionDetail(!showSessionDetail)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', padding: 0 }}
              >
                {showSessionDetail ? '收起' : '展开'}会话明细 ({sessionStats.sessions.length} 个)
              </button>

              {showSessionDetail && (
                <div className="custom-scrollbar" style={{ maxHeight: 400, overflowY: 'auto', marginTop: 8 }}>
                  {sessionStats.sessions.map(s => {
                    const isExpanded = expandedSessions.has(s.sessionId)
                    const durMin = Math.floor(s.duration / 60)
                    const durSec = s.duration % 60
                    return (
                      <div key={s.sessionId} style={{
                        marginBottom: 8, borderRadius: 10,
                        border: '1px solid rgba(0,0,0,0.05)',
                        background: '#faf9f8',
                        overflow: 'hidden',
                      }}>
                        {/* Session header */}
                        <div
                          onClick={() => {
                            setExpandedSessions(prev => {
                              const next = new Set(prev)
                              next.has(s.sessionId) ? next.delete(s.sessionId) : next.add(s.sessionId)
                              return next
                            })
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 14px', cursor: 'pointer',
                            transition: 'background 0.1s',
                          }}
                        >
                          <span style={{ fontSize: 10, color: isExpanded ? '#7c3aed' : '#9b8e84', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2520', minWidth: 100 }}>
                            {s.startedAt ? new Date(s.startedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + new Date(s.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : s.sessionId}
                          </span>
                          <span style={{ fontSize: 11, color: '#9b8e84' }}>
                            {durMin > 0 ? `${durMin}分${durSec}秒` : `${durSec}秒`}
                          </span>
                          <span style={{ fontSize: 11, color: '#2563eb', marginLeft: 'auto' }}>
                            {s.apiCallCount} 次API
                          </span>
                          <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>
                            {(s.promptTokens + s.completionTokens).toLocaleString()} tok
                          </span>
                          {s.errorCount > 0 && (
                            <span style={{ fontSize: 10, color: '#dc2626', background: 'rgba(220,38,38,0.06)', padding: '1px 6px', borderRadius: 6 }}>
                              {s.errorCount} 错误
                            </span>
                          )}
                          {/* v14 批处理: 失败/拒绝信号徽章（最有价值的运营数据） */}
                          {s.toolErrors > 0 && (
                            <span style={{ fontSize: 10, color: '#ea580c', background: 'rgba(234,88,12,0.06)', padding: '1px 6px', borderRadius: 6 }}>
                              {s.toolErrors} 工具失败
                            </span>
                          )}
                          {s.permissionDenied > 0 && (
                            <span style={{ fontSize: 10, color: '#9333ea', background: 'rgba(147,51,234,0.06)', padding: '1px 6px', borderRadius: 6 }}>
                              {s.permissionDenied} 权限拒绝
                            </span>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmAction({ title: '删除会话记录', message: `确定删除会话 ${s.sessionId.slice(0, 8)}... 的记录？`, onConfirm: async () => { await statsService.deleteSession(s.sessionId); statsService.getSessionStats().then(setSessionStats).catch(() => {}) } }) }}
                            title="删除此会话"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#d4ccc4', marginLeft: 'auto', flexShrink: 0 }}
                          >
                            <TrashIcon style={{ width: 12, height: 12 }} />
                          </button>
                        </div>

                        {/* Session detail (expanded) */}
                        {isExpanded && (
                          <div style={{ padding: '8px 14px 12px 36px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                            {/* Token breakdown */}
                            <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 11 }}>
                              <span style={{ color: '#2563eb' }}>输入: {s.promptTokens.toLocaleString()}</span>
                              <span style={{ color: '#16a34a' }}>输出: {s.completionTokens.toLocaleString()}</span>
                              <span style={{ color: '#9b8e84' }}>合计: {s.totalTokens.toLocaleString()}</span>
                              {/* v14 批处理: 会话级费用与最后使用时间 */}
                              <span style={{ color: '#0f766e' }}>花费: ${s.cost.toFixed(4)}</span>
                              <span style={{ color: '#9b8e84', marginLeft: 'auto' }}>
                                最后使用: {s.lastUsed ? new Date(s.lastUsed).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                              </span>
                            </div>

                            {/* Operations */}
                            {s.operations.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: 11, color: '#6b5e54', fontWeight: 600, marginBottom: 4 }}>操作记录</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {s.operations.map((op, i) => (
                                    <span key={i} style={{
                                      fontSize: 10, color: '#4a3f38',
                                      background: 'rgba(124,58,237,0.04)',
                                      border: '1px solid rgba(124,58,237,0.08)',
                                      padding: '2px 8px', borderRadius: 6,
                                    }}>
                                      {op}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Tools used */}
                            {s.toolCalls.length > 0 && (
                              <div>
                                <div style={{ fontSize: 11, color: '#6b5e54', fontWeight: 600, marginBottom: 4 }}>工具使用</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {s.toolCalls.map(tc => (
                                    <span key={tc.toolName} style={{
                                      fontSize: 10, color: '#ca8a04',
                                      background: 'rgba(202,138,4,0.06)',
                                      border: '1px solid rgba(202,138,4,0.1)',
                                      padding: '2px 8px', borderRadius: 6,
                                    }}>
                                      {tc.toolName} ×{tc.count}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: '#9b8e84', lineHeight: 1.8 }}>
            暂无会话统计。使用 AI Agent 功能后，每次会话的 API 调用和工具操作将在此展示。
          </p>
        )}
      </div>
    </div>
    {/* 通用确认弹窗 */}
    {confirmAction && (
      <ConfirmModal
        isOpen={true}
        title={confirmAction.title}
        message={confirmAction.message}
        confirmLabel="确定"
        danger
        onConfirm={() => { confirmAction.onConfirm(); setConfirmAction(null) }}
        onCancel={() => setConfirmAction(null)}
      />
    )}
    </>
  )
}

const miniSelect: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)',
  outline: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#4a3f38',
}

// v14.2.1: 调用来源显示名（main/subagent/pipeline/image）；v14 批处理: +embedding；v16.2.0: +vision（副模型图片理解）
const SOURCE_LABELS: Record<string, string> = {
  main: '主 agent', subagent: '子代理', pipeline: '独立流水线', image: '图片生成', embedding: '知识库嵌入', vision: '副模型看图',
}

// ════════════════════════════════════════════════════════════
// v14.3: 按日趋势折线图（手绘 SVG，无第三方依赖）
// 系列可切换：调用次数 / 输入 / 输出 / 缓存命中 / 花费；hover 显示当日数值
// ════════════════════════════════════════════════════════════

type TrendSeries = 'count' | 'input' | 'output' | 'cacheHit' | 'cost'

const TREND_SERIES_META: Record<TrendSeries, { label: string; color: string }> = {
  count: { label: '调用次数', color: '#6b5e54' },
  input: { label: '输入 Token', color: '#2563eb' },
  output: { label: '输出 Token', color: '#16a34a' },
  cacheHit: { label: '缓存命中', color: '#ca8a04' },
  cost: { label: '花费', color: '#7c3aed' },
}

interface TrendDay { date: string; count: number; input: number; output: number; cacheHit: number; cost: number }

function DayTrendChart({ data, cSym }: { data: TrendDay[]; cSym: string }) {
  const [series, setSeries] = useState<TrendSeries>('input')
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) return null
  const W = 720
  const H = 180
  const PAD = { top: 18, right: 14, bottom: 24, left: 52 }
  // byDay 为降序（新→旧）→ 图表升序（旧→新）
  const ascending = [...data].reverse()
  const getVal = (d: TrendDay) => series === 'count' ? d.count
    : series === 'input' ? d.input
    : series === 'output' ? d.output
    : series === 'cacheHit' ? d.cacheHit
    : d.cost
  const values = ascending.map(getVal)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const x = (i: number) => PAD.left + (ascending.length === 1 ? (W - PAD.left - PAD.right) / 2 : (i / (ascending.length - 1)) * (W - PAD.left - PAD.right))
  const y = (v: number) => H - PAD.bottom - ((v - min) / range) * (H - PAD.top - PAD.bottom)
  const linePts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const areaPts = `${PAD.left},${H - PAD.bottom} ${linePts} ${x(ascending.length - 1).toFixed(1)},${H - PAD.bottom}`
  const meta = TREND_SERIES_META[series]
  const fmt = (v: number) => series === 'cost' ? `${cSym}${v.toFixed(4)}` : v.toLocaleString()

  // 底部日期标签：最多 6 个（首/尾 + 均匀取点）
  const labelIdx: number[] = []
  if (ascending.length <= 6) {
    for (let i = 0; i < ascending.length; i++) labelIdx.push(i)
  } else {
    for (let k = 0; k < 6; k++) labelIdx.push(Math.round((k / 5) * (ascending.length - 1)))
  }
  const uniqLabelIdx = [...new Set(labelIdx)]

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < ascending.length; i++) {
      const d = Math.abs(x(i) - px)
      if (d < bestDist) { bestDist = d; best = i }
    }
    setHover(best)
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6b5e54', marginRight: 4 }}>日趋势</span>
        {(Object.keys(TREND_SERIES_META) as TrendSeries[]).map(s => (
          <button key={s} onClick={() => setSeries(s)} style={{
            padding: '2px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11,
            background: series === s ? `${TREND_SERIES_META[s].color}14` : 'transparent',
            color: series === s ? TREND_SERIES_META[s].color : '#9b8e84',
            fontWeight: series === s ? 600 : 400,
          }}>
            {TREND_SERIES_META[s].label}
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }} className="custom-scrollbar">
        <svg
          width="100%"
          style={{ minWidth: 360, display: 'block' }}
          viewBox={`0 0 ${W} ${H}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* 网格线 */}
          {[0, 0.25, 0.5, 0.75, 1].map(t => {
            const gy = PAD.top + t * (H - PAD.top - PAD.bottom)
            return (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy} stroke="rgba(0,0,0,0.05)" strokeWidth={1} />
                <text x={PAD.left - 6} y={gy + 3} textAnchor="end" fontSize={9} fill="#b8aca1">
                  {fmt(Math.round(min + (1 - t) * range))}
                </text>
              </g>
            )
          })}
          {/* 面积 */}
          <polygon points={areaPts} fill={meta.color} opacity={0.08} />
          {/* 折线 */}
          <polyline points={linePts} fill="none" stroke={meta.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* 数据点 */}
          {values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={ascending.length <= 30 ? 2.4 : 1.6} fill="#fff" stroke={meta.color} strokeWidth={1.5} />
          ))}
          {/* hover 指示 */}
          {hover !== null && hover >= 0 && hover < ascending.length && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke={meta.color} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
              <circle cx={x(hover)} cy={y(values[hover])} r={4} fill={meta.color} stroke="#fff" strokeWidth={2} />
              <rect
                x={Math.min(Math.max(x(hover) - 46, 2), W - 100)}
                y={Math.max(PAD.top - 26, 2)}
                width={92} height={22} rx={6}
                fill="rgba(45,37,32,0.85)"
              />
              <text x={Math.min(Math.max(x(hover), 46), W - 48)} y={Math.max(PAD.top - 10, 13)} textAnchor="middle" fontSize={9.5} fill="#fff">
                {ascending[hover].date.slice(5)} · {fmt(values[hover])}
              </text>
            </g>
          )}
          {/* 日期标签 */}
          {uniqLabelIdx.map(i => (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#b8aca1">
              {ascending[i].date.slice(5)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}
