// ── V4 Security Fence ──
//
// v14.5.1 全自由模式（个人使用）：路径不再要求审批——
//   Layer 1: Hard blocks — system dirs, UNC, env variables (NEVER allowed)
//   Layer 2: Format Validation — JSON/YAML schema validation for create_file/edit_file
//   Layer 3: (已移除) 外部路径审批 —— agent 可在任意非系统目录读写，事前审批 → 事后审计（操作历史）
//   Layer 4: Tool gate — 剩余 DANGEROUS_ASK / PROJECT_ASK 工具（update_prompt/delete_project）仍需确认

import { toolRegistry } from './skills/ToolRegistry'
import { tryParseJsonOrYaml } from '../utils/yamlUtils'

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
    // ── Layer 1: Hard blocks (never allowed) ──
    const hardBlock = this.checkHardBlocks(args)
    if (!hardBlock.allowed) return hardBlock

    // ── Layer 2: JSON Validation ──
    const jsonResult = this.checkJsonValidation(toolName, args)
    if (!jsonResult.allowed) return jsonResult

    // ── Layer 3: (v14.5.1 移除) 外部路径不再需要审批 — 全自由模式，仅 Layer 1 硬拦截保留 ──

    // ── Layer 4: Tool gate → approval ──
    if (toolRegistry.needsApproval(toolName, args)) {
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

  // ── Layer 1: Hard blocks ──

  private checkHardBlocks(args: Record<string, unknown>): SecurityCheckResult {
    const fp = this.extractPath(args)
    if (!fp) return { allowed: true, needsApproval: false }

    // UNC network paths → hard block
    if (/^\\\\/.test(fp)) {
      return {
        allowed: false, needsApproval: false,
        reason: `[安全] 路径 "${fp}" 是网络路径，操作被拦截。`,
      }
    }

    // Environment variable expansion → hard block
    if (/%[A-Z_]+%/.test(fp) || /\$[A-Z_]+/i.test(fp) || fp.includes('${')) {
      return {
        allowed: false, needsApproval: false,
        reason: `[安全] 路径含环境变量引用，操作被拦截。请使用相对路径。`,
      }
    }

    // System-critical directories → hard block
    const lowered = fp.toLowerCase().replace(/\\/g, '/')
    if (lowered.startsWith('c:/windows') || lowered.startsWith('c:/system32') ||
        lowered.startsWith('/dev/') || lowered.startsWith('/etc/') ||
        lowered.startsWith('/usr/') || lowered.startsWith('/bin/') ||
        lowered.startsWith('/sys/') || lowered.startsWith('/proc/')) {
      return {
        allowed: false, needsApproval: false,
        reason: `[安全] 路径 "${fp}" 指向系统目录，操作被拦截。`,
      }
    }

    return { allowed: true, needsApproval: false }
  }

  // ── Layer 2: Format Validation (JSON + YAML) ──

  private checkJsonValidation(toolName: string, args: Record<string, unknown>): SecurityCheckResult {
    if (toolName !== 'create_file' && toolName !== 'edit_file') {
      return { allowed: true, needsApproval: false }
    }
    const fp = String(args.file_path || args.path || '')
    // 只检查结构化数据文件（.json 或 .yaml/.yml）
    const isYaml = fp.endsWith('.yaml') || fp.endsWith('.yml')
    const isJson = fp.endsWith('.json')
    if (!isYaml && !isJson) return { allowed: true, needsApproval: false }

    // v12.13.0: edit_file 局部替换跳过格式校验
    // new_string 是替换片段（非完整文档），独立解析必然失败
    // 仅当 old_string 为非空且非 __FULL_REPLACE__ 时才确认是局部替换
    if (toolName === 'edit_file') {
      const oldStr = args.old_string as string | undefined
      if (oldStr != null && oldStr !== '' && oldStr !== '__FULL_REPLACE__') {
        return { allowed: true, needsApproval: false }
      }
      // old_string 缺失/为空/为 __FULL_REPLACE__ → 继续校验（可能是全量覆盖）
    }

    const content = String(args.content || args.new_string || '')
    if (!content) return { allowed: true, needsApproval: false }

    // 按文件扩展名选择对应的解析器（.json 只接受 JSON，.yaml 只接受 YAML）
    const preferFormat = isYaml ? 'yaml' : 'json'
    const parsed = tryParseJsonOrYaml(content, preferFormat)
    if (parsed) {
      return { allowed: true, needsApproval: false }
    }

    // 格式错误 — 提供有针对性的修复建议
    const fmtLabel = isYaml ? 'YAML' : 'JSON'
    const suggestions = isYaml
      ? '检查 YAML 缩进是否正确（必须用 2 空格，禁止 Tab）、多行文本是否正确使用 | 或 >-、列表项是否以 -  开头'
      : '检查所有键用双引号、无尾随逗号、字符串用双引号。可参考项目中已有的同名文件格式'
    return {
      allowed: false, needsApproval: false,
      reason: `[格式] ${fmtLabel} 解析失败。${suggestions}。`,
    }
  }

  // ── Layer 3: (v14.5.1 移除) 外部路径审批 — 全自由模式下路径仅受 Layer 1 硬拦截约束 ──

  // ── Helpers ──

  private extractPath(args: Record<string, unknown>): string {
    return String(args.file_path || args.path || args.filePath || args.dir_path || '')
  }
}
