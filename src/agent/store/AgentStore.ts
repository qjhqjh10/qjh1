import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AgentPhase, ThinkingPlan, VerificationReport } from '../state/types'
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
  executionPlan: ThinkingPlan | null
  planPhase: 'none' | 'generating' | 'awaiting_approval' | 'approved' | 'rejected'
  verificationReports: VerificationReport[]
  planDeviation: { toolName: string; message: string } | null
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
  setExecutionPlan: (plan: ThinkingPlan | null) => void
  setPlanPhase: (phase: AgentRunState['planPhase']) => void
  setVerificationReports: (reports: VerificationReport[]) => void
  addVerificationReport: (report: VerificationReport) => void
  setPlanDeviation: (deviation: { toolName: string; message: string } | null) => void

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
      executionPlan: null,
      planPhase: 'none',
      verificationReports: [],
      planDeviation: null,
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

    startRun: (runId) => set(s => {
      s.run.runId = runId
      s.run.phase = 'THINKING'
      s.run.isRunning = true
      s.run.iteration = 0
      s.run.thinking = null
      s.run.activeTools = {}
      s.run.lastError = null
      s.run.streamingText = ''
      s.run.isStreaming = false
      s.run.hookFeedback = null
      s.run.executionPlan = null
      s.run.planPhase = 'none'
      s.run.verificationReports = []
      s.run.planDeviation = null
    }),

    endRun: () => set(s => {
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
      s.run.executionPlan = null
      s.run.planPhase = 'none'
      s.run.verificationReports = []
      s.run.planDeviation = null
    }),

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
      setTimeout(() => {
        set(s2 => { delete s2.run.activeTools[callId] })
      }, 15000)
    }),

    setLastError: (error) => set(s => { s.run.lastError = error }),
    setStreamingText: (text) => set(s => { s.run.streamingText = text }),
    setIsStreaming: (streaming) => set(s => { s.run.isStreaming = streaming }),
    setHookFeedback: (feedback) => set(s => { s.run.hookFeedback = feedback }),

    setExecutionPlan: (plan) => set(s => { s.run.executionPlan = plan }),
    setPlanPhase: (phase) => set(s => { s.run.planPhase = phase }),
    setVerificationReports: (reports) => set(s => { s.run.verificationReports = reports }),
    addVerificationReport: (report) => set(s => { s.run.verificationReports.push(report) }),
    setPlanDeviation: (deviation) => set(s => { s.run.planDeviation = deviation }),

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
