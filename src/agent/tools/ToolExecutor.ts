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
  let readCount = 0
  let listCount = 0
  const MAX_READS = 10
  const MAX_LISTS = 3

  for (const call of calls) {
    // G11: Read limits — cap reads and directory listings per batch
    if (call.name === 'read_file') {
      readCount++
      if (readCount > MAX_READS) {
        results.push({ status: 'error', summary: `本轮已读取 ${MAX_READS} 个文件（上限），请分析已读内容后再继续。` })
        failureCount++
        continue
      }
    }
    if (call.name === 'list_directory') {
      listCount++
      if (listCount > MAX_LISTS) {
        results.push({ status: 'error', summary: `本轮已列出 ${MAX_LISTS} 个目录（上限），请按需查询。` })
        failureCount++
        continue
      }
    }

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
