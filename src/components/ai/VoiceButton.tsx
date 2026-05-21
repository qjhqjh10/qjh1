import { MicrophoneIcon, StopIcon } from '@heroicons/react/24/outline'

interface Props {
  isListening: boolean
  interimText: string
  supported: boolean
  onToggle: () => void
}

export default function VoiceButton({ isListening, interimText, supported, onToggle }: Props) {
  if (!supported) return null

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={onToggle}
        title={isListening ? '停止录音' : '语音输入'}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 10, border: 'none', cursor: 'pointer',
          background: isListening ? '#dc2626' : 'rgba(124,58,237,0.08)',
          color: isListening ? '#fff' : '#7c3aed',
          transition: 'all 0.15s ease',
          animation: isListening ? 'pulse 1.2s ease-in-out infinite' : 'none',
        }}
      >
        {isListening ? <StopIcon style={{ width: 15, height: 15 }} /> : <MicrophoneIcon style={{ width: 15, height: 15 }} />}
      </button>
      {isListening && interimText && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 4, padding: '4px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.75)',
          color: '#fff', fontSize: 11, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none',
        }}>
          {interimText.slice(-30)}
        </span>
      )}
    </div>
  )
}
