import { useRef, useCallback, useEffect, useState } from 'react'
import { AgentRuntime } from '../runtime/AgentRuntime'
import { useAgentStore } from '../store/AgentStore'
import { toolRegistry } from '../tools/ToolRegistry'
import { contextAssembler } from '../context/ContextAssembler'
import { coreRulesProvider } from '../context/providers/coreRulesProvider'
import { PermissionManager } from '../permissions/PermissionManager'
import { BudgetManager } from '../budget/BudgetManager'
import { ReflectionEngine } from '../reflection/ReflectionEngine'
import { ToolCache } from '../cache/ToolCache'
import type { AgentConfig, AgentRunInput, Message } from '../runtime/AgentRuntime'
import type { ToolResultEvent } from '../runtime/AgentEventEmitter'
import { aiService } from '@/services/fileService'
import { ALL_TOOLS } from '../tools/definitions'

// ── Init globals once ──
let globalsInitialized = false
function initGlobals() {
  if (globalsInitialized) return
  globalsInitialized = true
  // Register all 26 tools
  toolRegistry.registerAll(ALL_TOOLS)
  // Register core rules provider
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
}

export function useAgentRuntime(options: UseAgentRuntimeOptions) {
  initGlobals()

  const {
    configId, projectId, workMode,
    maxIterations = 8,
    historyMessages = [],
  } = options

  const [isRunning, setIsRunning] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamedText, setStreamedText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const runtimeRef = useRef<AgentRuntime | null>(null)
  const abortControllerRef = useRef<AbortController>(new AbortController())
  const permissionMgrRef = useRef(new PermissionManager())
  const budgetMgrRef = useRef(new BudgetManager(128000))
  const reflectionRef = useRef(new ReflectionEngine())
  const toolCacheRef = useRef(new ToolCache())

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

    runtime.setContextAssembler(async (userMessage, history, mode) => {
      return contextAssembler.assemble(userMessage, history, projectId)
    })

    runtime.setToolExecutor(async (args, ctx) => {
      return toolRegistry.execute(ctx.callId.includes('tool') ? ctx.callId.replace('tool', '') : ctx.callId, args, ctx)
    })

    runtime.setTools(toolRegistry.getAllSchemas())
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
  }, [configId, projectId, workMode, maxIterations, historyMessages, store])

  // Run the agent
  const run = useCallback(async (input: AgentRunInput) => {
    setError(null)
    setStreamedText('')
    setIsRunning(true)

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
