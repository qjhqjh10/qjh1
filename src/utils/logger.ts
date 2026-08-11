// ⚠️ 渲染层 logger——与 electron/ipc/logger.ts 是【刻意分开】的两个文件，不要合并！
// 分开原因（2026-08-11 审计结论）：
//   1. console 语义不同：浏览器 console.error(msg, err) 第二参渲染为独立对象（保留 err
//      便于 DevTools 展开）；Node 侧（主进程版）会直接拼接进消息文本。
//   2. 依赖隔离：本文件可被 src/ 全量引用（含 '@' 别名）；主进程版禁止带 '@' 别名
//      （electron-vite main 构建不解析别名，仅相对路径可用）。
// 修改约定：两处函数签名/行为【必须保持一致】——新增函数请两处同步添加。
const PREFIX = '[青剑]'

export function logError(context: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`${PREFIX} ${context}: ${msg}`, err)
}
