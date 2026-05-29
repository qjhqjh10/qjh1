import { useState } from 'react'
import { CheckCircleIcon, XCircleIcon, DocumentTextIcon, FolderOpenIcon, PencilSquareIcon, PlusCircleIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { ThinkingPlan, ThinkingStep } from '@/agent/state/types'

const toolIcons: Record<string, React.ReactNode> = {
  read_file:       <DocumentTextIcon style={{ width: 14, height: 14 }} />,
  list_directory:  <FolderOpenIcon style={{ width: 14, height: 14 }} />,
  search_files:    <FolderOpenIcon style={{ width: 14, height: 14 }} />,
  search_content:  <DocumentTextIcon style={{ width: 14, height: 14 }} />,
  edit_file:       <PencilSquareIcon style={{ width: 14, height: 14 }} />,
  create_file:     <PlusCircleIcon style={{ width: 14, height: 14 }} />,
  delete_file:     <TrashIcon style={{ width: 14, height: 14 }} />,
  rename_file:     <PencilSquareIcon style={{ width: 14, height: 14 }} />,
  write_note:      <PlusCircleIcon style={{ width: 14, height: 14 }} />,
}

const riskColors: Record<string, { border: string; bg: string }> = {
  safe:      { border: 'rgba(5,150,105,0.15)', bg: 'rgba(5,150,105,0.04)' },
  moderate:  { border: 'rgba(217,119,6,0.15)', bg: 'rgba(217,119,6,0.04)' },
  dangerous: { border: 'rgba(220,38,38,0.15)', bg: 'rgba(220,38,38,0.04)' },
}

function stepRisk(tool: string): 'safe' | 'moderate' | 'dangerous' {
  if (/^(read_file|list_directory|search_files|search_content|list_notes|read_note)$/.test(tool)) return 'safe'
  if (/^(create_file|edit_file|rename_file|write_note)$/.test(tool)) return 'moderate'
  return 'dangerous'
}

interface PlanCardProps {
  plan: ThinkingPlan
  onToggleStep: (stepId: string, approved: boolean) => void
  onApproveAll: () => void
  onRejectAll: (feedback?: string) => void
}

export function PlanCard({ plan, onToggleStep, onApproveAll, onRejectAll }: PlanCardProps) {
  const [showDetail, setShowDetail] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showFeedbackInput, setShowFeedbackInput] = useState(false)

  const approvedCount = plan.steps.filter(s => s.approvalStatus === 'approved').length
  const rejectedCount = plan.steps.filter(s => s.approvalStatus === 'rejected').length
  const totalCount = plan.steps.length

  // Auto-reject dependent steps when a dependency is rejected
  const getEffectiveStatus = (step: ThinkingStep, idx: number): 'pending' | 'approved' | 'rejected' => {
    if (step.approvalStatus === 'rejected') return 'rejected'
    // Check if any dependency is rejected
    const deps = plan.dependencies[idx] || []
    for (const depIdx of deps) {
      if (depIdx < plan.steps.length && plan.steps[depIdx].approvalStatus === 'rejected') {
        return 'rejected'
      }
    }
    return step.approvalStatus
  }

  return (
    <div style={{
      marginBottom: 10, borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(168,85,247,0.04))',
      border: '1px solid rgba(124,58,237,0.15)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        background: 'rgba(124,58,237,0.04)',
        borderBottom: '1px solid rgba(124,58,237,0.08)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <DocumentTextIcon style={{ width: 14, height: 14, color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>执行计划</div>
            <div style={{ fontSize: 10, color: '#9b8e84' }}>{plan.intent.slice(0, 60)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#9b8e84' }}>
            {approvedCount}/{totalCount} 已批准
            {rejectedCount > 0 ? ` · ${rejectedCount} 已拒绝` : ''}
          </span>
          <button onClick={() => setShowDetail(!showDetail)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed', fontFamily: 'inherit', fontWeight: 600 }}>
            {showDetail ? '收起' : '展开详情'}
          </button>
        </div>
      </div>

      {/* Steps */}
      {showDetail && (
        <div style={{ padding: '8px 14px', maxHeight: 260, overflowY: 'auto' }} className="custom-scrollbar">
          {plan.steps.map((step, idx) => {
            const effectiveStatus = getEffectiveStatus(step, idx)
            const isDepRejected = effectiveStatus === 'rejected' && step.approvalStatus !== 'rejected'
            const style = riskColors[stepRisk(step.tool)]
            return (
              <div key={step.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                marginBottom: 4, borderRadius: 8, border: `1px solid ${style.border}`,
                background: effectiveStatus === 'rejected' ? 'rgba(220,38,38,0.03)' : style.bg,
                opacity: effectiveStatus === 'rejected' ? 0.6 : 1,
                transition: 'all 0.15s ease',
              }}>
                {/* Toggle */}
                <button
                  onClick={() => {
                    if (isDepRejected) return
                    onToggleStep(step.id, effectiveStatus !== 'approved')
                  }}
                  style={{
                    width: 22, height: 22, borderRadius: 6, border: 'none', cursor: isDepRejected ? 'not-allowed' : 'pointer',
                    background: effectiveStatus === 'approved' ? 'rgba(5,150,105,0.12)' : 'rgba(0,0,0,0.04)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'all 0.15s ease',
                  }}
                  title={effectiveStatus === 'approved' ? '点击取消批准' : '点击批准'}
                >
                  <CheckCircleIcon style={{
                    width: 14, height: 14,
                    color: effectiveStatus === 'approved' ? '#059669' : '#d4ccc4',
                  }} />
                </button>

                {/* Step info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                    <span style={{ color: '#7c3aed' }}>{toolIcons[step.tool] || '🔧'}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#2d2520' }}>{step.tool}</span>
                    <span style={{ fontSize: 10, color: '#9b8e84' }}>— {step.action}</span>
                  </div>
                  {step.expectedOutcome && (
                    <div style={{ fontSize: 10, color: '#9b8e84', paddingLeft: 18 }}>
                      预期: {step.expectedOutcome.slice(0, 80)}
                    </div>
                  )}
                  {Boolean(step.args?.file_path) && (
                    <div style={{ fontSize: 9, color: '#b0a89e', paddingLeft: 18 }}>
                      📁 {String(step.args!.file_path)}
                    </div>
                  )}
                  {isDepRejected && (
                    <div style={{ fontSize: 9, color: '#dc2626', paddingLeft: 18 }}>
                      依赖步骤已拒绝，自动跳过
                    </div>
                  )}
                </div>

                {/* Status tag */}
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
                  background: effectiveStatus === 'approved' ? 'rgba(5,150,105,0.1)' :
                              effectiveStatus === 'rejected' ? 'rgba(220,38,38,0.08)' : 'rgba(0,0,0,0.04)',
                  color: effectiveStatus === 'approved' ? '#059669' :
                         effectiveStatus === 'rejected' ? '#dc2626' : '#9b8e84',
                  flexShrink: 0,
                }}>
                  {effectiveStatus === 'approved' ? '已批准' : effectiveStatus === 'rejected' ? '已拒绝' : '待批'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Action buttons */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px',
        borderTop: '1px solid rgba(124,58,237,0.08)',
        background: 'rgba(124,58,237,0.02)',
      }}>
        <button onClick={onApproveAll} style={{
          padding: '6px 16px', borderRadius: 8, border: 'none',
          background: '#16a34a', color: '#fff', fontSize: 11, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.1s',
        }}>
          批准全部
        </button>
        <button onClick={() => setShowFeedbackInput(!showFeedbackInput)} style={{
          padding: '6px 12px', borderRadius: 8,
          border: '1px solid rgba(220,38,38,0.2)', background: '#fff',
          color: '#dc2626', fontSize: 11, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          拒绝
        </button>
        {showFeedbackInput && (
          <>
            <input
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="反馈理由（可选）"
              style={{
                flex: 1, padding: '4px 10px', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.1)', fontSize: 11,
                fontFamily: 'inherit', color: '#2d2520',
              }}
            />
            <button onClick={() => { onRejectAll(feedback); setShowFeedbackInput(false); setFeedback('') }} style={{
              padding: '6px 12px', borderRadius: 8, border: 'none',
              background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              确认拒绝
            </button>
          </>
        )}
      </div>
    </div>
  )
}
