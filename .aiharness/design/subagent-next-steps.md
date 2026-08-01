# 子 Agent 后续功能计划（跨 run 续跑 / 批量并行 / 验收子代理）

> 本文档供新会话使用。背景：v14.1.1 已完成"子 agent 上下文隔离"（analyze_file/edit_file_task 委托独立上下文窗口），
> 以下三个功能为已验证架构上的后续增量。实施前请阅读现状代码，遵循"备份→改动→测试→删备份"流程。

## 现状速览（v14.1.1，已实现）

- 主 agent：V4UnifiedRuntime（任务清单状态 v14.1.0 + 子代理委托工具 v14.1.1），29 工具
- 子 agent：`src/agent/subagent/SubagentService.ts`（runSubagent 工厂，isolatedStore，64K 窗口）+ SubagentPrompt + createSubagentAdapter
- 委托工具：`analyze_file`（只读）/ `edit_file_task`（读写），SERIAL_TOOLS 串行执行，subAgentUsage 主/子分开统计
- 测试：498 单测 + 25 场景对话测试（S_MT2 多任务压力 / S_SUB1 大文件分析 / S_SUB2 长文件修改）

---

## 功能 1：跨 run 续跑（解决"长时间坚持"）

**问题**：主 agent run 有 30 轮 / 5 分钟硬上限；中断后任务清单（taskList/taskDone）随 runtime 销毁丢失，新 run 无法从断点继续。

**设计**：
1. **任务状态持久化**：
   - `V4AgentRunResult` 已有 `subAgentUsage` 等；新增返回 `taskProgress?: { tasks: {id, desc, done}[] }`（仅 taskList 非空时）
   - BridgeSendResult 透传 → AIChatWindow 把 taskProgress 存入**会话消息**（assistant 消息附字段，IndexedDB 自动持久化）
2. **恢复注入**：
   - `buildHistoryMessages` 或 `updateHistory` 时，检测上一轮 assistant 消息的 taskProgress 未完成 → 注入 user/system 消息：
     `[续跑] 上次中断于任务 X/Y，已完成: …；剩余: …。请继续完成剩余任务，不要重新开始。`
   - 复用现有任务清单机制：提取/注入/完成检测全部复用（taskExtraction + injectTaskStatus + GLOBAL_DONE_RE）
3. **触发条件**：run 因 maxIterations/RUN_TIMEOUT/异常中断（非正常完成）→ 标记"未完成"；用户下一条消息（含"继续"）触发续跑注入
4. **注意**：
   - 不要在正常完成的消息上注入续跑（检查 taskDone 全 true 或无任务清单）
   - 续跑注入后模型可能重做已完成任务 → 提示词明确"已完成的不重复"
   - 测试：集成测试（T_Resume1 中断后恢复）+ 对话场景（S_RESUME 长任务分两轮完成）

## 功能 2：批量并行分析（子代理并行）

**问题**：SERIAL_TOOLS 串行执行多个 analyze_file——多文件分析总时长叠加；续写/仿写流水线的批量逐章分析也未并行。

**设计**：
1. **安全并行条件**：analyze_file（只读）可并行；edit_file_task（写）保持串行——SERIAL_TOOLS 拆分为 `PARALLEL_READ_SUBAGENTS`（analyze_file）与 `SERIAL_WRITE_SUBAGENTS`（edit_file_task）
2. **并行实现**：V4UnifiedRuntime 的 serialReads 段改为：analyze_file 归回 readOnlyCalls 的 Promise.all（只读无副作用）；**但注意 isolatedStore 已保证 store 安全**（v14.1.1 已验证），并发正确性由 isolatedStore 兜底
3. **批量场景接入**：续写（ContinuationWorkspacePage 的逐章分析 L195-223）/ 仿写（ImitationDetailedPage）目前用 chatAI 硬编码流水线——可改造为并发 analyze_file 子代理（产出格式不变，收益：上下文隔离 + 并行）
4. **注意**：
   - 并发上限（如同时 ≤3 个子代理）防 API 限流——Promise.all 分片（改写工作区已有分批先例：RewriteWorkspacePage L583-648 每批 4 章）
   - 每个子代理独立 abort：SubagentService 已支持 signal 传播
   - 测试：集成测试（同轮 3 个 analyze_file 并行完成）+ 对话场景（S_PAR 多文件并行分析）

## 功能 3：验收子代理（产物质量验证）

**问题**：写作完成后无自动验收——产物是否符合任务要求（文件存在、关键内容、格式）无法验证。

**设计**：
1. **验收工具** `verify_task`（只读子代理）：参数 `file_paths[]` + `criteria[]`（验收标准，可来自任务清单的验收字段或主 agent 生成）→ 子代理读取产物 → 对照标准逐项判定 → 返回 `{passed: boolean, items: [{criterion, passed, reason}]}`
2. **接入点**：
   - 任务清单模式：完成检测通过后（清单清空），主 agent 可选调 verify_task（提示词引导："任务完成后建议用 verify_task 验收"）
   - 或运行时自动：清单清空时注入提示（不强制）
3. **工具集**：复用 ANALYZE_TOOL_NAMES（只读）+ 提示词加"对照验收标准逐项检查，不修改文件"
4. **注意**：
   - 验收失败 → 主 agent 收到 items 后决定修复（委托 edit_file_task）或汇报用户
   - detail 截断（参考 analyze_file 4000）
   - 测试：集成测试（verify 通过/失败两路径）+ 对话场景（S_VERIFY 写作后验收）

---

## 实施建议顺序

1. 功能 1（跨 run 续跑）——复用现有任务清单机制，改动集中在 AIChatWindow 消息持久化 + Bridge 透传，风险最低、收益最直接
2. 功能 2（批量并行）——analyze_file 并行是纯收益（续写/仿写场景大文件批量分析）
3. 功能 3（验收）——独立新工具，不依赖前两者

## 通用约束

- 不引入新 npm 依赖；双协议兼容；备份到 `.aiharness/backups/`；测试全绿后删备份
- 测试基线：`npx tsc --noEmit` + `npx vitest run`（498+）+ 对话测试 25 场景
- 对话测试：`export AI_API_KEY=sk-... && npx tsx scripts/test-ai-conversation.mjs`
