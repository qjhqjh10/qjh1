import { useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Message } from '@/components/ai/chat/types'

interface Props {
  messages: Message[]
  renderMessage: (msg: Message, index: number, prevMsg: Message | null) => React.ReactNode
  /** Estimated average message height (px) — used as initial guess before measurement */
  estimateSize?: number
  /** Max messages before virtualization kicks in (default 20) */
  virtualizeThreshold?: number
  /** Called when messages change (for auto-scroll) */
  messagesUpdatedAt?: number
}

export function VirtualMessageList({
  messages,
  renderMessage,
  estimateSize = 120,
  virtualizeThreshold = 20,
  messagesUpdatedAt,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null)

  // Only virtualize above threshold
  if (messages.length <= virtualizeThreshold) {
    return (
      <div ref={parentRef} className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
        {messages.map((msg, i) => renderMessage(msg, i, i > 0 ? messages[i - 1] : null))}
      </div>
    )
  }

  return (
    <VirtualizedInner
      messages={messages}
      renderMessage={renderMessage}
      estimateSize={estimateSize}
      messagesUpdatedAt={messagesUpdatedAt}
    />
  )
}

function VirtualizedInner({
  messages, renderMessage, estimateSize, messagesUpdatedAt,
}: Omit<Props, 'virtualizeThreshold'>) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback((_index: number) => estimateSize as number, [estimateSize]),
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  // Auto-scroll to bottom when new messages arrive
  const prevLen = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevLen.current) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
    prevLen.current = messages.length
  }, [messages.length, messagesUpdatedAt, virtualizer])

  const items = virtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '14px 18px', contain: 'strict' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${items[0]?.start ?? 0}px)` }}>
          {items.map((virtualRow) => {
            const i = virtualRow.index
            const msg = messages[i]
            const prevMsg = i > 0 ? messages[i - 1] : null
            return (
              <div key={virtualRow.key} data-index={i} ref={virtualizer.measureElement}>
                {renderMessage(msg, i, prevMsg)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
