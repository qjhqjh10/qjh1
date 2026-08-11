// ── Shared Tool Executor Factory (v11.7.1) ──
// Extracted from V4AnthropicChatBridge and V4AgentChatBridge — identical
// SecurityFence → Approval → Execute → Audit → Cache pattern.
// Eliminates ~80 lines of duplicated code across the two bridges.

import { V4SecurityFence } from '../V4SecurityFence'
import { AuditTrail } from '../audit/AuditTrail'
import { toolRegistry } from '../skills/ToolRegistry'
import { invalidateAfterTool } from '../context/CacheInvalidator'
import { normalizeReadPath } from '../context/ReadResultTracker'
import { FENCE_WRITE_TOOLS } from '../skills/tools/writeToolSets'
import type { ToolExecutorFn } from '../runtime/RuntimeTypes'

/**
 * v16.1.0: 协作只读围栏——关联模式(chapterCollab.active)下禁止写当前章节文件。
 * 主/子代理统一生效(子代理绕过=漏洞,与"允许读本章、禁止写本章文件"决策冲突)。
 * v16.3.1(审计 D8): FENCE_WRITE_TOOLS 定义移入 ../skills/tools/writeToolSets（单一真源）
 */

function chapterLabel(chapterId: string): string {
  const m = String(chapterId || '').match(/(\d+)/)
  return m ? `第${m[1]}章` : chapterId
}

/** 返回拦截 reason(null = 放行)。动态读 store(用户可随时取消 chip 关联)。 */
async function checkCollabFence(toolName: string, args: Record<string, unknown>): Promise<string | null> {
  if (!FENCE_WRITE_TOOLS.has(toolName)) return null
  let collab: { active: boolean; chapterId: string | null }
  try {
    const { useChapterCollabStore } = await import('@/store/chapterCollabStore')
    collab = useChapterCollabStore.getState()
  } catch { return null }
  if (!collab.active || !collab.chapterId) return null

  // 提取目标路径(覆盖各写工具的参数键)
  const fp = String(args.file_path || args.path || args.filePath || args.new_path || args.targetPath || '')
  if (!fp) return null
  const target = normalizeReadPath(fp)
  // v16.1.0(审查修复 C11): 限定 "/chapters/{id}.txt" 形态——原 endsWith(chapterFile) 裸文件名
  // 容错会误拦 backups/chapters/x.txt、imitation_projects/其他项目/chapters/x.txt 等同名路径。
  // 归一化后: 项目内相对路径 "proj/chapters/x.txt" 与绝对路径均以 "/chapters/x.txt" 结尾。
  const chapterPath = `/chapters/${collab.chapterId}.txt`
  const isChapter = target === chapterPath.replace(/^\//, '')
    || target.endsWith(chapterPath)
  if (!isChapter) return null

  return `[协作只读] 当前与「${chapterLabel(collab.chapterId)}」建立 AI 协作关联，本章文件处于只读保护。` +
    `本章内容的修改请用 editor_rewrite 工具（直接应用到编辑器，不经文件系统，用户可直接看到特效改写）。` +
    `若需直接修改本章文件，请先在聊天窗点击「已关联 ✕」取消关联后再试。其他文件不受此限制。`
}

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

    // v16.1.0: Layer 5 — 协作只读围栏（关联模式下禁写当前章文件；主/子代理统一生效）
    const fenceReason = await checkCollabFence(ctx.toolName, args)
    if (fenceReason) {
      auditTrail.recordToolResult(ctx.toolName, 'blocked', fenceReason)
      auditTrail.recordPermissionDecision(ctx.toolName, 'deny', fenceReason)
      return { status: 'error', summary: fenceReason }
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
