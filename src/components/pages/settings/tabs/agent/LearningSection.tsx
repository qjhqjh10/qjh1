import { useState, useEffect, useCallback } from 'react'
import { fileService } from '@/services/fileService'
import { SkeletonList } from '@/components/common/Skeleton'
import { TrashIcon, PencilIcon, PlusIcon, ArrowDownTrayIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useSettingsStore } from '@/store'

interface LearnedPattern {
  key: string
  toolName: string
  errorSummary: string
  count: number
  firstSession: string
  lastSession: string
}

export function LearningSection() {
  const [patterns, setPatterns] = useState<LearnedPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editTool, setEditTool] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const LEARNED_PATH = '.aiharness/cli-learned.json'

  const loadData = useCallback(async () => {
    setLoading(true)
    const all: LearnedPattern[] = []
    try {
      // CLI learner patterns
      const raw = await fileService.read(LEARNED_PATH)
      if (raw && raw.trim()) {
        const cli = JSON.parse(raw)
        if (Array.isArray(cli)) all.push(...cli)
      }
    } catch { /* no CLI learned yet */ }
    try {
      // Electron learned rules
      const files = await fileService.listDir('.aiharness/learned')
      for (const f of files.filter((f: string) => f.endsWith('.json')).slice(0, 20)) {
        try {
          const raw = await fileService.read(`.aiharness/learned/${f}`)
          const rule = JSON.parse(raw)
          all.push({
            key: rule.id || f.replace('.json', ''),
            toolName: rule.toolName || rule.trigger || 'unknown',
            errorSummary: rule.errorSummary || rule.problem || '',
            count: rule.count || rule.occurrenceCount || 1,
            firstSession: rule.firstSession || rule.createdAt?.slice(0, 10) || '?',
            lastSession: rule.lastSession || rule.updatedAt?.slice(0, 10) || '?',
          })
        } catch { /* skip corrupt */ }
      }
    } catch { /* no learned dir */ }
    setPatterns(all.sort((a, b) => b.count - a.count))
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const saveAll = async (updated: LearnedPattern[]) => {
    try {
      await fileService.ensureDir('.aiharness')
      await fileService.write(LEARNED_PATH, JSON.stringify(updated, null, 2))
      setPatterns(updated)
    } catch (e) { console.error('保存学习数据失败', e) }
  }

  const handleDelete = async (key: string) => {
    const updated = patterns.filter(p => p.key !== key)
    await saveAll(updated)
    setConfirmDelete(null)
  }

  const handleClearAll = async () => {
    await saveAll([])
  }

  const handleStartEdit = (p: LearnedPattern) => {
    setEditingKey(p.key)
    setEditTool(p.toolName)
    setEditSummary(p.errorSummary)
  }

  const handleSaveEdit = async () => {
    const updated = patterns.map(p =>
      p.key === editingKey ? { ...p, toolName: editTool, errorSummary: editSummary } : p
    )
    await saveAll(updated)
    setEditingKey(null)
  }

  const handleAdd = async () => {
    const newPattern: LearnedPattern = {
      key: `manual_${Date.now().toString(36)}`,
      toolName: '新工具',
      errorSummary: '新错误描述',
      count: 1,
      firstSession: new Date().toISOString().slice(0, 10),
      lastSession: new Date().toISOString().slice(0, 10),
    }
    const updated = [newPattern, ...patterns]
    await saveAll(updated)
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(patterns, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'cli-learned-export.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const activeCount = patterns.filter(p => p.count >= 2).length
  const pendingCount = patterns.filter(p => p.count === 1).length

  if (loading) return <div style={{ padding: 12 }}><SkeletonList count={4} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: '100%', paddingRight: 4 }} className="custom-scrollbar">
      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.12)', color: '#059669', fontWeight: 600 }}>
          活跃 {activeCount} 条
        </div>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)', color: '#9b8e84', fontWeight: 600 }}>
          待确认 {pendingCount} 条
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} title="导出学习数据" style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', cursor: 'pointer', fontSize: 11, color: '#6b5e54', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
          <ArrowDownTrayIcon style={{ width: 12, height: 12 }} /> 导出
        </button>
        <button onClick={handleAdd} title="手动添加学习条目" style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(124,58,237,0.15)', background: 'rgba(124,58,237,0.04)', cursor: 'pointer', fontSize: 11, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
          <PlusIcon style={{ width: 12, height: 12 }} /> 添加
        </button>
      </div>

      {/* Empty state */}
      {patterns.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#9b8e84', fontSize: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
          <div style={{ fontWeight: 600, color: '#6b5e54', marginBottom: 4 }}>暂无学习记录</div>
          <div>当 AI 在同一会话中犯同类错误 ≥2 次时，系统会自动记录。</div>
          <div style={{ marginTop: 4 }}>也可以手动添加学习条目。</div>
        </div>
      )}

      {/* Pattern list */}
      {patterns.map(p => {
        const isActive = p.count >= 2
        const isEditing = editingKey === p.key
        return (
          <div key={p.key} style={{
            padding: '10px 12px', borderRadius: 10,
            background: isActive ? 'rgba(5,150,105,0.03)' : 'rgba(0,0,0,0.015)',
            border: `1px solid ${isActive ? 'rgba(5,150,105,0.12)' : 'rgba(0,0,0,0.06)'}`,
            opacity: isEditing ? 1 : (confirmDelete === p.key ? 0.5 : 1),
          }}>
            {confirmDelete === p.key ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>确认删除？</span>
                <button onClick={() => handleDelete(p.key)} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>删除</button>
                <button onClick={() => setConfirmDelete(null)} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#6b5e54', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
              </div>
            ) : isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={editTool} onChange={e => setEditTool(e.target.value)} style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)', fontSize: 11, fontFamily: 'inherit' }} placeholder="工具名" />
                  <input value={editSummary} onChange={e => setEditSummary(e.target.value)} style={{ flex: 2, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)', fontSize: 11, fontFamily: 'inherit' }} placeholder="错误描述" />
                  <button onClick={handleSaveEdit} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>保存</button>
                  <button onClick={() => setEditingKey(null)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#9b8e84', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                      background: isActive ? 'rgba(5,150,105,0.1)' : 'rgba(0,0,0,0.05)',
                      color: isActive ? '#059669' : '#9b8e84',
                    }}>{isActive ? '活跃' : '待确认'}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#2d2520' }}>{p.toolName}</span>
                    <span style={{ fontSize: 10, color: '#9b8e84' }}>×{p.count}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#6b5e54' }}>{p.errorSummary}</div>
                  <div style={{ fontSize: 9, color: '#b0a89e', marginTop: 1 }}>
                    首次: {p.firstSession} · 最近: {p.lastSession}
                  </div>
                </div>
                <button onClick={() => handleStartEdit(p)} title="编辑" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 4 }}>
                  <PencilIcon style={{ width: 13, height: 13 }} />
                </button>
                <button onClick={() => setConfirmDelete(p.key)} title="删除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 4 }}>
                  <TrashIcon style={{ width: 13, height: 13 }} />
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Clear all */}
      {patterns.length > 0 && (
        <button onClick={handleClearAll} style={{
          padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.15)', background: 'transparent',
          color: '#dc2626', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start',
        }}>
          清空全部学习记录
        </button>
      )}

      {/* Self-Optimize section */}
      <SelfOptimizePanel />

      {/* Data source info */}
      <div style={{ fontSize: 9, color: '#b0a89e', borderTop: '1px solid rgba(0,0,0,0.04)', paddingTop: 8 }}>
        数据来源: .aiharness/cli-learned.json + .aiharness/learned/
      </div>
    </div>
  )
}

