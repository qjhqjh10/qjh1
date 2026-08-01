# 遗留工作清单与情况说明（v14.3.0）

> **本文档供新会话使用**：直接复制对应章节的说明即可开始优化工作。
> 来源：2026-08-01 多轮审查（工具能力限制 / 上下文输出限制 / 前后端功能对齐 三路并行审计 + 全面代码检查）确认的遗留项，经用户确认为"后续优化方向"。
>
> **进度**：✅ 决策 1-9 全部完成（2026-08-01）。决策 4（token 估算精度）实施记录见 `.aiharness/design/token-estimation-data-2026-08-01.md`：实测 DeepSeek 分词密度（中文小说 1.19 字符/token）→ CJK 1.8→1.2、Latin 4→4.5 → 全量回归零破坏。
>
> 本批改动摘要（详见各章节"实施摘要"）：
> - ② 死代码清理：stats:getPrices/savePrices、lsp:diagnose、agent 系列 8 handler、browser:screenshot、debugLogService 11 死函数（**保留 debug:append-log**——文档原判断有误，DiagnosticLogger 每轮写入）
> - ③ 会话统计增强：审计事件接线（api:call+cost/model、permission:decision）→ readSessionStats 聚合（cost/toolErrors/permissionDenied/lastUsed）+ deleteSession 截断 bug 修复 + 接口收敛 electron.d.ts
> - ⑤ KB embedding 记账：getEmbedding 返回 usage；索引按文件合并 1 条 / 检索每调用 1 条，source='embedding'，cost 记 0（无价格来源，TODO）
> - ⑦ RUN_TIMEOUT 动态化：min(15min, max(5min, maxIterations×60s))
> - ⑧ 压缩保护：strip_detail 保护最近 2 轮 tool detail（按 user 轮次边界）
> - ⑨ 会话池：MAX_SESSIONS 4→8
> - ④ 数据收集：对话测试脚本输出 估算 vs 真实 usage 对比表（tokenEstimation 调整基线）

## 当前状态基线（实施前必须验证）

- 版本 **v14.3.0**（2026-08-01）；架构见 `.aiharness/design/` 与 `docs/软件架构.md`
- 测试基线：`npx tsc --noEmit` + `npx vitest run`（**544 passed + 15 skipped，共 559**）
- 对话场景：31 个（`scripts/test-ai-conversation.mjs`，需 `AI_API_KEY`，全量 ~35 分钟）
- 标准流程：备份到 `.aiharness/backups/YYYY-MM-DD_slug/` → 改动 → 测试全绿 → 删备份
- 版本规则：功能更新 0.1 / 小修补 0.01；**不要自动 bump**（等用户明确指令）
- 已完成的 v14.3 功能（勿重复）：子代理快照跨 run 复用、subagent_ask 会话追问、验收督促闸门、截断续写修复、truncated 假成功修复、Token 统计增强（折线图/byModel/预算口径/缓存列）、操作记录迁移、知识库三处修复、长讨论记忆改善、前端可视化卡片

---

## 遗留决策 1：find_files 审批降级（DANGEROUS_ASK → AUTO）—— ✅ 已完成 2026-08-01

**实施摘要**：ToolDefinition + `approvalGate`（条件审批）；find_files 保留 DANGEROUS_ASK + gate（scope=computer 才审批）；toolExecutorFactory 修复"needsApproval 无审批路径直接放行"漏洞（改为拒绝）；IPC find_files 的 dir_path 走 safeResolve 强制 containment（修复越界搜索漏洞）。单测 +3。测试 547 passed + 15 skipped。

**背景**：批量任务（"处理所有章节"）中，主 agent 每次按文件名定位（find_files）都弹确认框，频繁打断。审查评估其安全风险可控。

**现状**：
- 工具定义 `src/agent/skills/tools/fileTools.ts`（find_files 权限为 DANGEROUS_ASK，约 L255）
- IPC 执行 `electron/ipc/fileToolHandlers.ts`（约 L1002）：`scope=project` 已限制在 appRoot 内、MAX_RESULTS=200、max_depth 默认 5 最大 10
- 主 agent 审批路径：AIChatWindow `onApprovalRequired` → DangerousToolModal（180s 超时视为拒绝）

**建议方案**：
- 方案 A（推荐）：find_files 权限降为 `AUTO`，但 IPC 层强制 `scope` 默认 `project`（当前语义已是如此），绝对路径/`..` 深度搜索仍走审批——需要新增"按参数条件审批"能力（toolRegistry 目前权限是静态的）
- 方案 B（保守）：保留 DANGEROUS_ASK，但在提示词中引导模型优先用 list_directory/search_content 替代 find_files，减少审批频率

