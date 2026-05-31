import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AgentPhase } from '../state/types'
import type { ToolProgressEvent, ThinkingContext } from '../runtime/AgentEventEmitter'

// ── Types ──

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  totalTokens: number
  modelName: string
}

export interface ToolExecutionState {
  callId: string
  toolName: string
  status: 'pending' | 'running' | 'success' | 'error'
  progress: number
  summary: string
  detail?: string
}

export interface AgentRunState {
  runId: string | null
  phase: AgentPhase
  iteration: number
  isRunning: boolean
  thinking: ThinkingContext | null
  activeTools: Record<string, ToolExecutionState>  // keyed by callId
  lastError: string | null
  streamingText: string
  isStreaming: boolean
  hookFeedback: { hookName: string; passed: boolean; feedback: string; timestamp: number } | null
}

export interface PermissionPattern {
  toolName: string
  approvedCount: number
  deniedCount: number
  lastApproved: number | null
}

export interface AgentHealthState {
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  circuitFailures: number
  checkpointCount: number
  autoApprovedTools: string[]
  lastSessionMetrics: {
    toolSuccessRate: number
    hallucinationRate: number
    iterationCycles: number
    trend: 'improving' | 'stable' | 'declining'
  } | null
}

export interface AgentStoreState {
  // Sessions
  sessions: AgentSessionMeta[]
  activeSessionId: string | null

  // Current run
  run: AgentRunState

  // Permission learning
  permissionPatterns: PermissionPattern[]

  // Token tracking
  totalTokensUsed: number
  peakPromptTokens: number

  // Health (persisted across sessions for settings page)
  health: AgentHealthState

  // Actions — Session
  setSessions: (sessions: AgentSessionMeta[]) => void
  setActiveSession: (id: string | null) => void
  addSession: (session: AgentSessionMeta) => void
  removeSession: (id: string) => void
  updateSessionMeta: (id: string, partial: Partial<AgentSessionMeta>) => void

  // Actions — Run
  startRun: (runId: string) => void
  endRun: () => void
  setPhase: (phase: AgentPhase) => void
  setIteration: (n: number) => void
  setThinking: (thinking: ThinkingContext | null) => void
  addToolExecution: (callId: string, toolName: string) => void
  updateToolProgress: (event: ToolProgressEvent) => void
  completeTool: (callId: string, status: 'success' | 'error', summary: string, detail?: string) => void
  setLastError: (error: string | null) => void
  setStreamingText: (text: string) => void
  setIsStreaming: (streaming: boolean) => void
  setHookFeedback: (feedback: { hookName: string; passed: boolean; feedback: string; timestamp: number } | null) => void
  // Actions — Permissions
  recordPermission: (toolName: string, approved: boolean) => void
  getPermissionPattern: (toolName: string) => PermissionPattern | undefined

  // Actions — Tokens
  addTokens: (amount: number) => void
  setPeakPromptTokens: (tokens: number) => void

  // Actions — Health
  setHealth: (health: Partial<AgentHealthState>) => void
}

// Shared reset fields for startRun/endRun to avoid duplication
// ── Store ──

// Track pending tool cleanup timers so they can be cancelled on new run
const _toolCleanupTimers = new Set<ReturnType<typeof setTimeout>>()

