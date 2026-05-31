import React from 'react'

interface Props {
  children: React.ReactNode
  fallbackLabel?: string
}

interface State {
  error: Error | null
}

export class AgentErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary] ${this.props.fallbackLabel || 'UI'}:`, error.message, info.componentStack)
    // Fire-and-forget: log to diagnostic logger if available
    try { import('@/agent/diagnostics/DiagnosticLogger').then(m => m.diagnosticLogger.recordError(`UI: ${error.message}`, info.componentStack || '')).catch(() => {}) } catch { /* */ }
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      const label = this.props.fallbackLabel || '组件'
      return (
        <div style={{
          padding: '24px', margin: '12px', borderRadius: 12,
          background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', marginBottom: 6 }}>
            {label} 发生错误
          </div>
          <div style={{ fontSize: 11, color: '#6b5e54', marginBottom: 14, maxHeight: 80, overflow: 'auto' }}>
            {this.state.error.message}
          </div>
          <button onClick={this.handleReset} style={{
            padding: '6px 16px', borderRadius: 8, border: '1px solid rgba(124,58,237,0.2)',
            background: '#fff', color: '#7c3aed', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