**风险**：权限模型改动影响 V4SecurityFence/toolRegistry 的 needsApproval 判定；子 agent 工具集**不要**加 find_files（无审批路径会绕过，这正是当初排除的原因——除非做成 scope=project 专用变体）。

**验证**：单测（权限判定）+ 对话场景（批量任务中 find_files 不再触发审批）。

---

## 遗留决策 2：死代码清理（约 10 个无消费者 IPC handler）—— ✅ 已完成 2026-08-01

**实施摘要**：删除 stats:getPrices/savePrices（含 ModelPrice 类型 3 处）、lsp:diagnose（整文件）、agent 系列 8 handler（整文件 + main.ts 注册/目录条目 + electronBridge agentService + 磁盘 agent-sessions 孤儿数据）、browser:screenshot、debugLogService 11 个死辅助函数。**保留 debug:append-log**（文档原判断有误：DiagnosticLogger L294-308 与 AIChatWindow debugApiError 每轮真实写入）。验证：tsc + vitest 全量通过。

**背景**：前后端对齐审计发现后端铺了 handler 但前端无任何调用。

**清单**（按清理价值排序）：

| # | 位置 | 说明 | 注意 |
|---|------|------|------|
| 1 | `electron/ipc/statsHandlers.ts:243-258` `stats:getPrices/savePrices` | prices.json 孤儿子系统：无 UI 消费者，且 `calculateCost`（electron/ipc/utils.ts:209）根本不读 prices.json | **有测试引用**：`tests/mocks/electron.ts:110`（mock 返回值）；删除需同步改 mock；或反向决策——给 TokenStatsTab 加价格表编辑 UI 并让 calculateCost 读取（功能化而非删除） |
| 2 | `electron/ipc/lspHandlers.ts:11` `lsp:diagnose` | v13.2.0 已删 lsp_diagnose 工具，handler 残留 | electronBridge.lspService 已移除 |
| 3 | `electron/ipc/agentHandlers.ts` `agent:session-save/load/list/delete`、`agent:permission-record`、`agent:permission-patterns`、`agent:get-sessions-path`、`agent:optimize` | 无任何前端调用；`agentService.optimize` wrapper（electronBridge.ts:40-43）也是死 wrapper | 删除前 grep 确认无引用 |
| 4 | `electron/ipc/browserHandlers.ts:83` `browser:screenshot` | 连前端 wrapper 都没有 | — |
| 5 | `electron/main.ts:264` `debug:append-log` | 无前端调用者 | — |

**建议**：先 grep 每个 handler 名的引用（含测试），逐项删除 handler + preload 暴露 + wrapper + 类型；测试 mock 同步清理。**注意**：statsService.getUsage 的 opts 类型缺 `source` 字段（`src/types/electron.d.ts:161`，TokenStatsTab 实际传了）——顺手补上。

**验证**：tsc + vitest 全量（删除后 mock 不引用已删方法）。

---

## 遗留决策 3：会话统计增强（审计日志信息未消费）—— ✅ 已完成 2026-08-01

**实施摘要**：真实问题是"未接线"而非"未消费"（磁盘实证 api:call/tool:call/error 零生产调用）。接线：V4AgentConfig+auditTrail/model → runtime 每轮 recordApiCall（含 cost/model）；toolExecutorFactory 三处 permission:decision。聚合：readSessionStats 抽 parseAuditJsonl 纯函数 + cost/toolErrors/permissionDenied/lastUsed；**修 deleteSession 截断 bug**（sessionId 完整返回）；接口收敛 electron.d.ts 单一来源；TokenStatsTab 汇总卡片+会话徽章+展开区展示。hook:result 不接线（hook 机制已废弃）。

**背景**：审计日志（`src/agent/audit/AuditTrail.ts`）记录了比会话统计展示更多的信息。

**现状**：
- 已消费：`session:start`、`api:call`（仅 tokens）、`tool:call`（→操作描述）、`error`（→计数）
- **记录了但前端不展示**：`tool:result`（工具成败）、`hook:result`（质量钩子通过/失败+反馈）、`permission:decision`（工具调用被拒/允许+原因）、`state:transition`
- `api:call` 只记 prompt/completion tokens，**无 cost、无 model**（后端数据缺口，前端无从展示）
- 会话明细 operations 后端截断为 10 条（statsHandlers.ts 约 L482）；工具 lastUsed 时间戳前端不显示
- 前端：TokenStatsTab 会话统计区（约 L236-383）已显示 errorCount 徽章

