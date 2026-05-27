import { useRef, useCallback, useEffect, useState } from 'react'
import { AgentRuntime } from '../runtime/AgentRuntime'
import { useAgentStore } from '../store/AgentStore'
import { toolRegistry } from '../tools/ToolRegistry'
import { contextAssembler } from '../context/ContextAssembler'
import { coreRulesProvider } from '../context/providers/coreRulesProvider'
import { BudgetManager } from '../budget/BudgetManager'
import { ToolCache } from '../cache/ToolCache'
import { CircuitBreaker } from '../circuit/CircuitBreaker'
import { ConstraintEngine } from '../constraints/ConstraintEngine'
import { PolicyEngine } from '../permissions/PolicyEngine'
import { SkillLearner } from '../evolution/SkillLearner'
import { LivingSkillManager } from '../living-skills/LivingSkillManager'
import { HallucinationDetector } from '../runtime/HallucinationDetector'
import type { AgentConfig, AgentRunInput, Message } from '../runtime/AgentRuntime'
import { aiService } from '@/services/fileService'
import { ALL_TOOLS } from '../tools/definitions'

// ── Init globals once ──
let globalsInitialized = false
function initGlobals() {
  if (globalsInitialized) return
  globalsInitialized = true
  toolRegistry.registerAll(ALL_TOOLS)
  if (contextAssembler.getProviders().length === 0) {
    contextAssembler.register(coreRulesProvider)
  }
}

// ── Hook ──

export interface UseAgentRuntimeOptions {
  configId: string
  projectId: string | null
  workMode: 'plan' | 'action'
  maxIterations?: number
  historyMessages?: Message[]
  kbEnabled?: boolean
  webSearchEnabled?: boolean
}

