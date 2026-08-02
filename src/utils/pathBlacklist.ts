// ── 系统目录黑名单（v14.6.1 提取为共享纯函数模块）──
// 单一来源：渲染层 V4SecurityFence（Layer 1）与主进程 pathResolution.ts 共用同一判定，
// 杜绝两处黑名单漂移（此前 fence 仅拦 C: 盘、主进程拦任意盘符——语义不一致）。
// 零依赖（无 node/electron import），渲染层可安全加载。

/** 系统目录黑名单（任意盘符 + POSIX）— 与 V4SecurityFence Layer 1 对齐 + Program Files */
export function isBlockedSystemPath(p: string): boolean {
  const lowered = pathNormalize(p)
  // 任意盘符的系统目录（windows / program files / system32 / syswow64 / perflogs / recovery）
  const winMatch = lowered.match(/^[a-z]:\//)
  if (winMatch) {
    const rest = lowered.slice(winMatch[0].length)
    if (rest.startsWith('windows') || rest.startsWith('program files') ||
        rest.startsWith('system32') || rest.startsWith('syswow64') ||
        rest.startsWith('perflogs') || rest.startsWith('recovery')) {
      return true
    }
  }
  return lowered.startsWith('/dev/') || lowered.startsWith('/etc/') ||
    lowered.startsWith('/usr/') || lowered.startsWith('/bin/') ||
    lowered.startsWith('/sys/') || lowered.startsWith('/proc/')
}

/** 归一化（反斜杠→正斜杠 + 小写）——纯字符串操作，无 node:path 依赖 */
function pathNormalize(p: string): string {
  return String(p).replace(/\\/g, '/').toLowerCase().replace(/\/+/g, '/')
}

/**
 * 全局资源目录顶层段（v14.9: 从 electron/ipc/pathResolution.ts 提升到共享模块——
 * 解析基座选择逻辑 CacheInvalidator 也要用：首段命中 → 解析到 appRoot（如 notes/x.md），
 * 否则 → projectPath。两处共用防漂移）
 */
export const GLOBAL_DIR_NAMES = new Set([
  'style_templates', 'scene_templates', 'knowledge_base', 'uploads', 'notes', '.aiharness',
])