**建议**：
- 后端：`readSessionStats` 增补 `toolErrors` / `hookFailed` / `permissionDenied` 计数（从审计事件聚合）；`recordApiCall` 增补 cost/model
- 前端：会话展开区显示上述计数（失败/拒绝信号是最有价值的运营数据）

**风险**：审计日志格式变更影响旧日志解析（向后兼容解析或版本化字段）。

**验证**：单测（readSessionStats 聚合）+ 手动（会话后查看统计）。

---

## 遗留决策 4：token 估算精度（中文 1.8 字/token 低估）—— ✅ 已完成 2026-08-01

**实施摘要**：直接测量（scripts/measure-token-density.mjs，chat usage 反推，无缓存干扰）：中文小说 1.19 / 纯中文 1.72 / 标点密集 1.08 / 纯英文 4.49 字符每 token。定系数 CJK **1.2**、Latin **4.5**。全量回归 558+15 零破坏；S1/S2/S8 场景通过。已知局限：场景级估/真对比受缓存口径影响（input_tokens 疑似只计未缓存部分）；单条空消息固定开销 83 tokens 未纳入 estimateMessages。详见 `.aiharness/design/token-estimation-data-2026-08-01.md`。

**背景**：`src/agent/utils/tokenEstimation.ts`（L6-23）按 CJK 1.8 字符/token、其他 4 字符/token 估算；DeepSeek 实际中文约 1-1.2 字符/token → **估算低估实际用量约 1.5-1.8 倍**。

**影响**：ContextCompressor 的 70/80/90% 阈值基于估算——低估导致压缩触发**晚于**真实越界，存在 API 400 或供应商静默截断风险；上下文进度条显示也偏低。

**建议**：系数 1.8 → 1.2（或 1.3）后全量回归。**连锁影响面大**（压缩阈值、进度条、测试断言都可能变），需要：
1. 先实测确认 DeepSeek 实际分词密度（对比 API usage 与估算值）
2. 调整后跑全部压缩相关测试（ContextCompressor.test.ts 15 例 + V4AgentRuntime 压缩场景）

**风险**：调太紧会导致压缩过早触发（大文件内容更早被截 200 字）——与"大文件处理"目标冲突，需权衡。

**验证**：单测 + 对话场景上下文占比观察。

---

## 遗留决策 5：KB embedding token 记录—— ✅ 已完成 2026-08-01

**实施摘要**：getEmbedding 返回 {embedding, promptTokens}（+getEmbeddingVector 保 IPC 契约）；indexFile 按文件合并记 1 条（逐 chunk 累加）；kb:search 与 notes:search 每次调用记 1 条；kb:getEmbedding IPC 按钮不记（低频测试用途）。source='embedding'（TokenStatsTab 来源筛选+1 项）。**cost 记 0**（ModelConfig 无 embedding 价格字段 + 端点价格不一，TODO: EMBEDDING_PRICE_PER_M）。

**背景**：`electron/ipc/kbHandlers/helpers.ts`（约 L135-143）`getEmbedding` 直连 OpenAI embeddings API，**不走 logTokenUsage**——知识库索引/检索的 embedding 费用完全不在 Token 统计内。

**现状**：embedding 用量口径特殊（usage.jsonl 的 input/output 字段是文本 token 口径）；需要决策：
- 方案 A：logTokenUsage 记一条 inputTokens=embedding tokens、source='pipeline'（或新 source 'embedding'）的条目
- 方案 B：单独 stats 文件记录 embedding 用量

**建议**：方案 A + `source: 'embedding'`（UI 来源筛选加一项），改动小、口径清晰。

**验证**：索引文件后 TokenStatsTab 出现 embedding 来源条目。

---

## 遗留决策 6：子 agent 无 find_files（定位摩擦）—— ✅ 已完成 2026-08-01

**实施摘要**：ANALYZE_TOOL_NAMES + find_files（verify/edit 继承）。安全前提已落地：① find_files 条件审批（scope=computer 仍 needsApproval）② executor 无审批路径时拒绝（子 agent 调 scope=computer 得错误提示）③ IPC dir_path containment。子代理实际只能用 scope=project 软件内定位。

**背景**：`src/agent/subagent/SubagentService.ts` 三个角色工具集均无 find_files（注释明确：DANGEROUS_ASK 无审批路径会直接执行=权限绕过风险）。子代理只能 search_content 按内容定位。

**影响**：主 agent 委托时通常带明确 file_path（不受阻）；但主 agent 自己不确定路径时，必须先自己定位（消耗主轮次+审批）或让子代理盲搜。

