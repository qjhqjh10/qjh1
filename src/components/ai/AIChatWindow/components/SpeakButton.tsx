import { useState, useRef } from 'react'
import { SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/outline'

interface Props {
  text: string
}

export default function SpeakButton({ text }: Props) {
  const [speaking, setSpeaking] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const supported = typeof speechSynthesis !== 'undefined'

  const speak = () => {
    if (!supported || !text) return
    speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text.slice(0, 2000))
    utter.lang = 'zh-CN'
    utter.rate = 1.0
    utter.onstart = () => setSpeaking(true)
    utter.onend = () => setSpeaking(false)
    utter.onerror = () => setSpeaking(false)
    utteranceRef.current = utter
    speechSynthesis.speak(utter)
  }

  const stop = () => {
    speechSynthesis.cancel()
    setSpeaking(false)
  }

  if (!supported) return null

  return (
    <button
      onClick={speaking ? stop : speak}
      title={speaking ? '停止朗读' : '朗读此消息'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
        background: speaking ? '#7c3aed' : 'transparent',
        color: speaking ? '#fff' : '#9b8e84',
        opacity: 0.5, transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
      onMouseEnter={e => { if (!speaking) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(124,58,237,0.06)'; e.currentTarget.style.color = '#7c3aed' } }}
      onMouseLeave={e => { if (!speaking) { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9b8e84' } }}
    >
      {speaking ? <SpeakerXMarkIcon style={{ width: 13, height: 13 }} /> : <SpeakerWaveIcon style={{ width: 13, height: 13 }} />}
    </button>
  )
}
