// ⚠️ 主进程 logger——与 src/utils/logger.ts 是【刻意分开】的两个文件，不要合并！
// 分开原因（2026-08-11 审计结论）：
//   1. console 语义不同：Node 的 console.error(msg, err) 会把 err 拼进消息；
//      浏览器 console.error(msg, err) 第二参是独立对象（渲染层版多传 err 第三参）。
//   2. 依赖隔离：本文件只能被 electron/ipc 主进程代码引用（相对路径，无 '@' 别名、
//      无 window/electron 依赖）；渲染层版服务于 src/ 全部代码。
// 修改约定：两处函数签名/行为【必须保持一致】——新增函数（如 logInfo/logWarn）请
// 两处同步添加；仅当主/渲染进程对 console 输出格式的需求真正分歧时才各自演化。
const PREFIX = '[青剑]'

export function logError(context: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`${PREFIX} ${context}: ${msg}`)
}
