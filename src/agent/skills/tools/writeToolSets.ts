// ── 写工具集合（单一真源，v16.3.1 审计统一） ──
// 2026-08-11 审计: 原 4 处（ToolExecutor.WRITE_TOOLS / V4UnifiedRuntime.FILE_WRITE_TOOLS /
// toolExecutorFactory.FENCE_WRITE_TOOLS / ReadResultTracker.WRITE_TOOL_NAMES）各自维护镜像，
// 已漂移（v16.1.0 新增 editor_rewrite 时 WRITE_TOOL_NAMES 漏同步 → 协作改写成功后去重层
// 不标记 changed）。现收敛于此模块，各消费方从本模块派生。
//
// 派生规则（v16.3.1 审查强化——集合间为【自动过滤】而非字面量复制，新增工具只需放对基集，
// 其他集合自动跟随，杜绝"只改一处、另一处漏改"）：
//   - 新增【真实落盘文件】的写工具 → 放 FILE_WRITER_NAMES（自动进全部 4 个集合）
//   - 新增【网络/非文件副作用】工具 → 放 NETWORK_WRITES（只进 WRITE_TOOLS + WRITE_TOOL_NAMES，
//     不进 FILE_WRITE_TOOLS——网络写不算文件完成证据，v14.9 C3 语义）
//   - 新增【删除类无产出】工具 → 放 NO_FILE_EVIDENCE（同上，不算文件证据）
//   - 子代理写（edit_file_task）恒为文件证据（各集合显式追加）
// 修改任一集合时请同步更新 WriteToolSets.test.ts 的成员关系断言。
//
// ⚠️ 何时【应该拆开】而不是继续共享（2026-08-11 审查结论）：本共享成立的前提是 4 个集合
//   对"写工具"的语义同向（新增写工具时全部集合自动跟随是期望行为）。若未来出现以下
//   语义分歧，请拆成独立基集（各集合自持成员清单），不要继续依赖自动过滤：
//   - 某工具只属于单个集合（如"仅围栏拦截、不算完成证据、不串行化"）——当前无此工具，
//     出现时为其建立显式差异集（如 FENCE_ONLY_NAMES），不要塞进公共基集；
//   - 集合间语义方向相反（如"完成证据"要收某工具而"围栏"要排除且原因互斥）——
//     此时共享基集会迫使两处同步变化，拆开后各自演化。
//   判断标准：新增工具时如果会纠结"放哪个基集"，说明语义已分歧，应拆。 */

/** 真实落盘文件的写工具（完成证据 + 围栏 + 去重失效的公共基集） */
const FILE_WRITER_NAMES = [
  'create_file', 'edit_file', 'batch_replace', 'delete_file', 'rename_file',
  'kb_append_file', 'kb_index_file',  // v14.9(审计): +kb_index_file——索引必须等文件落盘后执行
]

/** 网络/浏览器副作用写——串行化执行，但【不算文件写证据】（v14.9 C3: 只抓网页后声明完成不放行） */
const NETWORK_WRITES = ['http_get', 'http_fetch', 'browser_open', 'browser_search']

/** 删除类无产出内容的工具——【不算文件写证据】 */
const NO_FILE_EVIDENCE = ['delete_project']

/** 副作用写工具——串行化执行（ToolExecutor 分类依据）。
 * v16.3.0: generate_image 已移除（原归入此集合）；
 * v16.1.0(审查修复): +editor_rewrite——归入串行写工具，防同轮多次调用并行 dispatchRewrite
 * 到单槽 pendingAction 后写覆盖前写（竞态丢失改写）。 */
export const WRITE_TOOLS = new Set([
  ...FILE_WRITER_NAMES,
  'create_project',
  ...NO_FILE_EVIDENCE,
  ...NETWORK_WRITES,
  'editor_rewrite',
])

/** 文件写证据集合——完成判定闸门（v14.9 C3: 证据 = 文件写成功，跨轮累积）。
 * = WRITE_TOOLS 自动剔除网络写/删除类 + edit_file_task（子代理写）。
 * edit_file_task 与 editor_rewrite（协作改写）同为文件证据。 */
export const FILE_WRITE_TOOLS = new Set([
  ...[...WRITE_TOOLS].filter(t => !NETWORK_WRITES.includes(t) && !NO_FILE_EVIDENCE.includes(t)),
  'edit_file_task',
])

/** 协作只读围栏集合（v16.1.0）——chapterCollab 关联模式下禁止写当前章节文件的工具。
 * = FILE_WRITE_TOOLS 自动剔除 create_project（新建项目不触碰本章文件）与
 * editor_rewrite（协作改写的唯一合法写通道，不能被围栏拦截）。 */
export const FENCE_WRITE_TOOLS = new Set(
  [...FILE_WRITE_TOOLS].filter(t => t !== 'create_project' && t !== 'editor_rewrite'),
)

/** 去重层失效集合——写工具成功后使 ReadResultTracker 读记录失效（v15.6）。
 * = WRITE_TOOLS 全部 + edit_file_task（写子代理同样使读记录失效）。 */
export const WRITE_TOOL_NAMES = new Set([
  ...WRITE_TOOLS,
  'edit_file_task',
])
