import { useState, useEffect, useCallback } from 'react'
import { WELCOME_MSG, STORAGE_KEY } from '@/components/ai/chatConstants'
import type { Message, Conversation } from '@/components/ai/chat/types'
import { useStore, useSettingsStore } from '@/store'
import { useAgentStore } from '@/agent/store/AgentStore'
import { makeConversation } from '../utils'
import { logError } from '@/utils/logger'

export function useConversationState() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) { const p = JSON.parse(s) as Conversation[]; if (Array.isArray(p) && p.length > 0) return p } } catch { /* */ }
    return [makeConversation('default', '新对话')]
  })
  const [activeConversationId, setActiveConversationId] = useState('default')
  const [convsLoaded, setConvsLoaded] = useState(false)
  const conversationToolNames = useRef(new Set<string>())
  const pendingCorrection = useRef<string | null>(null)
  const autoRetryRef = useRef(false)

  // Load from IndexedDB on mount
  useEffect(() => {
    let cancelled = false
    import('@/services/chatStorageService').then(async ({ loadConversations, loadLastActiveId, finalizeMigration }) => {
      try {
        const stored = await loadConversations()
        if (cancelled) return
        if (stored.length > 0) {
          setConversations(stored)
          const lastId = await loadLastActiveId()
          if (lastId && stored.some(c => c.id === lastId)) setActiveConversationId(lastId)
          else setActiveConversationId(stored[stored.length - 1].id)
        }
        finalizeMigration()
      } catch (e) { logError('IndexedDB 加载对话失败', e) }
      setConvsLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  // Persist conversations + lastActiveId
  const persistConversations = useCallback(async (convs: Conversation[]) => {
    try {
      const { saveConversations, saveLastActiveId } = await import('@/services/chatStorageService')
      await saveConversations(convs)
      await saveLastActiveId(activeConversationId)
    } catch (e) { logError('保存对话历史失败', e) }
  }, [activeConversationId])

  // Persist lastActiveId on switch
  useEffect(() => {
    import('@/services/chatStorageService').then(m => m.saveLastActiveId(activeConversationId)).catch(() => {})
  }, [activeConversationId])

  // Auto-save
  useEffect(() => {
    persistConversations(conversations)
  }, [conversations, persistConversations])

  const activeConversation = conversations.find(c => c.id === activeConversationId) || conversations[0]
  const messages = activeConversation?.messages || []

  const setMessages = useCallback((updater: Message[] | ((prev: Message[]) => Message[])) => {
    setConversations(prev => prev.map(c => {
      if (c.id !== activeConversationId) return c
      const newMessages = typeof updater === 'function' ? updater(c.messages) : updater
      const title = c.title === '新对话' ? getConvTitle(newMessages) : c.title
      return { ...c, messages: newMessages, title }
    }))
  }, [activeConversationId])

  const switchConversation = useCallback((convId: string) => {
    if (convId === activeConversationId) return
    useAgentStore.getState().endRun()
    setActiveConversationId(convId)
    const conv = conversations.find(c => c.id === convId)
    conversationToolNames.current = new Set()
    pendingCorrection.current = null
    autoRetryRef.current = false
  }, [activeConversationId, conversations])

  const handleNewConversation = useCallback(() => {
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    setConversations(prev => [...prev, makeConversation(id, '新对话')])
    setActiveConversationId(id)
    conversationToolNames.current = new Set()
    pendingCorrection.current = null
    autoRetryRef.current = false
  }, [])

  const handleClearConversation = useCallback(() => {
    const showWelcome = useSettingsStore.getState().aiSettings.showWelcome !== false
    setMessages(showWelcome ? [{ ...WELCOME_MSG, id: `welcome_${activeConversationId}` }] : [])
    conversationToolNames.current = new Set()
    pendingCorrection.current = null
    autoRetryRef.current = false
    setConversations(prev => prev.map(c => c.id === activeConversationId
      ? { ...c, totalTokens: 0, lastPromptTokens: 0, peakPromptTokens: 0 } : c))
  }, [activeConversationId, setMessages])

  const handleDeleteConversation = useCallback((convId: string) => {
    setConversations(prev => {
      const r = prev.filter(c => c.id !== convId)
      if (r.length === 0) {
        setActiveConversationId('default')
        return [makeConversation('default', '新对话')]
      }
      if (convId === activeConversationId) setActiveConversationId(r[0].id)
      return r
    })
  }, [activeConversationId])

  return {
    conversations, setConversations, activeConversationId, setActiveConversationId,
    activeConversation, messages, setMessages, convsLoaded,
    switchConversation, handleNewConversation, handleClearConversation, handleDeleteConversation,
    conversationToolNames, pendingCorrection, autoRetryRef,
    persistConversations,
  }
}

function getConvTitle(msgs: Message[]): string {
  const firstUser = msgs.find(m => m.role === 'user')
  return firstUser ? firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '...' : '') : '新对话'
}

// Need useRef
import { useRef } from 'react'