// ── Self-Optimize Panel (built into Learning section) ──

function SelfOptimizePanel() {
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const activeConfig = configs.find(c => c.id === activeConfigId)

  const handleRun = async () => {
    if (!command.trim() || !activeConfig || !window.electron?.agent) return
    setRunning(true); setError(''); setOutput(''); setExpanded(true)
    try {
      const result = await window.electron!.agent.optimize(activeConfig!.id, command.trim())
      setOutput(result)
    } catch (e: any) { setError(e.message || '执行失败') }
    setRunning(false)
  }

  return (
    <div style={{ borderTop: '1px solid rgba(124,58,237,0.12)', paddingTop: 10 }}>
      <button onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
        border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)',
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, color: '#7c3aed', fontWeight: 600,
        width: '100%', textAlign: 'left',
      }}>
        <SparklesIcon style={{ width: 14, height: 14 }} />
        自优化模式 — AI 检查并修改自身代码
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#9b8e84' }}>{expanded ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, color: '#9b8e84' }}>
            输入优化指令，AI 将读取源码、分析问题、输出方案并在你确认后修改代码。每次修改前自动 git commit 作为回滚点。
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleRun() }}
              placeholder="例: 检查 src/agent/runtime/AgentRuntime.ts 的循环效率"
              disabled={running}
              style={{
                flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)',
                fontSize: 11, fontFamily: 'inherit', color: '#2d2520',
                background: running ? 'rgba(0,0,0,0.03)' : '#fff',
              }}
            />
            <button onClick={handleRun} disabled={running || !command.trim() || !activeConfig} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none',
              background: running ? '#a78bfa' : '#7c3aed', color: '#fff',
              fontSize: 11, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>
              {running ? '运行中...' : '执行'}
            </button>
          </div>

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', fontSize: 11, color: '#dc2626' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>错误</span>
                <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 0 }}><XMarkIcon style={{ width: 12, height: 12 }} /></button>
              </div>
              <div style={{ marginTop: 4 }}>{error}</div>
            </div>
          )}

          {output && (
            <div style={{
              padding: '10px 12px', borderRadius: 8, background: '#1e1e1e', color: '#d4d4d4',
              fontSize: 10, fontFamily: 'Consolas, monospace', maxHeight: 300, overflowY: 'auto',
              whiteSpace: 'pre-wrap', lineHeight: 1.6,
            }} className="custom-scrollbar">
              {output.replace(/\x1b\[\d+m/g, '').replace(/\x1b\[0m/g, '')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
