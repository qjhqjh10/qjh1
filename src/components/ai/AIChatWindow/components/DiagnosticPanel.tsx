import { useState, useEffect, useRef } from 'react'
import { diagnosticLogger } from '@/agent/diagnostics/DiagnosticLogger'
import type { DiagnosticEvent } from '@/agent/diagnostics/DiagnosticLogger'

const SEVERITY_COLORS = {
  info: '#059669',
  warn: '#d97706',
  error: '#dc2626',
}

const TYPE_ICONS: Record<string, string> = {
  phase_change: '→',
  api_call_start: '↑',
  api_call_end: '↓',
  api_call_error: '✗',
  tool_start: '▶',
  tool_end: '✓',
  tool_error: '✗',
  tool_timeout: '⏱',
  hook_start: '⚡',
  hook_end: '⚡',
  approval_pending: '?',
  approval_resolved: '✓',
  stuck_detected: '⚠',
  error: '✗',
  info: 'ℹ',
}

export function DiagnosticPanel() {
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [expanded, setExpanded] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stuckWarning, setStuckWarning] = useState<DiagnosticEvent | null>(null)

  useEffect(() => {
    // Load existing events
    setEvents(diagnosticLogger.getRecentEvents(100))

    // Subscribe to new events
    const unsub = diagnosticLogger.onEvent((event) => {
      setEvents(prev => [...prev.slice(-199), event])

      // Track stuck warnings
      if (event.type === 'stuck_detected') {
        setStuckWarning(event)
      } else if (event.type === 'phase_change' && event.phase === 'IDLE') {
        setStuckWarning(null)
      }
    })

    return unsub
  }, [])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events, autoScroll])

  const currentPhase = diagnosticLogger.getCurrentPhase()
  const phaseDuration = diagnosticLogger.getPhaseDuration()
  const errorCount = events.filter(e => e.severity === 'error').length
  const recentEvents = events.slice(-50)

  return (
    <div style={{
      margin: '8px 0', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
      background: '#fafaf9', overflow: 'hidden', fontSize: 11, fontFamily: 'monospace',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          background: stuckWarning ? 'rgba(220,38,38,0.06)' : 'transparent',
          borderBottom: expanded ? '1px solid rgba(0,0,0,0.06)' : 'none',
        }}
      >
        <span style={{ fontWeight: 600, color: '#4a3f38' }}>诊断面板</span>

        {/* Current phase badge */}
        <span style={{
          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500,
          background: stuckWarning ? 'rgba(220,38,38,0.1)' : 'rgba(37,99,235,0.08)',
          color: stuckWarning ? '#dc2626' : '#2563eb',
        }}>
          {currentPhase}
          {currentPhase !== 'IDLE' && ` ${(phaseDuration / 1000).toFixed(0)}s`}
        </span>

        {/* Error count */}
        {errorCount > 0 && (
          <span style={{ color: '#dc2626', fontSize: 10 }}>
            {errorCount} 个错误
          </span>
        )}

        {/* Stuck warning */}
        {stuckWarning && (
          <span style={{ color: '#dc2626', fontSize: 10, fontWeight: 600, animation: 'pulse 1.5s infinite' }}>
            ⚠ 疑似卡死
          </span>
        )}

        <span style={{ marginLeft: 'auto', color: '#9b8e84', fontSize: 10 }}>
          {expanded ? '收起 ▲' : '展开 ▼'}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div>
          {/* Controls */}
          <div style={{ padding: '4px 12px', display: 'flex', gap: 12, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#6b5e54' }}>
              <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
              自动滚动
            </label>
            <button
              onClick={() => { diagnosticLogger.recordInfo('手动检查: 当前阶段 ' + currentPhase + ', 持续 ' + (phaseDuration / 1000).toFixed(1) + 's') }}
              style={{ background: 'none', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 10, color: '#6b5e54' }}
            >
              手动检查
            </button>
            <span style={{ color: '#9b8e84', marginLeft: 'auto' }}>
              {recentEvents.length} / {events.length} 条事件
            </span>
          </div>

          {/* Event list */}
          <div
            ref={scrollRef}
            style={{
              maxHeight: 300, overflowY: 'auto', padding: '4px 0',
            }}
            className="custom-scrollbar"
          >
            {recentEvents.map((event) => (
              <div
                key={event.id}
                style={{
                  padding: '3px 12px', display: 'flex', alignItems: 'flex-start', gap: 6,
                  background: event.type === 'stuck_detected' ? 'rgba(220,38,38,0.04)' : 'transparent',
                  borderLeft: event.severity === 'error' ? '2px solid #dc2626' :
                              event.severity === 'warn' ? '2px solid #d97706' : '2px solid transparent',
                }}
              >
                {/* Timestamp */}
                <span style={{ color: '#9b8e84', flexShrink: 0, width: 60 }}>
                  {new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>

                {/* Icon */}
                <span style={{ color: SEVERITY_COLORS[event.severity], flexShrink: 0, width: 12 }}>
                  {TYPE_ICONS[event.type] || '·'}
                </span>

                {/* Phase */}
                {event.phase && (
                  <span style={{ color: '#6366f1', flexShrink: 0, width: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {event.phase}
                  </span>
                )}

                {/* Message */}
                <span style={{ color: event.severity === 'error' ? '#dc2626' : '#4a3f38', flex: 1 }}>
                  {event.message}
                </span>

                {/* Duration */}
                {event.duration !== undefined && (
                  <span style={{ color: event.duration > 30000 ? '#dc2626' : '#9b8e84', flexShrink: 0 }}>
                    {event.duration > 1000 ? `${(event.duration / 1000).toFixed(1)}s` : `${event.duration}ms`}
                  </span>
                )}
              </div>
            ))}

            {recentEvents.length === 0 && (
              <div style={{ padding: '12px', textAlign: 'center', color: '#9b8e84' }}>
                暂无诊断事件。发送消息后这里会显示实时状态。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
