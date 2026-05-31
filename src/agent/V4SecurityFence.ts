// ── V4 Security Fence ──
// Reduced from V3's 12-layer defense to 3 essential checks.
// The model handles everything else through its own reasoning.
//
// Layer 1: Path Isolation — prevent access outside project directory
// Layer 2: JSON Validation — catch malformed JSON before file write
// Layer 3: Dangerous Tool Gate — user confirmation for dangerous/project-scoped tools
//         Uses toolRegistry as the single source of truth for permission levels.

import { toolRegistry } from './tools/ToolRegistry'

export interface SecurityCheckResult {
  allowed: boolean
  needsApproval: boolean
  reason?: string
}

export class V4SecurityFence {
  private projectId: string | null

  constructor(projectId: string | null) {
    this.projectId = projectId
  }

  check(toolName: string, args: Record<string, unknown>): SecurityCheckResult {
    // ── Layer 1: Path Isolation ──
    const pathResult = this.checkPathIsolation(args)
    if (!pathResult.allowed) return pathResult

    // ── Layer 2: JSON Validation ──
    const jsonResult = this.checkJsonValidation(toolName, args)
    if (!jsonResult.allowed) return jsonResult

    // ── Layer 3: Dangerous Tool Gate ──
    // Uses toolRegistry.getPermissionLevel() as the single source of truth.
    // Triggers approval for DANGEROUS_ASK and PROJECT_ASK permissions.
    if (toolRegistry.needsApproval(toolName)) {
      const perm = toolRegistry.getPermissionLevel(toolName)
      const label = perm === 'PROJECT_ASK' ? '项目操作' : '危险操作'
      return {
        allowed: true,
        needsApproval: true,
        reason: `${label} "${toolName}" 需要用户确认`,
      }
    }

    return { allowed: true, needsApproval: false }
  }

  // ── Layer 1 ──

  private checkPathIsolation(args: Record<string, unknown>): SecurityCheckResult {
    const fp = String(args.file_path || args.path || args.filePath || '')
    if (!fp) return { allowed: true, needsApproval: false }

    // Absolute system paths
    if (/^[A-Z]:[\\/]/i.test(fp) || fp.startsWith('/etc') || fp.startsWith('/usr') || fp.startsWith('/bin') || fp.startsWith('/dev')) {
      return {
        allowed: false, needsApproval: false,
        reason: `[安全] 路径 "${fp}" 指向系统目录，操作被拦截。请使用项目内相对路径。`,
      }
    }

    // UNC network paths
    if (/^\\\\/.test(fp)) {
      return {
        allowed: false, needsApproval: false,
        reason: `[安全] 路径 "${fp}" 是网络路径，操作被拦截。`,
      }
    }

    // Environment variable expansion
    if (/%[A-Z_]+%/.test(fp) || /\$[A-Z_]+/i.test(fp) || fp.includes('${')) {
      return {
        allowed: false, needsApproval: false,
        reason: `[安全] 路径含环境变量引用，操作被拦截。请使用相对路径。`,
      }
    }

    // Directory traversal
    if (fp.includes('..')) {
      return {
        allowed: false, needsApproval: false,
        reason: `[安全] 路径含 ".." 目录遍历，操作被拦截。请使用项目内相对路径。`,
      }
    }

    return { allowed: true, needsApproval: false }
  }

  // ── Layer 2 ──

  private checkJsonValidation(toolName: string, args: Record<string, unknown>): SecurityCheckResult {
    if (toolName !== 'create_file' && toolName !== 'edit_file') {
      return { allowed: true, needsApproval: false }
    }

    const fp = String(args.file_path || args.path || '')
    if (!fp.endsWith('.json')) return { allowed: true, needsApproval: false }

    const content = String(args.content || '')
    if (!content) return { allowed: true, needsApproval: false }

    try {
      JSON.parse(content)
      return { allowed: true, needsApproval: false }
    } catch (e) {
      return {
        allowed: false, needsApproval: false,
        reason: `[格式] JSON 解析失败: ${(e as Error).message}。请检查：所有键用双引号、无尾随逗号、字符串用双引号。可参考项目中已有的同名 JSON 文件格式。`,
      }
    }
  }
}
