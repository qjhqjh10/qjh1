import { ToolRegistry } from './ToolRegistry'
import type { ToolResult, ToolExecutionContext } from '../runtime/AgentRuntime'
import type { ToolProgressEvent } from '../runtime/AgentEventEmitter'

export interface BatchExecutionOptions {
  registry: ToolRegistry
  calls: Array<{ id: string; name: string; arguments: string }>
  ctx: ToolExecutionContext
  onProgress: (event: ToolProgressEvent) => void
  maxParallel?: number  // reserved for future parallel execution
}

export interface BatchResult {
  results: ToolResult[]
  successCount: number
  failureCount: number
  allSuccess: boolean
}

export async function executeBatch(options: BatchExecutionOptions): Promise<BatchResult> {
  const { registry, calls, ctx, onProgress } = options
  const results: ToolResult[] = []
  let successCount = 0
  let failureCount = 0

  for (const call of calls) {
    const args = JSON.parse(call.arguments)

    const result = await registry.execute(call.name, args, {
      ...ctx,
      callId: call.id,
    }, onProgress)

    results.push(result)
    if (result.status === 'success') successCount++
    else failureCount++
  }

  return {
    results,
    successCount,
    failureCount,
    allSuccess: failureCount === 0,
  }
}
