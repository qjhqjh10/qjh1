import { useState } from 'react'
import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, DocumentTextIcon, ArrowRightIcon, TrashIcon, Square2StackIcon } from '@heroicons/react/24/outline'

interface BatchCard { toolCalls: any[]; summary: string; previews: any[]; thinkingPlan?: any; }

export function BatchApprovalPanel({ batchCard, batchFeedback, showBatchFeedback, conversationToolNames, onApprove, onDeny, onFeedbackChange, onToggleFeedback }: any) {
  const [showDetail, setShowDetail] = useState(false)

  if (!batchCard) return null

  const summary = batchCard.summary

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
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2d2520' }}>审批操作</div>
            <div style={{ fontSize: 10, color: '#9b8e84' }}>{summary}</div>
          </div>
        </div>
        <button onClick={() => setShowDetail(!showDetail)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#7c3aed', fontFamily: 'inherit', fontWeight: 600 }}>
          {showDetail ? '收起' : '展开详情'}
        </button>
      </div>

      {/* Detail preview */}
      {showDetail && (
        <div style={{ padding: '10px 14px', maxHeight: 200, overflowY: 'auto' }} className="custom-scrollbar">
          {batchCard.previews.map((p: any, i: number) => (
            <div key={i} style={{ marginBottom: 8, fontSize: 11 }}>
              <div style={{ fontWeight: 600, color: '#7c3aed', marginBottom: 2 }}>
                {p.toolName} — {p.summary}
              </div>
              {p.preview && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <div style={{
                    flex: 1, padding: '4px 8px', borderRadius: 6,
                    background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.1)',
                    fontSize: 10, color: '#dc2626', whiteSpace: 'pre-wrap', fontFamily: 'monospace',
                    maxHeight: 100, overflow: 'auto',
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#dc2626', marginBottom: 2 }}>— 删除</div>
                    {p.preview.old?.slice(0, 300)}
                  </div>
                  <ArrowRightIcon style={{ width: 12, height: 12, color: '#9b8e84', marginTop: 4 }} />
                  <div style={{
                    flex: 1, padding: '4px 8px', borderRadius: 6,
                    background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.1)',
                    fontSize: 10, color: '#16a34a', whiteSpace: 'pre-wrap', fontFamily: 'monospace',
                    maxHeight: 100, overflow: 'auto',
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#16a34a', marginBottom: 2 }}>+ 新增</div>
                    {p.preview.new?.slice(0, 300)}
                  </div>
                </div>
              )}
              {!p.preview && <div style={{ color: '#6b5e54' }}>{p.detail}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
        <button onClick={onApprove} style={batchBtnStyle('linear-gradient(135deg, #16a34a, #22c55e)', '#fff')}>
          <CheckCircleIcon style={{ width: 12, height: 12, marginRight: 4 }} />
          批准全部
        </button>
        <button onClick={() => onDeny()} style={batchBtnStyle('linear-gradient(135deg, #dc2626, #ef4444)', '#fff')}>
          <XCircleIcon style={{ width: 12, height: 12, marginRight: 4 }} />
          拒绝
        </button>
        {!showBatchFeedback ? (
          <button onClick={onToggleFeedback} style={{ ...batchBtnStyle('transparent', '#6b5e54'), border: '1px solid rgba(0,0,0,0.1)' }}>
            附反馈拒绝
          </button>
        ) : (
          <div style={{ flex: 1, display: 'flex', gap: 6 }}>
            <input
              value={batchFeedback}
              onChange={e => onFeedbackChange(e.target.value)}
              placeholder="说明原因..."
              style={{
                flex: 1, padding: '4px 10px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.1)', fontSize: 11, fontFamily: 'inherit',
              }}
              autoFocus
            />
            <button onClick={() => onDeny(batchFeedback)} style={batchBtnStyle('#f59e0b', '#fff')}>发送</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function FileGroup({ files }: any) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
      {files.map((f: any, i: number) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 8px', borderRadius: 6, fontSize: 10,
          background: f.isRead ? 'rgba(59,130,246,0.06)' : 'rgba(124,58,237,0.06)',
          border: f.isRead ? '1px solid rgba(59,130,246,0.12)' : '1px solid rgba(124,58,237,0.12)',
          color: f.isRead ? '#3b82f6' : '#7c3aed',
        }}>
          {f.isRead ? '📖' : '✏️'} {f.path}
        </span>
      ))}
    </div>
  )
}

export const batchBtnStyle = (bg: string, fg: string) => ({
  padding: '6px 16px', borderRadius: 8, border: 'none',
  background: bg, color: fg, fontSize: 11, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
})
