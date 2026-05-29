import { CheckCircleIcon, XCircleIcon, MinusCircleIcon } from '@heroicons/react/24/outline'
import type { VerificationReport } from '@/agent/state/types'

interface VerificationPanelProps {
  reports: VerificationReport[]
  onDismiss: () => void
}

export function VerificationPanel({ reports, onDismiss }: VerificationPanelProps) {
  if (reports.length === 0) return null

  const passedCount = reports.filter(r => r.status === 'passed').length
  const failedCount = reports.filter(r => r.status === 'failed').length
  const skippedCount = reports.filter(r => r.status === 'skipped').length

  return (
    <div style={{
      marginBottom: 10, borderRadius: 14,
      background: failedCount > 0
        ? 'linear-gradient(135deg, rgba(220,38,38,0.04), rgba(234,179,8,0.03))'
        : 'linear-gradient(135deg, rgba(5,150,105,0.04), rgba(5,150,105,0.02))',
      border: failedCount > 0 ? '1px solid rgba(220,38,38,0.12)' : '1px solid rgba(5,150,105,0.12)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px',
        borderBottom: '1px solid rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>
            {failedCount > 0 ? '⚠️' : '✅'}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>
            验证完成
          </span>
          <span style={{ fontSize: 10, color: '#9b8e84' }}>
            {passedCount} 通过{failedCount > 0 ? ` · ${failedCount} 失败` : ''}{skippedCount > 0 ? ` · ${skippedCount} 跳过` : ''}
          </span>
        </div>
        <button onClick={onDismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#9b8e84', fontFamily: 'inherit' }}>
          关闭
        </button>
      </div>

      {/* Step results */}
      <div style={{ padding: '6px 14px', maxHeight: 160, overflowY: 'auto' }} className="custom-scrollbar">
        {reports.map((report, i) => (
          <div key={report.planStepId} style={{
            display: 'flex', alignItems: 'flex-start', gap: 6,
            padding: '4px 0', borderBottom: i < reports.length - 1 ? '1px solid rgba(0,0,0,0.03)' : 'none',
          }}>
            {report.status === 'passed' ? (
              <CheckCircleIcon style={{ width: 14, height: 14, color: '#059669', flexShrink: 0, marginTop: 1 }} />
            ) : report.status === 'failed' ? (
              <XCircleIcon style={{ width: 14, height: 14, color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
            ) : (
              <MinusCircleIcon style={{ width: 14, height: 14, color: '#9b8e84', flexShrink: 0, marginTop: 1 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#2d2520' }}>
                {report.expectedOutcome.slice(0, 60) || `步骤 ${report.planStepId}`}
              </div>
              {report.discrepancy && (
                <div style={{ fontSize: 9, color: '#dc2626', marginTop: 1 }}>
                  {report.discrepancy}
                </div>
              )}
              {report.status === 'passed' && report.actualOutcome && (
                <div style={{ fontSize: 9, color: '#9b8e84', marginTop: 1 }}>
                  {report.actualOutcome.slice(0, 100)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