**建议**（与决策 1 联动）：若 find_files 降级为 AUTO 且 IPC 强制 scope=project（appRoot 内），则子代理可安全加入 find_files（同样 scope 限制）——**注意子代理工具集加入前必须确认 IPC 层安全边界**，否则保持现状。

**验证**：子代理定位测试 + 权限审计。

---

## 遗留决策 7：5 分钟 RUN_TIMEOUT 硬墙（批量任务）—— ✅ 已完成 2026-08-01

**实施摘要**：`computeRunTimeoutMs(maxIterations) = min(900_000, max(300_000, maxIterations×60_000))`（主 30 轮→15min 封顶；子代理 10 轮→10min；短任务 5min 下限）。检查点在循环顶部（轮间墙钟兜底），maxIterations 终止循环 + [续跑] 恢复，宽松无害。未加 UI 配置（范围克制）。

**背景**：`src/agent/runtime/V4UnifiedRuntime.ts:223` `RUN_TIMEOUT = 300_000` 硬编码。单轮子代理委托可耗 300s + API 180s > 300s 预算——"写 5 章"/批量 20 文件必然中断，靠跨 run 续跑（taskProgress + [续跑]）分多次完成。

**影响**：UX 上批量任务每批次要用户手动"继续" 2-5 次。

**建议**：
- 方案 A：RUN_TIMEOUT 按任务规模/迭代数动态估算（如 maxIterations × 60s），或提为配置项
- 方案 B：保持 5 分钟，但把 [续跑] 注入从"用户下一条消息"改为"自动续跑"（bridge 层检测 interrupted 自动重发）——改动大

**风险**：延长超时 = 长任务期间 UI 锁定更久；自动续跑有循环风险。

**验证**：模拟批量场景。

---

## 遗留决策 8：压缩 70% stripDetail 无最近保护—— ✅ 已完成 2026-08-01

**实施摘要**：`compress(..., protectRecentRounds=2)`：getRecentBoundary 按 user 消息从尾数 N 轮（对齐轮次边界防孤儿 tool；无 user → 全截断保旧行为；不足 N 轮 → 全保护，大文件单轮不截断）；stripDetail 带边界只截旧轮。V4UnifiedRuntime 调用传 2。新增 3 测试（最近 2 轮保护/单轮全保护/无孤儿）。

**背景**：`src/agent/context/ContextCompressor.ts`（L78-96）Stage 1 在 ≥70% 阈值时对所有 tool 消息的 detail 截 200 字（**无最近保护**）——大文件内容一次压缩全丢，形成"膨胀→压缩→失真→重读"循环，且与重复读提醒/读 nudge 矛盾（已部分缓解：重复读文案修正）。

**建议**：Stage 1 增加保护尾部（如最近 2 轮 tool 结果不截断，优先截更早轮）；或对 read_file/analyze_file 结果压缩时保留结构信息（章节标题/关键设定名）而非纯前 200 字。

**风险**：保护尾部 = 压缩率下降，需平衡（窗口足够大时影响小）。

**验证**：ContextCompressor 单测（新增保护尾部用例）。

---

## 遗留决策 9：子代理会话池扩容（4 → 8-16）—— ✅ 已完成 2026-08-01

**实施摘要**：MAX_SESSIONS 4→8（内存 ≈160K 字符，有界）；LRU 测试用例 5→9 会话改造。

**背景**：`src/agent/subagent/SubagentService.ts:71` `MAX_SESSIONS = 4`、`MAX_SESSION_CHARS = 20000`。长讨论中 subagent_ask 追多个文件时旧会话被 LRU 淘汰，追问退化为重新分析（浪费 token/时间）。

**建议**：MAX_SESSIONS 4 → 8（内存成本约 8 × 20K 字符 ≈ 160K 字符 ≈ 8 万 tokens 内存，可接受）；可选按文件大小加权保留。**注意**：扩大会话池增加内存占用与快照过时风险（文件已改但快照旧——subagent_ask 的 userMessage 已有"文件可能已修改"提醒兜底）。

**验证**：SubagentService 会话池测试（LRU 用例调整）。

---

## 通用注意事项

1. 每项改动遵循：备份 → 改动 → `npx tsc --noEmit` + `npx vitest run` 全绿 → 相关对话场景回归 → 删备份
2. 涉及对话场景的改动在 `scripts/test-ai-conversation.mjs`（31 场景）
3. 版本更新：等用户明确指令，按 memory/version-control-rules.md 两阶段执行
4. 交叉依赖：决策 1（find_files 降级）与决策 6（子代理 find_files）联动；决策 2（死代码）与决策 3（会话统计）都在 stats/audit 区域，可合并处理
