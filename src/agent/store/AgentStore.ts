import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AgentPhase } from '../state/types'
// v16.3.0(审计 M10 修复): ToolProgressEvent import 删除（updateToolProgress 已删）
import type { ThinkingContext } from '../runtime/AgentEventEmitter'

// ── Types ──

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

export interface AgentHealthState {
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  circuitFailures: number
  circuitOpenedAt: number | null  // v9.5.5: 熔断器打开时间戳（用于冷却计时）
}

export interface AgentStoreState {
  // Current run
  run: AgentRunState

  // Token tracking
  totalTokensUsed: number

  // Health（内存态——无 persist 中间件；v16.3.0 审计 M10: setHealth action 已删（零调用），
  // health 字段保留——熔断器（recordApiFailure/checkCircuit）真实读写）
  health: AgentHealthState

  // Actions — Run
  startRun: (runId: string) => void
  endRun: () => void
  setPhase: (phase: AgentPhase) => void
  setIteration: (n: number) => void
  setThinking: (thinking: ThinkingContext | null) => void
  addToolExecution: (callId: string, toolName: string) => void
  // v16.3.0(审计 M10 修复): 删 updateToolProgress/setPeakPromptTokens/setHealth action（零调用）；
  // health 字段保留——熔断器（recordApiFailure 等）真实读写 s.health
  completeTool: (callId: string, status: 'success' | 'error', summary: string, detail?: string) => void
  setLastError: (error: string | null) => void
  setStreamingText: (text: string) => void
  setIsStreaming: (streaming: boolean) => void
  // v14.9(接线): 反馈横幅（hook:blocked / hook:passed 事件）——原 hookFeedback 字段全仓无写入点（死 UI）
  setHookFeedback: (fb: { hookName: string; passed: boolean; feedback: string; timestamp: number } | null) => void

  // Actions — Tokens
  addTokens: (amount: number) => void

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

    totalTokensUsed: 0,

    // health 字段保留——熔断器（recordApiFailure/checkCircuit）真实读写；setHealth action 已删
    health: {
      circuitState: 'CLOSED',
      circuitFailures: 0,
      circuitOpenedAt: null,  // v9.5.5
    },

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

    // v16.3.0(审计 M10 修复): 删 updateToolProgress（全仓零调用——ToolExecutor 事件只走
    // completeTool/setLastError，工具实时状态由 AgentStateBar 读 activeTools）

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

    // v14.9(接线): 反馈横幅写入（chatBridgeFactory 订阅 hook:blocked/hook:passed 事件调用）
    setHookFeedback: (fb) => set(s => { s.run.hookFeedback = fb }),

    // ── Token Actions ──

    addTokens: (amount) => set(s => { s.totalTokensUsed += amount }),

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
