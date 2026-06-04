import { useState, useRef, useCallback } from 'react'
import { MicrophoneIcon, StopIcon } from '@heroicons/react/24/outline'

interface Props {
  onTextChange: (text: string) => void
  onFinalText: (text: string) => void
}

/** 语音输入按钮 — 接入 Web Speech API (webkitSpeechRecognition) */
export default function VoiceButton({ onTextChange, onFinalText }: Props) {
  const [isListening, setIsListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const recognitionRef = useRef<any>(null)

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const supported = !!SpeechRecognition

  const start = useCallback(() => {
    if (!supported) return
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.interimResults = true
    recognition.continuous = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join('')
      setInterimText(transcript)
      onTextChange(transcript)
    }

    recognition.onerror = () => {
      setIsListening(false)
      setInterimText('')
    }

    recognition.onend = () => {
      setIsListening(false)
      // On stop, emit final text
      if (interimText.trim()) {
        onFinalText(interimText.trim())
      }
      setInterimText('')
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [supported, onTextChange, onFinalText, interimText])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  const toggle = useCallback(() => {
    if (isListening) stop()
    else start()
  }, [isListening, start, stop])

  if (!supported) return null

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={toggle}
        title={isListening ? '停止录音' : '语音输入（说中文）'}
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
      {isListening && !interimText && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 4, padding: '4px 10px', borderRadius: 8, background: 'rgba(220,38,38,0.9)',
          color: '#fff', fontSize: 10, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none',
        }}>
          🎤 正在聆听...
        </span>
      )}
    </div>
  )
}
