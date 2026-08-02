// ── 全自由模式路径解析 (v14.5.1) ──
// 纯函数模块（无 electron 依赖，可直接单测）。
// 个人使用安全姿态：agent 可在任意非系统目录读写；
// 唯一硬边界 = 系统目录黑名单 + UNC/网络路径。
// path.resolve 归一化所有 ../（含中段）与混合分隔符，语义与磁盘解析一致。

import * as path from 'path'
import * as fsp from 'fs/promises'

/** 全局资源目录顶层段（首段命中 → 解析到 appRoot，如 notes/x.md） */
export const GLOBAL_DIR_NAMES = new Set([
  'style_templates', 'scene_templates', 'knowledge_base', 'uploads', 'notes', '.aiharness',
])

/** 系统目录黑名单（与 V4SecurityFence Layer 1 对齐 + Program Files） */
export function isBlockedSystemPath(p: string): boolean {
  const lowered = path.normalize(p).toLowerCase().replace(/\\/g, '/')
  return lowered.startsWith('c:/windows') || lowered.startsWith('c:/system32') ||
    lowered.startsWith('c:/program files') || lowered.startsWith('/dev/') ||
    lowered.startsWith('/etc/') || lowered.startsWith('/usr/') ||
    lowered.startsWith('/bin/') || lowered.startsWith('/sys/') ||
    lowered.startsWith('/proc/')
}

/** 共享解析逻辑：返回绝对路径；系统目录/UNC 返回 null */
export function resolveArg(raw: string, projectPath: string): string | null {
  let clean = raw.replace(/\\/g, '/')
  // Decode percent-encoded path traversal attempts (%2e%2e%2f = ../, %2f = /)
  clean = clean.replace(/%2e%2e%2f/gi, '../').replace(/%2e%2e/gi, '..').replace(/%2f/gi, '/')
  // UNC network paths → block
  if (clean.startsWith('//')) return null
  // Absolute paths → use as-is (全自由: 仅挡系统目录)
  if (/^[A-Za-z]:[/\\]/.test(clean) || clean.startsWith('/')) {
    const resolved = path.normalize(clean)
    return isBlockedSystemPath(resolved) ? null : resolved
  }
  // Relative → base by first segment (全局资源目录 → appRoot，其余 → projectPath)
  const firstSegment = clean.split('/')[0]
  const basePath = GLOBAL_DIR_NAMES.has(firstSegment) ? path.dirname(projectPath) : projectPath
  const resolved = path.resolve(basePath, clean)
  return isBlockedSystemPath(resolved) ? null : resolved
}

/** 异步版：文件存在时 realpath 复核（解析符号链接后重查系统目录） */
export async function safeResolveArg(raw: string, projectPath: string): Promise<string | null> {
  const resolved = resolveArg(raw, projectPath)
  if (!resolved) return null
  try {
    const real = await fsp.realpath(resolved)
    return isBlockedSystemPath(real) ? null : real
  } catch {
    return resolved // File doesn't exist yet
  }
}
