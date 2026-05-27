// ── Deny-first Policy Engine ──

export type PolicyEffect = 'allow' | 'deny' | 'ask'

export interface PermissionPolicy {
  id: string
  effect: PolicyEffect
  toolName: string | '*'
  pathPattern?: string
  operation?: 'read' | 'write' | 'delete' | 'execute'
  conditions?: {
    workMode?: 'plan' | 'action'
    maxTokensPerSession?: number
  }
  autoApproveReason?: string
}

export interface PolicyEvaluation {
  effect: PolicyEffect
  matchedPolicy: string | null
  reason: string
  requiresUserApproval: boolean
}

// Operation inference from tool name
function inferOperation(toolName: string): string {
  if (/^(read_file|list_directory|search_files|search_content|kb_list|list_notes|read_note|list_prompts)$/.test(toolName)) return 'read'
  if (/^(create_file|write_note|generate_image|kb_create_file|create_project|create_style_template|create_scene_template)$/.test(toolName)) return 'write'
  if (/^(delete_file|delete_note|delete_project)$/.test(toolName)) return 'delete'
  if (/^(edit_file|rename_file|append_note|kb_append_file|toggle_prompt|update_prompt|search_images|kb_index_file)$/.test(toolName)) return 'execute'
  return 'execute'
}

function matchGlob(pattern: string, value: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*\*/g, '<<<DOUBLESTAR>>>').replace(/\*/g, '[^/]*').replace(/<<<DOUBLESTAR>>>/g, '.*') + '$')
  return regex.test(value)
}

import { PermissionManager } from './PermissionManager'

export class PolicyEngine {
  private policies: PermissionPolicy[] = []
  private permissionMgr: PermissionManager | null = null

  load(policies: PermissionPolicy[]): void {
    this.policies = [...policies]
  }

  setPermissionManager(mgr: PermissionManager): void {
    this.permissionMgr = mgr
  }

  getPolicies(): readonly PermissionPolicy[] {
    return this.policies
  }

  evaluate(toolName: string, args?: Record<string, unknown>): PolicyEvaluation {
    const op = inferOperation(toolName)
    const filePath = args?.['file_path'] as string || args?.['path'] as string || ''

    // 1. Check explicit denies first (most restrictive wins)
    for (const p of this.policies) {
      if (p.effect !== 'deny') continue
      if (!this.matchesTool(p, toolName)) continue
      if (p.pathPattern && filePath && !matchGlob(p.pathPattern, filePath)) continue
      if (p.operation && p.operation !== op) continue
      return { effect: 'deny', matchedPolicy: p.id, reason: `策略 [${p.id}] 禁止此操作`, requiresUserApproval: false }
    }

    // 2. Check explicit allows
    for (const p of this.policies) {
      if (p.effect !== 'allow') continue
      if (!this.matchesTool(p, toolName)) continue
      if (p.pathPattern && filePath && !matchGlob(p.pathPattern, filePath)) continue
      if (p.operation && p.operation !== op) continue
      return { effect: 'allow', matchedPolicy: p.id, reason: p.autoApproveReason || `策略 [${p.id}] 允许`, requiresUserApproval: false }
    }

    // 3. Check explicit "ask" policies
    for (const p of this.policies) {
      if (p.effect !== 'ask') continue
      if (!this.matchesTool(p, toolName)) continue
      if (p.pathPattern && filePath && !matchGlob(p.pathPattern, filePath)) continue
      if (p.operation && p.operation !== op) continue
      return { effect: 'ask', matchedPolicy: p.id, reason: `策略 [${p.id}] 需要用户确认`, requiresUserApproval: true }
    }

    // 4. Fallback to learned permission patterns
    if (this.permissionMgr) {
      const learned = this.permissionMgr.evaluate(toolName, filePath || undefined)
      if (learned.suggestedAutoApprove) {
        return { effect: 'allow', matchedPolicy: 'learned', reason: `自动批准（历史行为模式）`, requiresUserApproval: false }
      }
    }

    // 5. Default deny
    return { effect: 'deny', matchedPolicy: null, reason: '默认拒绝：未匹配任何允许策略', requiresUserApproval: false }
  }

  private matchesTool(policy: PermissionPolicy, toolName: string): boolean {
    if (policy.toolName === '*') return true
    return matchGlob(policy.toolName, toolName)
  }
}
