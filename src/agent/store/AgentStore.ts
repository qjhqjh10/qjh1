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
  circuitOpenedAt: number | null  // v9.5.5: 熔断器打开时间戳（用于冷却计时）
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

  // v9.5.5: 熔断器方法
  /** 记录 API 调用失败，达到阈值时触发熔断 */
  recordApiFailure: (maxFailures?: number) => { tripped: boolean }
  /** 记录 API 调用成功，重置失败计数 */
  recordApiSuccess: () => void
  /** 检查熔断器状态，返回是否允许执行 */
  checkCircuit: (maxFailures?: number, cooldownMs?: number) => { allowed: boolean; reason?: string }
}

// Shared reset fields for startRun/endRun to avoid duplication
// ── Store ──

// Track pending tool cleanup timers so they can be cancelled on new run
const _toolCleanupTimers = new Set<ReturnType<typeof setTimeout>>()

// Throttle state for streaming text updates (module-level, not in Zustand state)
let _lastStreamUpdate = 0
let _streamTimer: ReturnType<typeof setTimeout> | null = null

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
      circuitOpenedAt: null,  // v9.5.5
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
      // Reset streaming throttle state
      if (_streamTimer) { clearTimeout(_streamTimer); _streamTimer = null }
      _lastStreamUpdate = 0
      return set(s => {
        s.run.runId = runId
        s.run.phase = 'ANALYZE'
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
      if (_streamTimer) { clearTimeout(_streamTimer); _streamTimer = null }
      _lastStreamUpdate = 0
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

    // Throttled streaming text updates — max ~20 updates/sec to prevent
    // 100+ full-component re-renders per response. 50ms delay is imperceptible.
    setStreamingText: (text) => {
      const now = Date.now()
      if (now - _lastStreamUpdate < 50) {
        if (_streamTimer) clearTimeout(_streamTimer)
        _streamTimer = setTimeout(() => {
          set(s => { s.run.streamingText = text })
          _lastStreamUpdate = Date.now()
          _streamTimer = null
        }, 50)
        return
      }
      set(s => { s.run.streamingText = text })
      _lastStreamUpdate = now
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

    // ── v9.5.5: 熔断器方法 ──
    // 配置默认值（对齐 aiharness.json）：
    //   maxConsecutiveFailures = 5
    //   cooldownMs = 30_000 (30秒)

    recordApiFailure: (maxFailures = 5) => {
      let tripped = false
      set(s => {
        s.health.circuitFailures++
        if (s.health.circuitFailures >= maxFailures) {
          s.health.circuitState = 'OPEN'
          s.health.circuitOpenedAt = Date.now()
          tripped = true
        }
      })
      return { tripped }
    },

    recordApiSuccess: () => set(s => {
      // HALF_OPEN 成功后恢复；CLOSED 下重置计数器（防漂移累积）
      if (s.health.circuitState === 'HALF_OPEN') {
        s.health.circuitState = 'CLOSED'
        s.health.circuitOpenedAt = null
      }
      s.health.circuitFailures = 0
    }),

    checkCircuit: (maxFailures = 5, cooldownMs = 30_000) => {
      const state = get()
      const { circuitState, circuitFailures, circuitOpenedAt } = state.health

      if (circuitState === 'CLOSED') {
        // 防御: 如果计数异常高但状态未同步，手动触发（幂等安全）
        if (circuitFailures >= maxFailures) {
          set(s => {
            s.health.circuitState = 'OPEN'
            s.health.circuitOpenedAt = Date.now()
          })
          return {
            allowed: false,
            reason: `[熔断] 连续 ${circuitFailures} 次 API 失败，熔断器已打开。请等待 ${cooldownMs / 1000} 秒后重试。`,
          }
        }
        return { allowed: true }
      }

      if (circuitState === 'OPEN') {
        const elapsed = circuitOpenedAt ? Date.now() - circuitOpenedAt : 0
        if (elapsed >= cooldownMs) {
          // 冷却完成 → 半开（允许下一次尝试）
          set(s => {
            s.health.circuitState = 'HALF_OPEN'
          })
          return { allowed: true }
        }
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000)
        return {
          allowed: false,
          reason: `[熔断] 连续 API 调用失败，熔断器保护中。请等待 ${remainingSec} 秒后重试。`,
        }
      }

      // HALF_OPEN: 允许尝试（一次机会）
      return { allowed: true }
    },
  }))
)
