// ── Shared Tool Executor Factory (v11.7.1) ──
// Extracted from V4AnthropicChatBridge and V4AgentChatBridge — identical
// SecurityFence → Approval → Execute → Audit → Cache pattern.
// Eliminates ~80 lines of duplicated code across the two bridges.

import { V4SecurityFence } from '../V4SecurityFence'
import { AuditTrail } from '../audit/AuditTrail'
import { toolRegistry } from '../skills/ToolRegistry'
import { invalidateAfterTool } from '../context/CacheInvalidator'
import type { ToolExecutorFn } from '../runtime/RuntimeTypes'

export interface ToolExecutorFactoryOptions {
  securityFence: V4SecurityFence
  auditTrail: AuditTrail
  projectId: string | null
  /** 用户审批超时 (ms)，默认 180_000。Only Anthropic 有超时，OpenAI 无限 */
  approvalTimeoutMs?: number
  /** 需要用户确认时回调。不传则直接拒绝 */
  onApprovalRequired?: (tools: Array<{ name: string; args: Record<string, unknown> }>) => Promise<boolean>
}

export function createToolExecutor(opts: ToolExecutorFactoryOptions): ToolExecutorFn {
  const { securityFence, auditTrail, projectId, approvalTimeoutMs = 180_000, onApprovalRequired } = opts

  return async (args, ctx) => {
    // Layer 1-4: Security fence
    const secCheck = securityFence.check(ctx.toolName, args)
    if (!secCheck.allowed) {
      auditTrail.recordToolResult(ctx.toolName, 'blocked', secCheck.reason || '')
      return { status: 'error', summary: secCheck.reason || '操作被安全围栏拦截' }
    }

    // Approval: dangerous tools or external paths
    if (secCheck.needsApproval && onApprovalRequired) {
      const timeoutPromise = new Promise<boolean>(r =>
        setTimeout(() => r(false), approvalTimeoutMs),
      )
      const approved = await Promise.race([
        onApprovalRequired([{ name: ctx.toolName, args }]),
        timeoutPromise,
      ])
      if (!approved) {
        return { status: 'error', summary: '用户拒绝了此操作' }
      }
    }

    // Execute
    const result = await toolRegistry.execute(ctx.toolName, args, ctx)
    auditTrail.recordToolResult(ctx.toolName, result.status, result.summary)

    // Cache invalidation + UI notification
    if (result.status === 'success') {
      await invalidateAfterTool(ctx.toolName, args, projectId, {
        onFileChanged: async (filePath) => {
          const { useStore } = await import('@/store')
          useStore.getState().setFileEditNotify({
            filePath,
            newContent: '__AI_EDITED__',
          })
        },
      })
    }

    return result
  }
}
