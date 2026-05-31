/**
 * StreamingMessage (V2-7)
 *
 * Isolated component for rendering AI streaming text.
 * Uses React.memo + requestAnimationFrame batching to prevent
 * the 100+ full-component re-renders per response that occurred
 * when streamingText was a direct subscriber in AIChatWindow.
 */
import { useState, useEffect, useRef, memo } from 'react'

interface StreamingMessageProps {
  content: string
}

/**
 * Isolated streaming text bubble.
 * Uses rAF batching to render at display refresh rate (~60fps max)
 * instead of per-token-chunk frequency (~100+ fps).
 */
export const StreamingMessage = memo(function StreamingMessage({
  content,
}: StreamingMessageProps) {
  const [displayText, setDisplayText] = useState('')
  const rafRef = useRef<number>(0)
  const lastContentRef = useRef('')

  useEffect(() => {
    // Skip if content hasn't changed (redundant store updates from V1-7 throttle)
    if (content === lastContentRef.current) return
    lastContentRef.current = content

    // Use rAF for batched rendering — only updates once per frame
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setDisplayText(content)
    })
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [content])

  if (!displayText) return null

  return (
    <div style={{
      display: 'flex', justifyContent: 'flex-start', marginBottom: 8,
      animation: 'fadeInUp 0.3s ease-out',
    }}>
      <div style={{
        maxWidth: '80%', padding: '12px 16px', borderRadius: 16,
        borderBottomLeftRadius: 4,
        background: 'rgba(245,242,239,0.9)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(0,0,0,0.04)',
        color: '#2d2520',
        fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}>
        {displayText}
        <span className="typewriter-cursor" style={{ fontSize: 14 }} />
      </div>
    </div>
  )
})
