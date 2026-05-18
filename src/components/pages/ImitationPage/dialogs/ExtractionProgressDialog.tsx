import Button from '@/components/common/Button'

interface Props {
  progress: { current: number; total: number; text: string }
  paused: boolean
  onPauseResume: () => void
  onStop: () => void
}

export default function ExtractionProgressDialog({ progress, paused, onPauseResume, onStop }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: 32, width: 360, textAlign: 'center', boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', border: '4px solid rgba(124,58,237,0.1)', borderTopColor: '#7c3aed', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ height: '100%', width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`, background: '#7c3aed', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#7c3aed', marginBottom: 4 }}>{progress.current}/{progress.total}</div>
        <div style={{ fontSize: 12, color: '#9b8e84', marginBottom: 16 }}>{progress.text || '正在提取...'}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Button size="sm" variant="ghost" onClick={onPauseResume}>{paused ? '继续提取' : '暂停提取'}</Button>
          <Button size="sm" variant="danger" onClick={onStop}>停止提取</Button>
        </div>
      </div>
    </div>
  )
}