export const useAgentStore = create<AgentStoreState>()(
  immer((set, get) => ({
    sessions: [],
    activeSessionId: null,

    run: {
      runId: null,
      phase: 'IDLE',
      iteration: 0,
      isRunning: false,
      thinking: null,
      activeTools: {},
      lastError: null,
      streamingText: '',
      isStreaming: false,
      hookFeedback: null,
    },

    permissionPatterns: [],

    totalTokensUsed: 0,
    peakPromptTokens: 0,

    health: {
      circuitState: 'CLOSED',
      circuitFailures: 0,
      checkpointCount: 0,
      autoApprovedTools: [],
      lastSessionMetrics: null,
    },

    // ── Session Actions ──

    setSessions: (sessions) => set(s => { s.sessions = sessions }),
    setActiveSession: (id) => set(s => { s.activeSessionId = id }),
    addSession: (session) => set(s => { s.sessions.push(session) }),
    removeSession: (id) => set(s => {
      s.sessions = s.sessions.filter(x => x.id !== id)
    }),
    updateSessionMeta: (id, partial) => set(s => {
      const idx = s.sessions.findIndex(x => x.id === id)
      if (idx !== -1) Object.assign(s.sessions[idx], partial, { updatedAt: new Date().toISOString() })
    }),

    // ── Run Actions ──

    startRun: (runId) => {
      // Clear any pending tool cleanup timers from previous runs
      for (const timer of _toolCleanupTimers) clearTimeout(timer)
      _toolCleanupTimers.clear()
      return set(s => {
        s.run.runId = runId
        s.run.phase = 'RUNNING'
        s.run.isRunning = true
        s.run.iteration = 0
        s.run.thinking = null
        s.run.activeTools = {}
        s.run.lastError = null
        s.run.streamingText = ''
        s.run.isStreaming = false
        s.run.hookFeedback = null
      })
    },

    endRun: () => {
      for (const timer of _toolCleanupTimers) clearTimeout(timer)
      _toolCleanupTimers.clear()
      return set(s => {
        s.run.runId = null
        s.run.phase = 'IDLE'
        s.run.isRunning = false
        s.run.iteration = 0
        s.run.thinking = null
        s.run.activeTools = {}
        s.run.lastError = null
        s.run.streamingText = ''
        s.run.isStreaming = false
        s.run.hookFeedback = null
      })
    },

    setPhase: (phase) => set(s => { s.run.phase = phase }),
    setIteration: (n) => set(s => { s.run.iteration = n }),
    setThinking: (thinking) => set(s => { s.run.thinking = thinking }),

    addToolExecution: (callId, toolName) => set(s => {
      s.run.activeTools[callId] = { callId, toolName, status: 'pending', progress: 0, summary: '' }
    }),

    updateToolProgress: (event) => set(s => {
      const t = s.run.activeTools[event.callId]
      if (t) {
        t.status = 'running'
        t.progress = event.progress ?? t.progress
        if (event.message) t.summary = event.message
      }
    }),

    completeTool: (callId, status, summary, detail) => set(s => {
      const t = s.run.activeTools[callId]
      if (t) {
        t.status = status
        t.progress = 1
        t.summary = summary
        t.detail = detail
      }
      // Auto-remove completed tool after 15 seconds to give users time to see results
      const timer = setTimeout(() => {
        _toolCleanupTimers.delete(timer)
        set(s2 => { delete s2.run.activeTools[callId] })
      }, 15000)
      _toolCleanupTimers.add(timer)
    }),

    setLastError: (error) => set(s => { s.run.lastError = error }),

    // V1-7: Throttled streaming text updates — max ~20 updates/sec to prevent
    // 100+ full-component re-renders per response. 50ms delay is imperceptible.
    setStreamingText: (text) => {
      const state = get() as any
      const now = Date.now()
      const last = state._lastStreamUpdate || 0
      if (now - last < 50) {
        clearTimeout(state._streamTimer)
        state._streamTimer = setTimeout(() => {
          set(s => { s.run.streamingText = text })
          ;(get() as any)._lastStreamUpdate = Date.now()
        }, 50)
        return
      }
      set(s => { s.run.streamingText = text })
      ;(get() as any)._lastStreamUpdate = now
    },
    setIsStreaming: (streaming) => {
      // V1-7: Only update if value actually changes (was called on every chunk)
      if (get().run.isStreaming !== streaming) set(s => { s.run.isStreaming = streaming })
    },
    setHookFeedback: (feedback) => set(s => { s.run.hookFeedback = feedback }),


    // ── Permission Actions ──

    recordPermission: (toolName, approved) => set(s => {
      const p = s.permissionPatterns.find(x => x.toolName === toolName)
      if (p) {
        if (approved) p.approvedCount++
        else p.deniedCount++
        p.lastApproved = approved ? Date.now() : p.lastApproved
      } else {
        s.permissionPatterns.push({
          toolName,
          approvedCount: approved ? 1 : 0,
          deniedCount: approved ? 0 : 1,
          lastApproved: approved ? Date.now() : null,
        })
      }
    }),

    getPermissionPattern: (toolName) => get().permissionPatterns.find(x => x.toolName === toolName),

    // ── Token Actions ──

    addTokens: (amount) => set(s => { s.totalTokensUsed += amount }),
    setPeakPromptTokens: (tokens) => set(s => {
      if (tokens > s.peakPromptTokens) s.peakPromptTokens = tokens
    }),

    // ── Health Actions ──

    setHealth: (partial) => set(s => { Object.assign(s.health, partial) }),
  }))
)
