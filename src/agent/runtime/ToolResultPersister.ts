// ── Tool Result Persister ──
// Offloads large tool results to filesystem, keeping only summaries in API context.
// Inspired by: LangChain "Context Rot" — retain head+tail, persist full content.
// This prevents context window pollution from large file reads.

import type { ToolResult } from './AgentRuntime'

const DETAIL_MAX_CHARS = 10000  // Max chars of detail to keep in API context
const HEAD_CHARS = 500          // Keep first N chars in summary
const TAIL_CHARS = 200          // Keep last N chars in summary

export interface PersistedResult {
  originalResult: ToolResult
  persistedPath: string | null   // null if below threshold
  summary: string                // The trimmed summary for API context
}

export class ToolResultPersister {
  private persistedFiles: string[] = []
  private tempDir = '.aiharness/tool-results'

  /** Offload large detail fields to filesystem, return trimmed summary */
  async persist(result: ToolResult, projectId: string | null): Promise<PersistedResult> {
    const detail = result.detail || ''
    if (detail.length <= DETAIL_MAX_CHARS) {
      return {
        originalResult: result,
        persistedPath: null,
        summary: detail,
      }
    }

    // Persist full content to temp file
    const fileName = `result_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}.txt`
    const filePath = `${this.tempDir}/${fileName}`

    try {
      const { mkdir, writeFile } = await import('fs/promises')
      const { join } = await import('path')
      const dir = join(projectId || '.', this.tempDir)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, fileName), detail, 'utf-8')
      this.persistedFiles.push(filePath)
    } catch {
      // Fallback: truncate in-memory
      return {
        originalResult: result,
        persistedPath: null,
        summary: detail.slice(0, HEAD_CHARS) + `\n...(截断 ${detail.length - HEAD_CHARS - TAIL_CHARS} 字符)...\n` + detail.slice(-TAIL_CHARS),
      }
    }

    // Return trimmed summary for API context
    const head = detail.slice(0, HEAD_CHARS)
    const tail = detail.slice(-TAIL_CHARS)
    const summary = `${head}\n\n... (完整内容已持久化到 ${filePath}，共 ${detail.length} 字符) ...\n\n${tail}`

    return {
      originalResult: result,
      persistedPath: filePath,
      summary,
    }
  }

  /** Clean up persisted files after session */
  async cleanup(): Promise<void> {
    for (const path of this.persistedFiles) {
      try {
        const { unlink } = await import('fs/promises')
        await unlink(path)
      } catch { /* already cleaned */ }
    }
    this.persistedFiles = []
  }
}
