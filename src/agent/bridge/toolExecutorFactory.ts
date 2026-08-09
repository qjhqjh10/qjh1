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
  /** 用户审批超时 (ms)，默认 60_000。v14.5.0: 180s→60s——须小于工具超时 120s，
   * 否则"审批晚于工具超时、通过后孤儿执行"竞态（工具已判超时但审批通过仍会执行副作用） */
  approvalTimeoutMs?: number
  /** 需要用户确认时回调。不传则直接拒绝 */
  onApprovalRequired?: (tools: Array<{ name: string; args: Record<string, unknown> }>) => Promise<boolean>
}

export function createToolExecutor(opts: ToolExecutorFactoryOptions): ToolExecutorFn {
  const { securityFence, auditTrail, approvalTimeoutMs = 60_000, onApprovalRequired } = opts

  return async (args, ctx) => {
    // Layer 1-4: Security fence
    const secCheck = securityFence.check(ctx.toolName, args)
    if (!secCheck.allowed) {
      auditTrail.recordToolResult(ctx.toolName, 'blocked', secCheck.reason || '')
      // v14 批处理: 审计权限决策（会话统计的 permissionDenied 计数来源）
      auditTrail.recordPermissionDecision(ctx.toolName, 'deny', secCheck.reason || '安全围栏拦截')
      return { status: 'error', summary: secCheck.reason || '操作被安全围栏拦截' }
    }

    // Approval: dangerous tools or external paths
    // 无 onApprovalRequired（如子 agent）时 needsApproval 一律拒绝——否则条件审批可被绕过
    if (secCheck.needsApproval && !onApprovalRequired) {
      auditTrail.recordToolResult(ctx.toolName, 'blocked', '工具需要审批但当前执行环境无审批路径')
      auditTrail.recordPermissionDecision(ctx.toolName, 'deny', '当前环境无审批路径')
      return { status: 'error', summary: '此操作需要用户确认，当前环境不支持审批' }
    }
    if (secCheck.needsApproval && onApprovalRequired) {
      // v14.5.0: 审批等待期间状态条显示"待审批"（WAITING_APPROVAL 此前从未被设置，
      // 审批期间 UI 一直显示"执行中"）；动态 import 避免模块环；子代理无 onApprovalRequired 不触碰共享 store
      let agentStore: { setPhase: (phase: import('../state/types').AgentPhase) => void } | null = null
      try {
        const { useAgentStore } = await import('../store/AgentStore')
        agentStore = useAgentStore.getState()
        agentStore.setPhase('WAITING_APPROVAL')
      } catch { /* 测试/无 store 环境不影响审批 */ }
      try {
        const timeoutPromise = new Promise<boolean>(r =>
          setTimeout(() => r(false), approvalTimeoutMs),
        )
        const approved = await Promise.race([
          onApprovalRequired([{ name: ctx.toolName, args }]),
          timeoutPromise,
        ])
        // v14 批处理: 审计权限决策（allow/deny + 原因）
        auditTrail.recordPermissionDecision(ctx.toolName, approved ? 'allow' : 'deny',
          approved ? '用户批准' : '用户拒绝或审批超时')
        if (!approved) {
          return { status: 'error', summary: '用户拒绝了此操作' }
        }
      } finally {
        // v14.5.0 审查修复: 中止/超时结束时不恢复 EXECUTE（run 结束 endRun 归位 IDLE）
        if (agentStore && !ctx.signal.aborted) agentStore.setPhase('EXECUTE')
      }
    }

    // Execute
    // v16.0.2(P3): recordToolCall 接线——审计工具入参（脱敏：content→长度、query→100 字截断，
    // 见 AuditTrail.recordToolCall）。原方法定义后无调用方，事后审计只能看结果 summary 看不到
    // "agent 实际请求了什么参数"。放在执行前（"调用"=实际执行）；失败/拒绝路径不记录调用
    auditTrail.recordToolCall(ctx.toolName, args)
    const result = await toolRegistry.execute(ctx.toolName, args, ctx)
    auditTrail.recordToolResult(ctx.toolName, result.status, result.summary)

    // Cache invalidation + UI notification
    if (result.status === 'success') {
      // v14.6.1: 传 projectsBasePath——AI 相对路径解析为绝对路径双 key 失效
      // （GUI 缓存/刷新比较都用绝对路径，原相对 key 失效漏掉 GUI 条目）
      let basePath: string | undefined
      try {
        const { useStore } = await import('@/store')
        basePath = useStore.getState().projectsBasePath || undefined
      } catch { /* 测试/无 store 环境：无 basePath 时保持旧行为 */ }
      await invalidateAfterTool(ctx.toolName, args, {
        onFileChanged: async (filePath) => {
          const { useStore } = await import('@/store')
          useStore.getState().setFileEditNotify({
            filePath,
            newContent: '__AI_EDITED__',
          })
        },
      }, basePath)
    }

    return result
  }
}