export function useAgentRuntime(options: UseAgentRuntimeOptions) {
  initGlobals()

  const {
    configId, projectId, workMode,
    maxIterations = 8,
    historyMessages = [],
    kbEnabled = false,
    webSearchEnabled = false,
  } = options

  const [isRunning, setIsRunning] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamedText, setStreamedText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const runtimeRef = useRef<AgentRuntime | null>(null)
  const abortControllerRef = useRef<AbortController>(new AbortController())
  const budgetMgrRef = useRef(new BudgetManager(128000))
  const toolCacheRef = useRef(new ToolCache())
  const circuitBreakerRef = useRef(new CircuitBreaker())
  const constraintEngineRef = useRef(new ConstraintEngine())
  const policyEngineRef = useRef(new PolicyEngine())
  const skillLearnerRef = useRef(new SkillLearner('.aiharness'))
  const livingSkillManagerRef = useRef(new LivingSkillManager())
  const hallucinationDetectorRef = useRef(new HallucinationDetector())

  const store = useAgentStore()

  // Build the agent runtime
  const getRuntime = useCallback(() => {
    if (runtimeRef.current) return runtimeRef.current

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const config: AgentConfig = {
      configId, projectId, workMode, maxIterations,
      abortSignal: abortController.signal,
    }

    const runtime = new AgentRuntime(config)

    // Inject dependencies
    runtime.setAIService({
      chatWithTools: async (messages, cid, pid, tools) => {
        const result = await aiService.chatWithTools(messages, cid, pid, tools)
        return {
          text: result.text,
          toolCalls: result.toolCalls?.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })) || null,
          finishReason: result.finishReason,
          images: result.images,
          reasoning_content: result.reasoning_content,
          usage: result.usage,
        }
      },
      abortStream: () => aiService.abortStream(),
    })

    runtime.setContextAssembler(async (userMessage, history, pid, _mode) => {
      let searchContext = ''
      const effectiveProjectId = pid ?? projectId

      if (kbEnabled && effectiveProjectId) {
        try {
          const { kbService } = await import('@/services/fileService')
          const results = await kbService.search(userMessage, effectiveProjectId, configId || '', 3)
          if (Array.isArray(results) && results.length > 0) {
            searchContext += '\n[知识库搜索结果]\n' + results.map((r: any) => r.content || r.text || '').join('\n---\n')
          }
        } catch { /* KB search unavailable */ }
      }

      if (webSearchEnabled) {
        try {
          const { kbService } = await import('@/services/fileService')
          const results = await kbService.webSearch(userMessage, 3)
          if (Array.isArray(results) && results.length > 0) {
            searchContext += '\n[网络搜索结果]\n' + results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
          }
        } catch { /* Web search unavailable */ }
      }

      const assembled = await contextAssembler.assemble(userMessage, history, effectiveProjectId)
      if (searchContext) {
        assembled.systemMessages.push({ role: 'system', content: searchContext })
        assembled.totalTokens += Math.ceil(searchContext.length / 3)
      }
      return assembled
    })

    runtime.setToolExecutor(async (args, ctx) => {
      // Circuit breaker check
      const cbCheck = circuitBreakerRef.current.beforeCall()
      if (!cbCheck.allowed) {
        return { status: 'error', summary: cbCheck.reason || '断路保护已激活' }
      }

      // For reads, check cache first
      const cacheKey = `${ctx.toolName}:${JSON.stringify(args)}`
      if (toolCacheRef.current.has(cacheKey)) {
        return toolCacheRef.current.get(cacheKey)!
      }

      const result = await toolRegistry.execute(ctx.toolName, args, ctx)

      if (result.status === 'success') {
        circuitBreakerRef.current.recordSuccess()
        if (ctx.toolName === 'read_file') toolCacheRef.current.set(cacheKey, result)
      } else {
        circuitBreakerRef.current.recordFailure()
      }

      return result
    })

    // Safety-critical subsystems
    runtime.setBudgetManager(budgetMgrRef.current)
    runtime.setConstraintEngine(constraintEngineRef.current)
    runtime.setPolicyEngine(policyEngineRef.current)
    runtime.setLivingSkillManager(livingSkillManagerRef.current)
    runtime.setHallucinationDetector(hallucinationDetectorRef.current)
    runtime.setHallucinationCallback((text) => {
      skillLearnerRef.current.recordError('hallucination', text, 'hallucination')
    })
    runtime.setTools(toolRegistry.getFilteredSchemas(workMode))
    runtime.setHistory(historyMessages)

    // Wire events to UI
    const emitter = runtime.getEmitter()
    emitter.on('response:streaming', (data) => {
      setIsStreaming(true)
      setStreamedText(data.accumulated)
    })
    emitter.on('response:complete', () => {
      setIsStreaming(false)
    })
    emitter.on('error', (data) => {
      setError(data.message)
      setIsRunning(false)
      setIsStreaming(false)
    })
    emitter.on('agent:state', (data) => {
      store.setPhase(data.to)
      store.setIteration(data.state.iteration)
    })
    emitter.on('tool:started', (data) => {
      store.addToolExecution(data.callId, data.toolName)
    })
    emitter.on('tool:completed', (data) => {
      store.completeTool(data.callId, 'success', data.summary, data.detail)
    })
    emitter.on('tool:failed', (data) => {
      store.completeTool(data.callId, 'error', data.summary, data.detail)
    })

    runtimeRef.current = runtime
    return runtime
  }, [configId, projectId, workMode, maxIterations, historyMessages, kbEnabled, webSearchEnabled, store])

  // Run the agent
  const run = useCallback(async (input: AgentRunInput) => {
    setError(null)
    setStreamedText('')
    setIsRunning(true)

    circuitBreakerRef.current.reset()
    const runtime = getRuntime()

    try {
      const result = await runtime.run(input)
      store.addTokens(result.totalTokens)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
      store.setLastError(msg)
      throw err
    } finally {
      setIsRunning(false)
    }
  }, [getRuntime, store])

  // Abort
  const abort = useCallback(() => {
    abortControllerRef.current.abort()
    runtimeRef.current?.abort()
    setIsRunning(false)
    setIsStreaming(false)
  }, [])

  // Reset for new conversation
  const reset = useCallback(() => {
    abort()
    runtimeRef.current = null
    abortControllerRef.current = new AbortController()
    toolCacheRef.current.invalidateAll()
    circuitBreakerRef.current.reset()
    setStreamedText('')
    setError(null)
  }, [abort])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abort()
    }
  }, [abort])

  return {
    run,
    abort,
    reset,
    isRunning,
    isStreaming,
    streamedText,
    error,
    store,
    getRuntime,
  }
}
