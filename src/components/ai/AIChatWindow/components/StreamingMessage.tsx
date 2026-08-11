/**
 * StreamingMessage (V2-7, v16.3.0 审计 M1 改造)
 *
 * Isolated component for rendering AI streaming text.
 * v16.3.0(审计 M1 修复): 改为**内部订阅 store**（self-contained）——
 * 原实现 content 由 AIChatWindow 顶层订阅 `useAgentStore(s => s.run.streamingText)` 传入，
 * 流式期间整窗最高 20 次/秒重渲染（AgentStore 50ms 节流），memo/rAF 只省了本组件自身。
 * 现订阅下沉到本组件：流式文本变化只触发本组件重渲染，父组件零感知。
 *
 * 渲染：rAF 批处理（每帧至多一次 setState）显示文本 + 打字光标。
 */
import { useState, useEffect, useRef, memo } from 'react'
import { useAgentStore } from '@/agent/store/AgentStore'

/**
 * Isolated streaming text bubble.
 * Uses rAF batching to render at display refresh rate (~60fps max)
 * instead of per-token-chunk frequency (~100+ fps).
 */
export const StreamingMessage = memo(function StreamingMessage() {
  // v16.3.0(审计 M1 修复): 内部订阅——流式文本/状态变化仅重渲染本组件
  const content = useAgentStore(s => s.run.streamingText)
  const isStreaming = useAgentStore(s => s.run.isStreaming)
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

  if (!isStreaming || !displayText) return null

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
