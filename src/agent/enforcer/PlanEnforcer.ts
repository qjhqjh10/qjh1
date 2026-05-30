/**
 * PlanEnforcer — Unified Plan-as-Contract Execution Guard
 *
 * Wraps every tool call during execution, checking it against the approved plan.
 * Used by CLI, AgentRuntime, and AgentOrchestrator for consistent enforcement.
 *
 * Core rules:
 *   1. Tool must be in plan.neededTools
 *   2. Tool call must match a plan step
 *   3. Step must be approved (not rejected/pending)
 *   4. File path must match plan (soft warning if not)
 */

import type { ThinkingPlan, ThinkingStep } from '../state/types'

export interface EnforcerResult {
  allowed: boolean
  reason?: string
  matchedStep?: ThinkingStep
  needsApproval?: boolean
}

export interface ExpandResult {
  allowed: string[]       // tools added without approval
  needApproval: string[]  // tools requiring user approval
}

/** Tools that always require user approval when expanded */
const DANGEROUS_TOOLS = new Set([
  'delete_file', 'delete_project', 'delete_note',
  'shell_exec', 'shell_run_script',
])

/** Tools that never need expansion approval */
const SAFE_TOOLS = new Set([
  'read_file', 'list_directory', 'search_files', 'search_content',
  'read_note', 'search_notes', 'list_notes', 'list_rules', 'list_prompts', 'list_audit',
  'kb_list', 'write_note', 'append_note',
])

export class PlanEnforcer {
  constructor(private plan: ThinkingPlan) {}

  get planRef(): ThinkingPlan {
    return this.plan
  }

  /**
   * Check if a tool call is allowed under the current plan contract.
   */
  check(toolName: string, args: Record<string, unknown>): EnforcerResult {
    // ① Tool must be in the approved neededTools list
    if (!this.plan.neededTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `[计划合约] 工具 "${toolName}" 不在已批准的工具列表中。可用: ${this.plan.neededTools.join(', ')}`,
      }
    }

    // ② Find matching step in the plan
    const step = this.findMatchingStep(toolName, args)
    if (!step) {
      return {
        allowed: false,
        reason: `[计划合约] "${toolName}" 没有对应的计划步骤。请先更新计划再执行。`,
      }
    }

    // ③ Check step approval status
    if (step.approvalStatus === 'rejected') {
      return {
        allowed: false,
        reason: `[计划合约] 步骤 "${step.action}" 已被用户拒绝。`,
      }
    }
    if (step.approvalStatus === 'pending') {
      return {
        allowed: false,
        reason: `[计划合约] 步骤 "${step.action}" 尚未获得批准。`,
        needsApproval: true,
      }
    }

    // ④ File path consistency check (soft — allows but could warn)
    // Intentionally non-blocking: path deviations are noted but not blocked

    return { allowed: true, matchedStep: step }
  }

  /**
   * Handle a tool expansion request from the agent.
   * Returns which tools can be auto-added vs. which need user approval.
   */
  handleExpand(requestedTools: string[]): ExpandResult {
    const allowed: string[] = []
    const needApproval: string[] = []

    for (const t of requestedTools) {
      if (this.plan.neededTools.includes(t)) continue  // already in plan

      if (DANGEROUS_TOOLS.has(t)) {
        needApproval.push(t)
      } else {
        allowed.push(t)
        this.plan.neededTools.push(t)
      }
    }

    return { allowed, needApproval }
  }

  /**
   * Mark a plan step as completed (or failed) after tool execution.
   */
  completeStep(
    toolName: string,
    args: Record<string, unknown>,
    result: { status: string; summary: string },
  ): void {
    const step = this.findMatchingStep(toolName, args)
    if (step) {
      step.status = result.status === 'success' ? 'completed' : 'failed'
      ;(step as any).completedAt = Date.now()
      ;(step as any).actualResult = result.summary
    }
  }

  /**
   * Check if all plan steps have been completed or failed.
   */
  get isComplete(): boolean {
    return this.plan.steps.length > 0
      && this.plan.steps.every(s => s.status === 'completed' || s.status === 'failed')
  }

  /**
   * Get a summary of step completion for review.
   */
  get progressSummary(): { total: number; completed: number; failed: number; pending: number } {
    const total = this.plan.steps.length
    const completed = this.plan.steps.filter(s => s.status === 'completed').length
    const failed = this.plan.steps.filter(s => s.status === 'failed').length
    const pending = total - completed - failed
    return { total, completed, failed, pending }
  }

  // ── Private ──

  private findMatchingStep(
    toolName: string,
    args: Record<string, unknown>,
  ): ThinkingStep | undefined {
    return this.plan.steps.find(s => {
      if (s.tool !== toolName) return false
      // If step doesn't specify a file path, any match on tool name is valid
      if (!s.args?.file_path || !args.file_path) return true
      const planned = String(s.args.file_path)
      const actual = String(args.file_path)
      // Substring match in either direction
      return actual.includes(planned) || planned.includes(actual)
    })
  }
}
